import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config';
import { openDb } from './db/db';
import { seedIfEmpty } from './db/seed';
import { createApp } from './app';
import { purgeExpiredEvidence } from './services/evidence';
import type { AppContext } from './context';

if (process.env.NODE_ENV !== 'production' && existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const db = openDb(config.databasePath);
const ctx: AppContext = { db, config, now: () => new Date() };

if (config.demoMode && seedIfEmpty(ctx)) {
  console.log('[fairshift] Seeded synthetic demonstration data.');
}

// Safety photos of reports verified more than a year ago are deleted, at start-up and daily
const purge = () => {
  const n = purgeExpiredEvidence(ctx);
  if (n > 0) console.log(`[fairshift] Deleted ${n} safety photo(s) past their retention period.`);
};
purge();
setInterval(purge, 24 * 60 * 60 * 1000).unref();

const app = await createApp(ctx, async (app) => {
  if (config.production) {
    const clientDir = resolve(dirname(fileURLToPath(import.meta.url)), '../client');
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(resolve(clientDir, 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: resolve(process.cwd(), 'vite.config.ts'),
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(
    `[fairshift] Listening on port ${config.port} (${config.production ? 'production' : 'development'}, demo mode ${config.demoMode ? 'on' : 'off'})`,
  );
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
