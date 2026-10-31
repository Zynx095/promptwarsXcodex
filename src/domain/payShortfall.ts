// Possible pay shortfall: compares what verified attendance should have earned at the configured
// rate with what the employer has recorded as paid. Integer paise throughout; the expected amount
// comes from the same calculatePay used for payslips, so the two can never disagree on rounding.
//
// This is an indicator for a conversation, not a finding: it does not know statutory minimum
// rates (they depend on state, sector, worker category and date), payments made but not recorded
// in FairShift, or agreements outside the configured rate. It never moves or deducts money.
import { calculatePay } from './payroll';
import type { PayRules, ShortfallReason, ShortfallResultDTO } from '../shared/types';

/** A shortfall of at least 10% of expected pay is marked for review (basis points). */
export const REVIEW_THRESHOLD_BP = 1000;

export interface ShortfallInput {
  /** The worker's configured hourly rate in paise; 0 or less means no rate is configured. */
  hourlyRateMinor: number;
  rules: PayRules;
  /** Minutes from closed (verified) shifts only. */
  regularMinutes: number;
  overtimeMinutes: number;
  openShiftsExcluded: number;
  /** Recorded payment and adjustment amounts counted for this period, in paise. */
  payments: { amountMinor: number }[];
  /** Recorded payments that also cover dates outside the period (not counted). */
  excludedPayments: number;
}

export function assessPayShortfall(input: ShortfallInput): ShortfallResultDTO {
  const reasons: ShortfallReason[] = [];
  if (input.openShiftsExcluded > 0) reasons.push('open_shifts_excluded');
  if (input.excludedPayments > 0) reasons.push('payments_outside_period');
  const recordedMinor = input.payments.reduce((sum, p) => sum + p.amountMinor, 0);
  const base = { recordedMinor, paymentCount: input.payments.length, reviewThresholdBp: REVIEW_THRESHOLD_BP };

  if (!Number.isSafeInteger(input.hourlyRateMinor) || input.hourlyRateMinor <= 0) {
    return { ...base, status: 'unavailable', reasons: ['rate_missing', ...reasons], expected: null, outstandingMinor: 0, overpaidMinor: 0 };
  }

  let pay: ReturnType<typeof calculatePay>;
  try {
    pay = calculatePay({
      hourlyRateMinor: input.hourlyRateMinor,
      regularMinutes: input.regularMinutes,
      overtimeMinutes: input.overtimeMinutes,
      rules: input.rules,
    });
  } catch {
    return { ...base, status: 'unavailable', reasons: ['calculation_failed', ...reasons], expected: null, outstandingMinor: 0, overpaidMinor: 0 };
  }
  const expected = {
    regularMinutes: pay.regularMinutes,
    overtimeMinutes: pay.overtimeMinutes,
    basePayMinor: pay.basePayMinor,
    overtimePayMinor: pay.overtimePayMinor,
    grossPayMinor: pay.grossPayMinor,
    totalDeductionsMinor: pay.totalDeductionsMinor,
    netPayMinor: pay.netPayMinor,
  };
  const due = expected.netPayMinor;
  const outstandingMinor = Math.max(0, due - recordedMinor);
  const overpaidMinor = Math.max(0, recordedMinor - due);

  if (due === 0 && recordedMinor === 0) {
    return { ...base, status: 'no_discrepancy', reasons: ['nothing_due', ...reasons], expected, outstandingMinor, overpaidMinor };
  }
  if (outstandingMinor === 0) {
    const why: ShortfallReason = overpaidMinor > 0 ? 'recorded_exceeds_expected' : 'paid_in_full';
    return { ...base, status: 'no_discrepancy', reasons: [why, ...reasons], expected, outstandingMinor, overpaidMinor };
  }
  if (input.payments.length === 0) {
    return { ...base, status: 'requires_review', reasons: ['no_payment_recorded', ...reasons], expected, outstandingMinor, overpaidMinor };
  }
  // outstanding / due >= 10%, compared in integers
  const large = outstandingMinor * 10000 >= due * REVIEW_THRESHOLD_BP;
  return {
    ...base,
    status: large ? 'requires_review' : 'possible_shortfall',
    reasons: [large ? 'large_shortfall' : 'small_shortfall', ...reasons],
    expected,
    outstandingMinor,
    overpaidMinor,
  };
}
