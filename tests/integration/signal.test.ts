import { describe, expect, it } from 'vitest';
import { setup, PHONES } from './helpers';
import type { SafeSignalResponse } from '../../src/shared/types';

describe('Safe Signal Integration — Recurring Hazard Detection & Privacy Protection', () => {
  it('suppresses patterns below minimum cohort threshold (cohort < 3)', async () => {
    const env = await setup();
    const admin = await env.login(PHONES.constructionAdmin);

    // Initial seed has only 1 report in fall, 1 in ppe, 1 in electrical
    const res = await admin.get('/api/admin/signals');
    expect(res.status).toBe(200);
    const body = res.body as SafeSignalResponse;

    expect(body.cohortThreshold).toBe(3);
    // No signals should trigger because each category has fewer than 3 reports
    expect(body.signals).toHaveLength(0);
    expect(body.analyzedReportCount).toBeGreaterThanOrEqual(3);
  });

  it('triggers category cluster signal when >= 3 reports exist in category and protects worker privacy', async () => {
    const env = await setup();
    const worker = await env.login(PHONES.lakshmi);
    const admin = await env.login(PHONES.constructionAdmin);

    // Seed already has 1 report in 'fall'. Submit 2 more to reach cohort threshold of 3.
    const rep1 = await worker.post('/api/reports').send({
      category: 'fall',
      severity: 'critical',
      title: 'Scaffold planks missing tie wire',
      description: 'Planks on second level scaffold are not wired down and shift when walked on.',
      location: 'Tower B west face',
      confidential: true,
    });
    expect(rep1.status).toBe(201);

    const rep2 = await worker.post('/api/reports').send({
      category: 'fall',
      severity: 'high',
      title: 'Unguarded floor opening',
      description: 'Core shaft opening on level 4 has no cover or perimeter barrier.',
      location: 'Core shaft 2',
      confidential: false,
    });
    expect(rep2.status).toBe(201);

    // Now admin queries Safe Signals
    const res = await admin.get('/api/admin/signals');
    expect(res.status).toBe(200);
    const body = res.body as SafeSignalResponse;

    expect(body.cohortThreshold).toBe(3);
    expect(body.signals.length).toBeGreaterThanOrEqual(1);

    const fallSignal = body.signals.find((s) => s.category === 'fall');
    expect(fallSignal).toBeDefined();
    expect(fallSignal!.reportCount).toBeGreaterThanOrEqual(3);
    expect(fallSignal!.rule).toBe('category_cluster');
    expect(fallSignal!.title).toContain('Fall from height');
    expect(fallSignal!.recommendedActions.length).toBeGreaterThan(0);
    expect(fallSignal!.statusSummary.unresolvedCount).toBeGreaterThan(0);

    // Strict privacy verification:
    // Verify that NO worker / reporter identifiers or personal info are leaked in the signal object
    const serializedSignal = JSON.stringify(fallSignal);
    expect(serializedSignal).not.toContain(PHONES.lakshmi);
    expect(serializedSignal).not.toContain('usr_demo_c_lakshmi');
    expect(serializedSignal).not.toContain('Lakshmi');
    expect(serializedSignal).not.toContain('reporter_id');
    expect(serializedSignal).not.toContain('reporterId');
  });

  it('enforces tenant isolation — signals in one organization do not leak to another', async () => {
    const env = await setup();
    const lakshmi = await env.login(PHONES.lakshmi);
    const irfan = await env.login(PHONES.irfan);
    const constructionAdmin = await env.login(PHONES.constructionAdmin);
    const campusAdmin = await env.login(PHONES.campusAdmin);

    // Create 3 reports in construction for 'machinery' category from two distinct workers
    for (let i = 0; i < 3; i++) {
      const res = await (i === 2 ? irfan : lakshmi).post('/api/reports').send({
        category: 'machinery',
        severity: 'high',
        title: `Heavy machinery hydraulic leak #${i + 1}`,
        description: 'Fluid dripping from excavator arm near pedestrian path.',
        location: 'Excavation zone',
        confidential: false,
      });
      expect(res.status).toBe(201);
    }

    // Construction admin should see the machinery signal
    const cRes = await constructionAdmin.get('/api/admin/signals');
    expect(cRes.status).toBe(200);
    const cBody = cRes.body as SafeSignalResponse;
    const machinerySignal = cBody.signals.find((s) => s.category === 'machinery');
    expect(machinerySignal).toBeDefined();
    expect(machinerySignal!.reportCount).toBe(3);

    // Campus admin should NOT see the machinery signal from construction
    const campusRes = await campusAdmin.get('/api/admin/signals');
    expect(campusRes.status).toBe(200);
    const campusBody = campusRes.body as SafeSignalResponse;
    const leakedSignal = campusBody.signals.find((s) => s.category === 'machinery');
    expect(leakedSignal).toBeUndefined();
  });

  it('blocks worker access to admin signals endpoint', async () => {
    const env = await setup();
    const worker = await env.login(PHONES.lakshmi);

    const res = await worker.get('/api/admin/signals');
    expect(res.status).toBe(403);
  });
});
