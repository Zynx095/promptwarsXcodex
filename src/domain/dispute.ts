// Domain logic for Worker Labour Dispute Notice Generation.
// Prepares factual, structured wage discrepancy notices based on verifiable attendance
// and cryptographic payroll receipts. Includes strict legal disclaimers and privacy safeguards.
import { DomainError } from './errors';
import { formatMinutes, hoursDecimal } from '../client/lib/format';
import { formatMoney } from '../shared/money';

export type DiscrepancyCategory = 'unpaid_wages' | 'unpaid_overtime' | 'unauthorized_deductions' | 'rate_mismatch' | 'incorrect_hours' | 'other';

export const DISCREPANCY_LABELS: Record<DiscrepancyCategory, string> = {
  unpaid_wages: 'Full or Partial Unpaid Net Wages',
  unpaid_overtime: 'Unpaid or Underpaid Overtime Hours',
  unauthorized_deductions: 'Disputed or Unauthorized Deductions',
  rate_mismatch: 'Wage Rate Lower Than Agreed Rate',
  incorrect_hours: 'Recorded Working Hours Discrepancy',
  other: 'General Payroll Discrepancy',
};

export const LEGAL_DISCLAIMER =
  'IMPORTANT NOTICE: This document is a worker-generated factual wage discrepancy statement derived from recorded timecard entries and FairShift cryptographic work receipts. It does not constitute formal legal representation, statutory certification, or legal advice. In the event of unresolved wage disputes, workers are advised to approach relevant labor conciliation authorities or legal aid institutions.';

/**
 * General legal context only. Verified against the Ministry of Labour and Employment notification
 * S.O. 5322(E) (21 Nov 2025) bringing the principal provisions of the Code on Wages, 2019 into force,
 * and section 69 of the Code (repeal and savings). It deliberately states no rates, deadlines or
 * entitlements: applicability depends on the employment, establishment and the appropriate
 * Government's rules, which this tool cannot determine.
 */
export const STATUTORY_CONTEXT_NOTE =
  'General context (not a legal conclusion): The principal provisions of the Code on Wages, 2019 came into force on 21 November 2025 (Ministry of Labour and Employment notification S.O. 5322(E)). Under section 69 of the Code, the Payment of Wages Act, 1936 and the Minimum Wages Act, 1948 are repealed, subject to its savings provisions, so matters arising earlier may still fall under those Acts. Whether and how any of these laws applies depends on the type of employment, the establishment and the rules of the appropriate Government. This notice records factual discrepancies between recorded attendance and recorded pay; it does not determine any legal entitlement, rate or time limit. Help is available from the local Labour Department (Inspector-cum-Facilitator) or a District Legal Services Authority.';

export interface WageDisputeNoticeInput {
  workerName: string;
  workerPhone?: string;
  workerJobTitle?: string;
  employerName: string;
  employerIndustry: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  hourlyRateMinor: number;
  scheduledDailyMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  basePayMinor: number;
  overtimePayMinor: number;
  grossPayMinor: number;
  totalDeductionsMinor: number;
  netPayMinor: number;
  /** Amount the worker states is in dispute. Never inferred: omitted means "see statement". */
  outstandingMinor?: number;
  payslipId?: string;
  payslipStatus?: 'preview' | 'issued';
  receiptId?: string;
  receiptDigest?: string;
  discrepancyCategory: DiscrepancyCategory;
  workerStatement: string;
  generatedAt: string;
}

export interface FormattedDisputeNotice {
  noticeReference: string;
  dateGenerated: string;
  discrepancyLabel: string;
  disclaimer: string;
  statutoryContext: string;
  worker: {
    name: string;
    phone: string;
    jobTitle: string;
  };
  employer: {
    name: string;
    industry: string;
  };
  period: {
    start: string;
    end: string;
  };
  attendanceSummary: {
    regularHoursText: string;
    overtimeHoursText: string;
    totalHoursText: string;
    scheduledDailyText: string;
  };
  financialSummary: {
    hourlyRateText: string;
    basePayText: string;
    overtimePayText: string;
    grossPayText: string;
    totalDeductionsText: string;
    netPayText: string;
    outstandingText: string;
  };
  recordReference: {
    payslipId: string;
    payslipStatusText: string;
  };
  cryptographicProof: {
    receiptId: string;
    canonicalDigest: string;
    isSealed: boolean;
  };
  workerStatement: string;
}

/**
 * Validates and formats a structured wage dispute notice.
 * Strictly avoids exposing confidential safety reports or unrelated administrative fields.
 */
export function buildWageDisputeNotice(input: WageDisputeNoticeInput): FormattedDisputeNotice {
  if (!input.workerName.trim()) {
    throw new DomainError('INVALID_DISPUTE_INPUT', 'Worker name is required.');
  }
  if (!input.employerName.trim()) {
    throw new DomainError('INVALID_DISPUTE_INPUT', 'Employer name is required.');
  }
  if (!input.workerStatement.trim() || input.workerStatement.trim().length < 10) {
    throw new DomainError('INVALID_DISPUTE_INPUT', 'A factual explanation statement of at least 10 characters is required.');
  }

  const currency = input.currency || 'INR';
  const m = (minor: number) => formatMoney(minor, currency);

  // Reference from the generation timestamp (it must not encode pay amounts)
  const dateStr = input.generatedAt.slice(0, 10).replace(/-/g, '');
  const timeStr = input.generatedAt.slice(11, 19).replace(/:/g, '');
  const noticeReference = `FS-DISPUTE-${dateStr}-${timeStr || '000000'}`;

  return {
    noticeReference,
    dateGenerated: input.generatedAt.slice(0, 10),
    discrepancyLabel: DISCREPANCY_LABELS[input.discrepancyCategory] || DISCREPANCY_LABELS.other,
    disclaimer: LEGAL_DISCLAIMER,
    statutoryContext: STATUTORY_CONTEXT_NOTE,
    worker: {
      name: input.workerName.trim(),
      phone: (input.workerPhone || 'Not provided').trim(),
      jobTitle: (input.workerJobTitle || 'Not provided').trim(),
    },
    employer: {
      name: input.employerName.trim(),
      industry: input.employerIndustry.trim(),
    },
    period: {
      start: input.periodStart,
      end: input.periodEnd,
    },
    attendanceSummary: {
      regularHoursText: `${formatMinutes(input.regularMinutes)} (${hoursDecimal(input.regularMinutes)})`,
      overtimeHoursText: `${formatMinutes(input.overtimeMinutes)} (${hoursDecimal(input.overtimeMinutes)})`,
      totalHoursText: `${formatMinutes(input.regularMinutes + input.overtimeMinutes)} (${hoursDecimal(input.regularMinutes + input.overtimeMinutes)})`,
      scheduledDailyText: formatMinutes(input.scheduledDailyMinutes),
    },
    financialSummary: {
      hourlyRateText: `${m(input.hourlyRateMinor)}/hr`,
      basePayText: m(input.basePayMinor),
      overtimePayText: m(input.overtimePayMinor),
      grossPayText: m(input.grossPayMinor),
      totalDeductionsText: m(input.totalDeductionsMinor),
      netPayText: m(input.netPayMinor),
      outstandingText:
        typeof input.outstandingMinor === 'number' && Number.isSafeInteger(input.outstandingMinor) && input.outstandingMinor >= 0
          ? m(input.outstandingMinor)
          : 'Not specified (see worker statement)',
    },
    recordReference: {
      payslipId: input.payslipId || 'Not available',
      payslipStatusText:
        input.payslipStatus === 'issued' ? 'Issued payslip' : input.payslipStatus === 'preview' ? 'Estimate only (payslip not yet issued)' : 'Unknown',
    },
    cryptographicProof: {
      receiptId: input.receiptId || 'Not linked to a sealed work receipt',
      canonicalDigest: input.receiptDigest || 'Not available',
      isSealed: Boolean(input.receiptId && input.receiptDigest),
    },
    workerStatement: input.workerStatement.trim(),
  };
}
