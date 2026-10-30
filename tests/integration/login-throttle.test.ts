import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { PHONES, setup } from './helpers';
import { createApp } from '../../src/server/app';
import { MAX_FAILURES_PER_PHONE } from '../../src/server/routes/auth';

describe('PIN login throttling', () => {
  it('limits guesses per phone number even when every attempt comes from a different IP address', async () => {
    const { ctx } = await setup();
    // Production trusts one proxy hop, so X-Forwarded-For sets req.ip as it would behind Cloud Run.
    const app = await createApp({ ...ctx, config: { ...ctx.config, production: true } });
    const attempt = (ip: string, pin: string) => request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ phone: PHONES.lakshmi, pin });

    for (let i = 0; i < MAX_FAILURES_PER_PHONE; i++) {
      expect((await attempt(`203.0.113.${i + 1}`, '0000')).status).toBe(401);
    }
    // A fresh IP with the correct PIN is still refused until the window passes
    expect((await attempt('198.51.100.7', '1234')).status).toBe(429);

    // Other accounts are unaffected
    const other = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.8').send({ phone: PHONES.ravi, pin: '1234' });
    expect(other.status).toBe(200);
  });
});
