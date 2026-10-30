import { beforeEach, describe, expect, it } from 'vitest';
import { PHONES, setup, type TestEnv } from './helpers';
import type { NotificationsResponse, SiteDTO, WorkerDTO, ShiftDTO, SafetyReportDTO } from '../../src/shared/types';

let env: TestEnv;
beforeEach(async () => {
  env = await setup();
});

describe('FairShift V4.0 — Release Candidate Workflows', () => {
  describe('Workforce Provisioning & Activation Controls', () => {
    it('allows administrators to provision new workers and rejects duplicate phone numbers', async () => {
      const admin = await env.login(PHONES.constructionAdmin);

      // 1. Provision a new worker
      const res = await admin.post('/api/admin/workers').send({
        name: 'Sunil Kumar',
        phone: '9000000099',
        jobTitle: 'Scaffolding Specialist',
        team: 'Crew C',
        hourlyRateMinor: 8500,
        pin: '1234',
      });

      expect(res.status).toBe(201);
      const worker = res.body as WorkerDTO;
      expect(worker.name).toBe('Sunil Kumar');
      expect(worker.phone).toBe('9000000099');
      expect(worker.hourlyRateMinor).toBe(8500);
      expect(worker.active).toBe(true);

      // 2. Reject duplicate phone
      const dup = await admin.post('/api/admin/workers').send({
        name: 'Sunil Duplicate',
        phone: '9000000099',
        jobTitle: 'Helper',
        hourlyRateMinor: 5000,
        pin: '1234',
      });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('PHONE_ALREADY_EXISTS');

      // 3. Worker can log in with provisioned credentials
      const newWorkerSession = await env.login('9000000099');
      const me = await newWorkerSession.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.user.name).toBe('Sunil Kumar');
    });

    it('enforces worker deactivation and prevents deactivated accounts from checking in', async () => {
      const admin = await env.login(PHONES.constructionAdmin);
      const worker = await env.login(PHONES.lakshmi);

      // Get worker ID for Lakshmi
      const me = await worker.get('/api/auth/me');
      const workerId = me.body.user.id;

      // 1. Admin deactivates worker
      const patchRes = await admin.patch(`/api/admin/workers/${workerId}`).send({ active: false });
      expect(patchRes.status).toBe(200);

      // 2. Deactivated worker attempts check-in -> session middleware rejects with 401 UNAUTHORIZED
      const checkInRes = await worker.post('/api/attendance/check-in').send({});
      expect(checkInRes.status).toBe(401);

      // 3. Reactivation does not revive the old session; after signing in again check-in succeeds
      await admin.patch(`/api/admin/workers/${workerId}`).send({ active: true });
      expect((await worker.post('/api/attendance/check-in').send({})).status).toBe(401);
      const workerAgain = await env.login(PHONES.lakshmi);
      const checkInAfter = await workerAgain.post('/api/attendance/check-in').send({});
      expect(checkInAfter.status).toBe(201);
    });
  });

  describe('Site Management & Multi-Site Configuration', () => {
    it('lists seeded sites and allows administrators to create and toggle sites', async () => {
      const admin = await env.login(PHONES.constructionAdmin);

      // 1. List sites (seeded sites exist)
      const listRes = await admin.get('/api/admin/sites');
      expect(listRes.status).toBe(200);
      const sites = listRes.body.items as SiteDTO[];
      expect(sites.length).toBeGreaterThanOrEqual(3);
      expect(sites.some((s) => s.code === 'P42CY')).toBe(true);

      // 2. Create a new site
      const createRes = await admin.post('/api/admin/sites').send({
        name: 'North Tunnel Portal',
        code: 'NTP05',
        address: 'Hebbal Flyover Junction, Bengaluru',
      });
      expect(createRes.status).toBe(201);
      const created = createRes.body as SiteDTO;
      expect(created.name).toBe('North Tunnel Portal');
      expect(created.code).toBe('NTP05');
      expect(created.active).toBe(true);

      // 3. Prevent duplicate site codes in the same organization
      const dupRes = await admin.post('/api/admin/sites').send({
        name: 'Another Tunnel Portal',
        code: 'NTP05',
      });
      expect(dupRes.status).toBe(409);
      expect(dupRes.body.error.code).toBe('DUPLICATE_SITE_CODE');

      // 4. Toggle site status
      const toggleRes = await admin.patch(`/api/admin/sites/${created.id}/status`).send({ active: false });
      expect(toggleRes.status).toBe(200);
      expect(toggleRes.body.active).toBe(false);
    });
  });

  describe('In-App Notification Center & Cross-Module Triggers', () => {
    it('delivers notifications for shift corrections and supports read state management', async () => {
      const admin = await env.login(PHONES.constructionAdmin);
      const worker = await env.login(PHONES.irfan);

      // 1. Initial seeded notifications exist
      const initial = await worker.get('/api/notifications/mine');
      expect(initial.status).toBe(200);
      const notifs = initial.body as NotificationsResponse;
      expect(notifs.unreadCount).toBeGreaterThanOrEqual(1);

      // 2. Check in and check out Irfan to create a shift
      const inRes = await worker.post('/api/attendance/check-in').send({});
      expect(inRes.status).toBe(201);
      env.advance(480);
      const outRes = await worker.post('/api/attendance/check-out').send({});
      expect(outRes.status).toBe(200);
      const shift = outRes.body as ShiftDTO;

      // 3. Admin corrects shift -> triggers shift_correction notification
      env.advance(60);
      const correctRes = await admin.patch(`/api/admin/shifts/${shift.id}`).send({
        checkInAt: shift.checkInAt,
        checkOutAt: new Date(Date.parse(shift.checkOutAt!) + 30 * 60000).toISOString(),
        reason: 'Overtime extension confirmed by supervisor',
      });
      expect(correctRes.status).toBe(200);

      // Verify worker received correction notification
      const afterCorrection = await worker.get('/api/notifications/mine');
      const correctionNotif = (afterCorrection.body as NotificationsResponse).items.find((n) => n.type === 'shift_correction');
      expect(correctionNotif).toBeDefined();
      expect(correctionNotif?.body).toContain('Overtime extension confirmed by supervisor');

      // 4. Mark single notification as read
      const readRes = await worker.post(`/api/notifications/${correctionNotif!.id}/read`).send({});
      expect(readRes.status).toBe(200);
      expect(readRes.body.ok).toBe(true);

      // 5. Mark all notifications as read
      const readAllRes = await worker.post('/api/notifications/read-all').send({});
      expect(readAllRes.status).toBe(200);
      const finalNotifs = await worker.get('/api/notifications/mine');
      expect((finalNotifs.body as NotificationsResponse).unreadCount).toBe(0);
    });

    it('delivers safety alerts to administrators and resolution updates to workers', async () => {
      const admin = await env.login(PHONES.constructionAdmin);
      const worker = await env.login(PHONES.irfan);

      // 1. Worker submits identified safety report
      const repRes = await worker.post('/api/reports').send({
        category: 'fall',
        severity: 'critical',
        title: 'Missing guardrail on 4th floor perimeter',
        description: 'Workers are moving materials along an unprotected slab edge.',
        location: 'Tower A 4th Floor',
        confidential: false,
      });
      expect(repRes.status).toBe(201);
      const report = repRes.body as SafetyReportDTO;

      // Verify admin received safety_alert notification
      const adminNotifs = await admin.get('/api/notifications/mine');
      const alertNotif = (adminNotifs.body as NotificationsResponse).items.find((n) => n.type === 'safety_alert');
      expect(alertNotif).toBeDefined();
      expect(alertNotif?.title).toContain('CRITICAL');

      // 2. Admin acknowledges safety report -> worker receives safety_update notification
      const transRes = await admin.post(`/api/admin/reports/${report.id}/transition`).send({
        to: 'acknowledged',
        note: 'Safety team dispatched to clear pallets',
      });
      expect(transRes.status).toBe(200);

      const workerNotifsAfterReport = await worker.get('/api/notifications/mine');
      const safetyNotif = (workerNotifsAfterReport.body as NotificationsResponse).items.find((n) => n.type === 'safety_update');
      expect(safetyNotif).toBeDefined();
      expect(safetyNotif?.body).toContain('Safety team dispatched to clear pallets');
    });
  });

  describe('Administrative Payroll CSV Export', () => {
    it('exports tenant-isolated CSV containing payroll details and correct column headers', async () => {
      const admin = await env.login(PHONES.constructionAdmin);

      const csvRes = await admin.get('/api/admin/payslips/export.csv');
      expect(csvRes.status).toBe(200);
      expect(csvRes.headers['content-type']).toContain('text/csv');
      expect(csvRes.headers['content-disposition']).toContain('.csv');

      const text = csvRes.text;
      const lines = text.trim().split('\r\n');
      expect(lines.length).toBeGreaterThan(1); // Header + at least one payslip
      expect(lines[0]).toBe(
        'Payslip ID,Worker ID,Worker Name,Phone,Period Start,Period End,Currency,Regular Hours,Overtime Hours,Base Pay,Overtime Pay,Gross Pay,Deductions,Net Pay,Issued At',
      );

      // Check tenant isolation: Campus admin cannot access construction payslips
      const campusAdmin = await env.login(PHONES.campusAdmin);
      const campusCsv = await campusAdmin.get('/api/admin/payslips/export.csv');
      expect(campusCsv.status).toBe(200);
      // Construction worker Lakshmi should NOT be in campus CSV
      expect(campusCsv.text).not.toContain(PHONES.lakshmi);
    });
  });
});
