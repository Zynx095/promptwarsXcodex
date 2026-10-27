// Wage calculation. Pure functions over integer minor units; see shared/money.ts.
import { DomainError } from './errors';
import { dailyBreakdown, totals, type ShiftTimes } from './attendance';
import { BP, payForMinutes, percentOf } from '../shared/money';
import type { DeductionLine, PayBreakdown, PayRules } from '../shared/types';

export const MAX_HOURLY_RATE_MINOR = 1_000_000;
export const MAX_PERIOD_MINUTES = 31 * 24 * 60;

function requireInt(value: number, name: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new DomainError('INVALID_PAY_INPUT', `${name} must be a whole number between ${min} and ${max}.`);
  }
}

export function validatePayRules(rules: PayRules): void {
  requireInt(rules.scheduledDailyMinutes, 'Scheduled daily minutes', 1, 1440);
  requireInt(rules.overtimeMultiplierBp, 'Overtime multiplier', BP, 3 * BP);
  let percentTotal = 0;
  for (const d of rules.deductions) {
    if (d.kind === 'fixed') requireInt(d.value, `Deduction "${d.label}"`, 0, 10_000_000);
    else if (d.kind === 'percent_of_base' || d.kind === 'percent_of_gross') {
      requireInt(d.value, `Deduction "${d.label}"`, 0, BP);
      percentTotal += d.value;
    } else throw new DomainError('INVALID_PAY_INPUT', `Unknown deduction type for "${d.label}".`);
  }
  if (percentTotal > BP) throw new DomainError('INVALID_PAY_INPUT', 'Percentage deductions cannot exceed 100% in total.');
}

export interface PayInput {
  hourlyRateMinor: number;
  regularMinutes: number;
  overtimeMinutes: number;
  rules: PayRules;
}

/**
 * Calculates base pay, overtime pay, deductions and net pay.
 * Deductions are applied in configured order and capped so that net pay never becomes negative;
 * any capped deduction is flagged so the payslip can explain it.
 */
export function calculatePay(input: PayInput): Omit<PayBreakdown, 'days' | 'openShiftsExcluded'> {
  const { hourlyRateMinor, regularMinutes, overtimeMinutes, rules } = input;
  requireInt(hourlyRateMinor, 'Hourly rate', 1, MAX_HOURLY_RATE_MINOR);
  requireInt(regularMinutes, 'Regular minutes', 0, MAX_PERIOD_MINUTES);
  requireInt(overtimeMinutes, 'Overtime minutes', 0, MAX_PERIOD_MINUTES);
  validatePayRules(rules);

  const basePayMinor = payForMinutes(regularMinutes, hourlyRateMinor);
  const overtimePayMinor = payForMinutes(overtimeMinutes, hourlyRateMinor, rules.overtimeMultiplierBp);
  const grossPayMinor = basePayMinor + overtimePayMinor;

  let remaining = grossPayMinor;
  const deductions: DeductionLine[] = rules.deductions.map((d) => {
    const computed = d.kind === 'fixed' ? d.value : percentOf(d.kind === 'percent_of_base' ? basePayMinor : grossPayMinor, d.value);
    const amountMinor = Math.min(computed, remaining);
    remaining -= amountMinor;
    return { code: d.code, label: d.label, kind: d.kind, value: d.value, amountMinor, capped: amountMinor < computed };
  });
  const totalDeductionsMinor = deductions.reduce((s, d) => s + d.amountMinor, 0);
  const netPayMinor = grossPayMinor - totalDeductionsMinor;

  // Reconciliation invariants: a payslip that fails these must never be shown.
  if (netPayMinor < 0 || netPayMinor !== remaining || basePayMinor + overtimePayMinor - totalDeductionsMinor !== netPayMinor) {
    throw new DomainError('INVALID_PAY_INPUT', 'Pay calculation did not reconcile.');
  }

  return {
    hourlyRateMinor,
    scheduledDailyMinutes: rules.scheduledDailyMinutes,
    regularMinutes,
    overtimeMinutes,
    overtimeMultiplierBp: rules.overtimeMultiplierBp,
    basePayMinor,
    overtimePayMinor,
    grossPayMinor,
    deductions,
    totalDeductionsMinor,
    netPayMinor,
  };
}

/** Builds a full payslip breakdown from recorded shifts already filtered to the pay period. */
export function buildPayBreakdown(shifts: ShiftTimes[], hourlyRateMinor: number, rules: PayRules, timeZone: string): PayBreakdown {
  const days = dailyBreakdown(shifts, timeZone, rules.scheduledDailyMinutes);
  const t = totals(days);
  return {
    ...calculatePay({ hourlyRateMinor, regularMinutes: t.regularMinutes, overtimeMinutes: t.overtimeMinutes, rules }),
    days,
    openShiftsExcluded: shifts.filter((s) => !s.checkOutAt).length,
  };
}
