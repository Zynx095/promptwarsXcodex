import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { getShift, listWorkerShifts } from '../repositories/shifts';
import { getWorker } from '../repositories/users';
import { buildCorrectionDiff, calculateShiftEarnings, computeReceiptDigest, verifyReceiptDigest } from '../../domain/proof';
import type { CanonicalReceiptData, WorkReceiptDTO } from '../../shared/types';
import { localDate, localRangeToUtc, minutesBetween } from '../../shared/time';
import { getLatestReceiptForShift, getReceiptById, getReceiptHistoryForShift, insertReceipt, toWorkReceiptDTO } from '../repositories/receipts';
import { notFound } from '../http';

/**
 * Checks whether an issued payslip already covers the given shift timestamp.
 */
function isShiftInFinalizedPeriod(ctx: AppContext, orgId: string, workerId: string, checkInAt: string): boolean {
  const payslip = ctx.db.get<{ id: string }>(
    `SELECT id FROM payslips
     WHERE org_id = @orgId AND worker_id = @workerId
       AND period_start <= @checkInAt AND period_end >= @checkInAt
     LIMIT 1`,
    { orgId, workerId, checkInAt },
  );
  return Boolean(payslip);
}

/**
 * Generates initial Work Receipt (v1) for a completed shift.
 */
export function generateReceiptForShift(ctx: AppContext, org: OrgRow, shiftId: string): WorkReceiptDTO {
  const shift = getShift(ctx.db, org.id, shiftId);
  if (!shift || !shift.checkOutAt) {
    throw notFound('Completed shift');
  }

  const worker = getWorker(ctx.db, org.id, shift.workerId);
  if (!worker) {
    throw notFound('Worker');
  }

  const shiftDay = localDate(shift.checkInAt, org.timezone);
  const { start: dayStartUtc, end: dayEndUtc } = localRangeToUtc(shiftDay, shiftDay, org.timezone);

  // List all completed shifts for this worker on this day that started before this shift
  const dayShifts = listWorkerShifts(ctx.db, shift.workerId, dayStartUtc, dayEndUtc);
  const priorCompleted = dayShifts.filter((s) => s.id !== shiftId && s.checkOutAt && s.checkInAt < shift.checkInAt);
  const priorMinutes = priorCompleted.reduce((acc, s) => acc + (s.checkOutAt ? minutesBetween(s.checkInAt, s.checkOutAt) : 0), 0);

  const earnings = calculateShiftEarnings(
    { checkInAt: shift.checkInAt, checkOutAt: shift.checkOutAt },
    priorMinutes,
    org.settings.pay.scheduledDailyMinutes,
    worker.hourlyRateMinor,
    org.settings.pay.overtimeMultiplierBp,
  );

  const isFinalized = isShiftInFinalizedPeriod(ctx, org.id, worker.id, shift.checkInAt);
  const now = ctx.now().toISOString();

  const canonicalData: CanonicalReceiptData = {
    shiftId: shift.id,
    workerId: worker.id,
    orgId: org.id,
    version: 1,
    status: isFinalized ? 'finalized' : 'estimated',
    checkInAt: shift.checkInAt,
    checkOutAt: shift.checkOutAt,
    durationMinutes: earnings.durationMinutes,
    rules: {
      scheduledDailyMinutes: org.settings.pay.scheduledDailyMinutes,
      hourlyRateMinor: worker.hourlyRateMinor,
      overtimeMultiplierBp: org.settings.pay.overtimeMultiplierBp,
      currency: org.currency,
    },
    earnings,
    issuedAt: now,
  };

  const digest = computeReceiptDigest(ctx.config.sessionSecret, canonicalData);
  const id = `rcpt_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  insertReceipt(ctx.db, {
    id,
    orgId: org.id,
    shiftId: shift.id,
    workerId: worker.id,
    version: 1,
    canonicalDigest: digest,
    status: canonicalData.status,
    data: canonicalData,
    createdAt: now,
    createdBy: worker.id,
  });

  const row = getReceiptById(ctx.db, org.id, id)!;
  return toWorkReceiptDTO(row, true);
}

/**
 * Generates an updated, versioned Work Receipt (vN) when a shift's timestamps are corrected by an administrator.
 */
export function generateCorrectedReceiptForShift(
  ctx: AppContext,
  org: OrgRow,
  shiftId: string,
  actor: { id: string; name: string },
  reason: string,
): WorkReceiptDTO {
  const shift = getShift(ctx.db, org.id, shiftId);
  if (!shift || !shift.checkOutAt) {
    throw notFound('Completed shift');
  }

  const worker = getWorker(ctx.db, org.id, shift.workerId);
  if (!worker) {
    throw notFound('Worker');
  }

  const prevRow = getLatestReceiptForShift(ctx.db, org.id, shiftId);
  const prevVersion = prevRow ? prevRow.version : 0;
  const nextVersion = prevVersion + 1;

  const shiftDay = localDate(shift.checkInAt, org.timezone);
  const { start: dayStartUtc, end: dayEndUtc } = localRangeToUtc(shiftDay, shiftDay, org.timezone);

  const dayShifts = listWorkerShifts(ctx.db, shift.workerId, dayStartUtc, dayEndUtc);
  const priorCompleted = dayShifts.filter((s) => s.id !== shiftId && s.checkOutAt && s.checkInAt < shift.checkInAt);
  const priorMinutes = priorCompleted.reduce((acc, s) => acc + (s.checkOutAt ? minutesBetween(s.checkInAt, s.checkOutAt) : 0), 0);

  const earnings = calculateShiftEarnings(
    { checkInAt: shift.checkInAt, checkOutAt: shift.checkOutAt },
    priorMinutes,
    org.settings.pay.scheduledDailyMinutes,
    worker.hourlyRateMinor,
    org.settings.pay.overtimeMultiplierBp,
  );

  const isFinalized = isShiftInFinalizedPeriod(ctx, org.id, worker.id, shift.checkInAt);
  const now = ctx.now().toISOString();

  let correctionDiff = undefined;
  if (prevRow) {
    const prevData = JSON.parse(prevRow.receipt_json) as CanonicalReceiptData;
    correctionDiff = buildCorrectionDiff(
      prevData,
      {
        checkInAt: shift.checkInAt,
        checkOutAt: shift.checkOutAt,
        durationMinutes: earnings.durationMinutes,
        earnings,
      },
      {
        correctedAt: now,
        correctedBy: `${actor.name} (${actor.id})`,
        reason,
      },
    );
  }

  const canonicalData: CanonicalReceiptData = {
    shiftId: shift.id,
    workerId: worker.id,
    orgId: org.id,
    version: nextVersion,
    status: isFinalized ? 'finalized' : 'estimated',
    checkInAt: shift.checkInAt,
    checkOutAt: shift.checkOutAt,
    durationMinutes: earnings.durationMinutes,
    rules: {
      scheduledDailyMinutes: org.settings.pay.scheduledDailyMinutes,
      hourlyRateMinor: worker.hourlyRateMinor,
      overtimeMultiplierBp: org.settings.pay.overtimeMultiplierBp,
      currency: org.currency,
    },
    earnings,
    issuedAt: now,
    correction: correctionDiff,
  };

  const digest = computeReceiptDigest(ctx.config.sessionSecret, canonicalData);
  const id = `rcpt_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  insertReceipt(ctx.db, {
    id,
    orgId: org.id,
    shiftId: shift.id,
    workerId: worker.id,
    version: nextVersion,
    previousVersionId: prevRow?.id ?? null,
    canonicalDigest: digest,
    status: canonicalData.status,
    data: canonicalData,
    correctionReason: reason,
    createdAt: now,
    createdBy: actor.id,
  });

  const row = getReceiptById(ctx.db, org.id, id)!;
  return toWorkReceiptDTO(row, true);
}

/**
 * Fetches the current latest receipt and historical versions for a given shift.
 */
export function getShiftReceipts(ctx: AppContext, orgId: string, shiftId: string): { current: WorkReceiptDTO | null; history: WorkReceiptDTO[] } {
  const rows = getReceiptHistoryForShift(ctx.db, orgId, shiftId);
  if (rows.length === 0) {
    return { current: null, history: [] };
  }

  const dtos = rows.map((r) => {
    const data = JSON.parse(r.receipt_json) as CanonicalReceiptData;
    const verified = verifyReceiptDigest(ctx.config.sessionSecret, data, r.canonical_digest);
    return toWorkReceiptDTO(r, verified);
  });

  return {
    current: dtos[0] ?? null,
    history: dtos,
  };
}

/**
 * Verifies cryptographic integrity of a specific receipt version.
 */
export function verifyReceipt(ctx: AppContext, orgId: string, receiptId: string): { receipt: WorkReceiptDTO; verified: boolean } {
  const row = getReceiptById(ctx.db, orgId, receiptId);
  if (!row) {
    throw notFound('Work receipt');
  }

  const data = JSON.parse(row.receipt_json) as CanonicalReceiptData;
  const verified = verifyReceiptDigest(ctx.config.sessionSecret, data, row.canonical_digest);

  return {
    receipt: toWorkReceiptDTO(row, verified),
    verified,
  };
}
