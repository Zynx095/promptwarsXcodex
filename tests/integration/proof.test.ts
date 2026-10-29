import { describe, expect, it } from 'vitest';
import { setup, PHONES } from './helpers';

describe('FairShift Proof Integration — Work Receipts, Versioning & Verification', () => {
  it('generates verifiable receipt on check-out and versioned receipt on shift correction', async () => {
    const env = await setup();
    const workerClient = await env.login(PHONES.lakshmi);

    // 1. Worker checks in and checks out
    const checkInRes = await workerClient.post('/api/attendance/check-in').send({});
    expect(checkInRes.status).toBe(201);
    const shiftId = checkInRes.body.id;

    // Advance clock 8 hours and 30 minutes (510 minutes: 480 min regular + 30 min overtime)
    env.advance(510);

    const checkOutRes = await workerClient.post('/api/attendance/check-out').send({});
    expect(checkOutRes.status).toBe(200);

    // 2. Fetch receipts for shift
    const receiptRes = await workerClient.get(`/api/receipts/shift/${shiftId}`);
    expect(receiptRes.status).toBe(200);
    expect(receiptRes.body.current).toBeDefined();
    expect(receiptRes.body.current.version).toBe(1);
    expect(receiptRes.body.current.status).toBe('estimated');
    expect(receiptRes.body.current.canonicalDigest).toHaveLength(64);
    expect(receiptRes.body.current.data.earnings.durationMinutes).toBe(510);
    expect(receiptRes.body.current.data.earnings.overtimeMinutes).toBe(30);
    expect(receiptRes.body.history).toHaveLength(1);

    // 3. Verify cryptographic integrity
    const receiptIdV1 = receiptRes.body.current.id;
    const verifyV1Res = await workerClient.get(`/api/receipts/${receiptIdV1}/verify`);
    expect(verifyV1Res.status).toBe(200);
    expect(verifyV1Res.body.verified).toBe(true);

    // 4. Admin corrects shift (adds another 30 mins to finish pour)
    // Advance clock 60 minutes so the corrected check-out time is not in the future
    env.advance(60);

    const adminClient = await env.login(PHONES.constructionAdmin);
    const shiftRecord = checkOutRes.body;
    const initialCheckOutDate = new Date(shiftRecord.checkOutAt);
    const newCheckOutDate = new Date(initialCheckOutDate.getTime() + 30 * 60000);

    const correctionRes = await adminClient.patch(`/api/admin/shifts/${shiftId}`).send({
      checkInAt: shiftRecord.checkInAt,
      checkOutAt: newCheckOutDate.toISOString(),
      reason: 'Confirmed with supervisor: overtime extended by 30 mins.',
    });
    expect(correctionRes.status).toBe(200);

    // 5. Worker checks receipts again: now has version 2 and historical version 1
    const receiptAfterCorrection = await workerClient.get(`/api/receipts/shift/${shiftId}`);
    expect(receiptAfterCorrection.status).toBe(200);
    expect(receiptAfterCorrection.body.current.version).toBe(2);
    expect(receiptAfterCorrection.body.current.previousVersionId).toBe(receiptIdV1);
    expect(receiptAfterCorrection.body.history).toHaveLength(2);

    const v2 = receiptAfterCorrection.body.current;
    expect(v2.data.earnings.durationMinutes).toBe(540); // 9 hours
    expect(v2.data.earnings.overtimeMinutes).toBe(60); // 1 hour overtime
    expect(v2.data.correction).toBeDefined();
    expect(v2.data.correction.previousVersion).toBe(1);
    expect(v2.data.correction.reason).toContain('overtime extended');
    expect(v2.data.correction.changes.grossPayMinor.deltaMinor).toBeGreaterThan(0);

    // Both version 1 and version 2 must verify cryptographically
    const verifyV2Res = await workerClient.get(`/api/receipts/${v2.id}/verify`);
    expect(verifyV2Res.status).toBe(200);
    expect(verifyV2Res.body.verified).toBe(true);

    const verifyV1Again = await workerClient.get(`/api/receipts/${receiptIdV1}/verify`);
    expect(verifyV1Again.status).toBe(200);
    expect(verifyV1Again.body.verified).toBe(true);
  });

  it('detects tampering and fails verification if database contents are altered', async () => {
    const env = await setup();
    const workerClient = await env.login(PHONES.lakshmi);

    await workerClient.post('/api/attendance/check-in').send({});
    env.advance(480);
    const checkOutRes = await workerClient.post('/api/attendance/check-out').send({});
    const shiftId = checkOutRes.body.id;

    const receiptRes = await workerClient.get(`/api/receipts/shift/${shiftId}`);
    const receipt = receiptRes.body.current;

    // Tamper with receipt_json directly in SQLite
    const tamperedData = {
      ...receipt.data,
      earnings: { ...receipt.data.earnings, grossPayMinor: 9999999 },
    };
    env.ctx.db.run(`UPDATE work_receipts SET receipt_json = @json WHERE id = @id`, {
      id: receipt.id,
      json: JSON.stringify(tamperedData),
    });

    // Verification must now fail
    const verifyRes = await workerClient.get(`/api/receipts/${receipt.id}/verify`);
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.verified).toBe(false);
  });

  it('enforces worker privacy and tenant isolation on receipts', async () => {
    const env = await setup();
    const lakshmiClient = await env.login(PHONES.lakshmi);
    const irfanClient = await env.login(PHONES.irfan);
    const campusAdmin = await env.login(PHONES.campusAdmin);

    // Lakshmi completes a shift
    await lakshmiClient.post('/api/attendance/check-in').send({});
    env.advance(480);
    const checkOutRes = await lakshmiClient.post('/api/attendance/check-out').send({});
    const shiftId = checkOutRes.body.id;

    const receiptRes = await lakshmiClient.get(`/api/receipts/shift/${shiftId}`);
    const receiptId = receiptRes.body.current.id;

    // Irfan cannot access Lakshmi's receipt
    const irfanShiftRes = await irfanClient.get(`/api/receipts/shift/${shiftId}`);
    expect(irfanShiftRes.status).toBe(404);

    const irfanReceiptRes = await irfanClient.get(`/api/receipts/${receiptId}`);
    expect(irfanReceiptRes.status).toBe(404);

    // Campus admin (different organization) cannot access construction shift receipt
    const campusShiftRes = await campusAdmin.get(`/api/admin/receipts/shift/${shiftId}`);
    expect(campusShiftRes.body.current).toBeNull();
  });

  it('finalizes receipt status when employer issues payslip covering the shift period', async () => {
    const env = await setup();
    const lakshmiClient = await env.login(PHONES.lakshmi);
    const adminClient = await env.login(PHONES.constructionAdmin);

    // Lakshmi completes a shift on Tuesday 27 Oct 2026
    await lakshmiClient.post('/api/attendance/check-in').send({});
    env.advance(480);
    const checkOutRes = await lakshmiClient.post('/api/attendance/check-out').send({});
    const shiftId = checkOutRes.body.id;

    const receiptBeforePayslip = (await lakshmiClient.get(`/api/receipts/shift/${shiftId}`)).body.current;
    expect(receiptBeforePayslip.status).toBe('estimated');

    // Admin issues payslip for the week (Monday 26 Oct to Sunday 01 Nov 2026)
    const issueRes = await adminClient.post('/api/admin/payslips').send({
      workerId: 'usr_demo_c_lakshmi',
      from: '2026-10-26',
      to: '2026-11-01',
    });
    expect(issueRes.status).toBe(201);

    // Receipt is now finalized
    const receiptAfterPayslip = (await lakshmiClient.get(`/api/receipts/shift/${shiftId}`)).body.current;
    expect(receiptAfterPayslip.status).toBe('finalized');
  });
});
