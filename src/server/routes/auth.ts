import { Router } from 'express';
import { loginSchema, phoneOtpRequestSchema, phoneOtpVerifySchema } from '../../shared/schemas';
import type { AuthConfigResponse, DemoAccount, MeResponse } from '../../shared/types';
import type { IndustryKey } from '../../shared/industries';
import type { AppContext } from '../context';
import { HttpError, parse } from '../http';
import { clearSessionCookie, requireUser, revokeSessions, setSessionCookie } from '../auth/session';
import { verifyPin } from '../auth/crypto';
import { findLoginByPhone } from '../repositories/users';
import { requireOrg, toSummary } from '../repositories/orgs';
import { handleGoogleCallback, isGoogleConfigured, startGoogleAuth } from '../auth/google';
import { getSmsProvider, requestPhoneOtp, verifyPhoneOtp } from '../auth/sms';
import { handleGithubCallback, isGithubConfigured, startGithubAuth } from '../auth/github';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
/**
 * Failures allowed per phone number across all client IPs. A 4-digit PIN has only 10,000 values,
 * so the per-IP limit alone would let an attacker rotating addresses guess it quickly.
 */
export const MAX_FAILURES_PER_PHONE = 30;

/** In-memory login throttle per client IP and phone number (per server instance). */
class LoginThrottle {
  private failures = new Map<string, { count: number; resetAt: number }>();
  check(key: string, now: number, max = MAX_FAILURES): void {
    const f = this.failures.get(key);
    if (f && f.resetAt > now && f.count >= max) {
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed sign-in attempts. Wait 15 minutes and try again.');
    }
  }
  fail(key: string, now: number): void {
    const f = this.failures.get(key);
    if (!f || f.resetAt <= now) this.failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
    else f.count++;
    if (this.failures.size > 10000) this.failures.clear();
  }
  succeed(key: string): void {
    this.failures.delete(key);
  }
}

export function authRoutes(ctx: AppContext): Router {
  const r = Router();
  const throttle = new LoginThrottle();

  /** Reports genuinely configured authentication providers. */
  r.get('/auth/config', (_req, res) => {
    const body: AuthConfigResponse = {
      demoMode: ctx.config.demoMode,
      providers: {
        google: {
          configured: isGoogleConfigured(ctx),
          name: 'Google',
        },
        phoneOtp: {
          configured: getSmsProvider(ctx).isConfigured(),
          name: 'Phone OTP',
        },
        github: {
          configured: isGithubConfigured(ctx),
          name: 'GitHub',
        },
      },
    };
    res.json(body);
  });

  // ---- Traditional Phone + PIN Login (Active in Demo Mode & Legacy Accounts) ----
  r.post('/auth/login', (req, res) => {
    const input = parse(loginSchema, req.body);
    const key = `${req.ip}|${input.phone}`;
    const phoneKey = `phone|${input.phone}`;
    const now = ctx.now().getTime();
    throttle.check(key, now);
    throttle.check(phoneKey, now, MAX_FAILURES_PER_PHONE);
    const login = findLoginByPhone(ctx.db, input.phone);
    // Verify against a dummy hash when the account is unknown to keep timing similar.
    const ok = verifyPin(input.pin, login?.pinHash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') && !!login?.active;
    if (!login || !ok) {
      throttle.fail(key, now);
      throttle.fail(phoneKey, now);
      throw new HttpError(401, 'INVALID_LOGIN', 'Phone number or PIN is incorrect.');
    }
    throttle.succeed(key);
    throttle.succeed(phoneKey);
    setSessionCookie(ctx, res, login.id);
    res.json({ ok: true });
  });

  // ---- Phone OTP Authentication ----
  r.post('/auth/phone/otp/request', async (req, res) => {
    const input = parse(phoneOtpRequestSchema, req.body);
    const result = await requestPhoneOtp(ctx, input.phone);
    res.json(result);
  });

  r.post('/auth/phone/otp/verify', async (req, res) => {
    const input = parse(phoneOtpVerifySchema, req.body);
    const result = await verifyPhoneOtp(ctx, res, input.phone, input.code);
    res.json(result);
  });

  // ---- Google OAuth / OIDC Flow ----
  r.get('/auth/google/start', (req, res) => {
    startGoogleAuth(ctx, req, res);
  });

  r.get('/auth/google/callback', async (req, res) => {
    await handleGoogleCallback(ctx, req, res);
  });

  // ---- GitHub OAuth Flow ----
  r.get('/auth/github/start', (req, res) => {
    startGithubAuth(ctx, req, res);
  });

  r.get('/auth/github/callback', async (req, res) => {
    await handleGithubCallback(ctx, req, res);
  });

  // ---- Session Management & Current Identity ----
  r.post('/auth/logout', (req, res) => {
    // Revoke server-side too: a copied cookie must stop working after sign-out.
    if (req.user) revokeSessions(ctx, req.user.id);
    clearSessionCookie(ctx, res);
    res.json({ ok: true });
  });

  r.get('/auth/me', (req, res) => {
    const user = requireUser(req);
    const org = requireOrg(ctx.db, user.orgId);
    const body: MeResponse = {
      user: { id: user.id, orgId: user.orgId, role: user.role, name: user.name, jobTitle: user.jobTitle, team: user.team },
      org: toSummary(org),
      demoMode: ctx.config.demoMode,
    };
    res.json(body);
  });

  // ---- Synthetic Demo Accounts Listing (Guarded by DEMO_MODE) ----
  r.get('/demo/accounts', (_req, res) => {
    if (!ctx.config.demoMode) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
    const accounts = ctx.db.all<DemoAccount & { industry: IndustryKey }>(
      `SELECT u.name, u.role, u.phone, o.name AS orgName, o.industry, u.job_title AS jobTitle
       FROM users u JOIN organizations o ON o.id = u.org_id
       WHERE u.is_synthetic = 1 AND u.active = 1 ORDER BY o.industry, u.role DESC, u.name LIMIT 50`,
    );
    res.json({ accounts, pinHint: 'All synthetic demo accounts use PIN 1234.' });
  });

  return r;
}
