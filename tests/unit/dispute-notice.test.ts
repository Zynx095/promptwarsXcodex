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

  it('states the Code on Wages, 2019 commencement and repeal without asserting rates, deadlines or entitlements', () => {
    const ctx = STATUTORY_CONTEXT_NOTE;
    expect(ctx).toContain('Code on Wages, 2019');
    expect(ctx).toContain('21 November 2025');
    expect(ctx).toContain('S.O. 5322(E)');
    expect(ctx).toMatch(/section 69/i);
    expect(ctx).toMatch(/repealed/);
    expect(ctx).toMatch(/not a legal conclusion/i);
    // The earlier note claimed overtime is "commonly 1.5× to 2×"; no rate or multiplier may be asserted.
    expect(ctx).not.toMatch(/\d(\.\d+)?\s*[×x]/);
    expect(ctx).not.toMatch(/within \d+ days/i);
  });

  it('never infers a claimed amount or a receipt seal that was not supplied', () => {
    const { outstandingMinor: _o, receiptId: _r, receiptDigest: _d, ...rest } = sampleInput;
    const notice = buildWageDisputeNotice({ ...rest, payslipId: 'ps_123', payslipStatus: 'preview' });
    expect(notice.financialSummary.outstandingText).toBe('Not specified (see worker statement)');
    expect(notice.cryptographicProof.isSealed).toBe(false);
    expect(notice.cryptographicProof.receiptId).toBe('Not linked to a sealed work receipt');
    expect(JSON.stringify(notice)).not.toContain('AUTHENTICATED_BY_FAIRSHIFT_LEDGER');
    expect(notice.recordReference).toEqual({ payslipId: 'ps_123', payslipStatusText: 'Estimate only (payslip not yet issued)' });
    // A digest alone, without the receipt it belongs to, is not presented as a seal
    expect(buildWageDisputeNotice({ ...rest, receiptDigest: 'ab'.repeat(32) }).cryptographicProof.isSealed).toBe(false);
  });

  it('does not mark unknown contact details as verified or encode pay in the reference', () => {
    const { workerPhone: _p, workerJobTitle: _j, ...rest } = sampleInput;
    const notice = buildWageDisputeNotice(rest);
    expect(notice.worker.phone).toBe('Not provided');
    expect(notice.worker.jobTitle).toBe('Not provided');
    expect(notice.noticeReference).toBe('FS-DISPUTE-20261028-100000');
    expect(notice.noticeReference).not.toContain(sampleInput.netPayMinor.toString(16).toUpperCase());
  });

  it('keeps Kannada, Hindi, Tamil, Telugu and Bengali text intact in names and statements', () => {
    const statement = 'ಓವರ್‌ಟೈಮ್ ವೇತನ ಬಾಕಿ ಇದೆ — ओवरटाइम बकाया — கூடுதல் நேரம் — ఓవర్‌టైమ్ — ওভারটাইম বকেয়া';
    const notice = buildWageDisputeNotice({ ...sampleInput, workerName: 'ರವಿ ಕುಮಾರ್', workerStatement: statement });
    expect(notice.worker.name).toBe('ರವಿ ಕುಮಾರ್');
    expect(notice.workerStatement).toBe(statement);
  });
});
