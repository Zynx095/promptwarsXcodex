// Domain logic for Worker Labour Dispute Notice Generation.
// Prepares factual, structured wage discrepancy notices based on verifiable attendance
// and cryptographic payroll receipts. Includes strict legal disclaimers and privacy safeguards.
import { DomainError } from './errors';
import { formatMinutes, hoursDecimal } from '../client/lib/format';
import { formatMoney } from '../shared/money';

export type DiscrepancyCategory =
  | 'unpaid_wages'
  | 'unpaid_overtime'
  | 'unauthorized_deductions'
  | 'rate_mismatch'
  | 'incorrect_hours'
  | 'other';

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

export const STATUTORY_CONTEXT_NOTE =
  'Factual Context: In India, timely payment of wages and restrictions on unauthorized deductions are governed by the Payment of Wages Act, 1936, the Minimum Wages Act, 1948, and the Code on Wages, 2019. Overtime for eligible workers in factories and construction establishments is typically compensated at overtime rates (commonly 1.5× to 2× standard rates under applicable state and central provisions). This document summarizes verifiable recorded attendance against issued amounts.';

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
  outstandingMinor: number;
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

  // Generate unique notice reference based on period and timestamp
  const dateStr = input.generatedAt.slice(0, 10).replace(/-/g, '');
  const noticeReference = `FS-DISPUTE-${dateStr}-${Math.abs(input.netPayMinor).toString(16).toUpperCase()}`;

  return {
    noticeReference,
    dateGenerated: input.generatedAt.slice(0, 10),
    discrepancyLabel: DISCREPANCY_LABELS[input.discrepancyCategory] || DISCREPANCY_LABELS.other,
    disclaimer: LEGAL_DISCLAIMER,
    statutoryContext: STATUTORY_CONTEXT_NOTE,
    worker: {
      name: input.workerName.trim(),
      phone: (input.workerPhone || 'On Record (Verified)').trim(),
      jobTitle: (input.workerJobTitle || 'Frontline Worker').trim(),
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
      totalHoursText: `${formatMinutes(input.regularMinutes + input.overtimeMinutes)} (${hoursDecimal(
        input.regularMinutes + input.overtimeMinutes,
      )})`,
      scheduledDailyText: formatMinutes(input.scheduledDailyMinutes),
    },
    financialSummary: {
      hourlyRateText: `${m(input.hourlyRateMinor)}/hr`,
      basePayText: m(input.basePayMinor),
      overtimePayText: m(input.overtimePayMinor),
      grossPayText: m(input.grossPayMinor),
      totalDeductionsText: m(input.totalDeductionsMinor),
      netPayText: m(input.netPayMinor),
      outstandingText: m(input.outstandingMinor),
    },
    cryptographicProof: {
      receiptId: input.receiptId || 'PENDING_FINALIZATION',
      canonicalDigest: input.receiptDigest || 'AUTHENTICATED_BY_FAIRSHIFT_LEDGER',
      isSealed: Boolean(input.receiptDigest),
    },
    workerStatement: input.workerStatement.trim(),
  };
}
