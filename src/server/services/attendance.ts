// Attendance orchestration: applies domain rules inside transactions and records audit events.
import { DomainError } from '../../domain/errors';
import { assertCanCheckIn, assertCanCheckOut, attendanceState, dailyBreakdown, validateCorrection } from '../../domain/attendance';
import { addDays, localDate, localRangeToUtc } from '../../shared/time';
import type { AttendanceStatusDTO, CheckInMethod, ShiftDTO } from '../../shared/types';
import { verifySiteCode } from '../auth/siteCode';
import type { ShiftCorrectionInput } from '../../shared/schemas';
import { nowIso, type AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { recordAudit } from '../repositories/audit';
import * as shifts from '../repositories/shifts';
import { evaluateWorkerFatigue } from './fatigue';
import { generateCorrectedReceiptForShift, generateReceiptForShift } from './receipts';
import { findSessionUser } from '../repositories/users';
import { notFound } from '../http';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/.test(err.message);
}

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
function checkInMethod(ctx: AppContext, org: OrgRow, siteCode: string | undefined): CheckInMethod {
  if (siteCode) {
    if (!verifySiteCode(ctx.config.sessionSecret, org.id, ctx.now(), siteCode)) {
      throw new DomainError('INVALID_SITE_CODE', 'That site code is wrong or has expired. Ask your supervisor for the current code.');
    }
    return 'site_code';
  }
  if (org.settings.attendance.requireSiteCode) {
    throw new DomainError('SITE_CODE_REQUIRED', 'Enter the 6-digit site code shown at your workplace to check in.');
  }
  return 'app';
}

export function checkIn(ctx: AppContext, org: OrgRow, workerId: string, siteCode?: string): ShiftDTO {
  const at = nowIso(ctx);
  const method = checkInMethod(ctx, org, siteCode);
  try {
    return ctx.db.tx(() => {
      assertCanCheckIn(shifts.getOpenShift(ctx.db, workerId) ?? null);
      const id = shifts.insertShift(ctx.db, { orgId: org.id, workerId, checkInAt: at, source: 'app', method, at });
      recordAudit(ctx.db, { orgId: org.id, actorId: workerId, entityType: 'shift', entityId: id, action: 'check_in', after: { checkInAt: at, method }, at });
      return shifts.toShiftDTO(shifts.getShift(ctx.db, org.id, id)!, org.timezone);
    });
  } catch (err) {
    // The partial unique index is the final guard against concurrent duplicate check-ins.
    if (isUniqueViolation(err)) assertCanCheckIn({ checkInAt: at, checkOutAt: null });
    throw err;
  }
}

export function checkOut(ctx: AppContext, org: OrgRow, workerId: string): ShiftDTO {
  const at = nowIso(ctx);
  const shift = ctx.db.tx(() => {
    const open = shifts.getOpenShift(ctx.db, workerId) ?? null;
    assertCanCheckOut(open, at);
    if (!shifts.closeShift(ctx.db, open.id!, at, at)) {
      throw new DomainError('NOT_ON_SHIFT', 'This shift was already checked out.');
    }
    recordAudit(ctx.db, {
      orgId: org.id,
      actorId: workerId,
      entityType: 'shift',
      entityId: open.id!,
      action: 'check_out',
      after: { checkOutAt: at },
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
      after: { checkInAt, checkOutAt },
      reason: input.reason,
      at,
    });
    evaluateWorkerFatigue(ctx, org, existing.workerId);
    if (checkOutAt) {
      const actor = findSessionUser(ctx.db, actorId);
      generateCorrectedReceiptForShift(ctx, org, shiftId, { id: actorId, name: actor?.name ?? 'Admin' }, input.reason);
    }
    return shifts.getShift(ctx.db, org.id, shiftId)!;
  });
  return shifts.toShiftDTO(updated, org.timezone);
}

/** Default reporting window: the last 14 local days including today. */
export function defaultRange(ctx: AppContext, timeZone: string, days = 14): { from: string; to: string } {
  const to = localDate(ctx.now(), timeZone);
  return { from: addDays(to, -(days - 1)), to };
}
