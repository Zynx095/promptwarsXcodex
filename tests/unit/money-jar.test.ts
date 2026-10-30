import { describe, expect, it } from 'vitest';
import { deriveMoneyJarModel } from '../../src/domain/moneyJar';
import type { PayslipDTO } from '../../src/shared/types';

describe('FairShift Money Jar — Mathematical Integrity & Earnings Model', () => {
  function makeMockSlip(overrides?: Partial<PayslipDTO>): PayslipDTO {
    return {
      id: 'slip-123',
      workerId: 'worker-1',
      workerName: 'Ravi Kumar',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      status: 'issued',
      issuedAt: '2026-11-01T10:00:00.000Z',
      synthetic: true,
      currency: 'INR',
      breakdown: {
        hourlyRateMinor: 15000, // ₹150.00 / hr
        scheduledDailyMinutes: 480, // 8 hours
        regularMinutes: 9600, // 20 days * 8h = 160h
        overtimeMinutes: 1200, // 20h
        overtimeMultiplierBp: 15000, // 1.5x
        basePayMinor: 2400000, // 160h * ₹150 = ₹24,000.00
        overtimePayMinor: 450000, // 20h * ₹150 * 1.5 = ₹4,500.00
        grossPayMinor: 2850000, // ₹28,500.00
        deductions: [
          {
            code: 'canteen',
            label: 'Canteen Meals',
            kind: 'fixed',
            value: 120000,
            amountMinor: 120000,
            capped: false,
          },
        ],
        totalDeductionsMinor: 120000, // ₹1,200.00
        netPayMinor: 2730000, // ₹27,300.00
        days: Array.from({ length: 20 }, (_, i) => ({
          date: `2026-10-${String(i + 1).padStart(2, '0')}`,
          workedMinutes: 540,
          regularMinutes: 480,
          overtimeMinutes: 60,
          shiftCount: 1,
        })),
        openShiftsExcluded: 0,
      },
      ...overrides,
    };
  }

  it('correctly maps base, overtime, deductions and net payable without paise drift', () => {
    const slip = makeMockSlip();
    const model = deriveMoneyJarModel(slip);

    expect(model.isZeroEarnings).toBe(false);
    expect(model.basePayMinor).toBe(2400000);
    expect(model.overtimePayMinor).toBe(450000);
    expect(model.grossPayMinor).toBe(2850000);
    expect(model.totalDeductionsMinor).toBe(120000);
    expect(model.netPayMinor).toBe(2730000);

    // Sum invariant: base + overtime = gross
    expect(model.basePayMinor + model.overtimePayMinor).toBe(model.grossPayMinor);
    // Net invariant: gross - deductions = net
    expect(model.grossPayMinor - model.totalDeductionsMinor).toBe(model.netPayMinor);
  });

  it('normalizes layer percentages accurately for visual representation', () => {
    const slip = makeMockSlip();
    const model = deriveMoneyJarModel(slip);

    const baseLayer = model.layers.find((l) => l.id === 'base');
    const otLayer = model.layers.find((l) => l.id === 'overtime');
    const dedLayer = model.layers.find((l) => l.id === 'deduction');
    const netLayer = model.layers.find((l) => l.id === 'net');

    expect(baseLayer?.percentage).toBe(84); // 24000 / 28500 * 100 = 84.21% -> 84%
    expect(otLayer?.percentage).toBe(16); // 100 - 84 = 16%
    expect(baseLayer!.percentage + otLayer!.percentage).toBe(100);

    expect(dedLayer?.percentage).toBe(4); // 1200 / 28500 * 100 = 4.21% -> 4%
    expect(netLayer?.percentage).toBe(96); // 27300 / 28500 * 100 = 95.78% -> 96%
  });

  it('handles zero earnings gracefully without division by zero', () => {
    const slip = makeMockSlip({
      status: 'preview',
      breakdown: {
        hourlyRateMinor: 15000,
        scheduledDailyMinutes: 480,
        regularMinutes: 0,
        overtimeMinutes: 0,
        overtimeMultiplierBp: 15000,
        basePayMinor: 0,
        overtimePayMinor: 0,
        grossPayMinor: 0,
        deductions: [],
        totalDeductionsMinor: 0,
        netPayMinor: 0,
        days: [],
        openShiftsExcluded: 0,
      },
    });

    const model = deriveMoneyJarModel(slip);
    expect(model.isZeroEarnings).toBe(true);
    expect(model.basePayMinor).toBe(0);
    expect(model.grossPayMinor).toBe(0);
    expect(model.netPayMinor).toBe(0);
    model.layers.forEach((l) => expect(l.percentage).toBe(0));
    expect(model.comparison.agreed.isAvailable).toBe(false);
  });

  it('calculates Agreed vs Worked vs Paid comparison reliably', () => {
    const slip = makeMockSlip();
    const model = deriveMoneyJarModel(slip);

    // Agreed
    expect(model.comparison.agreed.isAvailable).toBe(true);
    expect(model.comparison.agreed.workedDaysCount).toBe(20);
    // 20 days * 8h = 160h * ₹150 = ₹24,000.00
    expect(model.comparison.agreed.expectedBasePayMinor).toBe(2400000);

    // Worked
    expect(model.comparison.worked.regularMinutes).toBe(9600);
    expect(model.comparison.worked.overtimeMinutes).toBe(1200);
    expect(model.comparison.worked.totalWorkedMinutes).toBe(10800); // 180h
    expect(model.comparison.worked.grossPayMinor).toBe(2850000);

    // Paid
    expect(model.comparison.paid.status).toBe('approved_payable');
    expect(model.comparison.paid.payableAmountMinor).toBe(2730000);
    // FairShift holds no payment records, so disbursed and outstanding are unknown — not ₹0 / full net
    expect(model.comparison.paid.paymentRecorded).toBe(false);
    expect(model.comparison.paid.disbursedAmountMinor).toBeNull();
    expect(model.comparison.paid.outstandingAmountMinor).toBeNull();
  });

  it('clearly marks unfinalized preview status as pending approval', () => {
    const slip = makeMockSlip({ status: 'preview', issuedAt: null });
    const model = deriveMoneyJarModel(slip);

    expect(model.status).toBe('preview');
    expect(model.comparison.paid.status).toBe('pending_approval');
    expect(model.comparison.paid.defaultStatusLabel).toContain('Pending Final Approval');
  });

  it('preserves capped deduction flags from domain breakdown', () => {
    const slip = makeMockSlip();
    slip.breakdown.deductions.push({
      code: 'uniform',
      label: 'Safety Boots & Vest',
      kind: 'fixed',
      value: 500000,
      amountMinor: 300000,
      capped: true,
    });
    const model = deriveMoneyJarModel(slip);

    const uniform = model.deductionLines.find((d) => d.code === 'uniform');
    expect(uniform?.capped).toBe(true);
    expect(uniform?.amountMinor).toBe(300000);
  });
});
