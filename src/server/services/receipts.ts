import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { getShift, listWorkerShifts } from '../repositories/shifts';
import { getWorker } from '../repositories/users';
import { buildCorrectionDiff, calculateShiftEarnings, computeReceiptDigest, verifyCheckpointSignature, verifyReceiptDigest } from '../../domain/proof';
import { verifyMerkleProof } from '../../domain/merkle';
import { DomainError } from '../../domain/errors';
import { isUniqueViolation } from '../db/db';
import type { CanonicalReceiptData, ReceiptVerificationResponse, VerificationTrustStatus, WorkReceiptDTO } from '../../shared/types';
import { localDate, localRangeToUtc, minutesBetween } from '../../shared/time';
import { getLatestReceiptForShift, getReceiptById, getReceiptHistoryForShift, insertReceipt, toWorkReceiptDTO } from '../repositories/receipts';
import { getCheckpointByReceiptId } from '../repositories/checkpoints';
import { getCheckpointSecretForKey, getIndependentVerificationBundle, getReceiptInclusionProof } from './checkpoints';
import { notFound } from '../http';

/**
 * Returns the signing secret for a given key ID, falling back to receiptSigningSecret.
 */
export function getSecretForKey(ctx: AppContext, keyId?: string | null): string {
  if (keyId && ctx.config.receiptSigningKeys && ctx.config.receiptSigningKeys[keyId]) {
    return ctx.config.receiptSigningKeys[keyId];
  }
  return ctx.config.receiptSigningSecret;
}

/**
 * Checks whether an issued payslip already covers the given shift timestamp in the org's timezone.
 */
export function isShiftInFinalizedPeriod(ctx: AppContext, orgId: string, workerId: string, checkInAt: string, timezone: string): boolean {
  const shiftDate = localDate(checkInAt, timezone);
  const payslip = ctx.db.get<{ id: string }>(
    `SELECT id FROM payslips
     WHERE org_id = @orgId AND worker_id = @workerId
       AND period_start <= @shiftDate AND period_end >= @shiftDate
     LIMIT 1`,
    { orgId, workerId, shiftDate },
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

  const isFinalized = isShiftInFinalizedPeriod(ctx, org.id, worker.id, shift.checkInAt, org.timezone);
  const now = ctx.now().toISOString();
  const keyId = ctx.config.activeReceiptKeyId;
  const secret = getSecretForKey(ctx, keyId);

  const canonicalData: CanonicalReceiptData = {
    shiftId: shift.id,
    workerId: worker.id,
    orgId: org.id,
    version: 1,
    keyId,
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

  const digest = computeReceiptDigest(secret, canonicalData);
  const id = `rcpt_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  try {
    insertReceipt(ctx.db, {
      id,
      orgId: org.id,
      shiftId: shift.id,
      workerId: worker.id,
      version: 1,
      keyId,
      canonicalDigest: digest,
      status: canonicalData.status,
      data: canonicalData,
      createdAt: now,
      createdBy: worker.id,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DomainError('CONFLICT', 'A receipt for version 1 of this shift already exists.');
    }
    throw err;
  }

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
  if (prevRow) {
    if (prevRow.org_id !== org.id || prevRow.worker_id !== shift.workerId || prevRow.shift_id !== shift.id) {
      throw new DomainError('FORBIDDEN', 'Receipt history does not match target shift tenant or worker context');
    }
  }
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

  const isFinalized = isShiftInFinalizedPeriod(ctx, org.id, worker.id, shift.checkInAt, org.timezone);
  const now = ctx.now().toISOString();
  const keyId = ctx.config.activeReceiptKeyId;
  const secret = getSecretForKey(ctx, keyId);

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
    keyId,
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

  const digest = computeReceiptDigest(secret, canonicalData);
  const id = `rcpt_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  try {
    insertReceipt(ctx.db, {
      id,
      orgId: org.id,
      shiftId: shift.id,
      workerId: worker.id,
      version: nextVersion,
      previousVersionId: prevRow?.id ?? null,
      keyId,
      canonicalDigest: digest,
      status: canonicalData.status,
      data: canonicalData,
      correctionReason: reason,
      createdAt: now,
      createdBy: actor.id,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DomainError('CONCURRENT_CORRECTION', 'A conflicting correction was just recorded for this shift. Please reload and try again.');
    }
    throw err;
  }

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
    const secret = getSecretForKey(ctx, r.key_id);
    const verified = verifyReceiptDigest(secret, data, r.canonical_digest);
    const chk = getCheckpointByReceiptId(ctx.db, r.id);
    return toWorkReceiptDTO(r, verified, {
      anchored: Boolean(chk),
      checkpointId: chk?.checkpoint.id ?? null,
    });
  });

  return {
    current: dtos[0] ?? null,
    history: dtos,
  };
}

/**
 * Verifies cryptographic integrity of a specific receipt version, including its Merkle inclusion proof
 * and signed checkpoint anchoring status.
 */
export function verifyReceipt(ctx: AppContext, orgId: string, receiptId: string): ReceiptVerificationResponse {
  const row = getReceiptById(ctx.db, orgId, receiptId);
  if (!row) {
    throw notFound('Work receipt');
  }

  const data = JSON.parse(row.receipt_json) as CanonicalReceiptData;
  const secret = getSecretForKey(ctx, row.key_id);
  const digestVerified = verifyReceiptDigest(secret, data, row.canonical_digest);

  const inclusion = getReceiptInclusionProof(ctx, orgId, receiptId);
  let trustStatus: VerificationTrustStatus = 'valid_unanchored';
  let checkpointDTO = null;
  let proofDTO = null;
  let independentBundle = null;

  if (!digestVerified) {
    trustStatus = 'invalid_digest';
  } else if (inclusion) {
    checkpointDTO = inclusion.checkpoint;
    proofDTO = inclusion.proof;
    const proofValid = verifyMerkleProof(inclusion.proof.leafHash, inclusion.proof.auditPath, inclusion.checkpoint.merkleRoot);
    const chkSecret = getCheckpointSecretForKey(ctx, inclusion.checkpoint.keyId);
    const sigValid = verifyCheckpointSignature(chkSecret, inclusion.checkpoint);

    if (!proofValid) {
      trustStatus = 'invalid_proof';
    } else if (!sigValid) {
      trustStatus = 'invalid_checkpoint_signature';
    } else {
      trustStatus = 'valid_and_anchored';
      independentBundle = getIndependentVerificationBundle(ctx, orgId, receiptId);
    }
  }

  const receiptDTO = toWorkReceiptDTO(row, digestVerified, {
    anchored: Boolean(inclusion && trustStatus === 'valid_and_anchored'),
    checkpointId: inclusion?.checkpoint.id ?? null,
  });

  return {
    receipt: receiptDTO,
    verified: digestVerified && (inclusion ? trustStatus === 'valid_and_anchored' : true),
    trustStatus,
    checkpoint: checkpointDTO,
    proof: proofDTO,
    independentBundle,
  };
}
