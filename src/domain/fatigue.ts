// Deterministic excessive-hours (fatigue-risk) rules. These are scheduling warnings derived
// from recorded shifts, not medical assessments.
import { dailyBreakdown, type ShiftTimes } from './attendance';
import { isoWeekKey, minutesBetween, formatMinutes } from '../shared/time';
import type { FatigueRuleKey, FatigueRules } from '../shared/types';

export interface FatigueFinding {
  rule: FatigueRuleKey;
  /** Identifies the time window; one alert per worker, rule and window. */
  windowKey: string;
  observedValue: number;
  threshold: number;
  details: string;
}

export const RULE_LABELS: Record<FatigueRuleKey, string> = {
  daily_hours: 'Long working day',
  weekly_hours: 'Long working week',
  short_rest: 'Short rest between shifts',
  repeated_overtime: 'Repeated overtime',
};

/**
 * Evaluates completed shifts for one worker.
 * Boundaries: daily/weekly limits trigger when strictly exceeded; rest triggers when strictly
 * shorter than the minimum; repeated overtime triggers when the count of overtime days in an
 * ISO week reaches the configured number.
 */
export function evaluateFatigue(
  shifts: (ShiftTimes & { id: string })[],
  rules: FatigueRules,
  timeZone: string,
  scheduledDailyMinutes: number,
): FatigueFinding[] {
  const completed = shifts.filter((s) => s.checkOutAt).sort((a, b) => a.checkInAt.localeCompare(b.checkInAt));
  const findings: FatigueFinding[] = [];
  const days = dailyBreakdown(completed, timeZone, scheduledDailyMinutes);

  for (const d of days) {
    if (d.workedMinutes > rules.maxDailyMinutes) {
      findings.push({
        rule: 'daily_hours',
        windowKey: `day:${d.date}`,
        observedValue: d.workedMinutes,
        threshold: rules.maxDailyMinutes,
        details: `${formatMinutes(d.workedMinutes)} recorded on ${d.date}; limit is ${formatMinutes(rules.maxDailyMinutes)}.`,
      });
    }
  }

  const weeks = new Map<string, { worked: number; overtimeDays: number }>();
  for (const d of days) {
    const key = isoWeekKey(d.date);
    const w = weeks.get(key) ?? { worked: 0, overtimeDays: 0 };
    w.worked += d.workedMinutes;
    if (d.overtimeMinutes > 0) w.overtimeDays += 1;
    weeks.set(key, w);
  }
  for (const [week, w] of [...weeks.entries()].sort()) {
    if (w.worked > rules.maxWeeklyMinutes) {
      findings.push({
        rule: 'weekly_hours',
        windowKey: `week:${week}`,
        observedValue: w.worked,
        threshold: rules.maxWeeklyMinutes,
        details: `${formatMinutes(w.worked)} recorded in week ${week}; limit is ${formatMinutes(rules.maxWeeklyMinutes)}.`,
      });
    }
    if (w.overtimeDays >= rules.overtimeDaysPerWeek) {
      findings.push({
        rule: 'repeated_overtime',
        windowKey: `week:${week}`,
        observedValue: w.overtimeDays,
        threshold: rules.overtimeDaysPerWeek,
        details: `Overtime on ${w.overtimeDays} days in week ${week}; threshold is ${rules.overtimeDaysPerWeek} days.`,
      });
    }
  }

  if (rules.minRestMinutes > 0) {
    for (let i = 1; i < completed.length; i++) {
      const prev = completed[i - 1]!;
      const next = completed[i]!;
      const rest = minutesBetween(prev.checkOutAt!, next.checkInAt);
      if (rest >= 0 && rest < rules.minRestMinutes) {
        findings.push({
          rule: 'short_rest',
          windowKey: `shift:${next.id}`,
          observedValue: rest,
          threshold: rules.minRestMinutes,
          details: `Only ${formatMinutes(rest)} of rest before the shift starting ${next.checkInAt}; minimum is ${formatMinutes(rules.minRestMinutes)}.`,
        });
      }
    }
  }
  return findings;
}
