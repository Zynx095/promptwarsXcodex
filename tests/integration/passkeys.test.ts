import { describe, expect, it } from 'vitest';
import { SoftAuthenticator } from '../fixtures/authenticator';
import { PHONES, setup, type TestEnv } from './helpers';

const RP = { webauthnRpId: 'fairshift.test', webauthnOrigins: ['https://fairshift.test'] };
type Agent = Awaited<ReturnType<TestEnv['login']>>;

async function enrol(agent: Agent, device = new SoftAuthenticator('fairshift.test', 'https://fairshift.test')) {
  const options = await agent.post('/api/passkeys/register-options').send({});
  expect(options.status, JSON.stringify(options.body)).toBe(200);
  expect(options.body.authenticatorSelection).toMatchObject({ userVerification: 'required', authenticatorAttachment: 'platform' });
  const res = await agent.post('/api/passkeys/register').send({ label: 'My phone', response: device.register(options.body) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { device, passkey: res.body as { id: string } };
}

async function attend(agent: Agent, device: SoftAuthenticator, action: 'check-in' | 'check-out', tweak: Parameters<SoftAuthenticator['assert']>[1] = {}) {
  const options = await agent.post('/api/attendance/passkey-options').send({ action });
  expect(options.status, JSON.stringify(options.body)).toBe(200);
  const passkey = device.assert(options.body, tweak);
  return { options: options.body, passkey, res: await agent.post(`/api/attendance/${action}`).send({ passkey }) };
}

/** Ravi is seeded on shift; check him out with his sign-in so the tests start from "not on shift". */
async function offShift(env: TestEnv) {
  const ravi = await env.login(PHONES.ravi);
  await ravi.post('/api/attendance/check-out').send({});
  env.advance(30);
  return ravi;
}

describe('passkeys for attendance', () => {
  it('enrols a passkey and then requires a fresh, server-verified passkey check for check-in and check-out', async () => {
    const env = await setup(undefined, RP);
    const ravi = await offShift(env);
    expect((await ravi.get('/api/passkeys')).body).toMatchObject({ available: true, required: false, items: [] });
    const { device } = await enrol(ravi);
    const list = (await ravi.get('/api/passkeys')).body;
    expect(list).toMatchObject({ required: true, items: [{ label: 'My phone' }] });
    // Nothing biometric is stored: only the public key and its metadata
    const row = env.ctx.db.get<Record<string, unknown>>(`SELECT * FROM passkeys`)!;
    expect(Object.keys(row).sort()).toEqual(
      [
        'backed_up',
        'created_at',
        'credential_id',
        'device_type',
        'id',
        'label',
        'last_used_at',
        'org_id',
        'public_key',
        'revoked_at',
        'sign_count',
        'transports',
        'user_id',
      ].sort(),
    );

    // The signed-in session alone is no longer enough
    const bare = await ravi.post('/api/attendance/check-in').send({});
    expect(bare.status).toBe(403);
    expect(bare.body.error.code).toBe('PASSKEY_REQUIRED');

    const checkIn = await attend(ravi, device, 'check-in');
    expect(checkIn.res.status, JSON.stringify(checkIn.res.body)).toBe(201);
    expect(checkIn.res.body.checkInAuth).toBe('passkey');
    env.advance(240);
    // Check-out needs its own fresh check; the check-in assertion cannot be used again
    const replay = await ravi.post('/api/attendance/check-out').send({ passkey: checkIn.passkey });
    expect(replay.status).toBe(403);
    expect(replay.body.error.code).toBe('PASSKEY_FAILED');
    const checkOut = await attend(ravi, device, 'check-out');
    expect(checkOut.res.status, JSON.stringify(checkOut.res.body)).toBe(200);
    expect(checkOut.res.body).toMatchObject({ checkInAuth: 'passkey', checkOutAuth: 'passkey', status: 'completed' });

    // The audit trail says a passkey was used, never "fingerprint"
    const audit = env.ctx.db.all<{ action: string; after_json: string }>(
      `SELECT action, after_json FROM audit_events WHERE entity_type = 'shift' ORDER BY rowid DESC LIMIT 2`,
    );
    for (const a of audit) expect(JSON.parse(a.after_json)).toMatchObject({ auth: 'passkey', passkey: 'My phone' });
    expect(JSON.stringify(audit).toLowerCase()).not.toContain('fingerprint');
  });

  it('rejects a replayed assertion, an expired challenge and a challenge issued for another action', async () => {
    const env = await setup(undefined, RP);
    const ravi = await offShift(env);
    const { device } = await enrol(ravi);
    const first = await attend(ravi, device, 'check-in');
    expect(first.res.status).toBe(201);
    env.advance(240);
    await attend(ravi, device, 'check-out');

    // Replaying the old check-in assertion
    const replay = await ravi.post('/api/attendance/check-in').send({ passkey: first.passkey });
    expect(replay.body.error.code).toBe('PASSKEY_FAILED');

    // Expired: the challenge is older than five minutes
    const options = await ravi.post('/api/attendance/passkey-options').send({ action: 'check-in' });
    env.advance(6);
    const late = await ravi.post('/api/attendance/check-in').send({ passkey: device.assert(options.body) });
    expect(late.body.error.code).toBe('PASSKEY_FAILED');
    expect(late.body.error.message).toMatch(/expired/);

    // A check-out challenge cannot be used to check in
    const outOptions = await ravi.post('/api/attendance/passkey-options').send({ action: 'check-out' });
    const wrongPurpose = await ravi.post('/api/attendance/check-in').send({ passkey: device.assert(outOptions.body) });
    expect(wrongPurpose.body.error.code).toBe('PASSKEY_FAILED');
    expect(env.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM shifts WHERE check_out_at IS NULL`)!.n).toBe(0);
  });

  it('rejects an invalid signature, the wrong origin, the wrong relying party and no user verification', async () => {
    const env = await setup(undefined, RP);
    const ravi = await offShift(env);
    const { device } = await enrol(ravi);
    for (const tweak of [{ tamper: true }, { origin: 'https://evil.example' }, { rpId: 'evil.example' }, { userVerified: false }]) {
      const { res } = await attend(ravi, device, 'check-in', tweak);
      expect(res.status, JSON.stringify(tweak)).toBe(403);
      expect(res.body.error.code).toBe('PASSKEY_FAILED');
    }
    // A signature counter that goes backwards suggests a cloned authenticator
    expect((await attend(ravi, device, 'check-in')).res.status).toBe(201);
    env.advance(60);
    device.counter -= 1;
    expect((await attend(ravi, device, 'check-out', { keepCounter: true })).res.status).toBe(403);
    expect(env.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM shifts WHERE check_out_at IS NULL`)!.n).toBe(1);
  });

  it("does not let a worker check in with another worker's passkey or challenge", async () => {
    const env = await setup(undefined, RP);
    const ravi = await offShift(env);
    const { device: ravisPhone } = await enrol(ravi);
    const lakshmi = await env.login(PHONES.lakshmi);
    await lakshmi.post('/api/attendance/check-out').send({});
    const { device: lakshmisPhone } = await enrol(lakshmi);

    // Lakshmi gets her own challenge, then signs it with Ravi's passkey
    const options = await lakshmi.post('/api/attendance/passkey-options').send({ action: 'check-in' });
    const asRavi = await lakshmi.post('/api/attendance/check-in').send({ passkey: ravisPhone.assert(options.body) });
    expect(asRavi.body.error.code).toBe('PASSKEY_FAILED');
    // Ravi's challenge signed by Lakshmi and sent from Lakshmi's session
    const raviOptions = await ravi.post('/api/attendance/passkey-options').send({ action: 'check-in' });
    const crossed = await lakshmi.post('/api/attendance/check-in').send({ passkey: lakshmisPhone.assert(raviOptions.body) });
    expect(crossed.body.error.code).toBe('PASSKEY_FAILED');
    expect(env.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM shifts WHERE check_out_at IS NULL`)!.n).toBe(0);
  });

  it('rejects a registration without user verification, from another origin, or replayed', async () => {
    const env = await setup(undefined, RP);
    const ravi = await env.login(PHONES.ravi);
    const device = new SoftAuthenticator('fairshift.test', 'https://fairshift.test');
    for (const opts of [{ userVerified: false }, { origin: 'https://evil.example' }]) {
      const options = await ravi.post('/api/passkeys/register-options').send({});
      const res = await ravi.post('/api/passkeys/register').send({ label: 'x', response: device.register(options.body, opts) });
      expect(res.status, JSON.stringify(opts)).toBe(403);
    }
    const options = await ravi.post('/api/passkeys/register-options').send({});
    const response = device.register(options.body);
    expect((await ravi.post('/api/passkeys/register').send({ label: 'Phone', response })).status).toBe(201);
    expect((await ravi.post('/api/passkeys/register').send({ label: 'Phone', response })).status).toBe(403);
  });

  it('lets a worker revoke a lost phone, and an administrator reset passkeys, falling back to the sign-in', async () => {
    const env = await setup(undefined, RP);
    const ravi = await offShift(env);
    const { device, passkey } = await enrol(ravi);
    const revoked = await ravi.post(`/api/passkeys/${passkey.id}/revoke`).send({});
    expect(revoked.body).toMatchObject({ required: false, items: [] });
    // A revoked passkey no longer works, and no longer needs to be presented
    const opts = await ravi.post('/api/attendance/passkey-options').send({ action: 'check-in' });
    expect(opts.body.error.code).toBe('PASSKEY_REQUIRED');
    const fallback = await ravi.post('/api/attendance/check-in').send({});
    expect(fallback.status).toBe(201);
    expect(fallback.body.checkInAuth).toBe('session');
    env.advance(60);
    await ravi.post('/api/attendance/check-out').send({});

    // A revoked passkey cannot simply be registered again
    const again = await ravi.post('/api/passkeys/register-options').send({});
    expect((await ravi.post('/api/passkeys/register').send({ label: 'Old', response: device.register(again.body) })).status).toBe(409);
    // Administrator reset after the worker replaced their phone
    await enrol(ravi);
    const admin = await env.login(PHONES.constructionAdmin);
    const workers = (await admin.get('/api/admin/workers')).body.items as { id: string; phone: string }[];
    const raviId = workers.find((w) => w.phone === PHONES.ravi)!.id;
    expect((await admin.post(`/api/admin/workers/${raviId}/passkeys/revoke`).send({})).body).toEqual({ revoked: 1 });
    expect((await ravi.get('/api/passkeys')).body.required).toBe(false);
    const otherOrg = await env.login(PHONES.campusAdmin);
    expect((await otherOrg.post(`/api/admin/workers/${raviId}/passkeys/revoke`).send({})).status).toBe(404);
    const audit = env.ctx.db.all<{ action: string }>(`SELECT action FROM audit_events WHERE entity_type = 'passkey'`).map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['passkey_registered', 'passkey_revoked', 'passkeys_revoked_all']));
  });

  it('is off in production until a relying party is configured, and reports a missing authenticator plainly', async () => {
    const env = await setup(undefined, { production: true });
    // (Production session cookies are Secure, so plain-HTTP test requests cannot sign in: check the service.)
    const { relyingParty, listPasskeys, registrationOptions } = await import('../../src/server/services/passkeys');
    expect(relyingParty(env.ctx)).toBeNull();
    const user = env.ctx.db.get<{ id: string }>(`SELECT id FROM users WHERE phone = @p`, { p: PHONES.ravi })!;
    expect(listPasskeys(env.ctx, user.id)).toMatchObject({ available: false, required: false });
    await expect(registrationOptions(env.ctx, { id: user.id, orgId: 'x', role: 'worker', name: 'R', jobTitle: '', team: '', active: true })).rejects.toThrow(
      /not set up/,
    );
    const dev = await setup();
    const worker = await dev.login(PHONES.lakshmi);
    const options = await worker.post('/api/attendance/passkey-options').send({ action: 'check-in' });
    expect(options.body.error.code).toBe('PASSKEY_REQUIRED');
  });
});
