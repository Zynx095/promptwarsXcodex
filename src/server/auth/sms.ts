import { randomBytes, randomInt } from 'node:crypto';
import { hmac, safeEqual } from './crypto';
import { HttpError } from '../http';
import type { AppContext } from '../context';
import { findLoginByPhone, findSessionUser, linkIdentity } from '../repositories/users';
import { setSessionCookie } from './session';
import type { Response } from 'express';

export interface SmsProvider {
  readonly name: string;
  isConfigured(): boolean;
  sendOtp(phone: string, code: string): Promise<void>;
}

export class UnconfiguredSmsProvider implements SmsProvider {
  readonly name = 'unconfigured';
  isConfigured(): boolean {
    return false;
  }
  async sendOtp(): Promise<void> {
    throw new HttpError(
      503,
      'PROVIDER_NOT_CONFIGURED',
      'SMS delivery is not configured in this environment. Set SMS_PROVIDER and provider credentials to enable real phone OTP.',
    );
  }
}

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  readonly sentMessages: Array<{ phone: string; code: string; sentAt: Date }> = [];
  isConfigured(): boolean {
    return true;
  }
  async sendOtp(phone: string, code: string): Promise<void> {
    this.sentMessages.push({ phone, code, sentAt: new Date() });
  }
  getLatestCode(phone: string): string | undefined {
    const matching = this.sentMessages.filter((m) => m.phone === phone);
    return matching[matching.length - 1]?.code;
  }
  clear(): void {
    this.sentMessages.length = 0;
  }
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  constructor(
    private readonly accountSid?: string,
    private readonly authToken?: string,
    private readonly fromPhone?: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.accountSid && this.authToken && this.fromPhone);
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new HttpError(503, 'PROVIDER_NOT_CONFIGURED', 'Twilio SMS is not configured.');
    }
    const formattedPhone = phone.startsWith('+') ? phone : `+91${phone}`; // Default to India (+91) for FairShift
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: formattedPhone,
        From: this.fromPhone!,
        Body: `Your FairShift verification code is: ${code}. Valid for 5 minutes. Do not share this code.`,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[Twilio] Failed to send SMS:', errText);
      throw new HttpError(502, 'SMS_GATEWAY_ERROR', 'Failed to dispatch verification code via SMS provider.');
    }
  }
}

// Global mock provider instance for testing
export const mockSmsProvider = new MockSmsProvider();

export function getSmsProvider(ctx: AppContext): SmsProvider {
  if (ctx.config.smsProvider === 'mock') {
    if (ctx.config.production) {
      throw new HttpError(500, 'SECURITY_VIOLATION', 'Mock SMS provider is strictly forbidden in production mode.');
    }
    return mockSmsProvider;
  }
  if (ctx.config.smsProvider === 'twilio') {
    return new TwilioSmsProvider(ctx.config.twilioAccountSid, ctx.config.twilioAuthToken, ctx.config.twilioFromPhone);
  }
  return new UnconfiguredSmsProvider();
}

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_COOLDOWN_MS = 60 * 1000; // 60 seconds minimum between resends

export async function requestPhoneOtp(ctx: AppContext, phone: string): Promise<{ ok: boolean; message: string }> {
  const provider = getSmsProvider(ctx);
  if (!provider.isConfigured()) {
    throw new HttpError(
      503,
      'PROVIDER_NOT_CONFIGURED',
      'SMS delivery is not configured in this environment. Set SMS_PROVIDER and provider credentials to enable real phone OTP.',
    );
  }

  const now = ctx.now();
  const nowIso = now.toISOString();

  // Enforce cooldown / rate limit
  const recent = ctx.db.get<{ count: number; last_created: string }>(
    `SELECT COUNT(*) as count, MAX(created_at) as last_created
     FROM phone_verifications
     WHERE phone = @phone AND created_at >= @since`,
    {
      phone,
      since: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
    },
  );

  if (recent && recent.last_created) {
    const elapsed = now.getTime() - new Date(recent.last_created).getTime();
    if (elapsed < OTP_COOLDOWN_MS) {
      const waitSec = Math.ceil((OTP_COOLDOWN_MS - elapsed) / 1000);
      throw new HttpError(429, 'COOLDOWN', `Please wait ${waitSec} seconds before requesting another code.`);
    }
  }

  if (recent && recent.count >= 4) {
    throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many verification requests. Please wait 15 minutes and try again.');
  }

  // Generate 6-digit cryptographically secure code
  const code = String(randomInt(100000, 1000000));
  const otpHash = hmac(ctx.config.sessionSecret, `${phone}:${code}`);
  const id = randomBytes(16).toString('hex');
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS).toISOString();

  ctx.db.run(
    `INSERT INTO phone_verifications (id, phone, otp_hash, attempts, max_attempts, expires_at, created_at)
     VALUES (@id, @phone, @otpHash, 0, 5, @expiresAt, @nowIso)`,
    { id, phone, otpHash, expiresAt, nowIso },
  );

  await provider.sendOtp(phone, code);

  return { ok: true, message: 'Verification code sent.' };
}

export async function verifyPhoneOtp(ctx: AppContext, res: Response, phone: string, code: string): Promise<{ ok: boolean; userId: string }> {
  const now = ctx.now();
  const nowIso = now.toISOString();

  // Look up latest active challenge for this phone
  const challenge = ctx.db.get<{
    id: string;
    otp_hash: string;
    attempts: number;
    max_attempts: number;
    expires_at: string;
  }>(
    `SELECT id, otp_hash, attempts, max_attempts, expires_at
     FROM phone_verifications
     WHERE phone = @phone AND consumed_at IS NULL AND expires_at > @nowIso
     ORDER BY created_at DESC LIMIT 1`,
    { phone, nowIso },
  );

  if (!challenge) {
    throw new HttpError(400, 'INVALID_CODE', 'Verification code has expired or is invalid. Please request a new code.');
  }

  if (challenge.attempts >= challenge.max_attempts) {
    // Invalidate
    ctx.db.run(`UPDATE phone_verifications SET consumed_at = @nowIso WHERE id = @id`, { id: challenge.id, nowIso });
    throw new HttpError(429, 'MAX_ATTEMPTS_EXCEEDED', 'Too many incorrect attempts. Please request a new verification code.');
  }

  const expectedHash = hmac(ctx.config.sessionSecret, `${phone}:${code}`);
  const match = safeEqual(challenge.otp_hash, expectedHash);

  if (!match) {
    ctx.db.run(`UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = @id`, { id: challenge.id });
    const remaining = challenge.max_attempts - (challenge.attempts + 1);
    throw new HttpError(
      400,
      'INVALID_CODE',
      remaining > 0 ? `Incorrect verification code. ${remaining} attempts remaining.` : 'Incorrect code. Challenge locked.',
    );
  }

  // Mark challenge consumed so code cannot be reused or replayed
  ctx.db.run(`UPDATE phone_verifications SET consumed_at = @nowIso WHERE id = @id`, { id: challenge.id, nowIso });

  // Lookup user by phone
  const userLogin = findLoginByPhone(ctx.db, phone);
  if (!userLogin) {
    throw new HttpError(
      403,
      'UNPROVISIONED_ACCOUNT',
      'No active FairShift account found for this phone number. Please contact your organization administrator.',
    );
  }

  const sessionUser = findSessionUser(ctx.db, userLogin.id);
  if (!sessionUser || !sessionUser.active) {
    throw new HttpError(403, 'INACTIVE_ACCOUNT', 'This account has been deactivated. Contact your supervisor.');
  }

  // Link phone_otp identity if not present
  linkIdentity(ctx.db, {
    id: randomBytes(16).toString('hex'),
    userId: sessionUser.id,
    provider: 'phone_otp',
    providerUserId: phone,
    createdAt: nowIso,
    lastSignInAt: nowIso,
  });

  // Establish server-managed session
  setSessionCookie(ctx, res, sessionUser.id);

  return { ok: true, userId: sessionUser.id };
}
