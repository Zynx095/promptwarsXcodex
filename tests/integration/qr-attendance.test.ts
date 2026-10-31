import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildSiteQrToken, parseSiteQrToken, QR_ROTATE_SECONDS, QR_TTL_SECONDS, verifySiteQrSignature } from '../../src/server/auth/siteQr';
import { SoftAuthenticator } from '../fixtures/authenticator';
import { PHONES, setup, type TestEnv } from './helpers';
import type { SiteDTO, SiteQrStateDTO } from '../../src/shared/types';

type Agent = Awaited<ReturnType<TestEnv['login']>>;

async function adminWithQr(env: TestEnv, code = 'P42CY') {
  const admin = await env.login(PHONES.constructionAdmin);
  const sites = (await admin.get('/api/admin/sites')).body.items as SiteDTO[];
  const site = sites.find((s) => s.code === code)!;
  const started = await admin.post(`/api/admin/sites/${site.id}/qr/start`).send({});
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  return { admin, site, state: started.body as SiteQrStateDTO };
}

/** Lakshmi is not on shift in the seed data. */
async function lakshmi(env: TestEnv): Promise<Agent> {
  const w = await env.login(PHONES.lakshmi);
  const status = (await w.get('/api/attendance/status')).body;
  if (status.state === 'on_shift') await w.post('/api/attendance/check-out').send({});
  env.advance(0.1);
  return w;
}

describe('signed site QR tokens', () => {
  const secret = 'unit-secret-'.padEnd(48, 'q');
  const issued = new Date('2026-10-27T03:30:00.000Z');

  it('round-trips and fits a version 6 QR code as a link', () => {
    const token = buildSiteQrToken(secret, 'org_a', 'site_1', 'P42CY', issued, 'AbCdEfGh');
    const parsed = parseSiteQrToken(token)!;
    expect(parsed).toMatchObject({ siteCode: 'P42CY', nonce: 'AbCdEfGh', issuedSec: issued.getTime() / 1000 });
    expect(verifySiteQrSignature(secret, 'org_a', 'site_1', parsed)).toBe(true);
    expect(`https://fairshift-nine-red.vercel.app/c/${token}`.length).toBeLessThanOrEqual(106);
  });

  it('rejects a token signed for another organisation, site, time or nonce, or with another secret', () => {
    const token = buildSiteQrToken(secret, 'org_a', 'site_1', 'P42CY', issued, 'AbCdEfGh');
    const parsed = parseSiteQrToken(token)!;
    expect(verifySiteQrSignature(secret, 'org_b', 'site_1', parsed)).toBe(false);
    expect(verifySiteQrSignature(secret, 'org_a', 'site_2', parsed)).toBe(false);
    expect(verifySiteQrSignature('other-secret-'.padEnd(48, 'x'), 'org_a', 'site_1', parsed)).toBe(false);
    expect(verifySiteQrSignature(secret, 'org_a', 'site_1', { ...parsed, issuedSec: parsed.issuedSec + 60 })).toBe(false);
    expect(verifySiteQrSignature(secret, 'org_a', 'site_1', { ...parsed, nonce: 'ZZZZZZZZ' })).toBe(false);
    expect(parseSiteQrToken('not a token')).toBeNull();
    expect(parseSiteQrToken(`${token}x`)).toBeNull();
  });
});

describe('rotating QR attendance check-in', () => {
  it('shows a rotating code only while the display is active and rotates it on schedule', async () => {
    const env = await setup();
    const admin = await env.login(PHONES.constructionAdmin);
    const site = ((await admin.get('/api/admin/sites')).body.items as SiteDTO[])[0]!;
    const idle = (await admin.get(`/api/admin/sites/${site.id}/qr`)).body as SiteQrStateDTO;
    expect(idle).toMatchObject({ active: false, token: null, rotateSeconds: QR_ROTATE_SECONDS, ttlSeconds: QR_TTL_SECONDS });

    const { state } = await adminWithQr(env, site.code);
    expect(state.active).toBe(true);
    expect(state.token).toMatch(/^1\./);
    // Same code until the rotation is due, then a new one
    env.advance(0.25);
    expect((await admin.get(`/api/admin/sites/${site.id}/qr`)).body.token).toBe(state.token);
    env.clock.now = new Date(env.clock.now.getTime() + QR_ROTATE_SECONDS * 1000);
    const rotated = (await admin.get(`/api/admin/sites/${site.id}/qr`)).body as SiteQrStateDTO;
    expect(rotated.token).not.toBe(state.token);
    expect(Date.parse(rotated.expiresAt!) - Date.parse(rotated.issuedAt!)).toBe(QR_TTL_SECONDS * 1000);

    const stopped = (await admin.post(`/api/admin/sites/${site.id}/qr/stop`).send({})).body as SiteQrStateDTO;
    expect(stopped).toMatchObject({ active: false, token: null });
  });

  it('checks a worker in at the scanned site after showing them which site it is', async () => {
    const env = await setup();
    const { site, state } = await adminWithQr(env);
    const w = await lakshmi(env);
    const preview = await w.post('/api/attendance/qr/resolve').send({ token: state.token });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body).toMatchObject({ siteId: site.id, siteName: site.name, alreadyUsed: false });
    // Looking the code up records nothing
    expect((await w.get('/api/attendance/status')).body.state).not.toBe('on_shift');

    const res = await w.post('/api/attendance/check-in').send({ qrToken: state.token });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ checkInMethod: 'site_qr', siteId: site.id, siteName: site.name });
    const history = (await w.get('/api/attendance/shifts')).body.items;
    expect(history[0]).toMatchObject({ checkInMethod: 'site_qr', siteName: site.name });
    const audit = env.ctx.db.get<{ after: string }>(`SELECT after_json AS after FROM audit_events WHERE action = 'check_in' ORDER BY created_at DESC LIMIT 1`)!;
    expect(JSON.parse(audit.after)).toMatchObject({ method: 'site_qr', siteId: site.id });
  });

  it('rejects an expired code by the server clock, whatever the phone says', async () => {
    const env = await setup();
    const { state } = await adminWithQr(env);
    const w = await lakshmi(env);
    env.clock.now = new Date(Date.parse(state.issuedAt!) + QR_TTL_SECONDS * 1000);
    const res = await w.post('/api/attendance/check-in').send({ qrToken: state.token, queuedAt: state.issuedAt });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('QR_EXPIRED');
  });

  it('rejects edited signatures, unknown nonces and codes from another organisation', async () => {
    const env = await setup();
    const { site, state } = await adminWithQr(env);
    const w = await lakshmi(env);
    const parts = state.token!.split('.');
    const badSig = [...parts.slice(0, 4), parts[4]!.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'))].join('.');
    const forged = buildSiteQrToken(env.ctx.config.sessionSecret, 'org_demo_construction', site.id, site.code, new Date(), 'ZZZZZZZZ');
    for (const token of [badSig, forged]) {
      const res = await w.post('/api/attendance/check-in').send({ qrToken: token });
      expect(res.status, token).toBe(422);
      expect(res.body.error.code).toBe('QR_INVALID');
    }
    // A campus worker scanning the construction site's code
    const campus = await env.login(PHONES.manjula);
    const other = await campus.post('/api/attendance/qr/resolve').send({ token: state.token });
    expect(other.body.error.code).toBe('QR_INVALID');
    expect((await w.post('/api/attendance/check-in').send({ qrToken: 'garbage' })).status).toBe(400);
  });

  it('does not accept a token whose site code was swapped for another site', async () => {
    const env = await setup();
    const { state } = await adminWithQr(env, 'P42CY');
    const w = await lakshmi(env);
    const swapped = state.token!.replace('.P42CY.', '.SSX01.');
    const res = await w.post('/api/attendance/check-in').send({ qrToken: swapped });
    expect(res.body.error.code).toBe('QR_INVALID');
  });

  it('prevents replays: the same worker cannot reuse a code, and a stopped or refreshed display invalidates it', async () => {
    const env = await setup();
    const { admin, site, state } = await adminWithQr(env);
    const w = await lakshmi(env);
    expect((await w.post('/api/attendance/check-in').send({ qrToken: state.token })).status).toBe(201);
    // Duplicate check-in while on shift
    const dup = await w.post('/api/attendance/check-in').send({ qrToken: state.token });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_ON_SHIFT');
    env.advance(0.2);
    expect((await w.post('/api/attendance/check-out').send({})).status).toBe(200);
    // Replaying the same code after checking out
    const replay = await w.post('/api/attendance/check-in').send({ qrToken: state.token });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('QR_ALREADY_USED');
    expect((await w.post('/api/attendance/qr/resolve').send({ token: state.token })).body.alreadyUsed).toBe(true);

    // Refreshing replaces the code at once; stopping the display ends it
    const refreshed = (await admin.post(`/api/admin/sites/${site.id}/qr/refresh`).send({})).body as SiteQrStateDTO;
    const irfan = await env.login(PHONES.irfan);
    if ((await irfan.get('/api/attendance/status')).body.state === 'on_shift') await irfan.post('/api/attendance/check-out').send({});
    expect((await irfan.post('/api/attendance/check-in').send({ qrToken: state.token })).body.error.code).toBe('QR_INACTIVE');
    await admin.post(`/api/admin/sites/${site.id}/qr/stop`).send({});
    expect((await irfan.post('/api/attendance/check-in').send({ qrToken: refreshed.token })).body.error.code).toBe('QR_INACTIVE');
  });

  it('refuses codes for a deactivated site', async () => {
    const env = await setup();
    const { admin, site, state } = await adminWithQr(env);
    await admin.patch(`/api/admin/sites/${site.id}/status`).send({ active: false });
    const w = await lakshmi(env);
    expect((await w.post('/api/attendance/check-in').send({ qrToken: state.token })).body.error.code).toBe('SITE_INACTIVE');
    expect((await admin.post(`/api/admin/sites/${site.id}/qr/start`).send({})).body.error.code).toBe('SITE_INACTIVE');
  });

  it('requires a signed-in worker, and still requires the passkey when the worker has one', async () => {
    const env = await setup(undefined, { webauthnRpId: 'fairshift.test', webauthnOrigins: ['https://fairshift.test'] });
    const { state } = await adminWithQr(env);
    // No session: a QR code is not a credential on its own
    const anon = await request(env.app).post('/api/attendance/check-in').set('Content-Type', 'application/json').send({ qrToken: state.token });
    expect([401, 403]).toContain(anon.status);
    const anonResolve = await request(env.app).post('/api/attendance/qr/resolve').set('Content-Type', 'application/json').send({ token: state.token });
    expect([401, 403]).toContain(anonResolve.status);
    // Administrators cannot check in with it either
    const admin = await env.login(PHONES.constructionAdmin);
    expect((await admin.post('/api/attendance/check-in').send({ qrToken: state.token })).status).toBe(403);

    const w = await lakshmi(env);
    const device = new SoftAuthenticator('fairshift.test', 'https://fairshift.test');
    const options = await w.post('/api/passkeys/register-options').send({});
    expect((await w.post('/api/passkeys/register').send({ label: 'Phone', response: device.register(options.body) })).status).toBe(201);
    const without = await w.post('/api/attendance/check-in').send({ qrToken: state.token });
    expect(without.body.error.code).toBe('PASSKEY_REQUIRED');
    const challenge = await w.post('/api/attendance/passkey-options').send({ action: 'check-in' });
    const ok = await w.post('/api/attendance/check-in').send({ qrToken: state.token, passkey: device.assert(challenge.body) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ checkInMethod: 'site_qr', checkInAuth: 'passkey' });
  });

  it('records an offline tap time for review without using it as the check-in time', async () => {
    const env = await setup();
    const w = await lakshmi(env);
    const claimed = new Date(env.clock.now.getTime() - 3 * 3600000).toISOString();
    const res = await w.post('/api/attendance/check-in').send({ queuedAt: claimed });
    expect(res.status).toBe(201);
    expect(res.body.checkInAt).toBe(env.clock.now.toISOString());
    const audit = env.ctx.db.get<{ after: string }>(`SELECT after_json AS after FROM audit_events WHERE action = 'check_in' ORDER BY created_at DESC LIMIT 1`)!;
    expect(JSON.parse(audit.after)).toMatchObject({ queuedOfflineAt: claimed, queuedOfflineAtSource: 'device clock, unverified' });
  });
});
