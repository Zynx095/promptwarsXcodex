import { Router } from 'express';
import { loginSchema } from '../../shared/schemas';
import type { DemoAccount, MeResponse } from '../../shared/types';
import type { IndustryKey } from '../../shared/industries';
import type { AppContext } from '../context';
import { HttpError, parse } from '../http';
import { clearSessionCookie, requireUser, setSessionCookie } from '../auth/session';
import { verifyPin } from '../auth/crypto';
import { findLoginByPhone } from '../repositories/users';
import { requireOrg, toSummary } from '../repositories/orgs';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

/** In-memory login throttle per client IP and phone number (per server instance). */
class LoginThrottle {
  private failures = new Map<string, { count: number; resetAt: number }>();
  check(key: string, now: number): void {
    const f = this.failures.get(key);
    if (f && f.resetAt > now && f.count >= MAX_FAILURES) {
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

  r.post('/auth/login', (req, res) => {
    const input = parse(loginSchema, req.body);
    const key = `${req.ip}|${input.phone}`;
    const now = ctx.now().getTime();
    throttle.check(key, now);
    const login = findLoginByPhone(ctx.db, input.phone);
    // Verify against a dummy hash when the account is unknown to keep timing similar.
    const ok = verifyPin(input.pin, login?.pinHash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') && !!login?.active;
    if (!login || !ok) {
      throttle.fail(key, now);
      throw new HttpError(401, 'INVALID_LOGIN', 'Phone number or PIN is incorrect.');
    }
    throttle.succeed(key);
    setSessionCookie(ctx, res, login.id);
    res.json({ ok: true });
  });

  r.post('/auth/logout', (_req, res) => {
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
