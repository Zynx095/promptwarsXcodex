import { describe, expect, it } from 'vitest';
import {
  addDays,
  fromLocalInputValue,
  isLocalDate,
  isoWeekKey,
  localDate,
  localRangeToUtc,
  minutesBetween,
  startOfLocalDay,
  toLocalInputValue,
} from '../../src/shared/time';
import { divRoundHalfUp, parseMajorToMinor, payForMinutes, percentOf } from '../../src/shared/money';

describe('time handling', () => {
  it('derives the local calendar date in the organisation timezone', () => {
    // 20:00 UTC is 01:30 the next day in India.
    expect(localDate('2026-10-26T20:00:00Z', 'Asia/Kolkata')).toBe('2026-10-27');
    expect(localDate('2026-10-26T18:00:00Z', 'Asia/Kolkata')).toBe('2026-10-26');
  });

  it('converts a local date to the UTC start of that day', () => {
    expect(startOfLocalDay('2026-10-27', 'Asia/Kolkata').toISOString()).toBe('2026-10-26T18:30:00.000Z');
    expect(startOfLocalDay('2026-03-29', 'Europe/London').toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(startOfLocalDay('2026-07-01', 'Europe/London').toISOString()).toBe('2026-06-30T23:00:00.000Z');
  });

  it('builds a half-open UTC range for inclusive local dates', () => {
    expect(localRangeToUtc('2026-10-01', '2026-10-01', 'Asia/Kolkata')).toEqual({
      start: '2026-09-30T18:30:00.000Z',
      end: '2026-10-01T18:30:00.000Z',
    });
  });

  it('round-trips wall-clock input values in the organisation timezone', () => {
    expect(toLocalInputValue('2026-10-27T03:30:00Z', 'Asia/Kolkata')).toBe('2026-10-27T09:00');
    expect(fromLocalInputValue('2026-10-27T09:00', 'Asia/Kolkata')).toBe('2026-10-27T03:30:00.000Z');
    expect(fromLocalInputValue('2026-10-27T25:00', 'Asia/Kolkata')).toBeNull();
    expect(fromLocalInputValue('garbage', 'Asia/Kolkata')).toBeNull();
  });

  it('validates calendar dates strictly', () => {
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('26-02-01')).toBe(false);
  });

  it('computes ISO week keys across year boundaries', () => {
    expect(isoWeekKey('2026-10-27')).toBe('2026-W44');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('floors minutes between instants', () => {
    expect(minutesBetween('2026-10-27T08:00:00Z', '2026-10-27T08:59:59Z')).toBe(59);
  });
});

describe('money arithmetic', () => {
  it('rounds half up using integer arithmetic', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 3)).toBe(1);
    expect(divRoundHalfUp(0, 7)).toBe(0);
  });

  it('pays minutes at an hourly rate without floating-point drift', () => {
    // 1 minute at Rs 100.00/h = 166.666 paise -> 167
    expect(payForMinutes(1, 10000)).toBe(167);
    // 90 minutes at Rs 85.50/h at 1.5x = 192.375 rupees -> 19238 paise
    expect(payForMinutes(90, 8550, 15000)).toBe(19238);
    expect(percentOf(100001, 1200)).toBe(12000);
  });

  it('rejects negative or fractional money inputs', () => {
    expect(() => payForMinutes(-1, 100)).toThrow(RangeError);
    expect(() => payForMinutes(1.5, 100)).toThrow(RangeError);
    expect(() => divRoundHalfUp(1, 0)).toThrow(RangeError);
  });

  it('parses decimal strings into minor units', () => {
    expect(parseMajorToMinor('125.5')).toBe(12550);
    expect(parseMajorToMinor('0.05')).toBe(5);
    expect(parseMajorToMinor('-1')).toBeNull();
    expect(parseMajorToMinor('1.234')).toBeNull();
    expect(parseMajorToMinor('abc')).toBeNull();
  });
});
