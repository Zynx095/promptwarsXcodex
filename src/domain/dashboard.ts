// Workforce aggregations used by the employer dashboard. Inputs are stored records only.
import { dailyBreakdown, totals, type ShiftTimes } from './attendance';
import { isUnresolved } from './safety';
import { localDate } from '../shared/time';
import type { ReportStatus, Severity } from '../shared/types';

export function summarizeAttendance(shifts: (ShiftTimes & { workerId: string })[], timeZone: string, scheduledDailyMinutes: number) {
  const byWorker = new Map<string, ShiftTimes[]>();
  for (const s of shifts) {
    const list = byWorker.get(s.workerId) ?? [];
    list.push(s);
    byWorker.set(s.workerId, list);
  }
  let workedMinutes = 0;
  let overtimeMinutes = 0;
  let workersWithOvertime = 0;
  for (const list of byWorker.values()) {
    const t = totals(dailyBreakdown(list, timeZone, scheduledDailyMinutes));
    workedMinutes += t.workedMinutes;
    overtimeMinutes += t.overtimeMinutes;
    if (t.overtimeMinutes > 0) workersWithOvertime += 1;
  }
  return {
    completedShifts: shifts.filter((s) => s.checkOutAt).length,
    onShift: shifts.filter((s) => !s.checkOutAt).length,
    workedMinutes,
    overtimeMinutes,
    workersWithOvertime,
  };
}

/**
 * Daily attendance trend: distinct workers who checked in on each local date, and the
 * overtime recorded on that date (per-worker daily overtime summed). Dates without shifts
 * are included with zeros so charts show gaps honestly.
 */
export function attendanceTrend(
  shifts: (ShiftTimes & { workerId: string })[],
  dates: string[],
  timeZone: string,
  scheduledDailyMinutes: number,
): { date: string; present: number; overtimeMinutes: number }[] {
  const present = new Map<string, Set<string>>();
  const byWorker = new Map<string, ShiftTimes[]>();
  for (const s of shifts) {
    const date = localDate(s.checkInAt, timeZone);
    if (!present.has(date)) present.set(date, new Set());
    present.get(date)!.add(s.workerId);
    const list = byWorker.get(s.workerId) ?? [];
    list.push(s);
    byWorker.set(s.workerId, list);
  }
  const overtime = new Map<string, number>();
  for (const list of byWorker.values()) {
    for (const d of dailyBreakdown(list, timeZone, scheduledDailyMinutes)) overtime.set(d.date, (overtime.get(d.date) ?? 0) + d.overtimeMinutes);
  }
  return dates.map((date) => ({ date, present: present.get(date)?.size ?? 0, overtimeMinutes: overtime.get(date) ?? 0 }));
}

export function summarizeReports(reports: { status: ReportStatus; severity: Severity }[]) {
  const open = reports.filter((r) => isUnresolved(r.status));
  return { openReports: open.length, criticalUnresolved: open.filter((r) => r.severity === 'critical').length };
}
