// Worker Labour Dispute Notice Generator Modal
// Prepares a factual, printable dispute notice derived from verified work receipts and payslip data.
// Adheres strictly to legal disclaimers: factual summary, non-representation, and privacy preservation.
import { useState, useId, useEffect } from 'react';
import { useI18n } from '../lib/i18n';
import { useMe } from '../lib/session';
import type { PayslipDTO } from '../../shared/types';
import { buildWageDisputeNotice, type DiscrepancyCategory, DISCREPANCY_LABELS, type FormattedDisputeNotice } from '../../domain/dispute';
import { Button, Notice } from './ui';
import { Printer, Download, FileText, AlertTriangle, ShieldCheck, ArrowLeft, X } from 'lucide-react';

export function DisputeNoticeModal({ slip, isOpen, onClose }: { slip: PayslipDTO; isOpen: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const me = useMe();
  const categoryId = useId();
  const statementId = useId();

  const [category, setCategory] = useState<DiscrepancyCategory>('unpaid_overtime');
  const [statement, setStatement] = useState(
    'My recorded overtime hours for this pay period were not paid according to our agreed terms. I request reconciliation and disbursement of the outstanding amount.',
  );
  const [previewMode, setPreviewMode] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  let notice: FormattedDisputeNotice | null = null;
  try {
    notice = buildWageDisputeNotice({
      workerName: me.user.name || slip.workerName,
      workerJobTitle: me.user.jobTitle || 'Frontline Staff',
      employerName: me.org.name,
      employerIndustry: me.org.industry,
      periodStart: slip.periodStart,
      periodEnd: slip.periodEnd,
      currency: slip.currency || 'INR',
      hourlyRateMinor: slip.breakdown.hourlyRateMinor,
      scheduledDailyMinutes: slip.breakdown.scheduledDailyMinutes,
      regularMinutes: slip.breakdown.regularMinutes,
      overtimeMinutes: slip.breakdown.overtimeMinutes,
      basePayMinor: slip.breakdown.basePayMinor,
      overtimePayMinor: slip.breakdown.overtimePayMinor,
      grossPayMinor: slip.breakdown.grossPayMinor,
      totalDeductionsMinor: slip.breakdown.totalDeductionsMinor,
      netPayMinor: slip.breakdown.netPayMinor,
      outstandingMinor: slip.breakdown.netPayMinor,
      receiptId: slip.id ? `rcpt_${slip.id.slice(0, 12)}` : undefined,
      discrepancyCategory: category,
      workerStatement: statement,
      generatedAt: new Date().toISOString(),
    });
  } catch {
    if (!previewMode) {
      // Just fallback during drafting
    }
  }

  function handleProceedToPreview() {
    if (!statement.trim() || statement.trim().length < 10) {
      setValidationError('Please provide a factual explanation of at least 10 characters.');
      return;
    }
    setValidationError(null);
    setPreviewMode(true);
  }

  function handleDownloadText() {
    if (!notice) return;
    const textContent = `
FAIRSHIFT WORKER WAGE DISCREPANCY NOTICE
Reference: ${notice.noticeReference}
Date: ${notice.dateGenerated}
------------------------------------------------------------
DISCREPANCY TYPE: ${notice.discrepancyLabel}

WORKER DETAILS:
- Name: ${notice.worker.name}
- Phone: ${notice.worker.phone}
- Job Title: ${notice.worker.jobTitle}

EMPLOYER DETAILS:
- Organization: ${notice.employer.name}
- Industry: ${notice.employer.industry}

PAY PERIOD: ${notice.period.start} to ${notice.period.end}

RECORDED ATTENDANCE & HOURS:
- Regular Hours: ${notice.attendanceSummary.regularHoursText}
- Overtime Hours: ${notice.attendanceSummary.overtimeHoursText}
- Total Recorded Hours: ${notice.attendanceSummary.totalHoursText}
- Daily Scheduled Hours: ${notice.attendanceSummary.scheduledDailyText}

FINANCIAL RECORD SUMMARY:
- Contracted Hourly Rate: ${notice.financialSummary.hourlyRateText}
- Base Pay: ${notice.financialSummary.basePayText}
- Overtime Earnings: ${notice.financialSummary.overtimePayText}
- Gross Earnings: ${notice.financialSummary.grossPayText}
- Authorized Deductions: ${notice.financialSummary.totalDeductionsText}
- Net Payable: ${notice.financialSummary.netPayText}
- Outstanding Amount Claimed: ${notice.financialSummary.outstandingText}

WORKER'S FACTUAL STATEMENT:
"${notice.workerStatement}"

CRYPTOGRAPHIC WORK RECEIPT ANCHOR:
- Receipt Identifier: ${notice.cryptographicProof.receiptId}
- Canonical Digest: ${notice.cryptographicProof.canonicalDigest}
- Ledger Sealed: ${notice.cryptographicProof.isSealed ? 'YES' : 'PENDING'}

------------------------------------------------------------
${notice.disclaimer}

${notice.statutoryContext}
    `.trim();

    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FairShift-Wage-Discrepancy-Notice-${notice.noticeReference}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-card dispute-modal-card" role="dialog" aria-modal="true" aria-labelledby="dispute-title">
        {/* Header */}
        <div className="dispute-modal-header">
          <div className="flex items-center gap-2">
            <FileText className="icon text-amber" aria-hidden="true" />
            <h3 id="dispute-title" className="dialog-title m-0">
              {t('dispute.title') || 'Worker Wage Discrepancy Notice Generator'}
            </h3>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close modal">
            <X className="icon-sm" aria-hidden="true" />
          </button>
        </div>

        {/* Content body */}
        <div className="dispute-modal-body">
          {!previewMode ? (
            /* Step 1: Draft Discrepancy Form */
            <div className="flex flex-col gap-4">
              <Notice kind="info">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="icon-sm mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="small">
                    {t('dispute.draftNotice') ||
                      'This tool generates a factual summary notice of your recorded hours, earnings, and unpaid discrepancies based on cryptographic FairShift receipts.'}
                  </span>
                </div>
              </Notice>

              <div className="field">
                <label htmlFor={categoryId}>{t('dispute.categoryLabel') || 'Discrepancy Category'}</label>
                <select
                  id={categoryId}
                  value={category}
                  onChange={(e) => {
                    const cat = e.target.value as DiscrepancyCategory;
                    setCategory(cat);
                    if (cat === 'unpaid_wages') {
                      setStatement('The net wages approved for this pay period have not been disbursed to me.');
                    } else if (cat === 'unpaid_overtime') {
                      setStatement('My overtime hours recorded during this pay period were underpaid or missing.');
                    } else if (cat === 'unauthorized_deductions') {
                      setStatement('Deductions applied to my earnings exceed authorized statutory amounts.');
                    } else if (cat === 'rate_mismatch') {
                      setStatement('The hourly wage rate applied on this payslip is lower than my contracted hourly rate.');
                    } else if (cat === 'incorrect_hours') {
                      setStatement('Recorded check-in and check-out times differ from the hours physically worked on site.');
                    }
                  }}
                >
                  {(Object.keys(DISCREPANCY_LABELS) as DiscrepancyCategory[]).map((k) => (
                    <option key={k} value={k}>
                      {DISCREPANCY_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>

              <div className={`field ${validationError ? 'has-error' : ''}`}>
                <label htmlFor={statementId}>{t('dispute.statementLabel') || 'Your Factual Explanation'}</label>
                <p className="hint">
                  {t('dispute.statementHint') || 'Describe the specific discrepancy factually. You can edit this before generating the notice.'}
                </p>
                <textarea
                  id={statementId}
                  rows={4}
                  value={statement}
                  onChange={(e) => {
                    setStatement(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  placeholder="Explain what happened..."
                  required
                />
                {validationError && <p className="field-error">{validationError}</p>}
              </div>

              <div className="dispute-legal-preview-note">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="icon-sm text-amber mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="small muted">
                    <strong>{t('dispute.disclaimerTitle') || 'Legal Disclaimer'}:</strong>{' '}
                    {t('dispute.disclaimerShort') ||
                      'This notice is a worker-prepared statement of recorded facts. It is not formal legal counsel or a certified statutory filing.'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* Step 2: Document Preview */
            notice && (
              <div className="dispute-document-preview" id="dispute-printable-area">
                <div className="notice-document">
                  {/* Notice Letterhead */}
                  <div className="notice-header">
                    <div>
                      <h2 className="notice-heading">FACTUAL WAGE DISCREPANCY NOTICE</h2>
                      <span className="notice-ref">Ref: {notice.noticeReference}</span>
                    </div>
                    <div className="notice-date">
                      <span>Date: {notice.dateGenerated}</span>
                    </div>
                  </div>

                  <hr className="notice-divider" />

                  {/* Summary Grid */}
                  <div className="notice-parties-grid">
                    <div>
                      <span className="notice-subhead">WORKER DETAILS</span>
                      <ul className="notice-list">
                        <li>
                          <strong>Name:</strong> {notice.worker.name}
                        </li>
                        <li>
                          <strong>Phone:</strong> {notice.worker.phone}
                        </li>
                        <li>
                          <strong>Designation:</strong> {notice.worker.jobTitle}
                        </li>
                      </ul>
                    </div>
                    <div>
                      <span className="notice-subhead">EMPLOYER / PRINCIPAL</span>
                      <ul className="notice-list">
                        <li>
                          <strong>Organization:</strong> {notice.employer.name}
                        </li>
                        <li>
                          <strong>Industry:</strong> {notice.employer.industry}
                        </li>
                        <li>
                          <strong>Pay Period:</strong> {notice.period.start} to {notice.period.end}
                        </li>
                      </ul>
                    </div>
                  </div>

                  <div className="notice-section">
                    <span className="notice-subhead">NATURE OF DISCREPANCY</span>
                    <p className="notice-highlight-box">{notice.discrepancyLabel}</p>
                  </div>

                  <div className="notice-section">
                    <span className="notice-subhead">RECORDED HOURS & WAGE RECONCILIATION</span>
                    <table className="notice-table">
                      <tbody>
                        <tr>
                          <td>Contracted Hourly Rate:</td>
                          <td>
                            <strong>{notice.financialSummary.hourlyRateText}</strong>
                          </td>
                          <td>Regular Hours Worked:</td>
                          <td>
                            <strong>{notice.attendanceSummary.regularHoursText}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td>Scheduled Daily Shift:</td>
                          <td>
                            <strong>{notice.attendanceSummary.scheduledDailyText}</strong>
                          </td>
                          <td>Overtime Hours Worked:</td>
                          <td>
                            <strong>{notice.attendanceSummary.overtimeHoursText}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td>Base Wages Earned:</td>
                          <td>
                            <strong>{notice.financialSummary.basePayText}</strong>
                          </td>
                          <td>Overtime Pay Earned:</td>
                          <td>
                            <strong>{notice.financialSummary.overtimePayText}</strong>
                          </td>
                        </tr>
                        <tr>
                          <td>Gross Earnings:</td>
                          <td>
                            <strong>{notice.financialSummary.grossPayText}</strong>
                          </td>
                          <td>Authorized Deductions:</td>
                          <td>
                            <strong>{notice.financialSummary.totalDeductionsText}</strong>
                          </td>
                        </tr>
                        <tr className="notice-row-emphasis">
                          <td>Net Payable Amount:</td>
                          <td>
                            <strong>{notice.financialSummary.netPayText}</strong>
                          </td>
                          <td>Outstanding Wage Claimed:</td>
                          <td>
                            <strong className="text-good">{notice.financialSummary.outstandingText}</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="notice-section">
                    <span className="notice-subhead">WORKER FACTUAL EXPLANATION</span>
                    <p className="notice-statement">"{notice.workerStatement}"</p>
                  </div>

                  <div className="notice-section">
                    <span className="notice-subhead">CRYPTOGRAPHIC PROOF & INTEGRITY ANCHOR</span>
                    <div className="notice-crypto-box">
                      <div>
                        <strong>Receipt ID:</strong> <code>{notice.cryptographicProof.receiptId}</code>
                      </div>
                      <div>
                        <strong>HMAC Canonical Digest:</strong> <code className="text-break">{notice.cryptographicProof.canonicalDigest}</code>
                      </div>
                    </div>
                  </div>

                  <div className="notice-legal-footer">
                    <p className="notice-disclaimer-text">{notice.disclaimer}</p>
                    <p className="notice-statutory-text">{notice.statutoryContext}</p>
                  </div>
                </div>
              </div>
            )
          )}
        </div>

        {/* Footer actions */}
        <div className="dispute-modal-footer">
          {!previewMode ? (
            <div className="btn-group justify-end w-full">
              <Button variant="secondary" onClick={onClose}>
                {t('action.cancel')}
              </Button>
              <Button variant="primary" onClick={handleProceedToPreview}>
                {t('dispute.reviewNotice') || 'Review Notice Document'}
              </Button>
            </div>
          ) : (
            <div className="btn-group justify-between w-full">
              <Button variant="secondary" onClick={() => setPreviewMode(false)}>
                <ArrowLeft className="icon-sm" aria-hidden="true" />
                <span>{t('dispute.editStatement') || 'Edit Statement'}</span>
              </Button>
              <div className="btn-group">
                <Button variant="secondary" onClick={handleDownloadText}>
                  <Download className="icon-sm" aria-hidden="true" />
                  <span>{t('dispute.downloadText') || 'Download TXT'}</span>
                </Button>
                <Button variant="primary" onClick={() => window.print()}>
                  <Printer className="icon-sm" aria-hidden="true" />
                  <span>{t('dispute.printPdf') || 'Print / Save PDF'}</span>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
