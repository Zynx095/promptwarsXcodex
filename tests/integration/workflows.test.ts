import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PHONES, setup, type TestEnv } from './helpers';
import type { AttendanceStatusDTO, DashboardDTO, PayslipDTO, SafetyReportDTO, ShiftDTO } from '../../src/shared/types';
import { evaluateWorkerFatigue } from '../../src/server/services/fatigue';
import { requireOrg } from '../../src/server/repositories/orgs';

let env: TestEnv;
beforeEach(async () => {
  env = await setup();
});

describe('primary demonstration workflow (construction)', () => {
  it('check-in/out -> overtime -> payslip -> hazard report -> admin resolves -> dashboard updates', async () => {
    const worker = await env.login(PHONES.lakshmi);
    const admin = await env.login(PHONES.constructionAdmin);

    const before = (await admin.get('/api/admin/dashboard?from=2026-10-27&to=2026-10-27')).body as DashboardDTO;
    expect(before.synthetic).toBe(true);

    // 1. Check in, duplicate check-in rejected.
    let status = (await worker.get('/api/attendance/status')).body as AttendanceStatusDTO;
    expect(status.state).toBe('not_started');
    const inRes = await worker.post('/api/attendance/check-in').send({});
    expect(inRes.status).toBe(201);
    expect((inRes.body as ShiftDTO).status).toBe('open');
    const dup = await worker.post('/api/attendance/check-in').send({});
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_ON_SHIFT');
    status = (await worker.get('/api/attendance/status')).body;
    expect(status.state).toBe('on_shift');

    const mid = (await admin.get('/api/admin/dashboard?from=2026-10-27&to=2026-10-27')).body as DashboardDTO;
    expect(mid.onShiftNow).toBe(before.onShiftNow + 1);

    // 2. Ten hours later, check out: duration and overtime are derived server-side.
    env.advance(600);
    const out = await worker.post('/api/attendance/check-out').send({ durationMinutes: 1, overtimeMinutes: 999 });
    expect(out.status).toBe(200);
    expect((out.body as ShiftDTO).durationMinutes).toBe(600);
    status = (await worker.get('/api/attendance/status')).body;
    expect(status.state).toBe('completed');
    expect(status.today).toMatchObject({ workedMinutes: 600, regularMinutes: 480, overtimeMinutes: 120 });
    expect((await worker.post('/api/attendance/check-out').send({})).status).toBe(409);

    // 3. Payslip preview for the day: Rs 75/h, 2x overtime, PF 12% of base, welfare 1% of gross.
    const slip = (await worker.get('/api/payslips/preview?from=2026-10-27&to=2026-10-27')).body as PayslipDTO;
    expect(slip.status).toBe('preview');
    const b = slip.breakdown;
    expect(b).toMatchObject({ regularMinutes: 480, overtimeMinutes: 120, basePayMinor: 60000, overtimePayMinor: 30000, grossPayMinor: 90000 });
    expect(b.deductions.map((d) => d.amountMinor)).toEqual([7200, 900]);
    expect(b.netPayMinor).toBe(81900);
    expect(b.basePayMinor + b.overtimePayMinor - b.totalDeductionsMinor).toBe(b.netPayMinor);

    // 4. Worker submits a hazard report.
    const created = await worker.post('/api/reports').send({
      category: 'scaffolding',
      severity: 'critical',
      title: 'Scaffold base plate missing',
      description: 'One standard is resting directly on loose soil without a base plate.',
      location: 'Tower A north face',
    });
    expect(created.status).toBe(201);
    const report = created.body as SafetyReportDTO;
    expect(report.status).toBe('submitted');

    const afterReport = (await admin.get('/api/admin/dashboard?from=2026-10-27&to=2026-10-27')).body as DashboardDTO;
    expect(afterReport.openReports).toBe(before.openReports + 1);
    expect(afterReport.criticalUnresolved).toBe(before.criticalUnresolved + 1);
    expect(afterReport.completedShifts).toBe(before.completedShifts + 1);
    expect(afterReport.overtimeMinutes).toBe(before.overtimeMinutes + 120);
    expect(afterReport.recentActivity.some((a) => a.text.includes('Scaffold base plate missing'))).toBe(true);

    // 5. Admin cannot skip acknowledgement, must give a note to resolve, then resolves.
    const skip = await admin.post(`/api/admin/reports/${report.id}/transition`).send({ to: 'resolved', note: 'Fixed' });
    expect(skip.status).toBe(409);
    const ack = await admin.post(`/api/admin/reports/${report.id}/transition`).send({ to: 'acknowledged', assignee: 'Scaffolding foreman' });
    expect(ack.status).toBe(200);
    expect(ack.body.assignee).toBe('Scaffolding foreman');
    const noNote = await admin.post(`/api/admin/reports/${report.id}/transition`).send({ to: 'resolved' });
    expect(noNote.status).toBe(422);
    expect(noNote.body.error.code).toBe('NOTE_REQUIRED');
    env.advance(30);
    const resolved = await admin.post(`/api/admin/reports/${report.id}/transition`).send({ to: 'resolved', note: 'Base plate and sole board fitted.' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('resolved');
    expect(resolved.body.resolvedAt).toBeTruthy();

    // Worker sees the status and the timestamped history.
    const mine = (await worker.get(`/api/reports/${report.id}`)).body as SafetyReportDTO;
    expect(mine.status).toBe('resolved');
    expect(mine.history!.map((h) => h.toStatus)).toEqual(['submitted', 'acknowledged', 'resolved']);

    // 6. Dashboard reflects the resolution.
    const after = (await admin.get('/api/admin/dashboard?from=2026-10-27&to=2026-10-27')).body as DashboardDTO;
    expect(after.openReports).toBe(before.openReports);
    expect(after.criticalUnresolved).toBe(before.criticalUnresolved);
  });

  it('issues an immutable payslip once per worker and period', async () => {
    const admin = await env.login(PHONES.constructionAdmin);
    const workers = (await admin.get('/api/admin/workers')).body.items as { id: string; name: string }[];
    const lakshmi = workers.find((w) => w.name === 'Lakshmi Devi')!;
    const body = { workerId: lakshmi.id, from: '2026-10-26', to: '2026-10-26' };
    const issued = await admin.post('/api/admin/payslips').send(body);
    expect(issued.status).toBe(201);
    expect(issued.body.status).toBe('issued');
    expect((await admin.post('/api/admin/payslips').send(body)).status).toBe(409);
    const worker = await env.login(PHONES.lakshmi);
    const list = (await worker.get('/api/payslips')).body;
    expect(list.items.some((p: { id: string }) => p.id === issued.body.id)).toBe(true);
    const own = await worker.get(`/api/payslips/${issued.body.id}`);
    expect(own.status).toBe(200);
    expect(own.body.breakdown.netPayMinor).toBe(issued.body.breakdown.netPayMinor);
  });
});

describe('access control and data isolation', () => {
  it('rejects unauthenticated requests and non-admin access to admin APIs', async () => {
    expect((await request(env.app).get('/api/attendance/status')).status).toBe(401);
    expect((await request(env.app).get('/api/admin/dashboard')).status).toBe(401);
    const worker = await env.login(PHONES.lakshmi);
    expect((await worker.get('/api/admin/dashboard')).status).toBe(403);
    expect((await worker.get('/api/admin/feedback')).status).toBe(403);
    expect((await worker.patch('/api/admin/skills/anything').send({ verified: true })).status).toBe(403);
    const admin = await env.login(PHONES.constructionAdmin);
    expect((await admin.post('/api/attendance/check-in').send({})).status).toBe(403);
  });

  it("prevents a worker from opening another worker's payslip or report", async () => {
    const admin = await env.login(PHONES.constructionAdmin);
    const slips = (await admin.get('/api/admin/payslips')).body.items as { id: string; workerName: string }[];
    const ravisSlip = slips.find((s) => s.workerName === 'Ravi Kumar')!;
    expect(ravisSlip).toBeDefined();
    const lakshmi = await env.login(PHONES.lakshmi);
    const res = await lakshmi.get(`/api/payslips/${ravisSlip.id}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Ravi');

    const reports = (await admin.get('/api/admin/reports')).body.items as SafetyReportDTO[];
    const notMine = reports.find((r) => !r.confidential && r.reporterName !== 'Lakshmi Devi')!;
    expect((await lakshmi.get(`/api/reports/${notMine.id}`)).status).toBe(404);
  });

  it('prevents an admin from reaching another organisation by manipulating identifiers', async () => {
    const cAdmin = await env.login(PHONES.constructionAdmin);
    const eAdmin = await env.login(PHONES.campusAdmin);
    const cReport = ((await cAdmin.get('/api/admin/reports')).body.items as SafetyReportDTO[])[0]!;
    const cShift = ((await cAdmin.get('/api/admin/shifts?status=completed')).body.items as ShiftDTO[])[0]!;
    const cWorker = ((await cAdmin.get('/api/admin/workers')).body.items as { id: string }[])[0]!;
    const cSlip = ((await cAdmin.get('/api/admin/payslips')).body.items as { id: string }[])[0]!;

    expect((await eAdmin.get(`/api/admin/reports/${cReport.id}`)).status).toBe(404);
    expect((await eAdmin.post(`/api/admin/reports/${cReport.id}/transition`).send({ to: 'acknowledged' })).status).toBe(404);
    expect(
      (await eAdmin.patch(`/api/admin/shifts/${cShift.id}`).send({ checkInAt: cShift.checkInAt, checkOutAt: null, reason: 'Testing isolation' })).status,
    ).toBe(404);
    expect((await eAdmin.get(`/api/admin/workers/${cWorker.id}/skills`)).status).toBe(404);
    expect((await eAdmin.patch(`/api/admin/workers/${cWorker.id}`).send({ hourlyRateMinor: 1 })).status).toBe(404);
    expect((await eAdmin.get(`/api/admin/payslips/${cSlip.id}`)).status).toBe(404);
    expect((await eAdmin.get(`/api/admin/payslips/preview?workerId=${cWorker.id}&from=2026-10-20&to=2026-10-26`)).status).toBe(404);
    expect((await eAdmin.get(`/api/admin/shifts?workerId=${cWorker.id}`)).body.items).toHaveLength(0);
  });

  it('rejects bad logins and throttles repeated failures', async () => {
    const res = await request(env.app).post('/api/auth/login').send({ phone: PHONES.lakshmi, pin: '0000' });
    expect(res.status).toBe(401);
    for (let i = 0; i < 9; i++) await request(env.app).post('/api/auth/login').send({ phone: PHONES.lakshmi, pin: '0000' });
    expect((await request(env.app).post('/api/auth/login').send({ phone: PHONES.lakshmi, pin: '1234' })).status).toBe(429);
  });

  it('blocks non-JSON and cross-origin state changes (CSRF)', async () => {
    const form = await request(env.app).post('/api/auth/login').type('form').send('phone=9000000002&pin=1234');
    expect(form.status).toBe(415);
    const worker = await env.login(PHONES.lakshmi);
    const cross = await worker.post('/api/attendance/check-in').set('Origin', 'https://evil.example').send({});
    expect(cross.status).toBe(403);
  });

  it('rejects a tampered session cookie', async () => {
    const res = await request(env.app).get('/api/auth/me').set('Cookie', 'fs_session=eyJzdWIiOiJ1c3JfZGVtb19jX2FkbWluIiwiZXhwIjo5OTk5OTk5OTk5OTk5fQ.forged');
    expect(res.status).toBe(401);
  });
});

describe('confidential reporting and anonymous feedback', () => {
  it("never reveals a confidential reporter's identity to administrators", async () => {
    const worker = await env.login(PHONES.lakshmi);
    const created = await worker.post('/api/reports').send({
      category: 'ppe',
      severity: 'high',
      title: 'Harness hooks broken',
      description: 'Two of the four safety harness hooks do not lock properly.',
      location: 'Tool store',
      confidential: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.isMine).toBe(true);
    const id = created.body.id as string;

    const row = env.ctx.db.get<{ reporter_id: string | null }>('SELECT reporter_id FROM safety_reports WHERE id = @id', { id })!;
    expect(row.reporter_id).toBeNull();
    const auditActors = env.ctx.db.all<{ actor_id: string | null }>('SELECT actor_id FROM audit_events WHERE entity_id = @id', { id });
    expect(auditActors.every((a) => a.actor_id === null)).toBe(true);

    const admin = await env.login(PHONES.constructionAdmin);
    const detail = await admin.get(`/api/admin/reports/${id}`);
    expect(detail.body.reporterName).toBeNull();
    expect(detail.body.history[0].actorLabel).toBe('Reporter (confidential)');
    for (const url of [`/api/admin/reports/${id}`, '/api/admin/reports', '/api/admin/audit?entityId=' + id]) {
      expect(JSON.stringify((await admin.get(url)).body)).not.toContain('Lakshmi');
    }
    // The dashboard names workers for attendance events, but never in report activity.
    const dash = (await admin.get('/api/admin/dashboard')).body as DashboardDTO;
    const reportActivity = dash.recentActivity.filter((a) => a.kind.startsWith('report'));
    expect(reportActivity.some((a) => a.text.includes('Harness hooks broken'))).toBe(true);
    expect(JSON.stringify(reportActivity)).not.toContain('Lakshmi');

    const mine = (await worker.get('/api/reports/mine')).body.items as SafetyReportDTO[];
    expect(mine.find((r) => r.id === id)).toMatchObject({ confidential: true, isMine: true });
    // Another worker cannot open it.
    const other = await env.login(PHONES.irfan);
    expect((await other.get(`/api/reports/${id}`)).status).toBe(404);
  });

  it('stores feedback without any user reference and only shows aggregates above the threshold', async () => {
    const worker = await env.login(PHONES.lakshmi);
    expect((await worker.post('/api/feedback').send({ category: 'pay' })).status).toBe(400);
    expect((await worker.post('/api/feedback').send({ category: 'not-a-topic', rating: 3 })).status).toBe(422);
    const ok = await worker.post('/api/feedback').send({ category: 'equipment', rating: 1, comment: 'Grinder guard missing.' });
    expect(ok.status).toBe(201);
    const columns = env.ctx.db.all<{ name: string }>("SELECT name FROM pragma_table_info('feedback')").map((c) => c.name);
    expect(columns).not.toContain('user_id');
    expect(columns).not.toContain('created_at');

    const admin = await env.login(PHONES.constructionAdmin);
    const summary = (await admin.get('/api/admin/feedback/summary')).body.summaries as {
      category: string;
      suppressed: boolean;
      averageRating: number | null;
    }[];
    expect(summary.find((s) => s.category === 'equipment')).toMatchObject({ suppressed: true, averageRating: null });
    expect(summary.find((s) => s.category === 'pay')).toMatchObject({ suppressed: false });
    const list = (await admin.get('/api/admin/feedback?category=equipment')).body;
    expect(list.items[0]).toMatchObject({ comment: 'Grinder guard missing.', status: 'new' });
    expect(Object.keys(list.items[0])).not.toContain('userId');
    expect((await admin.patch(`/api/admin/feedback/${list.items[0].id}`).send({ status: 'reviewed' })).status).toBe(200);
  });
});

describe('administrator corrections, rules and alerts', () => {
  it('requires a reason for shift corrections and records an audit trail', async () => {
    const admin = await env.login(PHONES.constructionAdmin);
    const shift = ((await admin.get('/api/admin/shifts?status=completed&limit=1')).body.items as ShiftDTO[])[0]!;
    const newOut = new Date(Date.parse(shift.checkOutAt!) - 30 * 60000).toISOString();
    expect((await admin.patch(`/api/admin/shifts/${shift.id}`).send({ checkInAt: shift.checkInAt, checkOutAt: newOut, reason: '' })).status).toBe(400);
    expect(
      (await admin.patch(`/api/admin/shifts/${shift.id}`).send({ checkInAt: shift.checkInAt, checkOutAt: shift.checkInAt, reason: 'Wrong time entered' }))
        .status,
    ).toBe(422);
    const ok = await admin
      .patch(`/api/admin/shifts/${shift.id}`)
      .send({ checkInAt: shift.checkInAt, checkOutAt: newOut, reason: 'Left early for clinic visit' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ corrected: true, durationMinutes: shift.durationMinutes! - 30 });
    const audit = (await admin.get(`/api/admin/audit?entityType=shift&entityId=${shift.id}`)).body.items;
    expect(audit[0]).toMatchObject({
      action: 'correction',
      actorName: 'Priya Raman',
      reason: 'Left early for clinic visit',
      before: { checkInAt: shift.checkInAt, checkOutAt: shift.checkOutAt },
      after: { checkInAt: shift.checkInAt, checkOutAt: newOut },
    });
  });

  it('validates and applies configurable pay rules', async () => {
    const admin = await env.login(PHONES.constructionAdmin);
    const settings = (await admin.get('/api/admin/settings')).body;
    expect((await admin.put('/api/admin/settings').send({ ...settings, pay: { ...settings.pay, overtimeMultiplierBp: 500 } })).status).toBe(400);
    const updated = { ...settings, pay: { ...settings.pay, overtimeMultiplierBp: 15000, deductions: [] } };
    expect((await admin.put('/api/admin/settings').send(updated)).status).toBe(200);
    const worker = await env.login(PHONES.lakshmi);
    await worker.post('/api/attendance/check-in').send({});
    env.advance(540);
    await worker.post('/api/attendance/check-out').send({});
    const slip = (await worker.get('/api/payslips/preview?from=2026-10-27&to=2026-10-27')).body as PayslipDTO;
    expect(slip.breakdown.overtimePayMinor).toBe(11250); // 1h x Rs75 x 1.5
    expect(slip.breakdown.deductions).toHaveLength(0);
  });

  it('generates fatigue-risk alerts from recorded shifts without duplicates', async () => {
    const admin = await env.login(PHONES.constructionAdmin);
    const alerts = (await admin.get('/api/admin/alerts')).body.items as { workerName: string; rule: string; id: string }[];
    const irfan = alerts.filter((a) => a.workerName === 'Mohammed Irfan');
    expect(irfan.some((a) => a.rule === 'daily_hours')).toBe(true);
    expect(irfan.some((a) => a.rule === 'repeated_overtime')).toBe(true);
    expect(alerts.some((a) => a.workerName === 'Suresh Naik' && a.rule === 'short_rest')).toBe(true);

    const org = requireOrg(env.ctx.db, 'org_demo_construction');
    const count = () => env.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM fatigue_alerts')!.n;
    const n = count();
    expect(evaluateWorkerFatigue(env.ctx, org, 'usr_demo_c_irfan')).toBe(0);
    expect(count()).toBe(n);

    // Workers see only their own alerts.
    const irfanAgent = await env.login(PHONES.irfan);
    const own = (await irfanAgent.get('/api/alerts/mine')).body.items as { workerName: string }[];
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((a) => a.workerName === 'Mohammed Irfan')).toBe(true);

    expect((await admin.post(`/api/admin/alerts/${irfan[0]!.id}/acknowledge`).send({})).status).toBe(200);
    expect((await admin.post(`/api/admin/alerts/${irfan[0]!.id}/acknowledge`).send({})).status).toBe(404);
  });

  it('keeps self-reported skills separate from employer-verified ones', async () => {
    const worker = await env.login(PHONES.lakshmi);
    const added = await worker.post('/api/skills').send({ kind: 'skill', name: 'Bar bending', description: 'Two years on residential sites' });
    expect(added.status).toBe(201);
    let skills = (await worker.get('/api/skills/mine')).body.items as { id: string; verification: string }[];
    expect(skills.find((s) => s.id === added.body.id)!.verification).toBe('self_reported');
    const admin = await env.login(PHONES.constructionAdmin);
    expect((await admin.patch(`/api/admin/skills/${added.body.id}`).send({ verified: true })).status).toBe(200);
    skills = (await worker.get('/api/skills/mine')).body.items;
    expect(skills.find((s) => s.id === added.body.id)!.verification).toBe('employer_verified');
  });
});

describe('site check-in code', () => {
  it('records site-code check-ins, rejects wrong codes and can be required', async () => {
    const admin = await env.login(PHONES.constructionAdmin);
    const worker = await env.login(PHONES.lakshmi);
    expect((await worker.get('/api/admin/site-code')).status).toBe(403);
    const { code } = (await admin.get('/api/admin/site-code')).body as { code: string };
    expect(code).toMatch(/^\d{6}$/);

    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    const bad = await worker.post('/api/attendance/check-in').send({ siteCode: wrong });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('INVALID_SITE_CODE');
    expect((await worker.post('/api/attendance/check-in').send({ siteCode: '12' })).status).toBe(400);

    const ok = await worker.post('/api/attendance/check-in').send({ siteCode: code });
    expect(ok.status).toBe(201);
    expect(ok.body.checkInMethod).toBe('site_code');
    env.advance(60);
    await worker.post('/api/attendance/check-out').send({});

    // A code expires within two 5-minute windows.
    env.advance(15);
    expect((await worker.post('/api/attendance/check-in').send({ siteCode: code })).body.error.code).toBe('INVALID_SITE_CODE');

    const settings = (await admin.get('/api/admin/settings')).body;
    expect(settings.attendance).toEqual({ requireSiteCode: false });
    expect((await admin.put('/api/admin/settings').send({ ...settings, attendance: { requireSiteCode: true } })).status).toBe(200);
    expect((await worker.get('/api/attendance/status')).body.requireSiteCode).toBe(true);
    const missing = await worker.post('/api/attendance/check-in').send({});
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('SITE_CODE_REQUIRED');
    const fresh = (await admin.get('/api/admin/site-code')).body.code as string;
    expect((await worker.post('/api/attendance/check-in').send({ siteCode: fresh })).status).toBe(201);
  });

  it('includes a daily attendance trend on the dashboard', async () => {
    const admin = await env.login(PHONES.constructionAdmin);
    const d = (await admin.get('/api/admin/dashboard?from=2026-10-20&to=2026-10-27')).body as DashboardDTO;
    expect(d.trend.map((p) => p.date)).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
    ]);
    expect(d.trend.find((p) => p.date === '2026-10-26')!.present).toBeGreaterThan(0);
    expect(d.trend.find((p) => p.date === '2026-10-25')!.present).toBe(0); // Sunday: no seeded shifts
  });
});

describe('both industry configurations run on the same code', () => {
  it('campus support staff can check in/out, see pay and report campus hazards', async () => {
    const worker = await env.login(PHONES.manjula);
    const me = (await worker.get('/api/auth/me')).body;
    expect(me.org.industry).toBe('education');
    expect((await worker.post('/api/attendance/check-in').send({})).status).toBe(201);
    env.advance(480);
    expect((await worker.post('/api/attendance/check-out').send({})).status).toBe(200);
    const slip = (await worker.get('/api/payslips/preview?from=2026-10-27&to=2026-10-27')).body as PayslipDTO;
    expect(slip.breakdown).toMatchObject({ regularMinutes: 480, overtimeMinutes: 0, basePayMinor: 56000 });

    const construction = await worker.post('/api/reports').send({
      category: 'scaffolding',
      severity: 'low',
      title: 'Wrong category',
      description: 'Construction-only category should be rejected here.',
      location: 'Block C',
    });
    expect(construction.status).toBe(422);
    const campus = await worker.post('/api/reports').send({
      category: 'slip',
      severity: 'medium',
      title: 'Leaking cooler',
      description: 'Water pooling in the corridor outside the library.',
      location: 'Library corridor',
    });
    expect(campus.status).toBe(201);
    const admin = await env.login(PHONES.campusAdmin);
    const reports = (await admin.get('/api/admin/reports?category=slip')).body.items as SafetyReportDTO[];
    expect(reports.some((r) => r.id === campus.body.id)).toBe(true);
  });

  it('lists demo accounts only in demo mode and exposes a health check', async () => {
    const res = await request(env.app).get('/api/demo/accounts');
    expect(res.body.accounts.map((a: { industry: string }) => a.industry)).toEqual(expect.arrayContaining(['construction', 'education']));
    expect(JSON.stringify(res.body)).not.toContain('pin_hash');
    expect((await request(env.app).get('/healthz')).body).toEqual({ status: 'ok' });
    expect((await request(env.app).get('/api/nope')).status).toBe(404);
  });
});
