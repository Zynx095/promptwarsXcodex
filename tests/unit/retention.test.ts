import { describe, expect, it } from 'vitest';
import { ATTENTION_RULES, evaluateRetention, LEVEL_THRESHOLDS, levelFor, RETENTION_DISCLAIMER, type RetentionSignals } from '../../src/domain/retention';
import type { AttentionRecord } from '../../src/shared/types';

const rec = (n: number, label = 'record'): AttentionRecord[] =>
  Array.from({ length: n }, (_, i) => ({ at: `2026-10-${String(i + 1).padStart(2, '0')}`, label, link: null }));
const none: RetentionSignals = { overtimeDays: [], hoursAlerts: [], attendanceIssues: [], unresolvedReports: [], disputedFixes: [], pay: null };

describe('retention attention rules', () => {
  it('gives zero attention and no reasons to a worker with no records (nothing is invented)', () => {
    const r = evaluateRetention(none, 30);
    expect(r).toEqual({ level: 'low', score: 0, factors: [] });
  });

  it('classifies at the documented boundaries', () => {
    expect(LEVEL_THRESHOLDS).toEqual({ moderate: 2, high: 4 });
    expect([0, 1, 2, 3, 4, 7].map(levelFor)).toEqual(['low', 'low', 'moderate', 'moderate', 'high', 'high']);
    // Overtime bands: 2 days → 0, 3 → 1, 6 → 2
    expect(ATTENTION_RULES.overtime).toEqual([
      { min: 6, points: 2 },
      { min: 3, points: 1 },
    ]);
    expect(evaluateRetention({ ...none, overtimeDays: rec(2) }, 30).score).toBe(0);
    expect(evaluateRetention({ ...none, overtimeDays: rec(3) }, 30).score).toBe(1);
    expect(evaluateRetention({ ...none, overtimeDays: rec(6) }, 30)).toMatchObject({ score: 2, level: 'moderate' });
    expect(evaluateRetention({ ...none, hoursAlerts: rec(1), attendanceIssues: rec(1) }, 30)).toMatchObject({ score: 2, level: 'moderate' });
    expect(evaluateRetention({ ...none, overtimeDays: rec(6), unresolvedReports: rec(2) }, 30)).toMatchObject({ score: 4, level: 'high' });
  });

  it('explains every point with the rule, the observed count and the records behind it', () => {
    const r = evaluateRetention(
      {
        ...none,
        overtimeDays: rec(7, 'overtime day'),
        unresolvedReports: rec(2, 'open report'),
        pay: {
          currency: 'INR',
          periods: [
            {
              from: '2026-10-01',
              to: '2026-10-07',
              status: 'requires_review',
              expectedMinor: 1_250_000,
              recordedMinor: 1_050_000,
              outstandingMinor: 200_000,
              link: '/x',
            },
            {
              from: '2026-10-08',
              to: '2026-10-14',
              status: 'no_discrepancy',
              expectedMinor: 1_000_000,
              recordedMinor: 1_000_000,
              outstandingMinor: 0,
              link: '/y',
            },
          ],
        },
      },
      30,
    );
    expect(r.level).toBe('high');
    expect(r.score).toBe(6);
    const byKey = Object.fromEntries(r.factors.map((f) => [f.key, f]));
    expect(byKey.overtime).toMatchObject({ points: 2, observed: 7, reason: 'Overtime on 7 days in the last 30 days.' });
    expect(byKey.safety!.reason).toBe('2 unresolved safety reports raised by this worker.');
    expect(byKey.pay).toMatchObject({ points: 2, observed: 1 });
    expect(byKey.pay!.reason).toContain('₹2,000.00 possibly outstanding');
    expect(byKey.pay!.records).toHaveLength(1);
    for (const f of r.factors) {
      expect(f.followUp.length).toBeGreaterThan(10);
      expect(f.records.length).toBeGreaterThan(0);
    }
  });

  it('caps the listed records and counts disputed fixes as safety concerns', () => {
    const r = evaluateRetention({ ...none, attendanceIssues: rec(25), disputedFixes: rec(1) }, 30);
    const attendance = r.factors.find((f) => f.key === 'attendance')!;
    expect(attendance.observed).toBe(25);
    expect(attendance.records).toHaveLength(10);
    expect(r.factors.find((f) => f.key === 'safety')!.reason).toBe('1 fix the worker said did not work.');
  });

  it('adds no pay points when pay cannot be assessed or every period is settled', () => {
    expect(evaluateRetention({ ...none, pay: null }, 30).factors).toEqual([]);
    const settled = evaluateRetention(
      {
        ...none,
        pay: {
          currency: 'INR',
          periods: [{ from: 'a', to: 'b', status: 'no_discrepancy', expectedMinor: 1, recordedMinor: 1, outstandingMinor: 0, link: '' }],
        },
      },
      30,
    );
    expect(settled.factors).toEqual([]);
  });

  it('never uses predictive or punitive language', () => {
    const r = evaluateRetention(
      { overtimeDays: rec(9), hoursAlerts: rec(3), attendanceIssues: rec(4), unresolvedReports: rec(3), disputedFixes: rec(1), pay: null },
      30,
    );
    const text = [...r.factors.flatMap((f) => [f.label, f.reason, f.followUp])].join(' ').toLowerCase();
    expect(text).not.toMatch(/will (quit|leave)|likely to (quit|leave)|flight risk|probability|predict(s|ed)? that|disciplin|terminat/);
    expect(RETENTION_DISCLAIMER).toMatch(/not a prediction/);
    expect(RETENTION_DISCLAIMER).toMatch(/must not be used to penalise/);
  });
});
