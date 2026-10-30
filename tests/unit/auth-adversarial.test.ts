import { describe, expect, it, vi, afterEach } from 'vitest';
import { verifyGoogleTokenInfo } from '../../src/server/auth/google';
import { createToken, verifyToken } from '../../src/server/auth/session';
import { getSmsProvider, requestPhoneOtp, verifyPhoneOtp, mockSmsProvider } from '../../src/server/auth/sms';
import { HttpError } from '../../src/server/http';
import { openDb } from '../../src/server/db/db';
import { seedIfEmpty } from '../../src/server/db/seed';
import type { AppContext } from '../../src/server/context';
import type { Response } from 'express';

describe('FairShift Authentication & Authorization — Adversarial Security Audit', () => {
  const secret = 'test-secret-key-that-is-at-least-32-characters-long';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Adversarial Vector 1: Google OIDC Cryptographic Verification', () => {
    const validSub = '109876543210987654321';
    const validEmail = 'worker@fairshift.example.com';
    const expectedClientId = 'fairshift-client-id-1234.apps.googleusercontent.com';
    const expectedNonce = 'valid_session_nonce_token_99';
    const now = new Date('2026-10-30T10:00:00.000Z');
    const futureExp = Math.floor(now.getTime() / 1000) + 3600; // +1 hour

    it('successfully validates token with matching claims, issuer, audience, and nonce', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: validSub,
          email: validEmail,
          email_verified: true,
          aud: expectedClientId,
          iss: 'https://accounts.google.com',
          exp: futureExp,
          nonce: expectedNonce,
          name: 'Verified User',
        }),
      } as unknown as globalThis.Response);

      const userinfo = await verifyGoogleTokenInfo('fake_id_token', expectedClientId, expectedNonce, now);
      expect(userinfo.sub).toBe(validSub);
      expect(userinfo.email).toBe(validEmail);
      expect(userinfo.emailVerified).toBe(true);
    });

    it('rejects token with audience mismatch (preventing cross-client token injection)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: validSub,
          email: validEmail,
          email_verified: true,
          aud: 'different-malicious-client.apps.googleusercontent.com',
          iss: 'https://accounts.google.com',
          exp: futureExp,
          nonce: expectedNonce,
        }),
      } as unknown as globalThis.Response);

      await expect(verifyGoogleTokenInfo('fake_id_token', expectedClientId, expectedNonce, now)).rejects.toThrowError(/audience mismatch/);
    });

    it('rejects token with invalid issuer', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: validSub,
          email: validEmail,
          email_verified: true,
          aud: expectedClientId,
          iss: 'https://attacker-controlled-idp.example.com',
          exp: futureExp,
          nonce: expectedNonce,
        }),
      } as unknown as globalThis.Response);

      await expect(verifyGoogleTokenInfo('fake_id_token', expectedClientId, expectedNonce, now)).rejects.toThrowError(/Invalid Google token issuer/);
    });

    it('rejects token that has expired', async () => {
      const pastExp = Math.floor(now.getTime() / 1000) - 60; // 1 minute in the past
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: validSub,
          email: validEmail,
          email_verified: true,
          aud: expectedClientId,
          iss: 'https://accounts.google.com',
          exp: pastExp,
          nonce: expectedNonce,
        }),
      } as unknown as globalThis.Response);

      await expect(verifyGoogleTokenInfo('fake_id_token', expectedClientId, expectedNonce, now)).rejects.toThrowError(/token has expired/);
    });

    it('rejects token with unverified email address', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: validSub,
          email: 'unverified@example.com',
          email_verified: false,
          aud: expectedClientId,
          iss: 'https://accounts.google.com',
          exp: futureExp,
          nonce: expectedNonce,
        }),
      } as unknown as globalThis.Response);

      await expect(verifyGoogleTokenInfo('fake_id_token', expectedClientId, expectedNonce, now)).rejects.toThrowError(/email is not verified/);
    });

    it('rejects token with nonce mismatch (replay / session injection prevention)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: validSub,
          email: validEmail,
          email_verified: true,
          aud: expectedClientId,
          iss: 'https://accounts.google.com',
          exp: futureExp,
          nonce: 'stolen_or_replayed_nonce_from_another_login',
        }),
      } as unknown as globalThis.Response);

      await expect(verifyGoogleTokenInfo('fake_id_token', expectedClientId, expectedNonce, now)).rejects.toThrowError(/nonce mismatch/);
    });
  });

  describe('Adversarial Vector 2: OTP Security & Mock Production Guard', () => {
    function setupEnv(production = false) {
      const clock = { now: new Date('2026-10-27T10:00:00.000Z') };
      const ctx: AppContext = {
        db: openDb(':memory:'),
        config: {
          port: 0,
          production,
          sessionSecret: secret,
          receiptSigningSecret: secret,
          receiptSigningKeys: { v1: secret },
          activeReceiptKeyId: 'v1',
          checkpointSigningSecret: secret,
          checkpointSigningKeys: { chk_v1: secret },
          activeCheckpointKeyId: 'chk_v1',
          signalPseudonymSecret: secret,
          databasePath: ':memory:',
          demoMode: true,
          smsProvider: 'mock',
        },
        now: () => clock.now,
      };
      seedIfEmpty(ctx);
      return { ctx, clock };
    }

    it('strictly forbids mock SMS provider in production environment', () => {
      const { ctx } = setupEnv(true); // production = true
      expect(() => getSmsProvider(ctx)).toThrowError(HttpError);
      expect(() => getSmsProvider(ctx)).toThrowError(/Mock SMS provider is strictly forbidden/);
    });

    it('enforces lockout after 5 consecutive incorrect OTP attempts', async () => {
      const { ctx } = setupEnv(false);
      mockSmsProvider.clear();
      const phone = '9000000001'; // Ravi Kumar
      await requestPhoneOtp(ctx, phone);

      const res = {
        cookie: vi.fn(),
      } as unknown as Response;

      // 5 consecutive wrong attempts
      for (let i = 1; i <= 4; i++) {
        await expect(verifyPhoneOtp(ctx, res, phone, '000000')).rejects.toThrowError(/Incorrect verification code/);
      }

      // 5th wrong attempt locks the challenge
      await expect(verifyPhoneOtp(ctx, res, phone, '000000')).rejects.toThrowError(/Challenge locked/);

      // Subsequent attempt with even the CORRECT code must be rejected because it is locked
      const realCode = mockSmsProvider.getLatestCode(phone)!;
      await expect(verifyPhoneOtp(ctx, res, phone, realCode)).rejects.toThrowError(/Too many incorrect attempts|locked/);
    });

    it('prevents OTP replay attack after a code has been consumed', async () => {
      const { ctx } = setupEnv(false);
      mockSmsProvider.clear();
      const phone = '9000000001';
      await requestPhoneOtp(ctx, phone);
      const code = mockSmsProvider.getLatestCode(phone)!;

      const res = {
        cookie: vi.fn(),
      } as unknown as Response;

      // 1st verification succeeds
      const first = await verifyPhoneOtp(ctx, res, phone, code);
      expect(first.ok).toBe(true);

      // Replay attempt with same code must fail immediately
      await expect(verifyPhoneOtp(ctx, res, phone, code)).rejects.toThrowError(/expired or is invalid/);
    });

    it('enforces 60-second cooldown between resend requests', async () => {
      const { ctx, clock } = setupEnv(false);
      const phone = '9000000001';

      await requestPhoneOtp(ctx, phone);

      // Attempt to resend immediately (0 seconds elapsed)
      await expect(requestPhoneOtp(ctx, phone)).rejects.toThrowError(/Please wait \d+ seconds/);

      // Advance clock by 61 seconds
      clock.now = new Date(clock.now.getTime() + 61000);

      // Resend now succeeds
      const resend = await requestPhoneOtp(ctx, phone);
      expect(resend.ok).toBe(true);
    });
  });

  describe('Adversarial Vector 3: Session Rotation & Fixation Resistance', () => {
    it('generates distinct session tokens for the same user to guarantee session rotation on login', () => {
      const now = new Date('2026-10-30T10:00:00.000Z');
      const userId = 'usr_demo_c_ravi';

      const token1 = createToken(secret, userId, now);
      const token2 = createToken(secret, userId, now);

      // Tokens generated at the exact same timestamp must differ due to unique sid (session rotation)
      expect(token1).not.toBe(token2);

      // Both tokens verify to the correct user
      expect(verifyToken(secret, token1, now)).toBe(userId);
      expect(verifyToken(secret, token2, now)).toBe(userId);
    });

    it('rejects tampered or forged session token', () => {
      const now = new Date('2026-10-30T10:00:00.000Z');
      const token = createToken(secret, 'usr_demo_c_ravi', now);

      // Signature tampering
      const tamperedSig = token.slice(0, -4) + 'abcd';
      expect(verifyToken(secret, tamperedSig, now)).toBeNull();

      // Wrong secret
      expect(verifyToken('wrong-secret-key-1234567890123456', token, now)).toBeNull();

      // Expired session token
      const futureNow = new Date(now.getTime() + 13 * 60 * 60 * 1000); // +13h (TTL is 12h)
      expect(verifyToken(secret, token, futureNow)).toBeNull();
    });
  });
});
