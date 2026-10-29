// Signed, HttpOnly cookie sessions. The cookie carries only the user ID and expiry; role and
// organisation are re-read from the database on every request.
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { hmac, safeEqual } from './crypto';
import { HttpError } from '../http';
import type { AppContext } from '../context';
import type { Role } from '../../shared/types';
import { findSessionUser, type SessionUserRow } from '../repositories/users';

export const SESSION_COOKIE = 'fs_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUserRow;
  }
}

export function createToken(secret: string, userId: string, now: Date): string {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: now.getTime() + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${hmac(secret, payload)}`;
}

export function verifyToken(secret: string, token: string, now: Date): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(sig, hmac(secret, payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown; exp?: unknown };
    if (typeof data.sub !== 'string' || typeof data.exp !== 'number' || data.exp <= now.getTime()) return null;
    return data.sub;
  } catch {
    return null;
  }
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
  res.cookie(SESSION_COOKIE, createToken(ctx.config.sessionSecret, userId, ctx.now()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.production,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
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
      const userId = verifyToken(ctx.config.sessionSecret, token, ctx.now());
      if (userId) {
        const user = findSessionUser(ctx.db, userId);
        if (user && user.active) req.user = user;
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
