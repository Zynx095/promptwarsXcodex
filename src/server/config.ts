import { randomBytes } from 'node:crypto';

export interface AppConfig {
  port: number;
  production: boolean;
  sessionSecret: string;
  databasePath: string;
  demoMode: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  googleCallbackUrl?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  githubCallbackUrl?: string;
  smsProvider: 'twilio' | 'mock' | 'none';
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromPhone?: string;
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

  const smsProviderEnv = (env.SMS_PROVIDER ?? '').toLowerCase();
  const smsProvider: 'twilio' | 'mock' | 'none' = smsProviderEnv === 'twilio' ? 'twilio' : smsProviderEnv === 'mock' ? 'mock' : 'none';

  return {
    port,
    production,
    sessionSecret,
    databasePath: env.DATABASE_PATH ?? './data/fairshift.db',
    demoMode,
    googleClientId: env.GOOGLE_CLIENT_ID?.trim() || undefined,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET?.trim() || undefined,
    googleCallbackUrl: env.GOOGLE_CALLBACK_URL?.trim() || undefined,
    githubClientId: env.GITHUB_CLIENT_ID?.trim() || undefined,
    githubClientSecret: env.GITHUB_CLIENT_SECRET?.trim() || undefined,
    githubCallbackUrl: env.GITHUB_CALLBACK_URL?.trim() || undefined,
    smsProvider,
    twilioAccountSid: env.TWILIO_ACCOUNT_SID?.trim() || undefined,
    twilioAuthToken: env.TWILIO_AUTH_TOKEN?.trim() || undefined,
    twilioFromPhone: env.TWILIO_FROM_PHONE?.trim() || undefined,
  };
}
