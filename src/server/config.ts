import { randomBytes } from 'node:crypto';

export interface AppConfig {
  port: number;
  production: boolean;
  sessionSecret: string;
  receiptSigningSecret: string;
  receiptSigningKeys: Record<string, string>;
  activeReceiptKeyId: string;
  checkpointSigningSecret: string;
  checkpointSigningKeys: Record<string, string>;
  activeCheckpointKeyId: string;
  signalPseudonymSecret: string;
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
  /** Server text-to-speech fallback (Google Cloud Text-to-Speech). Unset: no server voice. */
  googleTtsApiKey?: string;
  /** Advisory image analysis (Google Cloud Vision). Unset: evidence goes to manual review only. */
  googleVisionApiKey?: string;
  /** WebAuthn relying party ID (the site's registrable domain) and allowed origins. */
  webauthnRpId?: string;
  webauthnOrigins?: string[];
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

  // Work Receipt Signing Keys & Active Key ID (supports key rotation)
  const receiptSigningSecret = env.RECEIPT_SIGNING_SECRET?.trim() || sessionSecret;
  const activeReceiptKeyId = env.ACTIVE_RECEIPT_KEY_ID?.trim() || 'v1';
  let receiptSigningKeys: Record<string, string> = { [activeReceiptKeyId]: receiptSigningSecret };
  if (env.RECEIPT_KEYS_JSON) {
    try {
      const parsed = JSON.parse(env.RECEIPT_KEYS_JSON) as Record<string, string>;
      if (typeof parsed === 'object' && parsed !== null) {
        receiptSigningKeys = { ...parsed, [activeReceiptKeyId]: receiptSigningSecret };
      }
    } catch {
      console.warn('[fairshift] Failed to parse RECEIPT_KEYS_JSON; falling back to primary signing key.');
    }
  }

  // Checkpoint Signing Keys & Active Key ID (supports independent anchoring & key rotation)
  const checkpointSigningSecret = env.CHECKPOINT_SIGNING_SECRET?.trim() || sessionSecret;
  const activeCheckpointKeyId = env.ACTIVE_CHECKPOINT_KEY_ID?.trim() || 'chk_v1';
  let checkpointSigningKeys: Record<string, string> = { [activeCheckpointKeyId]: checkpointSigningSecret };
  if (env.CHECKPOINT_KEYS_JSON) {
    try {
      const parsed = JSON.parse(env.CHECKPOINT_KEYS_JSON) as Record<string, string>;
      if (typeof parsed === 'object' && parsed !== null) {
        checkpointSigningKeys = { ...parsed, [activeCheckpointKeyId]: checkpointSigningSecret };
      }
    } catch {
      console.warn('[fairshift] Failed to parse CHECKPOINT_KEYS_JSON; falling back to primary checkpoint key.');
    }
  }

  // Dedicated Safe Signal Pseudonym Secret (decoupled from session cookie rotation)
  const signalPseudonymSecret = env.SIGNAL_PSEUDONYM_SECRET?.trim() || sessionSecret;

  const smsProviderEnv = (env.SMS_PROVIDER ?? '').toLowerCase();
  const smsProvider: 'twilio' | 'mock' | 'none' = smsProviderEnv === 'twilio' ? 'twilio' : smsProviderEnv === 'mock' ? 'mock' : 'none';

  return {
    port,
    production,
    sessionSecret,
    receiptSigningSecret,
    receiptSigningKeys,
    activeReceiptKeyId,
    checkpointSigningSecret,
    checkpointSigningKeys,
    activeCheckpointKeyId,
    signalPseudonymSecret,
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
    googleTtsApiKey: env.GOOGLE_TTS_API_KEY?.trim() || undefined,
    googleVisionApiKey: env.GOOGLE_VISION_API_KEY?.trim() || undefined,
    webauthnRpId: env.WEBAUTHN_RP_ID?.trim() || undefined,
    webauthnOrigins: (env.WEBAUTHN_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
