// Gathers the recorded facts behind the retention attention panel and applies the rules in
// domain/retention.ts. Read-only: it never writes, notifies or changes anything about a worker.
// Confidential safety reports and anonymous feedback are never attributed to anyone.
import { dailyBreakdown } from '../../domain/attendance';
import { evaluateRetention, LEVEL_THRESHOLDS, RETENTION_DISCLAIMER, type RetentionSignals } from '../../domain/retention';
import { addDays, formatMinutes, localDate, localRangeToUtc } from '../../shared/time';
import type { AttentionLevel, AttentionRecord, RetentionPanelDTO, RetentionWorkerDTO } from '../../shared/types';
import type { AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { listWorkerShifts } from '../repositories/shifts';
import { listWorkers } from '../repositories/users';
import { orgHasPayments, payCheck } from './payments';

export const RETENTION_WINDOW_DAYS = 30;
/** A shift longer than this (or still open after it) is listed as an attendance record issue. */
const LONG_SHIFT_MINUTES = 16 * 60;
const UNRESOLVED = ['submitted', 'acknowledged', 'in_progress', 'reopened'];
const CLOSED_BY_EMPLOYER = ['resolved', 'follow_up_pending', 'outcome_verified'];

const RULE_LABELS: Record<string, string> = {
  daily_hours: 'Long working day',
  weekly_hours: 'Long working week',
  short_rest: 'Short rest between shifts',
  repeated_overtime: 'Repeated overtime',
};

export function buildRetentionPanel(ctx: AppContext, org: OrgRow): RetentionPanelDTO {
  const to = localDate(ctx.now(), org.timezone);
  const from = addDays(to, -(RETENTION_WINDOW_DAYS - 1));
  const { start, end } = localRangeToUtc(from, to, org.timezone);
  const nowMs = ctx.now().getTime();
  const assessPay = orgHasPayments(ctx, org.id);

  const unavailable: RetentionPanelDTO['unavailable'] = [
    { key: 'feedback', reason: 'Worker feedback is anonymous by design, so it is never linked to an individual here.' },
    { key: 'wage_disputes', reason: 'Wage dispute notices are prepared on the worker’s own phone and are not stored by FairShift, so they cannot be counted.' },
  ];
  if (!assessPay) {
    unavailable.push({ key: 'pay', reason: 'No wage payments are recorded in FairShift for this organisation yet, so pay discrepancies cannot be assessed.' });
  }

  const workers: RetentionWorkerDTO[] = listWorkers(ctx.db, org.id)
    .filter((w) => w.active)
    .map((w) => {
      const shifts = listWorkerShifts(ctx.db, w.id, start, end, 2000);
      const closed = shifts.filter((s) => s.checkOutAt);

      const overtimeDays: AttentionRecord[] = dailyBreakdown(closed, org.timezone, org.settings.pay.scheduledDailyMinutes)
        .filter((d) => d.overtimeMinutes > 0)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((d) => ({ at: d.date, label: `${formatMinutes(d.workedMinutes)} worked, ${formatMinutes(d.overtimeMinutes)} overtime`, link: '/admin/shifts' }));

      const attendanceIssues: AttentionRecord[] = [];
      for (const s of shifts) {
        const minutes = Math.floor(((s.checkOutAt ? Date.parse(s.checkOutAt) : nowMs) - Date.parse(s.checkInAt)) / 60000);
        if (s.corrected) attendanceIssues.push({ at: s.checkInAt, label: 'Shift times corrected by an administrator', link: '/admin/shifts' });
        else if (minutes > LONG_SHIFT_MINUTES) {
          attendanceIssues.push({
            at: s.checkInAt,
            label: s.checkOutAt ? `Shift lasted ${formatMinutes(minutes)} (possible missed check-out)` : `Still open after ${formatMinutes(minutes)}`,
            link: '/admin/shifts',
          });
        }
      }

      const hoursAlerts = ctx.db
        .all<{ rule: string; details: string; createdAt: string }>(
          `SELECT rule, details, created_at AS createdAt FROM fatigue_alerts WHERE org_id = @orgId AND worker_id = @workerId AND status = 'open'
           ORDER BY created_at DESC LIMIT 50`,
          { orgId: org.id, workerId: w.id },
        )
        .map((a) => ({ at: a.createdAt, label: `${RULE_LABELS[a.rule] ?? a.rule}: ${a.details}`, link: '/admin/alerts' }));

      // Named reports only: confidential reports carry no reporter ID and are never counted.
      const reports = ctx.db.all<{ id: string; title: string; status: string; response: string | null; createdAt: string }>(
        `SELECT id, title, status, worker_response AS response, created_at AS createdAt FROM safety_reports
         WHERE org_id = @orgId AND reporter_id = @workerId AND confidential = 0 ORDER BY created_at DESC LIMIT 200`,
        { orgId: org.id, workerId: w.id },
      );
      const unresolvedReports = reports
        .filter((r) => UNRESOLVED.includes(r.status))
        .map((r) => ({ at: r.createdAt, label: `Open report: ${r.title} (${r.status.replace(/_/g, ' ')})`, link: `/admin/reports/${r.id}` }));
      const disputedFixes = reports
        .filter((r) => r.response === 'disputed' && CLOSED_BY_EMPLOYER.includes(r.status))
        .map((r) => ({ at: r.createdAt, label: `Worker disputed the fix: ${r.title}`, link: `/admin/reports/${r.id}` }));

      // Pay is checked per issued pay period (the employer has closed it) that ended in the window
      let pay: RetentionSignals['pay'] = null;
      if (assessPay) {
        const periods = ctx.db.all<{ from: string; to: string }>(
          `SELECT period_start AS "from", period_end AS "to" FROM payslips WHERE org_id = @orgId AND worker_id = @workerId AND period_end >= @from
           ORDER BY period_end DESC LIMIT 12`,
          { orgId: org.id, workerId: w.id, from },
        );
        pay = {
          currency: org.currency,
          periods: periods.map((p) => {
            const check = payCheck(ctx, org, w.id, p.from, p.to);
            return {
              ...p,
              status: check.result.status,
              expectedMinor: check.result.expected?.netPayMinor ?? null,
              recordedMinor: check.result.recordedMinor,
              outstandingMinor: check.result.outstandingMinor,
              link: `/admin/pay-check?worker=${encodeURIComponent(w.id)}&from=${p.from}&to=${p.to}`,
            };
          }),
        };
      }

      const result = evaluateRetention({ overtimeDays, hoursAlerts, attendanceIssues, unresolvedReports, disputedFixes, pay }, RETENTION_WINDOW_DAYS);
      return { workerId: w.id, name: w.name, jobTitle: w.jobTitle, team: w.team, ...result };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const counts: Record<AttentionLevel, number> = { low: 0, moderate: 0, high: 0 };
  for (const w of workers) counts[w.level]++;
  return {
    window: { from, to, days: RETENTION_WINDOW_DAYS },
    thresholds: { ...LEVEL_THRESHOLDS },
    counts,
    workers,
    unavailable,
    disclaimer: RETENTION_DISCLAIMER,
    synthetic: org.synthetic,
  };
}
