import { describe, expect, it } from 'vitest';
import { assessPayShortfall, REVIEW_THRESHOLD_BP } from '../../src/domain/payShortfall';
import { calculatePay } from '../../src/domain/payroll';
import type { PayRules } from '../../src/shared/types';

const NO_DEDUCTIONS: PayRules = { scheduledDailyMinutes: 480, overtimeMultiplierBp: 15000, deductions: [] };
// ₹125.00/hour, 100 hours regular = ₹12,500 expected
const base = { hourlyRateMinor: 12500, rules: NO_DEDUCTIONS, regularMinutes: 6000, overtimeMinutes: 0, openShiftsExcluded: 0, excludedPayments: 0 };

describe('possible pay shortfall indicator', () => {
  it('reproduces the example: ₹12,500 expected, ₹10,500 recorded, ₹2,000 possible shortfall that requires review', () => {
    const r = assessPayShortfall({ ...base, payments: [{ amountMinor: 1_050_000 }] });
    expect(r.expected?.netPayMinor).toBe(1_250_000);
    expect(r.recordedMinor).toBe(1_050_000);
    expect(r.outstandingMinor).toBe(200_000);
    expect(r.status).toBe('requires_review');
    expect(r.reasons).toContain('large_shortfall');
  });

  it('identifies no discrepancy when payment matches to the paisa', () => {
    const r = assessPayShortfall({ ...base, payments: [{ amountMinor: 1_000_000 }, { amountMinor: 250_000 }] });
    expect(r).toMatchObject({ status: 'no_discrepancy', outstandingMinor: 0, overpaidMinor: 0, paymentCount: 2 });
    expect(r.reasons[0]).toBe('paid_in_full');
  });

  it('treats a zero recorded payment as needing review, never as paid', () => {
    const r = assessPayShortfall({ ...base, payments: [] });
    expect(r).toMatchObject({ status: 'requires_review', recordedMinor: 0, outstandingMinor: 1_250_000 });
    expect(r.reasons[0]).toBe('no_payment_recorded');
  });

  it('splits partial payments at the 10% review boundary using integer arithmetic', () => {
    expect(REVIEW_THRESHOLD_BP).toBe(1000);
    // Exactly 10% outstanding: review
    expect(assessPayShortfall({ ...base, payments: [{ amountMinor: 1_125_000 }] }).status).toBe('requires_review');
    // One paisa under 10%: possible shortfall
    const small = assessPayShortfall({ ...base, payments: [{ amountMinor: 1_125_001 }] });
    expect(small.status).toBe('possible_shortfall');
    expect(small.outstandingMinor).toBe(124_999);
    expect(Number.isInteger(small.outstandingMinor)).toBe(true);
  });

  it('notes overpayment without calling it a shortfall', () => {
    const r = assessPayShortfall({ ...base, payments: [{ amountMinor: 1_300_000 }] });
    expect(r).toMatchObject({ status: 'no_discrepancy', overpaidMinor: 50_000, outstandingMinor: 0 });
    expect(r.reasons[0]).toBe('recorded_exceeds_expected');
  });

  it('cannot complete the calculation without a configured rate, and says so', () => {
    for (const hourlyRateMinor of [0, -5, Number.NaN]) {
      const r = assessPayShortfall({ ...base, hourlyRateMinor, payments: [{ amountMinor: 100 }] });
      expect(r).toMatchObject({ status: 'unavailable', expected: null, outstandingMinor: 0 });
      expect(r.reasons[0]).toBe('rate_missing');
    }
  });

  it('uses exactly the payslip calculation, including rounding, overtime and deductions', () => {
    const rules: PayRules = {
      scheduledDailyMinutes: 480,
      overtimeMultiplierBp: 15000,
      deductions: [
        { code: 'pf', label: 'PF', kind: 'percent_of_base', value: 1200 },
        { code: 'canteen', label: 'Canteen', kind: 'fixed', value: 3333 },
      ],
    };
    // 7 minutes at ₹101.01/h rounds half-up: payForMinutes is shared with payslips
    const input = { hourlyRateMinor: 10101, rules, regularMinutes: 2407, overtimeMinutes: 7, openShiftsExcluded: 0, excludedPayments: 0 };
    const pay = calculatePay(input);
    const r = assessPayShortfall({ ...input, payments: [{ amountMinor: pay.netPayMinor - 1 }] });
    expect(r.expected).toMatchObject({ grossPayMinor: pay.grossPayMinor, totalDeductionsMinor: pay.totalDeductionsMinor, netPayMinor: pay.netPayMinor });
    expect(r.outstandingMinor).toBe(1);
    expect(r.status).toBe('possible_shortfall');
    for (const v of Object.values(r.expected!)) expect(Number.isInteger(v)).toBe(true);
  });

  it('reports open shifts and out-of-period payments as context without changing the arithmetic', () => {
    const r = assessPayShortfall({ ...base, openShiftsExcluded: 1, excludedPayments: 2, payments: [{ amountMinor: 1_250_000 }] });
    expect(r.status).toBe('no_discrepancy');
    expect(r.reasons).toEqual(['paid_in_full', 'open_shifts_excluded', 'payments_outside_period']);
  });

  it('has nothing to check when nothing was worked or paid', () => {
    const r = assessPayShortfall({ ...base, regularMinutes: 0, payments: [] });
    expect(r).toMatchObject({ status: 'no_discrepancy', outstandingMinor: 0 });
    expect(r.reasons[0]).toBe('nothing_due');
  });
});
