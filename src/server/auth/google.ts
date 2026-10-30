import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { hmac, safeEqual } from './crypto';
import { HttpError } from '../http';
import type { AppContext } from '../context';
import { findUserByIdentity, findUserByIdentityEmail, linkIdentity, updateIdentityLastSignIn } from '../repositories/users';
import { setSessionCookie } from './session';

export const OAUTH_STATE_COOKIE = 'fs_oauth_state';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface OAuthStatePayload {
  state: string;
  nonce: string;
  codeVerifier: string;
  exp: number;
}

export function isGoogleConfigured(ctx: AppContext): boolean {
  return Boolean(ctx.config.googleClientId && ctx.config.googleClientSecret);
}

export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function createSignedOAuthState(secret: string, payload: OAuthStatePayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = hmac(secret, data);
  return `${data}.${sig}`;
}

export function verifySignedOAuthState(secret: string, token: string, now: Date): OAuthStatePayload | null {
  const [data, sig] = token.split('.');
  if (!data || !sig || !safeEqual(sig, hmac(secret, data))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as OAuthStatePayload;
    if (!parsed || typeof parsed.state !== 'string' || typeof parsed.nonce !== 'string' || typeof parsed.codeVerifier !== 'string') {
      return null;
    }
    if (typeof parsed.exp !== 'number' || parsed.exp <= now.getTime()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getEffectiveGoogleCallbackUrl(ctx: AppContext, req: Request): string {
  if (ctx.config.googleCallbackUrl) return ctx.config.googleCallbackUrl;
  const proto = req.secure || ctx.config.production ? 'https' : 'http';
  const host = req.get('host') || `localhost:${ctx.config.port}`;
  return `${proto}://${host}/api/auth/google/callback`;
}

export function startGoogleAuth(ctx: AppContext, req: Request, res: Response): void {
  if (!isGoogleConfigured(ctx)) {
    throw new HttpError(
      503,
      'PROVIDER_NOT_CONFIGURED',
      'Google Sign-In is not configured in this environment. Please configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    );
  }

  const { codeVerifier, codeChallenge } = generatePkce();
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const now = ctx.now();

  const signedCookie = createSignedOAuthState(ctx.config.sessionSecret, {
    state,
    nonce,
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

  const redirectUri = getEffectiveGoogleCallbackUrl(ctx, req);
  const params = new URLSearchParams({
    client_id: ctx.config.googleClientId!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export async function verifyGoogleTokenInfo(
  idToken: string,
  expectedClientId: string,
  expectedNonce?: string,
  now: Date = new Date(),
): Promise<GoogleUserInfo> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new HttpError(401, 'INVALID_TOKEN', `Failed to verify Google ID token: ${errText || res.statusText}`);
  }
  const data = (await res.json()) as {
    sub?: string;
    aud?: string;
    iss?: string;
    email?: string;
    email_verified?: string | boolean;
    name?: string;
    exp?: string | number;
    nonce?: string;
  };

  if (!data.sub || !data.email) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Google token missing required claims (sub, email).');
  }

  if (data.aud !== expectedClientId) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Google token audience mismatch.');
  }

  const validIssuers = ['https://accounts.google.com', 'accounts.google.com'];
  if (!data.iss || !validIssuers.includes(data.iss)) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid Google token issuer.');
  }

  const nowSec = Math.floor(now.getTime() / 1000);
  const expSec = typeof data.exp === 'string' ? parseInt(data.exp, 10) : typeof data.exp === 'number' ? data.exp : NaN;
  if (!Number.isFinite(expSec) || expSec < nowSec) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Google ID token has expired.');
  }

  // A nonce was sent with the authorization request, so the ID token must echo it back (OIDC Core 3.1.3.7).
  if (expectedNonce && (typeof data.nonce !== 'string' || !safeEqual(data.nonce, expectedNonce))) {
    throw new HttpError(401, 'INVALID_TOKEN', 'Google token nonce mismatch.');
  }

  const emailVerified = data.email_verified === true || data.email_verified === 'true';
  if (!emailVerified) {
    throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Google email is not verified.');
  }

  return {
    sub: data.sub,
    email: data.email.toLowerCase(),
    emailVerified: true,
    name: data.name ?? 'Google User',
  };
}

export async function handleGoogleCallback(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;
  const error = typeof req.query.error === 'string' ? req.query.error : null;

  // Clear state cookie regardless of outcome
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

  const redirectUri = getEffectiveGoogleCallbackUrl(ctx, req);

  // Exchange authorization code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: ctx.config.googleClientId!,
      client_secret: ctx.config.googleClientSecret!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: savedState.codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    console.error('[Google OAuth] Token exchange failed:', errText);
    res.redirect('/login?auth_error=token_exchange_failed');
    return;
  }

  const tokenData = (await tokenRes.json()) as { id_token?: string; access_token?: string };
  if (!tokenData.id_token) {
    res.redirect('/login?auth_error=missing_id_token');
    return;
  }

  const userinfo = await verifyGoogleTokenInfo(tokenData.id_token, ctx.config.googleClientId!, savedState.nonce, ctx.now());

  // Identity Mapping & Authorization:
  // 1. Look up existing link in auth_identities
  let user = findUserByIdentity(ctx.db, 'google', userinfo.sub);

  // 2. If not linked by subject ID, check if user exists by verified email that was pre-provisioned
  if (!user && userinfo.email) {
    const invitedUser = findUserByIdentityEmail(ctx.db, userinfo.email);
    if (invitedUser && invitedUser.active) {
      // Link Google identity to the provisioned user account
      linkIdentity(ctx.db, {
        id: randomBytes(16).toString('hex'),
        userId: invitedUser.id,
        provider: 'google',
        providerUserId: userinfo.sub,
        email: userinfo.email,
        createdAt: ctx.now().toISOString(),
        lastSignInAt: ctx.now().toISOString(),
      });
      user = invitedUser;
    }
  }

  // 3. If still no mapped account, reject unprovisioned identity without creating arbitrary privileged users
  if (!user) {
    res.redirect(`/login?auth_error=unprovisioned&email=${encodeURIComponent(userinfo.email)}`);
    return;
  }

  if (!user.active) {
    res.redirect('/login?auth_error=inactive_account');
    return;
  }

  // Record sign-in timestamp
  updateIdentityLastSignIn(ctx.db, 'google', userinfo.sub, ctx.now().toISOString());

  // Establish session cookie
  setSessionCookie(ctx, res, user.id);

  // Redirect to app root (which forwards to /worker or /admin based on user.role)
  res.redirect('/');
}
