import { describe, expect, it, vi } from 'vitest';
import { setup } from '../integration/helpers';
import {
  createSignedOAuthState,
  generatePkce,
  handleGoogleCallback,
  isGoogleConfigured,
  startGoogleAuth,
  verifyGoogleTokenInfo,
  verifySignedOAuthState,
} from '../../src/server/auth/google';
import type { Request, Response } from 'express';
import { HttpError } from '../../src/server/http';
import { linkIdentity } from '../../src/server/repositories/users';
import { verifyToken } from '../../src/server/auth/session';

describe('Google OAuth & OIDC Authentication', () => {
  it('generates cryptographically valid PKCE code verifier and challenge', () => {
    const { codeVerifier, codeChallenge } = generatePkce();
    expect(codeVerifier).toBeTruthy();
    expect(codeChallenge).toBeTruthy();
    expect(codeVerifier).not.toEqual(codeChallenge);
  });

  it('signs and validates OAuth state cookies securely', () => {
    const secret = 'super-secret-key-that-is-at-least-32-chars-long';
    const now = new Date('2026-10-30T10:00:00Z');
    const payload = {
      state: 'random-state-123',
      nonce: 'random-nonce-456',
      codeVerifier: 'verifier-789',
      exp: now.getTime() + 600000,
    };
    const signed = createSignedOAuthState(secret, payload);
    const verified = verifySignedOAuthState(secret, signed, now);
    expect(verified).toEqual(payload);

    // Rejects tampered state
    const parts = signed.split('.');
    const data = parts[0] ?? '';
    const sig = parts[1] ?? '';
    const tamperedSig = `${data}.invalid_sig`;
    const tamperedData = `x${data.slice(1)}.${sig}`;
    expect(verifySignedOAuthState(secret, tamperedSig, now)).toBeNull();
    expect(verifySignedOAuthState(secret, tamperedData, now)).toBeNull();

    // Rejects expired state
    const future = new Date(now.getTime() + 700000);
    expect(verifySignedOAuthState(secret, signed, future)).toBeNull();
  });

  it('rejects initiation when Google OAuth is not configured', async () => {
    const env = await setup();
    env.ctx.config.googleClientId = undefined;
    env.ctx.config.googleClientSecret = undefined;

    expect(isGoogleConfigured(env.ctx)).toBe(false);

    const mockReq = { secure: false, get: () => 'localhost:8080' } as unknown as Request;
    const mockRes = { cookie: vi.fn(), redirect: vi.fn() } as unknown as Response;

    expect(() => startGoogleAuth(env.ctx, mockReq, mockRes)).toThrow(HttpError);
    try {
      startGoogleAuth(env.ctx, mockReq, mockRes);
    } catch (e) {
      expect((e as HttpError).code).toBe('PROVIDER_NOT_CONFIGURED');
    }
  });

  it('initiates Google authorization with PKCE, state, and signed state cookie when configured', async () => {
    const env = await setup();
    env.ctx.config.googleClientId = 'test-client-id.apps.googleusercontent.com';
    env.ctx.config.googleClientSecret = 'test-client-secret';

    expect(isGoogleConfigured(env.ctx)).toBe(true);

    let cookieName = '';
    let cookieVal = '';
    let redirectUrl = '';

    const mockReq = { secure: false, get: () => 'localhost:8080' } as unknown as Request;
    const mockRes = {
      cookie: (name: string, val: string) => {
        cookieName = name;
        cookieVal = val;
      },
      redirect: (url: string) => {
        redirectUrl = url;
      },
    } as unknown as Response;

    startGoogleAuth(env.ctx, mockReq, mockRes);

    expect(cookieName).toBe('fs_oauth_state');
    expect(cookieVal).toBeTruthy();
    expect(redirectUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(redirectUrl).toContain('client_id=test-client-id.apps.googleusercontent.com');
    expect(redirectUrl).toContain('code_challenge_method=S256');
  });

  it('rejects callback with state mismatch to prevent login CSRF', async () => {
    const env = await setup();
    env.ctx.config.googleClientId = 'test-client-id';
    env.ctx.config.googleClientSecret = 'test-client-secret';

    let redirectedTo = '';
    const mockReq = {
      query: { code: 'auth-code', state: 'forged-state' },
      headers: { cookie: 'fs_oauth_state=invalid-or-different' },
    } as unknown as Request;
    const mockRes = {
      clearCookie: vi.fn(),
      redirect: (url: string) => {
        redirectedTo = url;
      },
    } as unknown as Response;

    await handleGoogleCallback(env.ctx, mockReq, mockRes);
    expect(redirectedTo).toBe('/login?auth_error=state_mismatch');

    // Missing cookie redirects to session_expired
    const missingCookieReq = {
      query: { code: 'auth-code', state: 'some-state' },
      headers: {},
    } as unknown as Request;
    await handleGoogleCallback(env.ctx, missingCookieReq, mockRes);
    expect(redirectedTo).toBe('/login?auth_error=session_expired');
  });

  it('authenticates a provisioned user and establishes application session', async () => {
    const env = await setup();
    env.ctx.config.googleClientId = 'test-client-id.apps.googleusercontent.com';
    env.ctx.config.googleClientSecret = 'test-client-secret';

    const now = env.ctx.now();
    const state = 'legit-state-abc';
    const codeVerifier = 'verifier-xyz';
    const signedCookie = createSignedOAuthState(env.ctx.config.sessionSecret, {
      state,
      nonce: 'nonce-123',
      codeVerifier,
      exp: now.getTime() + 600000,
    });

    // Link a test user (Ravi Kumar, usr_demo_c_ravi) to Google subject
    const googleSub = 'google-sub-1234567890';
    linkIdentity(env.ctx.db, {
      id: 'ident_google_ravi',
      userId: 'usr_demo_c_ravi',
      provider: 'google',
      providerUserId: googleSub,
      email: 'ravi.kumar@example.com',
      createdAt: now.toISOString(),
      lastSignInAt: now.toISOString(),
    });

    // Mock Google token exchange and tokeninfo
    const originalFetch = globalThis.fetch;
    const fakeFetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('oauth2.googleapis.com/tokeninfo')) {
        return new Response(
          JSON.stringify({
            sub: googleSub,
            aud: 'test-client-id.apps.googleusercontent.com',
            iss: 'https://accounts.google.com',
            email: 'ravi.kumar@example.com',
            email_verified: 'true',
            name: 'Ravi Kumar',
            exp: Math.floor(now.getTime() / 1000) + 3600,
            nonce: 'nonce-123',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ id_token: 'fake-id-token', access_token: 'fake-access' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(url);
    });
    vi.stubGlobal('fetch', fakeFetch);

    let sessionUserId: string | null = null;
    let redirectedTo = '';
    const mockReq = {
      query: { code: 'valid-google-code', state },
      headers: { cookie: `fs_oauth_state=${encodeURIComponent(signedCookie)}` },
      secure: false,
      get: () => 'localhost:8080',
    } as unknown as Request;

    const mockRes = {
      clearCookie: vi.fn(),
      cookie: (_name: string, token: string) => {
        sessionUserId = verifyToken(env.ctx.config.sessionSecret, token, now);
      },
      redirect: (url: string) => {
        redirectedTo = url;
      },
    } as unknown as Response;

    try {
      await handleGoogleCallback(env.ctx, mockReq, mockRes);
      expect(sessionUserId).toBe('usr_demo_c_ravi');
      expect(redirectedTo).toBe('/');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('redirects unprovisioned identities with clear message without auto-registering admin accounts', async () => {
    const env = await setup();
    env.ctx.config.googleClientId = 'test-client-id.apps.googleusercontent.com';
    env.ctx.config.googleClientSecret = 'test-client-secret';

    const now = env.ctx.now();
    const state = 'state-unprovisioned';
    const codeVerifier = 'verifier-unprovisioned';
    const signedCookie = createSignedOAuthState(env.ctx.config.sessionSecret, {
      state,
      nonce: 'nonce-unprov',
      codeVerifier,
      exp: now.getTime() + 600000,
    });

    // Mock Google token exchange and tokeninfo for unknown user
    const unprovisionedSub = 'google-unknown-999';
    const fakeFetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('oauth2.googleapis.com/tokeninfo')) {
        return new Response(
          JSON.stringify({
            sub: unprovisionedSub,
            aud: 'test-client-id.apps.googleusercontent.com',
            iss: 'https://accounts.google.com',
            email: 'stranger@example.com',
            email_verified: 'true',
            name: 'Stranger Danger',
            exp: Math.floor(now.getTime() / 1000) + 3600,
            nonce: 'nonce-unprov',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ id_token: 'fake-id-token-unprov' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fakeFetch);

    let sessionSet = false;
    let redirectedTo = '';
    const mockReq = {
      query: { code: 'valid-google-code', state },
      headers: { cookie: `fs_oauth_state=${encodeURIComponent(signedCookie)}` },
      secure: false,
      get: () => 'localhost:8080',
    } as unknown as Request;

    const mockRes = {
      clearCookie: vi.fn(),
      cookie: () => {
        sessionSet = true;
      },
      redirect: (url: string) => {
        redirectedTo = url;
      },
    } as unknown as Response;

    try {
      await handleGoogleCallback(env.ctx, mockReq, mockRes);
      // Must NOT establish session for unknown user
      expect(sessionSet).toBe(false);
      // Must redirect to unprovisioned error page with email
      expect(redirectedTo).toContain('/login?auth_error=unprovisioned');
      expect(redirectedTo).toContain('stranger%40example.com');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe('ID token claim validation', () => {
    const now = new Date('2026-10-27T10:00:00.000Z');
    const valid = {
      sub: 'google-sub-1',
      aud: 'client-id',
      iss: 'https://accounts.google.com',
      email: 'worker@example.com',
      email_verified: 'true',
      exp: Math.floor(now.getTime() / 1000) + 600,
      nonce: 'expected-nonce',
    };
    const withClaims = async (claims: Record<string, unknown>) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(claims), { status: 200 })));
      try {
        return await verifyGoogleTokenInfo('id-token', 'client-id', 'expected-nonce', now);
      } finally {
        vi.unstubAllGlobals();
      }
    };

    it('accepts a token carrying the expected nonce and a future expiry', async () => {
      await expect(withClaims(valid)).resolves.toMatchObject({ sub: 'google-sub-1', email: 'worker@example.com' });
    });

    it('rejects a token that omits the nonce sent in the authorization request', async () => {
      const { nonce: _omit, ...noNonce } = valid;
      await expect(withClaims(noNonce)).rejects.toThrow(/nonce/i);
    });

    it('rejects a token with a different nonce', async () => {
      await expect(withClaims({ ...valid, nonce: 'replayed-nonce' })).rejects.toThrow(/nonce/i);
    });

    it('rejects a token without an expiry claim', async () => {
      const { exp: _omit, ...noExp } = valid;
      await expect(withClaims(noExp)).rejects.toThrow(/expired/i);
    });
  });
});
