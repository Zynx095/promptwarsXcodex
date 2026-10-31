// Signed, HttpOnly cookie sessions. The cookie carries only the user ID, a session version and
// expiry; role, organisation, active status and the current session version are re-read from the
// database on every request, so bumping the version (logout, deactivation) revokes issued cookies.
import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { hmac, safeEqual } from './crypto';
import { HttpError } from '../http';
import type { AppContext } from '../context';
import type { Role } from '../../shared/types';
import { bumpSessionVersion, findSessionUser, getSessionVersion, raiseSessionVersion, type SessionUserRow } from '../repositories/users';

export const SESSION_COOKIE = 'fs_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUserRow;
  }
}

export function createToken(secret: string, userId: string, now: Date, version = 0): string {
  const sid = randomBytes(16).toString('hex');
  const payload = Buffer.from(JSON.stringify({ sub: userId, sid, ver: version, exp: now.getTime() + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${hmac(secret, payload)}`;
}

/** Returns the signed claims of a valid, unexpired token. Tokens issued before versioning count as version 0. */
export function verifyTokenClaims(secret: string, token: string, now: Date): { sub: string; ver: number } | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(sig, hmac(secret, payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown; exp?: unknown; ver?: unknown };
    if (typeof data.sub !== 'string' || typeof data.exp !== 'number' || data.exp <= now.getTime()) return null;
    const ver = data.ver === undefined ? 0 : data.ver;
    if (typeof ver !== 'number' || !Number.isSafeInteger(ver)) return null;
    return { sub: data.sub, ver };
  } catch {
    return null;
  }
}

export function verifyToken(secret: string, token: string, now: Date): string | null {
  return verifyTokenClaims(secret, token, now)?.sub ?? null;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function setSessionCookie(ctx: AppContext, res: Response, userId: string): void {
  res.cookie(SESSION_COOKIE, createToken(ctx.config.sessionSecret, userId, ctx.now(), getSessionVersion(ctx.db, userId)), {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.production,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

/** Revokes every cookie issued to the user so far (all devices). */
export function revokeSessions(ctx: AppContext, userId: string): void {
  bumpSessionVersion(ctx.db, userId);
}

export function clearSessionCookie(ctx: AppContext, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: ctx.config.production, path: '/' });
  res.clearCookie('fs_oauth_state', { httpOnly: true, sameSite: 'lax', secure: ctx.config.production, path: '/' });
}

/** Attaches req.user when a valid session cookie for an active user is present. */
export function sessionMiddleware(ctx: AppContext): RequestHandler {
  return (req, _res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      const claims = verifyTokenClaims(ctx.config.sessionSecret, token, ctx.now());
      if (claims) {
        const user = findSessionUser(ctx.db, claims.sub);
        if (user && user.active) {
          const current = getSessionVersion(ctx.db, user.id);
          // A signed version above the stored one was issued by a server instance with its own
          // database (separate Vercel function instances each keep one in /tmp). Adopting it keeps
          // the user signed in there and still rejects cookies older than that sign-in.
          if (claims.ver > current) raiseSessionVersion(ctx.db, user.id, claims.ver);
          if (claims.ver >= current) req.user = user;
        }
      }
    }
    next();
  };
}

export function requireUser(req: Request): SessionUserRow {
  if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  return req.user;
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = requireUser(req);
    if (!roles.includes(user.role)) throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to do this.');
    next();
  };
}

/**
 * CSRF defence for state-changing requests: SameSite=Lax cookies, plus a JSON content type
 * (not sendable cross-site without a CORS preflight) and a same-origin Origin header when present.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!req.is('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Requests must be sent as JSON.');
  }
  const origin = req.headers.origin;
  if (origin) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      /* treated as mismatch */
    }
    if (host !== req.headers.host) throw new HttpError(403, 'BAD_ORIGIN', 'Cross-site request blocked.');
  }
  next();
};
