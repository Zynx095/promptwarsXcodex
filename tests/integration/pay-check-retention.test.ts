import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PHONES, setup } from './helpers';
import type { PayCheckDTO, PayCheckSummaryDTO, RetentionPanelDTO } from '../../src/shared/types';

describe('recorded payments and the pay check', () => {
  it('compares verified hours at the configured rate with recorded payments for each seeded state', async () => {
    const env = await setup();
    const admin = await env.login(PHONES.constructionAdmin);
    const payslips = (await admin.get('/api/admin/payslips?limit=100')).body.items as { workerId: string; periodStart: string; periodEnd: string }[];
    const week = payslips[0]!;
    const summary = (await admin.get(`/api/admin/pay-check?from=${week.periodStart}&to=${week.periodEnd}`)).body as PayCheckSummaryDTO;
    expect(summary.paymentsRecorded).toBe(true);
    const statuses = new Set(summary.items.map((i) => i.status));
    expect(statuses.has('no_discrepancy')).toBe(true);
    expect(statuses.has('requires_review')).toBe(true);
    for (const item of summary.items) {
      expect(Number.isInteger(item.recordedMinor)).toBe(true);
      if (item.expectedNetMinor !== null) expect(item.outstandingMinor).toBe(Math.max(0, item.expectedNetMinor - item.recordedMinor));
    }
    expect(Object.values(summary.counts).reduce((a, b) => a + b, 0)).toBe(summary.items.length);
  });

  it('records a payment (append-only, audited) and the worker sees the updated indicator for their own pay only', async () => {
    const env = await setup();
    const admin = await env.login(PHONES.constructionAdmin);
    const worker = await env.login(PHONES.lakshmi);
    const me = (await worker.get('/api/auth/me')).body.user as { id: string };
    const payslips = (await worker.get('/api/payslips')).body.items as { periodStart: string; periodEnd: string }[];
    const period = payslips[0]!;
    const before = (await worker.get(`/api/pay-check?from=${period.periodStart}&to=${period.periodEnd}`)).body as PayCheckDTO;
    expect(before.workerId).toBe(me.id);
    const due = before.result.outstandingMinor;

    if (due > 0) {
      const res = await admin.post('/api/admin/payments').send({
        workerId: me.id,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        amountMinor: due,
        method: 'cash',
        paidOn: period.periodEnd,
        reference: 'TEST-1',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const after = (await worker.get(`/api/pay-check?from=${period.periodStart}&to=${period.periodEnd}`)).body as PayCheckDTO;
      expect(after.result).toMatchObject({ status: 'no_discrepancy', outstandingMinor: 0 });
    }
    // Rows can never be edited or deleted
    expect(() => env.ctx.db.run(`UPDATE wage_payments SET amount_minor = 1`)).toThrow(/append-only/);
    expect(() => env.ctx.db.run(`DELETE FROM wage_payments`)).toThrow(/append-only/);
    // A worker cannot reach another worker's pay check or the admin endpoints
    expect((await worker.get('/api/admin/pay-check')).status).toBe(403);
    expect((await worker.post('/api/admin/payments').send({})).status).toBe(403);
  });

  it('validates payments: no zero, no future dates, adjustments need a reason, integer paise only', async () => {
    const env = await setup();
    const admin = await env.login(PHONES.constructionAdmin);
    const workerId = env.ctx.db.get<{ id: string }>(`SELECT id FROM users WHERE phone = @p`, { p: PHONES.ravi })!.id;
    const ok = { workerId, periodStart: '2026-10-19', periodEnd: '2026-10-25', amountMinor: 1000, method: 'upi', paidOn: '2026-10-26' };
    expect((await admin.post('/api/admin/payments').send({ ...ok, amountMinor: 0 })).status).toBe(400);
    expect((await admin.post('/api/admin/payments').send({ ...ok, amountMinor: 10.5 })).status).toBe(400);
    expect((await admin.post('/api/admin/payments').send({ ...ok, amountMinor: -100 })).status).toBe(400);
    expect((await admin.post('/api/admin/payments').send({ ...ok, kind: 'adjustment', amountMinor: -100 })).status).toBe(400);
    expect((await admin.post('/api/admin/payments').send({ ...ok, kind: 'adjustment', amountMinor: -100, note: 'Duplicate entry' })).status).toBe(201);
    const future = await admin.post('/api/admin/payments').send({ ...ok, paidOn: '2026-12-01' });
    expect(future.body.error.code).toBe('INVALID_PAYMENT');
  });

  it('says the calculation cannot be completed when no rate is configured', async () => {
    const env = await setup();
    const admin = await env.login(PHONES.constructionAdmin);
    const workerId = env.ctx.db.get<{ id: string }>(`SELECT id FROM users WHERE phone = @p`, { p: PHONES.irfan })!.id;
    env.ctx.db.run(`UPDATE users SET hourly_rate_minor = 0 WHERE id = @id`, { id: workerId });
    const check = (await admin.get(`/api/admin/pay-check/${workerId}`)).body as PayCheckDTO;
    expect(check.result).toMatchObject({ status: 'unavailable', expected: null });
    expect(check.result.reasons[0]).toBe('rate_missing');
  });
});

describe('retention attention panel', () => {
  it('explains each classification from recorded data and never changes anything', async () => {
    const env = await setup();
    const admin = await env.login(PHONES.constructionAdmin);
    const before = env.ctx.db.get<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM shifts) + (SELECT COUNT(*) FROM audit_events) + (SELECT COUNT(*) FROM users WHERE active = 1) AS n`,
    )!.n;
    const res = await admin.get('/api/admin/retention');
    expect(res.status).toBe(200);
    const panel = res.body as RetentionPanelDTO;
    expect(panel.window.days).toBe(30);
    expect(panel.counts.low + panel.counts.moderate + panel.counts.high).toBe(panel.workers.length);
    expect(panel.disclaimer).toMatch(/not a prediction/);
    expect(panel.unavailable.map((u) => u.key)).toEqual(expect.arrayContaining(['feedback', 'wage_disputes']));
    for (const w of panel.workers) {
      expect(w.score).toBe(w.factors.reduce((n, f) => n + f.points, 0));
      if (w.level === 'low' && w.score === 0) expect(w.factors).toEqual([]);
      for (const f of w.factors) {
        expect(f.points).toBeGreaterThan(0);
        expect(f.reason).toBeTruthy();
        expect(f.records.length).toBeGreaterThan(0);
      }
    }
    // Sorted by attention, highest first
    const scores = panel.workers.map((w) => w.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    // Read-only
    const after = env.ctx.db.get<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM shifts) + (SELECT COUNT(*) FROM audit_events) + (SELECT COUNT(*) FROM users WHERE active = 1) AS n`,
    )!.n;
    expect(after).toBe(before);
    // Workers cannot open it
    const worker = await env.login(PHONES.ravi);
    expect((await worker.get('/api/admin/retention')).status).toBe(403);
  });

  it('only counts named reports, never confidential ones', async () => {
    const env = await setup();
    const worker = await env.login(PHONES.irfan);
    const admin = await env.login(PHONES.constructionAdmin);
    const id = (await worker.get('/api/auth/me')).body.user.id as string;
    const safetyCount = async () =>
      ((await admin.get('/api/admin/retention')).body as RetentionPanelDTO).workers.find((w) => w.workerId === id)!.factors.find((f) => f.key === 'safety')
        ?.observed ?? 0;
    const start = await safetyCount();
    const report = {
      category: 'electrical',
      severity: 'medium',
      title: 'Loose wiring',
      description: 'Exposed wires near the hoist panel.',
      location: 'Level 2',
    };
    expect((await worker.post('/api/reports').send({ ...report, confidential: true })).status).toBe(201);
    expect(await safetyCount()).toBe(start);
    expect((await worker.post('/api/reports').send({ ...report, confidential: false })).status).toBe(201);
    expect(await safetyCount()).toBe(start + 1);
  });

  it('gives a new worker with no records no attention at all', async () => {
    const env = await setup();
    const admin = await env.login(PHONES.constructionAdmin);
    const created = await admin.post('/api/admin/workers').send({ name: 'New Starter', phone: '9000000999', hourlyRateMinor: 15000 });
    expect(created.status).toBe(201);
    const panel = (await admin.get('/api/admin/retention')).body as RetentionPanelDTO;
    expect(panel.workers.find((w) => w.workerId === created.body.id)).toMatchObject({ level: 'low', score: 0, factors: [] });
  });
});

describe('offline retries are stored once', () => {
  it('returns the existing report when the same client request ID is sent again', async () => {
    const env = await setup();
    const worker = await env.login(PHONES.lakshmi);
    const body = {
      category: 'electrical',
      severity: 'low',
      title: 'Loose cable',
      description: 'Water pooled near the stairwell entrance.',
      location: 'Block A',
      clientRequestId: randomUUID(),
    };
    const first = await worker.post('/api/reports').send(body);
    const second = await worker.post('/api/reports').send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(env.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM safety_reports WHERE client_request_id = @k`, { k: body.clientRequestId })!.n).toBe(1);
    // Confidential retries work the same way and never expose another person's report
    const conf = { ...body, clientRequestId: randomUUID(), confidential: true };
    const c1 = await worker.post('/api/reports').send(conf);
    const c2 = await worker.post('/api/reports').send(conf);
    expect(c2.body.id).toBe(c1.body.id);
    const other = await env.login(PHONES.irfan);
    const stolen = await other.post('/api/reports').send(conf);
    expect(stolen.status).toBe(409);
    expect(JSON.stringify(stolen.body)).not.toContain(c1.body.id);
  });
});
