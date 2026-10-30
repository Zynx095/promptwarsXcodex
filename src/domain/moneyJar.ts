// Money Jar domain model: transforms verified payslip breakdowns into an accessible,
// visually intuitive earnings representation and an Agreed vs Worked vs Paid comparison.
// Uses integer paise arithmetic and shared rounding invariants (no floating point drift).
import { divRoundHalfUp, payForMinutes } from '../shared/money';
import type { PayslipDTO } from '../shared/types';

export interface MoneyJarLayer {
  id: 'base' | 'overtime' | 'deduction' | 'net';
  labelKey: string;
  defaultLabel: string;
  amountMinor: number;
  percentage: number;
  tone: 'emerald' | 'amber' | 'rose' | 'aubergine';
  icon: 'wallet' | 'clock-fast' | 'minus-circle' | 'check-circle';
}

export interface AgreedComparison {
  isAvailable: boolean;
  hourlyRateMinor: number;
  scheduledDailyMinutes: number;
  workedDaysCount: number;
  expectedBasePayMinor: number;
  unavailableReason?: string;
}

export interface WorkedComparison {
  regularMinutes: number;
  overtimeMinutes: number;
  totalWorkedMinutes: number;
  grossPayMinor: number;
  basePayMinor: number;
  overtimePayMinor: number;
}

export interface PaidComparison {
  status: 'pending_approval' | 'approved_payable' | 'disbursed';
  statusLabelKey: string;
  defaultStatusLabel: string;
  /** False: FairShift records approved payroll, not bank or cash disbursements. */
  paymentRecorded: boolean;
  /** Null when no payment record exists — never assumed to be zero. */
  disbursedAmountMinor: number | null;
  /** Null when no payment record exists, since the outstanding balance is then unknown. */
  outstandingAmountMinor: number | null;
  /** Net amount payable for the period according to the payslip (estimated until issued). */
  payableAmountMinor: number;
  netPayMinor: number;
}

export interface MoneyJarModel {
  currency: string;
  isZeroEarnings: boolean;
  basePayMinor: number;
  overtimePayMinor: number;
  grossPayMinor: number;
  totalDeductionsMinor: number;
  netPayMinor: number;
  layers: MoneyJarLayer[];
  deductionLines: Array<{
    code: string;
    label: string;
    amountMinor: number;
    capped: boolean;
  }>;
  status: 'preview' | 'issued';
  comparison: {
    agreed: AgreedComparison;
    worked: WorkedComparison;
    paid: PaidComparison;
  };
}

/**
 * Derives a pure, mathematically verified Money Jar representation from an existing PayslipDTO.
 * All amounts match the underlying payslip down to the exact paise.
 */
export function deriveMoneyJarModel(slip: PayslipDTO): MoneyJarModel {
  const b = slip.breakdown;
  const gross = b.grossPayMinor;
  const isZeroEarnings = gross === 0 && b.totalDeductionsMinor === 0;

  // Layer percentages normalized against gross inflow:
  let basePercent = 0;
  let overtimePercent = 0;
  let deductionPercent = 0;
  let netPercent = 0;

  if (gross > 0) {
    basePercent = divRoundHalfUp(b.basePayMinor * 100, gross);
    overtimePercent = divRoundHalfUp(b.overtimePayMinor * 100, gross);
    // Ensure base + overtime = 100%
    if (basePercent + overtimePercent !== 100 && (b.basePayMinor > 0 || b.overtimePayMinor > 0)) {
      overtimePercent = 100 - basePercent;
    }
    deductionPercent = Math.min(100, divRoundHalfUp(b.totalDeductionsMinor * 100, gross));
    netPercent = Math.max(0, divRoundHalfUp(b.netPayMinor * 100, gross));
  }

  const layers: MoneyJarLayer[] = [
    {
      id: 'base',
      labelKey: 'jar.baseWages',
      defaultLabel: 'Base Wages',
      amountMinor: b.basePayMinor,
      percentage: basePercent,
      tone: 'emerald',
      icon: 'wallet',
    },
    {
      id: 'overtime',
      labelKey: 'jar.overtimeWages',
      defaultLabel: 'Overtime Earnings',
      amountMinor: b.overtimePayMinor,
      percentage: overtimePercent,
      tone: 'amber',
      icon: 'clock-fast',
    },
    {
      id: 'deduction',
      labelKey: 'jar.deductions',
      defaultLabel: 'Authorized Deductions',
      amountMinor: b.totalDeductionsMinor,
      percentage: deductionPercent,
      tone: 'rose',
      icon: 'minus-circle',
    },
    {
      id: 'net',
      labelKey: 'jar.netPayable',
      defaultLabel: 'Net Payable',
      amountMinor: b.netPayMinor,
      percentage: netPercent,
      tone: 'aubergine',
      icon: 'check-circle',
    },
  ];

  // Agreed calculation: Expected base wages for the scheduled days
  const workedDaysCount = b.days.length;
  const isAgreedAvailable = b.hourlyRateMinor > 0 && b.scheduledDailyMinutes > 0 && workedDaysCount > 0;
  const expectedScheduledMinutes = workedDaysCount * b.scheduledDailyMinutes;
  const expectedBasePayMinor = isAgreedAvailable ? payForMinutes(expectedScheduledMinutes, b.hourlyRateMinor) : 0;

  const agreed: AgreedComparison = {
    isAvailable: isAgreedAvailable,
    hourlyRateMinor: b.hourlyRateMinor,
    scheduledDailyMinutes: b.scheduledDailyMinutes,
    workedDaysCount,
    expectedBasePayMinor,
    unavailableReason: isAgreedAvailable ? undefined : 'No scheduled work days or rate configured for this period',
  };

  const worked: WorkedComparison = {
    regularMinutes: b.regularMinutes,
    overtimeMinutes: b.overtimeMinutes,
    totalWorkedMinutes: b.regularMinutes + b.overtimeMinutes,
    grossPayMinor: b.grossPayMinor,
    basePayMinor: b.basePayMinor,
    overtimePayMinor: b.overtimePayMinor,
  };

  // Payment status derivation
  const isIssued = slip.status === 'issued';
  const paid: PaidComparison = {
    status: isIssued ? 'approved_payable' : 'pending_approval',
    statusLabelKey: isIssued ? 'jar.statusApproved' : 'jar.statusPending',
    defaultStatusLabel: isIssued ? 'Approved for Payment' : 'Estimated — Pending Final Approval',
    paymentRecorded: false,
    disbursedAmountMinor: null,
    outstandingAmountMinor: null,
    payableAmountMinor: b.netPayMinor,
    netPayMinor: b.netPayMinor,
  };

  return {
    currency: slip.currency || 'INR',
    isZeroEarnings,
    basePayMinor: b.basePayMinor,
    overtimePayMinor: b.overtimePayMinor,
    grossPayMinor: b.grossPayMinor,
    totalDeductionsMinor: b.totalDeductionsMinor,
    netPayMinor: b.netPayMinor,
    layers,
    deductionLines: b.deductions.map((d) => ({
      code: d.code,
      label: d.label,
      amountMinor: d.amountMinor,
      capped: d.capped,
    })),
    status: slip.status,
    comparison: {
      agreed,
      worked,
      paid,
    },
  };
}
