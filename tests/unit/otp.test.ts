import { describe, expect, it } from 'vitest';
import { setup } from '../integration/helpers';
import { MockSmsProvider, TwilioSmsProvider, UnconfiguredSmsProvider, mockSmsProvider, requestPhoneOtp, verifyPhoneOtp } from '../../src/server/auth/sms';
import { HttpError } from '../../src/server/http';
import type { Response } from 'express';
import { verifyToken } from '../../src/server/auth/session';

describe('Phone OTP Authentication & SMS Providers', () => {
  it('reports provider configuration status accurately', () => {
    const unconfigured = new UnconfiguredSmsProvider();
    expect(unconfigured.isConfigured()).toBe(false);

    const mock = new MockSmsProvider();
    expect(mock.isConfigured()).toBe(true);

    const twilioUnconfigured = new TwilioSmsProvider();
    expect(twilioUnconfigured.isConfigured()).toBe(false);

    const twilioConfigured = new TwilioSmsProvider('AC123', 'token456', '+15551234567');
    expect(twilioConfigured.isConfigured()).toBe(true);
  });

  it('rejects OTP dispatch when SMS provider is unconfigured', async () => {
    const env = await setup();
    env.ctx.config.smsProvider = 'none';

    await expect(requestPhoneOtp(env.ctx, '9876543210')).rejects.toThrow(HttpError);
    try {
      await requestPhoneOtp(env.ctx, '9876543210');
    } catch (e) {
      expect((e as HttpError).status).toBe(503);
      expect((e as HttpError).code).toBe('PROVIDER_NOT_CONFIGURED');
    }
  });

  it('dispatches OTP successfully via configured mock provider', async () => {
    const env = await setup();
    env.ctx.config.smsProvider = 'mock';
    mockSmsProvider.clear();

    const result = await requestPhoneOtp(env.ctx, '9876543210');
    expect(result.ok).toBe(true);

    const sent = mockSmsProvider.getLatestCode('9876543210');
    expect(sent).toBeDefined();
    expect(sent).toMatch(/^\d{6}$/);
  });

  it('enforces 60-second cooldown between resend requests', async () => {
    const env = await setup();
    env.ctx.config.smsProvider = 'mock';
    mockSmsProvider.clear();

    await requestPhoneOtp(env.ctx, '9876543210');

    // Immediate second request must trigger cooldown
    await expect(requestPhoneOtp(env.ctx, '9876543210')).rejects.toThrow(HttpError);
    try {
      await requestPhoneOtp(env.ctx, '9876543210');
    } catch (e) {
      expect((e as HttpError).status).toBe(429);
      expect((e as HttpError).code).toBe('COOLDOWN');
    }
  });

  it('verifies valid OTP, establishes session, and prevents replay attacks', async () => {
    const env = await setup();
    env.ctx.config.smsProvider = 'mock';
    mockSmsProvider.clear();

    // Ravi Kumar has phone 9000000001 in synthetic seed
    const phone = '9000000001';
    await requestPhoneOtp(env.ctx, phone);
    const code = mockSmsProvider.getLatestCode(phone)!;
    expect(code).toBeTruthy();

    let sessionUserId: string | null = null;
    const mockRes = {
      cookie: (_name: string, token: string) => {
        sessionUserId = verifyToken(env.ctx.config.sessionSecret, token, env.ctx.now());
      },
    } as unknown as Response;

    // Verify valid code
    const verifyResult = await verifyPhoneOtp(env.ctx, mockRes, phone, code);
    expect(verifyResult.ok).toBe(true);
    expect(verifyResult.userId).toBe('usr_demo_c_ravi');
    expect(sessionUserId).toBe('usr_demo_c_ravi');

    // Replay attack: trying to use the same code again MUST fail
    await expect(verifyPhoneOtp(env.ctx, mockRes, phone, code)).rejects.toThrow(HttpError);
    try {
      await verifyPhoneOtp(env.ctx, mockRes, phone, code);
    } catch (e) {
      expect((e as HttpError).status).toBe(400);
      expect((e as HttpError).code).toBe('INVALID_CODE');
    }
  });

  it('rejects incorrect OTP and locks after max attempts', async () => {
    const env = await setup();
    env.ctx.config.smsProvider = 'mock';
    mockSmsProvider.clear();

    const phone = '9000000001';
    await requestPhoneOtp(env.ctx, phone);

    const mockRes = { cookie: () => {} } as unknown as Response;

    // First 4 wrong attempts
    for (let i = 0; i < 4; i++) {
      await expect(verifyPhoneOtp(env.ctx, mockRes, phone, '000000')).rejects.toThrow(HttpError);
    }

    // 5th wrong attempt triggers challenge lock
    try {
      await verifyPhoneOtp(env.ctx, mockRes, phone, '000000');
    } catch (e) {
      expect((e as HttpError).status).toBe(400);
    }

    // 6th attempt should be locked (max attempts exceeded)
    try {
      await verifyPhoneOtp(env.ctx, mockRes, phone, '000000');
    } catch (e) {
      expect((e as HttpError).status).toBe(429);
      expect((e as HttpError).code).toBe('MAX_ATTEMPTS_EXCEEDED');
    }
  });

  it('rejects verification for unprovisioned phone number', async () => {
    const env = await setup();
    env.ctx.config.smsProvider = 'mock';
    mockSmsProvider.clear();

    const unprovisionedPhone = '9999999999';
    await requestPhoneOtp(env.ctx, unprovisionedPhone);
    const code = mockSmsProvider.getLatestCode(unprovisionedPhone)!;

    const mockRes = { cookie: () => {} } as unknown as Response;

    try {
      await verifyPhoneOtp(env.ctx, mockRes, unprovisionedPhone, code);
      expect.fail('Should have thrown HttpError');
    } catch (e) {
      expect((e as HttpError).status).toBe(403);
      expect((e as HttpError).code).toBe('UNPROVISIONED_ACCOUNT');
    }
  });
});
