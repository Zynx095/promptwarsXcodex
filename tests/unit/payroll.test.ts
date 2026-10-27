import { describe, expect, it } from 'vitest';
import { buildPayBreakdown, calculatePay } from '../../src/domain/payroll';
import { DomainError } from '../../src/domain/errors';
import type { PayRules } from '../../src/shared/types';

const rules: PayRules = {
  scheduledDailyMinutes: 480,
  overtimeMultiplierBp: 15000,
  deductions: [
    { code: 'pf', label: 'Provident fund', kind: 'percent_of_base', value: 1200 },
    { code: 'welfare', label: 'Welfare', kind: 'percent_of_gross', value: 100 },
    { code: 'canteen', label: 'Canteen', kind: 'fixed', value: 5000 },
  ],
};

describe('calculatePay', () => {
  it('separates base, overtime, deductions and net, and reconciles', () => {
    const p = calculatePay({ hourlyRateMinor: 10000, regularMinutes: 2400, overtimeMinutes: 90, rules });
    expect(p.basePayMinor).toBe(400000); // 40h x Rs100
    expect(p.overtimePayMinor).toBe(22500); // 1.5h x Rs100 x 1.5
    expect(p.grossPayMinor).toBe(422500);
    expect(p.deductions.map((d) => d.amountMinor)).toEqual([48000, 4225, 5000]);
    expect(p.totalDeductionsMinor).toBe(57225);
    expect(p.netPayMinor).toBe(365275);
    expect(p.basePayMinor + p.overtimePayMinor - p.totalDeductionsMinor).toBe(p.netPayMinor);
  });

  it('rounds each component half-up to the nearest paisa', () => {
    // 7 minutes at Rs 85.55/h = 998.083 paise -> 998; OT 7 min x 1.5 = 1497.125 -> 1497
    const p = calculatePay({ hourlyRateMinor: 8555, regularMinutes: 7, overtimeMinutes: 7, rules: { ...rules, deductions: [] } });
    expect(p.basePayMinor).toBe(998);
    expect(p.overtimePayMinor).toBe(1497);
    expect(p.netPayMinor).toBe(2495);
  });

  it('caps deductions so net pay never goes negative and flags the cap', () => {
    const p = calculatePay({ hourlyRateMinor: 10000, regularMinutes: 15, overtimeMinutes: 0, rules });
    expect(p.grossPayMinor).toBe(2500);
    expect(p.netPayMinor).toBe(0);
    expect(p.deductions.find((d) => d.code === 'canteen')).toMatchObject({ capped: true, amountMinor: 2500 - 300 - 25 });
  });

  it('produces a zero payslip for zero hours without fabricating amounts', () => {
    const p = calculatePay({ hourlyRateMinor: 10000, regularMinutes: 0, overtimeMinutes: 0, rules });
    expect(p.grossPayMinor).toBe(0);
    expect(p.netPayMinor).toBe(0);
  });

  it.each([
    ['zero rate', { hourlyRateMinor: 0 }],
    ['negative rate', { hourlyRateMinor: -100 }],
    ['fractional rate', { hourlyRateMinor: 100.5 }],
    ['NaN minutes', { regularMinutes: Number.NaN }],
    ['negative overtime', { overtimeMinutes: -1 }],
    ['absurd minutes', { regularMinutes: 31 * 24 * 60 + 1 }],
  ])('rejects invalid input: %s', (_label, patch) => {
    expect(() => calculatePay({ hourlyRateMinor: 10000, regularMinutes: 60, overtimeMinutes: 0, rules, ...patch })).toThrow(DomainError);
  });

  it.each([
    ['multiplier below 1x', { overtimeMultiplierBp: 9999 }],
    ['multiplier above 3x', { overtimeMultiplierBp: 30001 }],
    ['percentage above 100%', { deductions: [{ code: 'x', label: 'X', kind: 'percent_of_gross' as const, value: 10001 }] }],
    [
      'percentages summing above 100%',
      {
        deductions: [
          { code: 'a', label: 'A', kind: 'percent_of_gross' as const, value: 6000 },
          { code: 'b', label: 'B', kind: 'percent_of_base' as const, value: 4001 },
        ],
      },
    ],
    ['negative fixed deduction', { deductions: [{ code: 'x', label: 'X', kind: 'fixed' as const, value: -1 }] }],
  ])('rejects invalid pay rules: %s', (_label, patch) => {
    expect(() => calculatePay({ hourlyRateMinor: 10000, regularMinutes: 60, overtimeMinutes: 0, rules: { ...rules, ...patch } })).toThrow(DomainError);
  });
});

describe('buildPayBreakdown', () => {
  it('derives hours from recorded shifts and excludes open shifts', () => {
    const shifts = [
      { checkInAt: '2026-10-26T02:30:00Z', checkOutAt: '2026-10-26T12:30:00Z' },
      { checkInAt: '2026-10-27T02:30:00Z', checkOutAt: null },
    ];
    const b = buildPayBreakdown(shifts, 10000, { ...rules, deductions: [] }, 'Asia/Kolkata');
    expect(b.regularMinutes).toBe(480);
    expect(b.overtimeMinutes).toBe(120);
    expect(b.basePayMinor).toBe(80000);
    expect(b.overtimePayMinor).toBe(30000);
    expect(b.openShiftsExcluded).toBe(1);
    expect(b.days).toHaveLength(1);
  });
});
