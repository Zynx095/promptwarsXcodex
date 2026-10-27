import { randomBytes } from 'node:crypto';

export interface AppConfig {
  port: number;
  production: boolean;
  sessionSecret: string;
  databasePath: string;
  demoMode: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env.NODE_ENV === 'production';
  const demoMode = env.DEMO_MODE === 'true';
  let sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) {
    if (production && !demoMode) {
      throw new Error('SESSION_SECRET must be set to at least 32 characters in production.');
    }
    console.warn('[fairshift] SESSION_SECRET not set; using an ephemeral secret. Sessions end when the server restarts.');
    sessionSecret = randomBytes(48).toString('base64url');
  }
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0) throw new Error('PORT must be a positive integer.');
  return {
    port,
    production,
    sessionSecret,
    databasePath: env.DATABASE_PATH ?? './data/fairshift.db',
    demoMode,
  };
}
