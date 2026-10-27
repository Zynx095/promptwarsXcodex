// Attendance rules: shift state, check-in/out transitions, duration and overtime.
// Durations and overtime are always derived from stored timestamps, never from client input.
import { DomainError } from './errors';
import { localDate, minutesBetween } from '../shared/time';
import type { AttendanceState, DaySummary } from '../shared/types';

/** Longest shift accepted from a self check-out; longer shifts need an administrator correction. */
export const MAX_SHIFT_MINUTES = 16 * 60;
/** Tolerated client/server clock skew for corrected timestamps. */
const FUTURE_TOLERANCE_MS = 2 * 60 * 1000;

export interface ShiftTimes {
  id?: string;
  checkInAt: string;
  checkOutAt: string | null;
}

export function attendanceState(shiftsToday: ShiftTimes[], openShift: ShiftTimes | null): AttendanceState {
  if (openShift) return 'on_shift';
  return shiftsToday.some((s) => s.checkOutAt) ? 'completed' : 'not_started';
}

export function assertCanCheckIn(openShift: ShiftTimes | null): void {
  if (openShift) throw new DomainError('ALREADY_ON_SHIFT', 'You are already checked in. Check out before starting a new shift.');
}

export function assertCanCheckOut(openShift: ShiftTimes | null, now: string): asserts openShift is ShiftTimes {
  if (!openShift) throw new DomainError('NOT_ON_SHIFT', 'You are not checked in, so there is no shift to check out from.');
  const minutes = minutesBetween(openShift.checkInAt, now);
  if (Date.parse(now) <= Date.parse(openShift.checkInAt)) {
    throw new DomainError('INVALID_SHIFT_TIMES', 'Check-out time must be after check-in time.');
  }
  if (minutes > MAX_SHIFT_MINUTES) {
    throw new DomainError(
      'SHIFT_TOO_LONG',
      `This shift has been open for more than ${MAX_SHIFT_MINUTES / 60} hours. Ask your supervisor to record the correct check-out time.`,
    );
  }
}

/** Validates an administrator-entered correction. Corrections may exceed MAX_SHIFT_MINUTES up to 24h. */
export function validateCorrection(times: ShiftTimes, now: string, others: ShiftTimes[]): void {
  const inMs = Date.parse(times.checkInAt);
  const nowMs = Date.parse(now) + FUTURE_TOLERANCE_MS;
  if (Number.isNaN(inMs)) throw new DomainError('INVALID_SHIFT_TIMES', 'Check-in time is missing or invalid.');
  if (inMs > nowMs) throw new DomainError('INVALID_SHIFT_TIMES', 'Check-in time cannot be in the future.');
  if (times.checkOutAt !== null) {
    const outMs = Date.parse(times.checkOutAt);
    if (Number.isNaN(outMs)) throw new DomainError('INVALID_SHIFT_TIMES', 'Check-out time is invalid.');
    if (outMs <= inMs) throw new DomainError('INVALID_SHIFT_TIMES', 'Check-out time must be after check-in time.');
    if (outMs > nowMs) throw new DomainError('INVALID_SHIFT_TIMES', 'Check-out time cannot be in the future.');
    if (outMs - inMs > 24 * 3600 * 1000) throw new DomainError('SHIFT_TOO_LONG', 'A single shift cannot be longer than 24 hours.');
  }
  const end = times.checkOutAt ? Date.parse(times.checkOutAt) : Number.POSITIVE_INFINITY;
  for (const o of others) {
    if (o.id && o.id === times.id) continue;
    const oStart = Date.parse(o.checkInAt);
    const oEnd = o.checkOutAt ? Date.parse(o.checkOutAt) : Number.POSITIVE_INFINITY;
    if (inMs < oEnd && oStart < end) {
      throw new DomainError('OVERLAPPING_SHIFT', 'The corrected times overlap another shift for this worker.');
    }
  }
}

export function shiftDurationMinutes(shift: ShiftTimes): number | null {
  return shift.checkOutAt ? minutesBetween(shift.checkInAt, shift.checkOutAt) : null;
}

/**
 * Overtime rule: worked minutes are grouped by the local calendar date of check-in.
 * Minutes beyond the organisation's scheduled daily minutes on that date are overtime.
 * Open (not yet checked-out) shifts are excluded.
 */
export function dailyBreakdown(shifts: ShiftTimes[], timeZone: string, scheduledDailyMinutes: number): DaySummary[] {
  if (!Number.isInteger(scheduledDailyMinutes) || scheduledDailyMinutes <= 0) {
    throw new DomainError('INVALID_PAY_INPUT', 'Scheduled daily hours must be a positive number of minutes.');
  }
  const byDate = new Map<string, { worked: number; count: number }>();
  for (const s of shifts) {
    const minutes = shiftDurationMinutes(s);
    if (minutes === null) continue;
    if (minutes < 0) throw new DomainError('INVALID_SHIFT_TIMES', 'A recorded shift ends before it starts.');
    const date = localDate(s.checkInAt, timeZone);
    const entry = byDate.get(date) ?? { worked: 0, count: 0 };
    entry.worked += minutes;
    entry.count += 1;
    byDate.set(date, entry);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { worked, count }]) => {
      const overtime = Math.max(0, worked - scheduledDailyMinutes);
      return { date, workedMinutes: worked, regularMinutes: worked - overtime, overtimeMinutes: overtime, shiftCount: count };
    });
}

export function totals(days: DaySummary[]) {
  return days.reduce(
    (t, d) => ({
      workedMinutes: t.workedMinutes + d.workedMinutes,
      regularMinutes: t.regularMinutes + d.regularMinutes,
      overtimeMinutes: t.overtimeMinutes + d.overtimeMinutes,
    }),
    { workedMinutes: 0, regularMinutes: 0, overtimeMinutes: 0 },
  );
}
