// Vercel serverless entry: the same Express app as main.ts, exported as a request handler.
// Static client files are served by Vercel; this function handles /api/* and /healthz.
// Vercel's filesystem is read-only except /tmp, so the demo database lives there and is
// reseeded whenever a new function instance starts (see docs/DEPLOYMENT.md).
import { loadConfig } from './config';
import { openDb } from './db/db';
import { seedIfEmpty } from './db/seed';
import { createApp } from './app';
import type { AppContext } from './context';

const config = loadConfig({ ...process.env, DATABASE_PATH: process.env.DATABASE_PATH ?? '/tmp/fairshift.db' });
const db = openDb(config.databasePath);
const ctx: AppContext = { db, config, now: () => new Date() };
if (config.demoMode) seedIfEmpty(ctx);

export default await createApp(ctx);
