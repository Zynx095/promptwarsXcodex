import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { PHONES, setup } from './helpers';
import { hmac } from '../../src/server/auth/crypto';

async function signIn(app: Parameters<typeof request>[0], phone: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ phone, pin: '1234' });
  expect(res.status).toBe(200);
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('fs_session='));
  expect(cookie).toBeDefined();
  return cookie!.split(';')[0]!;
}

describe('Session revocation', () => {
  it('rejects a copied session cookie after the user signs out', async () => {
    const { app } = await setup();
    const cookie = await signIn(app, PHONES.ravi);

    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);

    const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie).send({});
    expect(logout.status).toBe(200);

    // Replaying the old cookie (e.g. from another device or a stolen copy) no longer works
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);

    // Signing in again issues a fresh, working session
    const fresh = await signIn(app, PHONES.ravi);
    expect((await request(app).get('/api/auth/me').set('Cookie', fresh)).status).toBe(200);
  });

  it('does not revive pre-deactivation sessions when a worker is reactivated', async () => {
    const { app } = await setup();
    const workerCookie = await signIn(app, PHONES.lakshmi);
    const adminCookie = await signIn(app, PHONES.constructionAdmin);
    const me = await request(app).get('/api/auth/me').set('Cookie', workerCookie);
    const workerId = me.body.user.id as string;

    const deactivate = await request(app).patch(`/api/admin/workers/${workerId}`).set('Cookie', adminCookie).send({ active: false });
    expect(deactivate.status).toBe(200);
    expect((await request(app).get('/api/attendance/status').set('Cookie', workerCookie)).status).toBe(401);

    const reactivate = await request(app).patch(`/api/admin/workers/${workerId}`).set('Cookie', adminCookie).send({ active: true });
    expect(reactivate.status).toBe(200);
    expect((await request(app).get('/api/attendance/status').set('Cookie', workerCookie)).status).toBe(401);

    // Rate changes do not sign the worker out
    const worker2 = await signIn(app, PHONES.lakshmi);
    await request(app).patch(`/api/admin/workers/${workerId}`).set('Cookie', adminCookie).send({ hourlyRateMinor: 20000 });
    expect((await request(app).get('/api/attendance/status').set('Cookie', worker2)).status).toBe(200);
  });

  it('adopts a newer session version issued by another instance and keeps rejecting older cookies', async () => {
    const { app, ctx } = await setup();
    const older = await signIn(app, PHONES.ravi);
    // A sign-in on another instance with its own database, where Ravi had already signed out once
    const exp = ctx.now().getTime() + 60_000;
    const payload = Buffer.from(JSON.stringify({ sub: 'usr_demo_c_ravi', sid: 'other', ver: 1, exp })).toString('base64url');
    const newer = `fs_session=${payload}.${hmac(ctx.config.sessionSecret, payload)}`;

    expect((await request(app).get('/api/auth/me').set('Cookie', newer)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', older)).status).toBe(401);
  });

  it('accepts cookies issued before session versioning existed as version 0', async () => {
    const { app, ctx } = await setup();
    // Legacy token shape: no "ver" claim
    const payload = Buffer.from(JSON.stringify({ sub: 'usr_demo_c_ravi', sid: 'legacy', exp: ctx.now().getTime() + 60_000 })).toString('base64url');
    const legacy = `fs_session=${payload}.${hmac(ctx.config.sessionSecret, payload)}`;
    expect((await request(app).get('/api/auth/me').set('Cookie', legacy)).status).toBe(200);
  });
});
