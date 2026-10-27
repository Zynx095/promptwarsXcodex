import { describe, expect, it } from 'vitest';
import { allowedTransitions, assertTransition, isUnresolved } from '../../src/domain/safety';
import { evaluateFatigue } from '../../src/domain/fatigue';
import { summarizeFeedback } from '../../src/domain/feedback';
import { canSeeReporter, canViewWorkerRecord } from '../../src/domain/access';
import { summarizeAttendance, summarizeReports } from '../../src/domain/dashboard';
import { DomainError } from '../../src/domain/errors';
import { REPORT_STATUSES } from '../../src/shared/types';
import type { FatigueRules } from '../../src/shared/types';

describe('safety report lifecycle', () => {
  it('allows the documented path submitted -> acknowledged -> in_progress -> resolved -> reopened', () => {
    expect(() => assertTransition('submitted', 'acknowledged', '')).not.toThrow();
    expect(() => assertTransition('acknowledged', 'in_progress', '')).not.toThrow();
    expect(() => assertTransition('in_progress', 'resolved', 'Guardrail installed')).not.toThrow();
    expect(() => assertTransition('resolved', 'reopened', 'Guardrail removed again')).not.toThrow();
    expect(() => assertTransition('reopened', 'acknowledged', '')).not.toThrow();
  });

  it('rejects skipping acknowledgement and every transition not in the table', () => {
    expect(() => assertTransition('submitted', 'resolved', 'done')).toThrow(DomainError);
    for (const from of REPORT_STATUSES) {
      for (const to of REPORT_STATUSES) {
        const allowed = allowedTransitions(from).includes(to);
        const fn = () => assertTransition(from, to, 'a note');
        if (allowed) expect(fn).not.toThrow();
        else expect(fn).toThrow(DomainError);
      }
    }
  });

  it('requires a note to resolve or reopen', () => {
    expect(() => assertTransition('acknowledged', 'resolved', '  ')).toThrow(/note/);
    expect(() => assertTransition('resolved', 'reopened', '')).toThrow(/note/);
  });

  it('treats only resolved reports as resolved', () => {
    expect(isUnresolved('resolved')).toBe(false);
    expect(isUnresolved('reopened')).toBe(true);
    expect(
      summarizeReports([
        { status: 'submitted', severity: 'critical' },
        { status: 'resolved', severity: 'critical' },
        { status: 'in_progress', severity: 'low' },
      ]),
    ).toEqual({ openReports: 2, criticalUnresolved: 1 });
  });
});

describe('fatigue-risk rules', () => {
  const rules: FatigueRules = { maxDailyMinutes: 600, maxWeeklyMinutes: 1800, minRestMinutes: 600, overtimeDaysPerWeek: 3 };
  const TZ = 'UTC';
  const shift = (id: string, start: string, hours: number) => ({
    id,
    checkInAt: start,
    checkOutAt: new Date(Date.parse(start) + hours * 3600000).toISOString(),
  });

  it('does not trigger at exactly the daily limit but does one minute over', () => {
    expect(evaluateFatigue([shift('a', '2026-10-26T06:00:00Z', 10)], rules, TZ, 480).filter((f) => f.rule === 'daily_hours')).toHaveLength(0);
    const over = { id: 'b', checkInAt: '2026-10-26T06:00:00Z', checkOutAt: '2026-10-26T16:01:00Z' };
    expect(evaluateFatigue([over], rules, TZ, 480).filter((f) => f.rule === 'daily_hours')).toEqual([
      expect.objectContaining({ windowKey: 'day:2026-10-26', observedValue: 601, threshold: 600 }),
    ]);
  });

  it('flags rest strictly shorter than the minimum between consecutive shifts', () => {
    const a = shift('a', '2026-10-26T06:00:00Z', 8); // ends 14:00
    const exact = shift('b', '2026-10-27T00:00:00Z', 4); // 10h rest: fine
    const short = shift('c', '2026-10-26T23:59:00Z', 4); // 9h59m rest: flagged
    expect(evaluateFatigue([a, exact], rules, TZ, 480).filter((f) => f.rule === 'short_rest')).toHaveLength(0);
    expect(evaluateFatigue([a, short], rules, TZ, 480).filter((f) => f.rule === 'short_rest')).toEqual([
      expect.objectContaining({ windowKey: 'shift:c', observedValue: 599 }),
    ]);
  });

  it('flags weekly hours and repeated overtime per ISO week', () => {
    const week = ['26', '27', '28'].map((d, i) => shift(`s${i}`, `2026-10-${d}T04:00:00Z`, 9)); // 27h, 3 OT days
    const f = evaluateFatigue(week, rules, TZ, 480);
    expect(f.find((x) => x.rule === 'repeated_overtime')).toMatchObject({ windowKey: 'week:2026-W44', observedValue: 3 });
    expect(f.find((x) => x.rule === 'weekly_hours')).toBeUndefined();
    const longer = [...week, shift('s3', '2026-10-29T04:00:00Z', 4)]; // 31h > 30h
    expect(evaluateFatigue(longer, rules, TZ, 480).find((x) => x.rule === 'weekly_hours')).toMatchObject({ observedValue: 1860 });
  });

  it('is deterministic: the same shifts always produce the same window keys', () => {
    const s = [shift('a', '2026-10-26T06:00:00Z', 11)];
    expect(evaluateFatigue(s, rules, TZ, 480)).toEqual(evaluateFatigue(s, rules, TZ, 480));
  });
});

describe('feedback aggregation', () => {
  const cats = [
    { key: 'pay', label: 'Pay' },
    { key: 'hours', label: 'Hours' },
  ];
  it('suppresses averages for groups smaller than the privacy threshold', () => {
    const s = summarizeFeedback(
      [
        { category: 'pay', rating: 2 },
        { category: 'pay', rating: 3 },
        { category: 'pay', rating: 5 },
        { category: 'hours', rating: 1 },
      ],
      cats,
    );
    expect(s[0]).toMatchObject({ count: 3, averageRating: 3.3, suppressed: false });
    expect(s[1]).toMatchObject({ count: 1, averageRating: null, suppressed: true });
  });
});

describe('access policy', () => {
  const worker = { id: 'w1', orgId: 'o1', role: 'worker' as const };
  const admin = { id: 'a1', orgId: 'o1', role: 'admin' as const };
  const otherAdmin = { id: 'a2', orgId: 'o2', role: 'admin' as const };

  it('lets workers see only their own records and admins only their organisation', () => {
    expect(canViewWorkerRecord(worker, { orgId: 'o1', workerId: 'w1' })).toBe(true);
    expect(canViewWorkerRecord(worker, { orgId: 'o1', workerId: 'w2' })).toBe(false);
    expect(canViewWorkerRecord(admin, { orgId: 'o1', workerId: 'w2' })).toBe(true);
    expect(canViewWorkerRecord(otherAdmin, { orgId: 'o1', workerId: 'w2' })).toBe(false);
  });

  it('hides confidential reporters from admins', () => {
    expect(canSeeReporter(admin, { confidential: true, isMine: false })).toBe(false);
    expect(canSeeReporter(admin, { confidential: false, isMine: false })).toBe(true);
    expect(canSeeReporter(worker, { confidential: true, isMine: true })).toBe(true);
  });
});

describe('dashboard aggregation', () => {
  it('derives totals and overtime per worker from shifts', () => {
    const s = summarizeAttendance(
      [
        { workerId: 'w1', checkInAt: '2026-10-26T00:00:00Z', checkOutAt: '2026-10-26T10:00:00Z' },
        { workerId: 'w2', checkInAt: '2026-10-26T00:00:00Z', checkOutAt: '2026-10-26T04:00:00Z' },
        { workerId: 'w2', checkInAt: '2026-10-26T05:00:00Z', checkOutAt: '2026-10-26T09:00:00Z' },
        { workerId: 'w3', checkInAt: '2026-10-27T00:00:00Z', checkOutAt: null },
      ],
      'UTC',
      480,
    );
    expect(s).toEqual({ completedShifts: 3, onShift: 1, workedMinutes: 1080, overtimeMinutes: 120, workersWithOvertime: 1 });
  });
});
