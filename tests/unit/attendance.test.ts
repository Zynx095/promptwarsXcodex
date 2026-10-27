import { describe, expect, it } from 'vitest';
import {
  assertCanCheckIn,
  assertCanCheckOut,
  attendanceState,
  dailyBreakdown,
  MAX_SHIFT_MINUTES,
  shiftDurationMinutes,
  totals,
  validateCorrection,
} from '../../src/domain/attendance';
import { DomainError } from '../../src/domain/errors';

const TZ = 'Asia/Kolkata';
const open = { id: 'a', checkInAt: '2026-10-27T02:30:00Z', checkOutAt: null };
const done = { id: 'b', checkInAt: '2026-10-26T02:30:00Z', checkOutAt: '2026-10-26T10:30:00Z' };

function code(fn: () => void): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : 'OTHER';
  }
  return undefined;
}

describe('shift state transitions', () => {
  it('reports not_started, on_shift and completed explicitly', () => {
    expect(attendanceState([], null)).toBe('not_started');
    expect(attendanceState([open], open)).toBe('on_shift');
    expect(attendanceState([done], null)).toBe('completed');
  });

  it('prevents duplicate check-in while a shift is open', () => {
    expect(code(() => assertCanCheckIn(open))).toBe('ALREADY_ON_SHIFT');
    expect(code(() => assertCanCheckIn(null))).toBeUndefined();
  });

  it('prevents check-out without an open shift', () => {
    expect(code(() => assertCanCheckOut(null, '2026-10-27T05:00:00Z'))).toBe('NOT_ON_SHIFT');
  });

  it('rejects a check-out at or before check-in', () => {
    expect(code(() => assertCanCheckOut(open, open.checkInAt))).toBe('INVALID_SHIFT_TIMES');
  });

  it('requires an administrator correction for overly long open shifts', () => {
    const exactlyMax = new Date(Date.parse(open.checkInAt) + MAX_SHIFT_MINUTES * 60000).toISOString();
    const overMax = new Date(Date.parse(open.checkInAt) + (MAX_SHIFT_MINUTES + 1) * 60000).toISOString();
    expect(code(() => assertCanCheckOut(open, exactlyMax))).toBeUndefined();
    expect(code(() => assertCanCheckOut(open, overMax))).toBe('SHIFT_TOO_LONG');
  });
});

describe('shift duration and overtime', () => {
  it('derives duration from timestamps; open shifts have none', () => {
    expect(shiftDurationMinutes(done)).toBe(480);
    expect(shiftDurationMinutes(open)).toBeNull();
  });

  it('computes overtime per local day beyond scheduled minutes', () => {
    const shifts = [
      // Day 1: 10h in one shift -> 2h overtime
      { checkInAt: '2026-10-26T02:30:00Z', checkOutAt: '2026-10-26T12:30:00Z' },
      // Day 2: two shifts 5h + 4h = 9h -> 1h overtime
      { checkInAt: '2026-10-27T02:30:00Z', checkOutAt: '2026-10-27T07:30:00Z' },
      { checkInAt: '2026-10-27T08:30:00Z', checkOutAt: '2026-10-27T12:30:00Z' },
      // Day 3: exactly 8h -> no overtime (boundary)
      { checkInAt: '2026-10-28T02:30:00Z', checkOutAt: '2026-10-28T10:30:00Z' },
      // Open shift ignored
      { checkInAt: '2026-10-29T02:30:00Z', checkOutAt: null },
    ];
    const days = dailyBreakdown(shifts, TZ, 480);
    expect(days).toEqual([
      { date: '2026-10-26', workedMinutes: 600, regularMinutes: 480, overtimeMinutes: 120, shiftCount: 1 },
      { date: '2026-10-27', workedMinutes: 540, regularMinutes: 480, overtimeMinutes: 60, shiftCount: 2 },
      { date: '2026-10-28', workedMinutes: 480, regularMinutes: 480, overtimeMinutes: 0, shiftCount: 1 },
    ]);
    expect(totals(days)).toEqual({ workedMinutes: 1620, regularMinutes: 1440, overtimeMinutes: 180 });
  });

  it('assigns an overnight shift to the local date of check-in', () => {
    const night = { checkInAt: '2026-10-26T15:30:00Z', checkOutAt: '2026-10-27T01:30:00Z' }; // 21:00 -> 07:00 IST
    expect(dailyBreakdown([night], TZ, 480)[0]).toMatchObject({ date: '2026-10-26', overtimeMinutes: 120 });
  });

  it('rejects an invalid scheduled-hours configuration', () => {
    expect(code(() => dailyBreakdown([], TZ, 0))).toBe('INVALID_PAY_INPUT');
  });
});

describe('administrator corrections', () => {
  const now = '2026-10-27T12:00:00Z';
  it('accepts a valid correction', () => {
    expect(code(() => validateCorrection({ id: 'b', checkInAt: '2026-10-26T03:00:00Z', checkOutAt: '2026-10-26T11:00:00Z' }, now, [done]))).toBeUndefined();
  });
  it('rejects inconsistent or future timestamps', () => {
    expect(code(() => validateCorrection({ checkInAt: '2026-10-26T11:00:00Z', checkOutAt: '2026-10-26T03:00:00Z' }, now, []))).toBe('INVALID_SHIFT_TIMES');
    expect(code(() => validateCorrection({ checkInAt: '2026-10-28T03:00:00Z', checkOutAt: null }, now, []))).toBe('INVALID_SHIFT_TIMES');
    expect(code(() => validateCorrection({ checkInAt: 'not-a-date', checkOutAt: null }, now, []))).toBe('INVALID_SHIFT_TIMES');
  });
  it('rejects shifts over 24 hours and overlaps with other shifts', () => {
    expect(code(() => validateCorrection({ checkInAt: '2026-10-25T00:00:00Z', checkOutAt: '2026-10-26T00:01:00Z' }, now, []))).toBe('SHIFT_TOO_LONG');
    expect(code(() => validateCorrection({ id: 'x', checkInAt: '2026-10-26T09:00:00Z', checkOutAt: '2026-10-26T12:00:00Z' }, now, [done]))).toBe(
      'OVERLAPPING_SHIFT',
    );
  });
});
