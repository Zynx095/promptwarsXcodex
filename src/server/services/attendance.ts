// Attendance orchestration: applies domain rules inside transactions and records audit events.
import { DomainError } from '../../domain/errors';
import { assertCanCheckIn, assertCanCheckOut, attendanceState, dailyBreakdown, validateCorrection } from '../../domain/attendance';
import { addDays, localDate, localRangeToUtc } from '../../shared/time';
import type { AttendanceAuth, AttendanceStatusDTO, CheckInMethod, ShiftDTO } from '../../shared/types';
import { verifySiteCode } from '../auth/siteCode';
import type { ShiftCorrectionInput } from '../../shared/schemas';
import { nowIso, type AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { recordAudit } from '../repositories/audit';
import * as shifts from '../repositories/shifts';
import { evaluateWorkerFatigue } from './fatigue';
import { generateCorrectedReceiptForShift, generateReceiptForShift, isShiftInFinalizedPeriod } from './receipts';
import { findSessionUser, getWorker } from '../repositories/users';
import { createNotification } from '../repositories/notifications';
import { notFound } from '../http';
import { qrUsedBy, recordQrUse, resolveQrToken, type ResolvedQr } from './siteQr';

import { isUniqueViolation } from '../db/db';

export function attendanceStatus(ctx: AppContext, org: OrgRow, workerId: string): AttendanceStatusDTO {
  const today = localDate(ctx.now(), org.timezone);
  const { start, end } = localRangeToUtc(today, today, org.timezone);
  const todays = shifts.listWorkerShifts(ctx.db, workerId, start, end);
  const open = shifts.getOpenShift(ctx.db, workerId) ?? null;
  const scheduled = org.settings.pay.scheduledDailyMinutes;
  const day = dailyBreakdown(todays, org.timezone, scheduled)[0] ?? {
    date: today,
    workedMinutes: 0,
    regularMinutes: 0,
    overtimeMinutes: 0,
    shiftCount: 0,
  };
  return {
    state: attendanceState(todays, open),
    openShift: open ? shifts.toShiftDTO(open, org.timezone) : null,
    today: day,
    scheduledDailyMinutes: scheduled,
    requireSiteCode: org.settings.attendance.requireSiteCode,
  };
}

/** Checks the optional site code against the organisation's rule. Returns how the check-in was made. */
function checkInMethod(ctx: AppContext, org: OrgRow, siteCode: string | undefined, qr: ResolvedQr | null): CheckInMethod {
  if (qr) return 'site_qr';
  if (siteCode) {
    if (!verifySiteCode(ctx.config.sessionSecret, org.id, ctx.now(), siteCode)) {
      throw new DomainError('INVALID_SITE_CODE', 'That site code is wrong or has expired. Ask your supervisor for the current code.');
    }
    return 'site_code';
  }
  if (org.settings.attendance.requireSiteCode) {
    throw new DomainError('SITE_CODE_REQUIRED', 'Enter the 6-digit site code shown at your workplace, or scan the site QR code, to check in.');
  }
  return 'app';
}

/** How the worker proved it was them: `credentialLabel` is set when a passkey assertion was verified. */
export interface AttendanceProof {
  auth: AttendanceAuth;
  credentialLabel?: string;
}

/** Optional extras for a check-in: a scanned site QR token, and when an offline phone saved the tap. */
export interface CheckInExtras {
  qrToken?: string;
  /** The phone's own clock: kept in the audit log for review, never used as the check-in time. */
  queuedAt?: string;
}

export function checkIn(
  ctx: AppContext,
  org: OrgRow,
  workerId: string,
  siteCode?: string,
  proof: AttendanceProof = { auth: 'session' },
  extras: CheckInExtras = {},
): ShiftDTO {
  const at = nowIso(ctx);
  const worker = getWorker(ctx.db, org.id, workerId);
  if (worker && !worker.active) {
    throw new DomainError('INACTIVE_ACCOUNT', 'This account has been deactivated. Contact your supervisor.');
  }
  const qr = extras.qrToken ? resolveQrToken(ctx, org, extras.qrToken) : null;
  const method = checkInMethod(ctx, org, siteCode, qr);
  try {
    return ctx.db.tx(() => {
      assertCanCheckIn(shifts.getOpenShift(ctx.db, workerId) ?? null);
      if (qr && qrUsedBy(ctx, qr.nonce, workerId)) {
        throw new DomainError('QR_ALREADY_USED', 'You already used this QR code. Scan the code on the screen now.');
      }

      const id = shifts.insertShift(ctx.db, { orgId: org.id, workerId, checkInAt: at, source: 'app', method, auth: proof.auth, siteId: qr?.site.id, at });
      if (qr) recordQrUse(ctx, qr.nonce, workerId, id);
      recordAudit(ctx.db, {
        orgId: org.id,
        actorId: workerId,
        entityType: 'shift',
        entityId: id,
        action: 'check_in',
        after: {
          checkInAt: at,
          method,
          auth: proof.auth,
          ...(proof.credentialLabel ? { passkey: proof.credentialLabel } : {}),
          ...(qr ? { siteId: qr.site.id } : {}),
          ...(extras.queuedAt ? { queuedOfflineAt: extras.queuedAt, queuedOfflineAtSource: 'device clock, unverified' } : {}),
        },
        at,
      });
      return shifts.toShiftDTO(shifts.getShift(ctx.db, org.id, id)!, org.timezone);
    });
  } catch (err) {
    // The partial unique index is the final guard against concurrent duplicate check-ins.
    if (isUniqueViolation(err)) assertCanCheckIn({ checkInAt: at, checkOutAt: null });
    throw err;
  }
}

export function checkOut(ctx: AppContext, org: OrgRow, workerId: string, proof: AttendanceProof = { auth: 'session' }, queuedAt?: string): ShiftDTO {
  const at = nowIso(ctx);
  const shift = ctx.db.tx(() => {
    const open = shifts.getOpenShift(ctx.db, workerId) ?? null;
    assertCanCheckOut(open, at);
    if (!shifts.closeShift(ctx.db, open.id!, at, at, proof.auth)) {
      throw new DomainError('NOT_ON_SHIFT', 'This shift was already checked out.');
    }
    recordAudit(ctx.db, {
      orgId: org.id,
      actorId: workerId,
      entityType: 'shift',
      entityId: open.id!,
      action: 'check_out',
      after: {
        checkOutAt: at,
        auth: proof.auth,
        ...(proof.credentialLabel ? { passkey: proof.credentialLabel } : {}),
        ...(queuedAt ? { queuedOfflineAt: queuedAt, queuedOfflineAtSource: 'device clock, unverified' } : {}),
      },
      at,
    });
    evaluateWorkerFatigue(ctx, org, workerId);
    generateReceiptForShift(ctx, org, open.id!);
    return shifts.getShift(ctx.db, org.id, open.id!)!;
  });
  return shifts.toShiftDTO(shift, org.timezone);
}

export function correctShift(ctx: AppContext, org: OrgRow, actorId: string, shiftId: string, input: ShiftCorrectionInput): ShiftDTO {
  const at = nowIso(ctx);
  const checkInAt = new Date(input.checkInAt).toISOString();
  const checkOutAt = input.checkOutAt ? new Date(input.checkOutAt).toISOString() : null;
  const updated = ctx.db.tx(() => {
    const existing = shifts.getShift(ctx.db, org.id, shiftId);
    if (!existing) throw notFound('Shift');

    const inFinalized = isShiftInFinalizedPeriod(ctx, org.id, existing.workerId, existing.checkInAt, org.timezone);
    if (inFinalized && !input.isPayrollAdjustment) {
      throw new DomainError(
        'FINALIZED_PERIOD_LOCKED',
        'This shift belongs to a finalized pay period with an issued payslip and cannot be directly modified without an explicit retroactive payroll adjustment.',
      );
    }

    if (existing.checkInAt === checkInAt && existing.checkOutAt === checkOutAt) {
      throw new DomainError('INVALID_SHIFT_TIMES', 'The corrected times are the same as the recorded times.');
    }
    const windowStart = new Date(Date.parse(checkInAt) - 2 * 86400000).toISOString();
    const windowEnd = new Date(Date.parse(checkInAt) + 2 * 86400000).toISOString();
    const neighbours = shifts.listWorkerShifts(ctx.db, existing.workerId, windowStart, windowEnd);
    validateCorrection({ id: shiftId, checkInAt, checkOutAt }, at, neighbours);
    try {
      shifts.updateShiftTimes(ctx.db, org.id, shiftId, checkInAt, checkOutAt, at);
    } catch (err) {
      if (isUniqueViolation(err)) throw new DomainError('ALREADY_ON_SHIFT', 'This worker already has another open shift.');
      throw err;
    }
    recordAudit(ctx.db, {
      orgId: org.id,
      actorId,
      entityType: 'shift',
      entityId: shiftId,
      action: 'correction',
      before: { checkInAt: existing.checkInAt, checkOutAt: existing.checkOutAt },
      after: { checkInAt, checkOutAt, isPayrollAdjustment: Boolean(input.isPayrollAdjustment) },
      reason: input.reason,
      at,
    });
    evaluateWorkerFatigue(ctx, org, existing.workerId);
    if (checkOutAt) {
      const actor = findSessionUser(ctx.db, actorId);
      generateCorrectedReceiptForShift(ctx, org, shiftId, { id: actorId, name: actor?.name ?? 'Admin' }, input.reason);
    }
    createNotification(ctx.db, {
      orgId: org.id,
      userId: existing.workerId,
      type: 'shift_correction',
      title: 'Shift Record Adjusted',
      body: `Your shift on ${existing.checkInAt.slice(0, 10)} was updated by administration. Reason: ${input.reason}`,
      link: '/worker/attendance',
      nowIso: at,
    });
    return shifts.getShift(ctx.db, org.id, shiftId)!;
  });
  return shifts.toShiftDTO(updated, org.timezone);
}

/** Default reporting window: the last 14 local days including today. */
export function defaultRange(ctx: AppContext, timeZone: string, days = 14): { from: string; to: string } {
  const to = localDate(ctx.now(), timeZone);
  return { from: addDays(to, -(days - 1)), to };
}
