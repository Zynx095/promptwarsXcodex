// Employer dashboard: every figure is computed from stored records for the selected range.
import { attendanceTrend, summarizeAttendance, summarizeReports } from '../../domain/dashboard';
import { addDays, localRangeToUtc } from '../../shared/time';
import type { ActivityItem, DashboardDTO } from '../../shared/types';
import type { AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { countActiveWorkers } from '../repositories/users';
import { countOpenShifts, listOrgShiftsInRange } from '../repositories/shifts';
import { countOpenAlerts } from './fatigue';
import { feedbackSummary } from './feedback';
import { reportCounts } from './reports';

const ACTIVITY_LIMIT = 10;

function recentActivity(ctx: AppContext, orgId: string): ActivityItem[] {
  const attendance = ctx.db.all<{ at: string; action: string; entityId: string; actorName: string | null; workerName: string | null }>(
    `SELECT a.created_at AS at, a.action, a.entity_id AS entityId, actor.name AS actorName, w.name AS workerName
     FROM audit_events a
     LEFT JOIN users actor ON actor.id = a.actor_id
     LEFT JOIN shifts s ON s.id = a.entity_id
     LEFT JOIN users w ON w.id = s.worker_id
     WHERE a.org_id = @orgId AND a.entity_type = 'shift'
     ORDER BY a.created_at DESC LIMIT @limit`,
    { orgId, limit: ACTIVITY_LIMIT },
  );
  const reports = ctx.db.all<{ at: string; fromStatus: string | null; toStatus: string; reportId: string; title: string; severity: string }>(
    `SELECT e.created_at AS at, e.from_status AS fromStatus, e.to_status AS toStatus, r.id AS reportId, r.title, r.severity
     FROM report_events e JOIN safety_reports r ON r.id = e.report_id
     WHERE e.org_id = @orgId ORDER BY e.created_at DESC LIMIT @limit`,
    { orgId, limit: ACTIVITY_LIMIT },
  );
  const items: ActivityItem[] = [
    ...attendance.map((a): ActivityItem => {
      const who = a.workerName ?? 'A worker';
      if (a.action === 'check_in') return { at: a.at, kind: 'check_in', text: `${who} checked in`, link: '/admin/shifts' };
      if (a.action === 'check_out') return { at: a.at, kind: 'check_out', text: `${who} checked out`, link: '/admin/shifts' };
      return { at: a.at, kind: 'correction', text: `${a.actorName ?? 'An administrator'} corrected a shift for ${who}`, link: '/admin/audit' };
    }),
    // Report activity never names the reporter, so confidential reports cannot leak here.
    ...reports.map((r): ActivityItem =>
      r.fromStatus === null
        ? { at: r.at, kind: 'report_created', text: `New ${r.severity} hazard reported: ${r.title}`, link: `/admin/reports/${r.reportId}` }
        : { at: r.at, kind: 'report_status', text: `Hazard "${r.title}" moved to ${r.toStatus.replace('_', ' ')}`, link: `/admin/reports/${r.reportId}` },
    ),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, ACTIVITY_LIMIT);
}

export function buildDashboard(ctx: AppContext, org: OrgRow, from: string, to: string): DashboardDTO {
  const { start, end } = localRangeToUtc(from, to, org.timezone);
  const shifts = listOrgShiftsInRange(ctx.db, org.id, start, end);
  const attendance = summarizeAttendance(shifts, org.timezone, org.settings.pay.scheduledDailyMinutes);
  // Trend covers the selected range, capped at the most recent 62 days to keep the chart readable.
  const dates: string[] = [];
  for (let d = to; d >= from && dates.length < 62; d = addDays(d, -1)) dates.unshift(d);
  const trend = attendanceTrend(shifts, dates, org.timezone, org.settings.pay.scheduledDailyMinutes);
  const reports = summarizeReports(reportCounts(ctx, org.id));
  return {
    range: { from, to },
    totalWorkers: countActiveWorkers(ctx.db, org.id),
    onShiftNow: countOpenShifts(ctx.db, org.id),
    completedShifts: attendance.completedShifts,
    workedMinutes: attendance.workedMinutes,
    overtimeMinutes: attendance.overtimeMinutes,
    workersWithOvertime: attendance.workersWithOvertime,
    openReports: reports.openReports,
    criticalUnresolved: reports.criticalUnresolved,
    openAlerts: countOpenAlerts(ctx, org.id),
    recentActivity: recentActivity(ctx, org.id),
    trend,
    feedback: feedbackSummary(ctx, org, from),
    synthetic: org.synthetic,
  };
}
