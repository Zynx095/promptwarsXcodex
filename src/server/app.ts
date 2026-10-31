import express, { type Express, type RequestHandler } from 'express';
import type { AppContext } from './context';
import { csrfGuard, sessionMiddleware } from './auth/session';
import { errorHandler, HttpError } from './http';
import { authRoutes } from './routes/auth';
import { workerRoutes } from './routes/worker';
import { adminRoutes } from './routes/admin';
import { notificationRoutes } from './routes/notifications';
import { speechRoutes } from './routes/speech';

function securityHeaders(production: boolean): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    // Camera for safety evidence and microphone for dictation are allowed for this site only
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    if (production) {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    }
    next();
  };
}

const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

/**
 * Builds the HTTP application. `frontend` mounts the web client (Vite in development,
 * static files in production); tests omit it and exercise the API only.
 */
export async function createApp(ctx: AppContext, frontend?: (app: Express) => Promise<void> | void): Promise<Express> {
  const app = express();
  app.disable('x-powered-by');
  // Cloud Run terminates TLS at one proxy hop; trust it so req.ip is the client address.
  app.set('trust proxy', ctx.config.production ? 1 : false);
  app.use(securityHeaders(ctx.config.production));

  app.get(['/healthz', '/api/health'], (_req, res) => {
    ctx.db.get('SELECT 1 AS ok');
    res.json({ status: 'ok' });
  });

  // Photo uploads are the one place a larger body is accepted (base64 of a resized photo)
  app.use('/api/reports/:id/evidence', express.json({ limit: '2200kb' }));
  app.use('/api', noStore, express.json({ limit: '32kb' }), csrfGuard, sessionMiddleware(ctx));
  app.use('/api', authRoutes(ctx));
  app.use('/api/admin', adminRoutes(ctx));
  app.use('/api', workerRoutes(ctx));
  app.use('/api', notificationRoutes(ctx));
  app.use('/api', speechRoutes(ctx));

  app.use('/api', (_req, _res, next) => {
    next(new HttpError(404, 'NOT_FOUND', 'Unknown API endpoint.'));
  });

  if (frontend) await frontend(app);
  app.use(errorHandler);
  return app;
}
