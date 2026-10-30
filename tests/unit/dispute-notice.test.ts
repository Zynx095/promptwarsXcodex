import { describe, expect, it } from 'vitest';
import { buildWageDisputeNotice, LEGAL_DISCLAIMER, STATUTORY_CONTEXT_NOTE } from '../../src/domain/dispute';

describe('FairShift Worker Labour Dispute Notice — Domain & Privacy Verification', () => {
  const sampleInput = {
    workerName: 'Ravi Kumar',
    workerPhone: '9000000001',
    workerJobTitle: 'Mason Grade II',
    employerName: 'Apex Infrastructure Ltd',
    employerIndustry: 'construction',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-15',
    currency: 'INR',
    hourlyRateMinor: 15000, // ₹150/hr
    scheduledDailyMinutes: 480, // 8h
    regularMinutes: 4800, // 80h
    overtimeMinutes: 900, // 15h
    basePayMinor: 1200000, // ₹12,000
    overtimePayMinor: 337500, // ₹3,375 (1.5x)
    grossPayMinor: 1537500,
    totalDeductionsMinor: 100000, // ₹1,000
    netPayMinor: 1437500, // ₹14,375
    outstandingMinor: 1437500,
    receiptId: 'rcpt_apex_ravi_1026',
    receiptDigest: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    discrepancyCategory: 'unpaid_overtime' as const,
    workerStatement: 'My 15 overtime hours completed during concrete pouring were not reflected in the cash disbursement given on Oct 20.',
    generatedAt: '2026-10-28T10:00:00.000Z',
  };

  it('builds a complete structured dispute notice with formatted currency and hours', () => {
    const notice = buildWageDisputeNotice(sampleInput);

    expect(notice.worker.name).toBe('Ravi Kumar');
    expect(notice.worker.phone).toBe('9000000001');
    expect(notice.employer.name).toBe('Apex Infrastructure Ltd');
    expect(notice.discrepancyLabel).toBe('Unpaid or Underpaid Overtime Hours');
    expect(notice.financialSummary.grossPayText).toContain('15,375.00');
    expect(notice.financialSummary.netPayText).toContain('14,375.00');
    expect(notice.attendanceSummary.overtimeHoursText).toContain('15 h');
    expect(notice.cryptographicProof.receiptId).toBe('rcpt_apex_ravi_1026');
    expect(notice.cryptographicProof.isSealed).toBe(true);
  });

  it('includes mandatory non-representation disclaimer and factual statutory context', () => {
    const notice = buildWageDisputeNotice(sampleInput);

    expect(notice.disclaimer).toBe(LEGAL_DISCLAIMER);
    expect(notice.disclaimer).toContain('does not constitute formal legal representation');
    expect(notice.disclaimer).not.toContain('legally certified');
    expect(notice.statutoryContext).toBe(STATUTORY_CONTEXT_NOTE);
    expect(notice.statutoryContext).toContain('Payment of Wages Act, 1936');
  });

  it('rejects short or empty worker statements', () => {
    expect(() =>
      buildWageDisputeNotice({
        ...sampleInput,
        workerStatement: 'Too short',
      }),
    ).toThrowError(/at least 10 characters/);

    expect(() =>
      buildWageDisputeNotice({
        ...sampleInput,
        workerStatement: '   ',
      }),
    ).toThrowError(/at least 10 characters/);
  });

  it('rejects missing worker name or employer name', () => {
    expect(() =>
      buildWageDisputeNotice({
        ...sampleInput,
        workerName: '',
      }),
    ).toThrowError(/Worker name is required/);

    expect(() =>
      buildWageDisputeNotice({
        ...sampleInput,
        employerName: '',
      }),
    ).toThrowError(/Employer name is required/);
  });

  it('strictly preserves worker privacy without leaking confidential safety metadata', () => {
    const notice = buildWageDisputeNotice(sampleInput);

    const serialized = JSON.stringify(notice);
    // Ensure no safety report, secret token or internal admin note fields exist in the notice
    expect(serialized).not.toContain('reporter_ref');
    expect(serialized).not.toContain('safety_reports');
    expect(serialized).not.toContain('pin_hash');
    expect(serialized).not.toContain('sessionSecret');
  });
});
