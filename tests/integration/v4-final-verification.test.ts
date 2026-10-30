import { beforeEach, describe, expect, it } from 'vitest';
import { PHONES, setup, type TestEnv } from './helpers';
import type { NotificationsResponse, SafetyReportDTO, ShiftDTO, WorkerDTO } from '../../src/shared/types';

let env: TestEnv;
beforeEach(async () => {
  env = await setup();
});

describe('FairShift V4.0 — Release Verification Suite', () => {
  describe('1. Confidential Safety Notifications & Privacy Boundaries', () => {
    it('guarantees confidential safety reports never leak reporter identity via notifications, API or audit', async () => {
      const admin = await env.login(PHONES.constructionAdmin);
      const worker = await env.login(PHONES.irfan);

      // 1. Irfan files a confidential high-severity report
      const repRes = await worker.post('/api/reports').send({
        category: 'fall',
        severity: 'high',
        title: 'Deep excavation trench without shoring',
        description: 'Soil is crumbling near the excavator path, urgent shoring required.',
        location: 'Sector 3 Trench',
        confidential: true,
      });
      expect(repRes.status).toBe(201);
      const report = repRes.body as SafetyReportDTO;
      expect(report.confidential).toBe(true);

      // Verify that the worker does NOT receive any notification linking them to the confidential report
      const workerNotifs = await worker.get('/api/notifications/mine');
      const confidentialWorkerNotif = (workerNotifs.body as NotificationsResponse).items.find((n) => n.body.includes('excavation trench'));
      expect(confidentialWorkerNotif).toBeUndefined();

      // 2. Administrator receives a high-severity alert notification
      const adminNotifs = await admin.get('/api/notifications/mine');
      const adminAlert = (adminNotifs.body as NotificationsResponse).items.find((n) => n.type === 'safety_alert' && n.title.includes('HIGH'));
      expect(adminAlert).toBeDefined();
      // Crucial: The notification body must NOT mention Irfan or any reporter identifier
      expect(adminAlert?.body).toContain('Deep excavation trench without shoring');
      expect(adminAlert?.body).not.toContain('Irfan');
      expect(adminAlert?.body).not.toContain(PHONES.irfan);

      // 3. Admin opens the report details via API
      const adminReportRes = await admin.get(`/api/admin/reports/${report.id}`);
      expect(adminReportRes.status).toBe(200);
      const adminReport = adminReportRes.body as SafetyReportDTO;
      // Administrator cannot see reporterName
      expect(adminReport.reporterName).toBeNull();
      // Report history explicitly labels the submission as 'Reporter (confidential)'
      expect(adminReport.history?.[0]?.actorLabel).toBe('Reporter (confidential)');

      // 4. Admin updates report status -> Verify no notification is sent to confidential reporter
      const transRes = await admin.post(`/api/admin/reports/${report.id}/transition`).send({
        to: 'acknowledged',
        note: 'Shoring contractor notified and en route',
      });
      expect(transRes.status).toBe(200);

      // Check worker notifications again: still no notification created in DB
      const workerNotifsAfter = await worker.get('/api/notifications/mine');
      const leakedNotif = (workerNotifsAfter.body as NotificationsResponse).items.find((n) => n.body.includes('Shoring contractor'));
      expect(leakedNotif).toBeUndefined();

      // 5. Cross-worker and cross-organization isolation: Another worker cannot view the confidential report
      const otherWorker = await env.login(PHONES.lakshmi);
      const otherWorkerReportRes = await otherWorker.get(`/api/reports/${report.id}`);
      expect(otherWorkerReportRes.status).toBe(404);

      // Other worker's notifications are isolated
      const otherWorkerNotifs = await otherWorker.get('/api/notifications/mine');
      expect(otherWorkerNotifs.status).toBe(200);
      const otherHasAlert = (otherWorkerNotifs.body as NotificationsResponse).items.some((n) => n.body.includes('excavation trench'));
      expect(otherHasAlert).toBe(false);
    });

    it('enforces strict tenant and user isolation on notification operations', async () => {
      const worker = await env.login(PHONES.irfan);
      const campusWorker = await env.login(PHONES.manjula);

      // Get worker's notifications
      const res = await worker.get('/api/notifications/mine');
      expect(res.status).toBe(200);
      const notifs = res.body as NotificationsResponse;
      expect(notifs.items.length).toBeGreaterThan(0);
      const notifId = notifs.items[0]!.id;

      // Campus worker cannot mark construction worker's notification as read
      const markOther = await campusWorker.post(`/api/notifications/${notifId}/read`).send({});
      expect(markOther.status).toBe(200);
      expect(markOther.body.ok).toBe(false); // No row affected due to orgId/userId scoping
    });
  });

  describe('2. Workforce Provisioning & Access Control Integrity', () => {
    it('verifies secure credential initialization and rejects duplicate phones', async () => {
      const admin = await env.login(PHONES.constructionAdmin);

      // 1. Provision valid worker
      const provRes = await admin.post('/api/admin/workers').send({
        name: 'Asha Begum',
        phone: '9000000088',
        jobTitle: 'Safety Coordinator',
        team: 'Health & Safety',
        hourlyRateMinor: 9500,
        pin: '5678',
      });
      expect(provRes.status).toBe(201);
      const worker = provRes.body as WorkerDTO;
      expect(worker.phone).toBe('9000000088');
      expect(worker.active).toBe(true);

      // 2. Reject duplicate phone
      const dupRes = await admin.post('/api/admin/workers').send({
        name: 'Asha Begum Duplicate',
        phone: '9000000088',
        jobTitle: 'Coordinator',
        team: 'Safety',
        hourlyRateMinor: 9500,
        pin: '1234',
      });
      expect(dupRes.status).toBe(409);
      expect(dupRes.body.error.code).toBe('PHONE_ALREADY_EXISTS');

      // 3. New worker can log in with their custom PIN
      const customAgent = (await import('supertest')).default.agent(env.app);
      const loginRes = await customAgent.post('/api/auth/login').send({ phone: '9000000088', pin: '5678' });
      expect(loginRes.status).toBe(200);
      const me = await customAgent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.user.name).toBe('Asha Begum');
    });

    it('rejects attempts at unauthorized role escalation', async () => {
      const worker = await env.login(PHONES.irfan);

      // 1. Worker attempts to provision a user -> rejected with 403 Forbidden
      const provAttempt = await worker.post('/api/admin/workers').send({
        name: 'Escalated Admin',
        phone: '9000000077',
        jobTitle: 'Manager',
        team: 'Exec',
        hourlyRateMinor: 10000,
        pin: '1234',
      });
      expect(provAttempt.status).toBe(403);

      // 2. Admin attempting to set role to 'admin' via workerCreateSchema -> schema ignores/strips role, assigns 'worker'
      const admin = await env.login(PHONES.constructionAdmin);
      const adminAttempt = await admin.post('/api/admin/workers').send({
        name: 'Worker With Sneaky Role',
        phone: '9000000077',
        jobTitle: 'Specialist',
        team: 'Team A',
        hourlyRateMinor: 7500,
        pin: '1234',
        role: 'admin',
      });
      expect(adminAttempt.status).toBe(201);
      // Verify in DB that role was assigned strictly as 'worker'
      const sneakyUser = await env.login('9000000077');
      const me = await sneakyUser.get('/api/auth/me');
      expect(me.body.user.role).toBe('worker');
    });

    it('verifies worker deactivation immediately revokes active sessions across all endpoints', async () => {
      const admin = await env.login(PHONES.constructionAdmin);
      const worker = await env.login(PHONES.lakshmi);

      // Verify active worker session works
      const initialMe = await worker.get('/api/auth/me');
      expect(initialMe.status).toBe(200);
      const workerId = initialMe.body.user.id;

      // Admin deactivates worker
      const deact = await admin.patch(`/api/admin/workers/${workerId}`).send({ active: false });
      expect(deact.status).toBe(200);

      // Test access to multiple sensitive endpoints using previously established session:
      // All must immediately return 401 UNAUTHORIZED due to per-request session user reload
      const endpoints = [
        worker.get('/api/auth/me'),
        worker.get('/api/attendance/status'),
        worker.post('/api/attendance/check-in').send({}),
        worker.get('/api/payslips'),
        worker.get('/api/reports/mine'),
        worker.get('/api/notifications/mine'),
      ];

      const results = await Promise.all(endpoints);
      for (const res of results) {
        expect(res.status).toBe(401);
      }
    });
  });

  describe('3. Payroll CSV Export Security & Formula Injection Defense', () => {
    it('defends against CSV formula injection and enforces tenant isolation and audit logging', async () => {
      const admin = await env.login(PHONES.constructionAdmin);

      // 1. Provision a worker whose name starts with formula injection characters: =cmd|' /C calc'!A0
      const evilWorkerRes = await admin.post('/api/admin/workers').send({
        name: "=cmd|' /C calc'!A0",
        phone: '9000000066',
        jobTitle: 'Tester',
        team: 'QA',
        hourlyRateMinor: 6000,
        pin: '1234',
      });
      expect(evilWorkerRes.status).toBe(201);
      const evilWorker = evilWorkerRes.body as WorkerDTO;

      // Check-in and check-out the worker to create a shift
      const evilSession = await env.login('9000000066');
      await evilSession.post('/api/attendance/check-in').send({});
      env.advance(480);
      await evilSession.post('/api/attendance/check-out').send({});

      // Issue payslip for the evil worker
      const issueRes = await admin.post('/api/admin/payslips').send({
        workerId: evilWorker.id,
        from: '2026-03-01',
        to: '2026-03-07',
      });
      expect(issueRes.status).toBe(201);

      // 2. Export payroll CSV
      const csvRes = await admin.get('/api/admin/payslips/export.csv');
      expect(csvRes.status).toBe(200);
      const csvText = csvRes.text;

      // Verify formula injection defense:
      // The cell must be prefixed with a single quote (') so spreadsheet applications do NOT execute it
      expect(csvText).toContain("\"'=cmd|' /C calc'!A0\"");
      // Must NOT contain unescaped raw formula
      expect(csvText).not.toContain('"=cmd|');

      // 3. Verify server-side authorization: Worker cannot export payroll CSV
      const worker = await env.login(PHONES.irfan);
      const workerExport = await worker.get('/api/admin/payslips/export.csv');
      expect(workerExport.status).toBe(403);

      // 4. Verify tenant isolation: Campus admin cannot export construction worker records
      const campusAdmin = await env.login(PHONES.campusAdmin);
      const campusCsv = await campusAdmin.get('/api/admin/payslips/export.csv');
      expect(campusCsv.status).toBe(200);
      expect(campusCsv.text).not.toContain('9000000066');
      expect(campusCsv.text).not.toContain('calc');

      // 5. Verify audit event was logged
      const auditRes = await admin.get('/api/admin/audit');
      expect(auditRes.status).toBe(200);
      const exportAudit = (auditRes.body.items as Array<{ action: string; entityType: string }>).find((a) => a.action === 'export_csv');
      expect(exportAudit).toBeDefined();
      expect(exportAudit?.entityType).toBe('payroll');
    });
  });

  describe('4. Multi-Site Attendance Integrity & Code Validation', () => {
    it('validates site check-in codes server-side, rejects expired and cross-organization codes', async () => {
      const admin = await env.login(PHONES.constructionAdmin);
      const worker = await env.login(PHONES.irfan);

      // 1. Fetch current valid site code for construction org
      const codeRes = await admin.get('/api/admin/site-code');
      expect(codeRes.status).toBe(200);
      const validCode = codeRes.body.code as string;
      expect(validCode).toMatch(/^\d{6}$/);

      // 2. Check-in with valid site code succeeds
      const checkInRes = await worker.post('/api/attendance/check-in').send({ siteCode: validCode });
      expect(checkInRes.status).toBe(201);
      const shift = checkInRes.body as ShiftDTO;
      expect(shift.checkInMethod).toBe('site_code');

      // Check out
      env.advance(60);
      await worker.post('/api/attendance/check-out').send({});

      // 3. Reject wrong site code (DomainError maps to 422)
      const wrongCodeRes = await worker.post('/api/attendance/check-in').send({ siteCode: '000000' });
      expect(wrongCodeRes.status).toBe(422);
      expect(wrongCodeRes.body.error.code).toBe('INVALID_SITE_CODE');

      // 4. Cross-organization misuse: fetch campus site code and try using it on construction worker
      const campusAdmin = await env.login(PHONES.campusAdmin);
      const campusCodeRes = await campusAdmin.get('/api/admin/site-code');
      const campusCode = campusCodeRes.body.code as string;

      const crossOrgRes = await worker.post('/api/attendance/check-in').send({ siteCode: campusCode });
      expect(crossOrgRes.status).toBe(422);
      expect(crossOrgRes.body.error.code).toBe('INVALID_SITE_CODE');

      // 5. Code expiration: advance time by 15 minutes (3 windows = expired)
      env.advance(15);
      const expiredRes = await worker.post('/api/attendance/check-in').send({ siteCode: validCode });
      expect(expiredRes.status).toBe(422);
      expect(expiredRes.body.error.code).toBe('INVALID_SITE_CODE');
    });

    it('enforces mandatory site code check-in when organization setting requires it', async () => {
      const admin = await env.login(PHONES.constructionAdmin);
      const worker = await env.login(PHONES.irfan);

      // Enable requireSiteCode setting
      const settingsRes = await admin.get('/api/admin/settings');
      const currentSettings = settingsRes.body;
      await admin.put('/api/admin/settings').send({
        ...currentSettings,
        attendance: { requireSiteCode: true },
      });

      // Attempt check-in without site code -> rejected with SITE_CODE_REQUIRED (DomainError maps to 422)
      const noCodeRes = await worker.post('/api/attendance/check-in').send({});
      expect(noCodeRes.status).toBe(422);
      expect(noCodeRes.body.error.code).toBe('SITE_CODE_REQUIRED');

      // Check-in with valid site code succeeds
      const codeRes = await admin.get('/api/admin/site-code');
      const validCode = codeRes.body.code as string;

      const withCodeRes = await worker.post('/api/attendance/check-in').send({ siteCode: validCode });
      expect(withCodeRes.status).toBe(201);

      // Clean up
      env.advance(60);
      await worker.post('/api/attendance/check-out').send({});
    });
  });
});
