import request from 'supertest';
import type { Express } from 'express';
import { openDb } from '../../src/server/db/db';
import { seedIfEmpty } from '../../src/server/db/seed';
import { createApp } from '../../src/server/app';
import { invalidateSignalCache } from '../../src/server/services/signal';
import type { AppContext } from '../../src/server/context';
import type { AppConfig } from '../../src/server/config';

export const PHONES = {
  constructionAdmin: '9000000100',
  ravi: '9000000001',
  lakshmi: '9000000002',
  irfan: '9000000003',
  campusAdmin: '9100000100',
  manjula: '9100000001',
};

export interface TestEnv {
  ctx: AppContext;
  app: Express;
  clock: { now: Date };
  advance: (minutes: number) => void;
  login: (phone: string) => Promise<ReturnType<typeof request.agent>>;
}

/** Fresh in-memory database seeded at a fixed instant (Tuesday 27 Oct 2026, 09:00 IST). */
export async function setup(start = '2026-10-27T03:30:00.000Z', overrides: Partial<AppConfig> = {}, fetchImpl?: typeof fetch): Promise<TestEnv> {
  invalidateSignalCache();
  const clock = { now: new Date(start) };
  const ctx: AppContext = {
    db: openDb(':memory:'),
    config: {
      port: 0,
      production: false,
      sessionSecret: 'test-secret-'.padEnd(48, 'x'),
      receiptSigningSecret: 'test-secret-'.padEnd(48, 'x'),
      receiptSigningKeys: { v1: 'test-secret-'.padEnd(48, 'x') },
      activeReceiptKeyId: 'v1',
      checkpointSigningSecret: 'test-checkpoint-secret-'.padEnd(48, 'y'),
      checkpointSigningKeys: { chk_v1: 'test-checkpoint-secret-'.padEnd(48, 'y') },
      activeCheckpointKeyId: 'chk_v1',
      signalPseudonymSecret: 'test-signal-pseudonym-secret-'.padEnd(48, 'z'),
      databasePath: ':memory:',
      demoMode: true,
      smsProvider: 'mock',
      ...overrides,
    },
    now: () => clock.now,
    fetch: fetchImpl,
  };
  seedIfEmpty(ctx);
  const app = await createApp(ctx);
  return {
    ctx,
    app,
    clock,
    advance: (minutes) => {
      clock.now = new Date(clock.now.getTime() + minutes * 60000);
    },
    login: async (phone) => {
      const agent = request.agent(app);
      const res = await agent.post('/api/auth/login').send({ phone, pin: '1234' });
      if (res.status !== 200) throw new Error(`login failed for ${phone}: ${res.status} ${JSON.stringify(res.body)}`);
      return agent;
    },
  };
}
