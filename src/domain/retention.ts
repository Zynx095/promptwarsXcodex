// Retention attention: a transparent, rule-based checklist of administrative issues that tend to
// wear people down (long hours, unresolved pay gaps, unanswered safety reports, record disputes).
// It is not a prediction and makes no claim about anyone's intentions. Every point comes from a
// stated rule over records that exist; a worker with no such records scores zero. Nothing here
// changes wages, attendance or employment status, and it must never be used to penalise anyone.
import { formatMoney } from '../shared/money';
import type { AttentionFactorDTO, AttentionFactorKey, AttentionLevel, AttentionRecord, ShortfallStatus } from '../shared/types';

/** Count thresholds per factor, highest first: the first band whose minimum is met gives its points. */
export const ATTENTION_RULES: Record<Exclude<AttentionFactorKey, 'pay'>, { min: number; points: number }[]> = {
  overtime: [
    { min: 6, points: 2 },
    { min: 3, points: 1 },
  ],
  hours_alerts: [
    { min: 2, points: 2 },
    { min: 1, points: 1 },
  ],
  attendance: [
    { min: 3, points: 2 },
    { min: 1, points: 1 },
  ],
  safety: [
    { min: 2, points: 2 },
    { min: 1, points: 1 },
  ],
};
export const PAY_POINTS: Partial<Record<ShortfallStatus, number>> = { requires_review: 2, possible_shortfall: 1 };
export const LEVEL_THRESHOLDS = { moderate: 2, high: 4 } as const;
const MAX_RECORDS = 10;

export const RETENTION_DISCLAIMER =
  'This panel lists administrative issues that may need attention, using fixed rules over recorded data. It is not a prediction of whether anyone will leave and says nothing about anyone’s intentions. It must not be used to penalise a worker: FairShift never changes wages, attendance or employment status because of it.';

export interface RetentionSignals {
  /** One record per local day in the window with overtime. */
  overtimeDays: AttentionRecord[];
  /** Open (unacknowledged) hours alerts. */
  hoursAlerts: AttentionRecord[];
  /** Corrected shifts and shifts left open unusually long, in the window. */
  attendanceIssues: AttentionRecord[];
  /** Named (non-confidential) safety reports by this worker that are still unresolved. */
  unresolvedReports: AttentionRecord[];
  /** Reports where the worker said the fix did not work. */
  disputedFixes: AttentionRecord[];
  /**
   * Pay checks for the pay periods with an issued payslip that ended in the window. Null when pay
   * cannot be assessed (no payments are recorded in this organisation at all).
   */
  pay: {
    currency: string;
    periods: {
      from: string;
      to: string;
      status: ShortfallStatus;
      expectedMinor: number | null;
      recordedMinor: number;
      outstandingMinor: number;
      link: string;
    }[];
  } | null;
}

export interface RetentionResult {
  level: AttentionLevel;
  score: number;
  factors: AttentionFactorDTO[];
}

function band(key: keyof typeof ATTENTION_RULES, count: number): number {
  return ATTENTION_RULES[key].find((b) => count >= b.min)?.points ?? 0;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function levelFor(score: number): AttentionLevel {
  return score >= LEVEL_THRESHOLDS.high ? 'high' : score >= LEVEL_THRESHOLDS.moderate ? 'moderate' : 'low';
}

export function evaluateRetention(s: RetentionSignals, windowDays: number): RetentionResult {
  const factors: AttentionFactorDTO[] = [];
  const add = (f: Omit<AttentionFactorDTO, 'records'> & { records: AttentionRecord[] }) => {
    if (f.points > 0) factors.push({ ...f, records: f.records.slice(0, MAX_RECORDS) });
  };

  add({
    key: 'overtime',
    label: 'Repeated overtime',
    points: band('overtime', s.overtimeDays.length),
    maxPoints: 2,
    observed: s.overtimeDays.length,
    reason: `Overtime on ${plural(s.overtimeDays.length, 'day', 'days')} in the last ${windowDays} days.`,
    followUp: 'Review how overtime is allocated with the supervisor and make sure rest days are planned.',
    records: s.overtimeDays,
  });
  add({
    key: 'hours_alerts',
    label: 'Open hours alerts',
    points: band('hours_alerts', s.hoursAlerts.length),
    maxPoints: 2,
    observed: s.hoursAlerts.length,
    reason: `${plural(s.hoursAlerts.length, 'hours alert', 'hours alerts')} (long days, long weeks or short rest) not yet acknowledged.`,
    followUp: 'Acknowledge the alerts in Hours alerts and note what was changed in the rota.',
    records: s.hoursAlerts,
  });
  add({
    key: 'attendance',
    label: 'Attendance record issues',
    points: band('attendance', s.attendanceIssues.length),
    maxPoints: 2,
    observed: s.attendanceIssues.length,
    reason: `${plural(s.attendanceIssues.length, 'shift record', 'shift records')} corrected or left open unusually long in the last ${windowDays} days.`,
    followUp: 'Go through the corrected or long shifts with the worker and confirm the record is right.',
    records: s.attendanceIssues,
  });
  const safetyCount = s.unresolvedReports.length + s.disputedFixes.length;
  const safetyParts = [
    s.unresolvedReports.length ? `${plural(s.unresolvedReports.length, 'unresolved safety report', 'unresolved safety reports')} raised by this worker` : '',
    s.disputedFixes.length ? `${plural(s.disputedFixes.length, 'fix', 'fixes')} the worker said did not work` : '',
  ].filter(Boolean);
  add({
    key: 'safety',
    label: 'Unresolved safety concerns',
    points: band('safety', safetyCount),
    maxPoints: 2,
    observed: safetyCount,
    reason: `${safetyParts.join(' and ')}.`.replace(/^./, (c) => c.toUpperCase()),
    followUp: 'Tell the worker where each report stands and agree a date for the fix. Raising a concern must never count against anyone.',
    records: [...s.unresolvedReports, ...s.disputedFixes],
  });
  if (s.pay) {
    const m = (minor: number) => formatMoney(minor, s.pay!.currency);
    const flagged = s.pay.periods.filter((p) => (PAY_POINTS[p.status] ?? 0) > 0);
    const points = Math.max(0, ...flagged.map((p) => PAY_POINTS[p.status] ?? 0));
    const outstanding = flagged.reduce((n, p) => n + p.outstandingMinor, 0);
    add({
      key: 'pay',
      label: 'Recorded pay discrepancy',
      points,
      maxPoints: 2,
      observed: flagged.length,
      reason: `${plural(flagged.length, 'issued pay period', 'issued pay periods')} where recorded payments are below verified hours at the configured rate (${m(outstanding)} possibly outstanding in total).`,
      followUp: 'Reconcile recorded payments against verified hours and share the result with the worker. Record any payment made outside FairShift.',
      records: flagged.map((p) => ({
        at: p.to,
        label: `${p.from} to ${p.to}: ${p.expectedMinor === null ? 'expected pay unavailable' : `${m(p.expectedMinor)} expected`}, ${m(p.recordedMinor)} recorded`,
        link: p.link,
      })),
    });
  }

  const score = factors.reduce((n, f) => n + f.points, 0);
  return { level: levelFor(score), score, factors };
}
