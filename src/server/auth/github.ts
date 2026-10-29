import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { safeEqual } from './crypto';
import { HttpError } from '../http';
import type { AppContext } from '../context';
import { findUserByIdentity, findUserByIdentityEmail, linkIdentity, updateIdentityLastSignIn } from '../repositories/users';
import { setSessionCookie } from './session';
import { createSignedOAuthState, generatePkce, OAUTH_STATE_COOKIE, verifySignedOAuthState } from './google';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function isGithubConfigured(ctx: AppContext): boolean {
  return Boolean(ctx.config.githubClientId && ctx.config.githubClientSecret);
}

export function getEffectiveGithubCallbackUrl(ctx: AppContext, req: Request): string {
  if (ctx.config.githubCallbackUrl) return ctx.config.githubCallbackUrl;
  const proto = req.secure || ctx.config.production ? 'https' : 'http';
  const host = req.get('host') || `localhost:${ctx.config.port}`;
  return `${proto}://${host}/api/auth/github/callback`;
}

export function startGithubAuth(ctx: AppContext, req: Request, res: Response): void {
  if (!isGithubConfigured(ctx)) {
    throw new HttpError(503, 'PROVIDER_NOT_CONFIGURED', 'GitHub Sign-In is not configured in this environment. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.');
  }

  const { codeVerifier } = generatePkce();
  const state = randomBytes(32).toString('base64url');
  const now = ctx.now();

  const signedCookie = createSignedOAuthState(ctx.config.sessionSecret, {
    state,
    nonce: 'github',
    codeVerifier,
    exp: now.getTime() + OAUTH_STATE_TTL_MS,
  });

  res.cookie(OAUTH_STATE_COOKIE, signedCookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.production,
    maxAge: OAUTH_STATE_TTL_MS,
    path: '/',
  });

  const redirectUri = getEffectiveGithubCallbackUrl(ctx, req);
  const params = new URLSearchParams({
    client_id: ctx.config.githubClientId!,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
}

export async function handleGithubCallback(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;
  const error = typeof req.query.error === 'string' ? req.query.error : null;

  res.clearCookie(OAUTH_STATE_COOKIE, { httpOnly: true, sameSite: 'lax', secure: ctx.config.production, path: '/' });

  if (error) {
    res.redirect(`/login?auth_error=${encodeURIComponent(error)}`);
    return;
  }

  if (!code || !state) {
    res.redirect('/login?auth_error=missing_callback_params');
    return;
  }

  const cookieHeader = req.headers.cookie ?? '';
  let rawStateCookie: string | null = null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === OAUTH_STATE_COOKIE) {
      rawStateCookie = decodeURIComponent(part.slice(idx + 1).trim());
      break;
    }
  }

  if (!rawStateCookie) {
    res.redirect('/login?auth_error=session_expired');
    return;
  }

  const savedState = verifySignedOAuthState(ctx.config.sessionSecret, rawStateCookie, ctx.now());
  if (!savedState || !safeEqual(savedState.state, state)) {
    res.redirect('/login?auth_error=state_mismatch');
    return;
  }

  const redirectUri = getEffectiveGithubCallbackUrl(ctx, req);

  // Exchange code for token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: ctx.config.githubClientId,
      client_secret: ctx.config.githubClientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    res.redirect('/login?auth_error=token_exchange_failed');
    return;
  }

  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    res.redirect('/login?auth_error=missing_access_token');
    return;
  }

  // Fetch GitHub User profile
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'User-Agent': 'FairShift-App',
    },
  });

  if (!userRes.ok) {
    res.redirect('/login?auth_error=profile_fetch_failed');
    return;
  }

  const githubUser = (await userRes.json()) as { id: number | string; login: string };
  const githubUserId = String(githubUser.id);

  // Fetch emails to get verified primary email
  let primaryEmail: string | null = null;
  const emailsRes = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'User-Agent': 'FairShift-App',
    },
  });

  if (emailsRes.ok) {
    const emailsData = await emailsRes.json().catch(() => null);
    if (Array.isArray(emailsData)) {
      const match = emailsData.find((e) => e && e.primary && e.verified);
      if (match && typeof match.email === 'string') primaryEmail = match.email.toLowerCase();
    }
  }

  // Identity Mapping & Authorization
  let user = findUserByIdentity(ctx.db, 'github', githubUserId);

  if (!user && primaryEmail) {
    const invitedUser = findUserByIdentityEmail(ctx.db, primaryEmail);
    if (invitedUser && invitedUser.active) {
      linkIdentity(ctx.db, {
        id: randomBytes(16).toString('hex'),
        userId: invitedUser.id,
        provider: 'github',
        providerUserId: githubUserId,
        email: primaryEmail,
        createdAt: ctx.now().toISOString(),
        lastSignInAt: ctx.now().toISOString(),
      });
      user = invitedUser;
    }
  }

  if (!user) {
    res.redirect(`/login?auth_error=unprovisioned${primaryEmail ? `&email=${encodeURIComponent(primaryEmail)}` : ''}`);
    return;
  }

  if (!user.active) {
    res.redirect('/login?auth_error=inactive_account');
    return;
  }

  updateIdentityLastSignIn(ctx.db, 'github', githubUserId, ctx.now().toISOString());
  setSessionCookie(ctx, res, user.id);
  res.redirect('/');
}
