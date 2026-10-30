import { describe, expect, it } from 'vitest';
import { setup, PHONES } from './helpers';
import type { AccountabilityMetricsDTO, SafetyReportDTO } from '../../src/shared/types';

describe('FairShift Accountability Loop Integration — Lifecycle & Metrics', () => {
  it('executes full accountability loop: submission -> acknowledgement -> resolution -> follow-up -> outcome verification', async () => {
    const env = await setup();
    const worker = await env.login(PHONES.lakshmi);
    const admin = await env.login(PHONES.constructionAdmin);

    // 1. Worker submits a hazard report
    const createRes = await worker.post('/api/reports').send({
      category: 'scaffolding',
      severity: 'critical',
      title: 'Scaffold tie wires loose on Level 3',
      description: 'Wind causes scaffold structure to sway away from concrete columns.',
      location: 'Level 3 East Wing',
      confidential: false,
    });
    expect(createRes.status).toBe(201);
    const reportId = createRes.body.id;

    // 2. Admin acknowledges
    env.advance(15); // 15 mins later
    const ackRes = await admin.post(`/api/admin/reports/${reportId}/transition`).send({
      to: 'acknowledged',
      assignee: 'Scaffolding lead',
    });
    expect(ackRes.status).toBe(200);
    expect(ackRes.body.status).toBe('acknowledged');
    expect(ackRes.body.assignee).toBe('Scaffolding lead');

    // 3. Admin marks work in progress
    env.advance(30); // 30 mins later
    const inProgressRes = await admin.post(`/api/admin/reports/${reportId}/transition`).send({
      to: 'in_progress',
      note: 'Crew mobilized with high-tensile wire and clamps.',
    });
    expect(inProgressRes.status).toBe(200);
    expect(inProgressRes.body.status).toBe('in_progress');

    // 4. Admin resolves with action taken
    env.advance(90); // 90 mins later
    const resolveRes = await admin.post(`/api/admin/reports/${reportId}/transition`).send({
      to: 'resolved',
      note: 'Rigid anchor clamps installed to column 14B.',
      actionTaken: 'Replaced flexible tie wire with 48mm steel scaffold column clamps.',
    });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.status).toBe('resolved');
    expect(resolveRes.body.resolvedAt).toBeDefined();
    expect(resolveRes.body.actionTaken).toBe('Replaced flexible tie wire with 48mm steel scaffold column clamps.');

    // 5. Admin schedules follow-up inspection
    env.advance(10);
    const followUpRes = await admin.post(`/api/admin/reports/${reportId}/transition`).send({
      to: 'follow_up_pending',
      note: 'Scheduled 48-hour torque and load verification.',
      followUpDate: '2026-10-31',
    });
    expect(followUpRes.status).toBe(200);
    expect(followUpRes.body.status).toBe('follow_up_pending');
    expect(followUpRes.body.followUpDate).toBe('2026-10-31');

    // 6. Admin verifies outcome (advance 48 hours and re-authenticate)
    env.advance(2880); // 48 hours later
    const adminActive = await env.login(PHONES.constructionAdmin);
    const verifyRes = await adminActive.post(`/api/admin/reports/${reportId}/transition`).send({
      to: 'outcome_verified',
      note: 'Torque test passed at 50 Nm. Zero deflection under gust wind.',
      verifiedBy: 'Suresh Rao (Third-party Safety Auditor)',
      verificationNote: 'Anchor confirmed fully rigid and compliant with safety standard IS 4014.',
    });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.status).toBe('outcome_verified');
    expect(verifyRes.body.verifiedAt).toBeDefined();
    expect(verifyRes.body.verifiedBy).toMatch(/^Suresh Rao \(Third-party Safety Auditor\) \(recorded by resolving administrator .+\)$/);
    expect(verifyRes.body.verificationNote).toBe('Anchor confirmed fully rigid and compliant with safety standard IS 4014.');

    // 7. Worker opens report: complete transparency of action taken and verification
    const workerActive = await env.login(PHONES.lakshmi);
    const workerReportRes = await workerActive.get(`/api/reports/${reportId}`);
    expect(workerReportRes.status).toBe(200);
    const workerReport = workerReportRes.body as SafetyReportDTO;
    expect(workerReport.status).toBe('outcome_verified');
    expect(workerReport.actionTaken).toBe('Replaced flexible tie wire with 48mm steel scaffold column clamps.');
    expect(workerReport.verifiedBy).toContain('Suresh Rao (Third-party Safety Auditor)');
    expect(workerReport.history!.length).toBeGreaterThanOrEqual(5);

    // 8. Fetch accountability metrics
    const metricsRes = await adminActive.get('/api/admin/reports/accountability');
    expect(metricsRes.status).toBe(200);
    const metrics = metricsRes.body as AccountabilityMetricsDTO;
    expect(metrics.totalReports).toBeGreaterThanOrEqual(1);
    expect(metrics.verifiedCount).toBeGreaterThanOrEqual(1);
    expect(metrics.meanTimeToAcknowledgeMinutes).toBeGreaterThan(0);
    expect(metrics.meanTimeToResolveMinutes).toBeGreaterThan(0);
    expect(metrics.verificationRatePercent).toBeGreaterThan(0);
  });

  it('allows reopening a verified report if the hazard reoccurs and updates reopen rate', async () => {
    const env = await setup();
    const worker = await env.login(PHONES.lakshmi);
    const admin = await env.login(PHONES.constructionAdmin);

    // Submit -> Ack -> Resolve -> Verify
    const rep = await worker.post('/api/reports').send({
      category: 'electrical',
      severity: 'high',
      title: 'Water pipe leaking into junction box',
      description: 'Condensation dripping onto live 415V distribution board.',
      location: 'Substation B',
      confidential: false,
    });
    const repId = rep.body.id;

    await admin.post(`/api/admin/reports/${repId}/transition`).send({ to: 'acknowledged' });
    await admin.post(`/api/admin/reports/${repId}/transition`).send({
      to: 'resolved',
      note: 'Drip tray installed and pipe joint tightened.',
    });
    await admin.post(`/api/admin/reports/${repId}/transition`).send({
      to: 'outcome_verified',
      note: 'No water ingress observed after 24h.',
    });

    // Substation vibrates during compressor start; leak resumes -> Reopen report
    const reopenRes = await admin.post(`/api/admin/reports/${repId}/transition`).send({
      to: 'reopened',
      note: 'Vibration caused joint to loosen again; water is dripping into tray overflow.',
    });
    expect(reopenRes.status).toBe(200);
    expect(reopenRes.body.status).toBe('reopened');
    expect(reopenRes.body.resolvedAt).toBeNull();
    expect(reopenRes.body.verifiedAt).toBeNull();

    // Check accountability metrics reflect the reopen
    const metricsRes = await admin.get('/api/admin/reports/accountability');
    expect(metricsRes.status).toBe(200);
    const metrics = metricsRes.body as AccountabilityMetricsDTO;
    expect(metrics.reopenedCount).toBeGreaterThanOrEqual(1);
    expect(metrics.reopenRatePercent).toBeGreaterThan(0);
  });

  it('enforces tenant isolation and access control on accountability metrics', async () => {
    const env = await setup();
    const worker = await env.login(PHONES.lakshmi);
    const constructionAdmin = await env.login(PHONES.constructionAdmin);
    const campusAdmin = await env.login(PHONES.campusAdmin);

    // Worker is forbidden from accessing admin accountability metrics
    const workerRes = await worker.get('/api/admin/reports/accountability');
    expect(workerRes.status).toBe(403);

    // Construction admin and Campus admin get isolated metrics
    const cRes = await constructionAdmin.get('/api/admin/reports/accountability');
    const bRes = await campusAdmin.get('/api/admin/reports/accountability');

    expect(cRes.status).toBe(200);
    expect(bRes.status).toBe(200);
  });
});
