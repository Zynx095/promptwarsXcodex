// Pay dispute notice: the worker picks what is wrong and explains it in their own words, then
// reviews a printable notice built from the payslip record. The notice document itself (its
// wording, figures, disclaimer and statutory note) comes from domain/dispute and is not altered here.
import { useRef, useState } from 'react';
import { useI18n, type MessageKey } from '../lib/i18n';
import { useMe } from '../lib/session';
import type { PayslipDTO } from '../../shared/types';
import { buildWageDisputeNotice, type DiscrepancyCategory, DISCREPANCY_LABELS, type FormattedDisputeNotice } from '../../domain/dispute';
import { Button, Field, Notice } from './ui';
import { Sheet } from './Sheet';
import { DictateButton } from './Voice';
import { Printer, Download, ArrowLeft, Scale } from 'lucide-react';

const CATEGORIES = Object.keys(DISCREPANCY_LABELS) as DiscrepancyCategory[];

export function DisputeNoticeModal({ slip, isOpen, onClose }: { slip: PayslipDTO; isOpen: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const me = useMe();
  const statementRef = useRef<HTMLTextAreaElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);

  const [category, setCategory] = useState<DiscrepancyCategory>('unpaid_overtime');
  // Starts empty and is never filled in for the worker: the statement must be their own account.
  const [statement, setStatement] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

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
      payslipId: slip.id || undefined,
      payslipStatus: slip.status,
      discrepancyCategory: category,
      workerStatement: statement,
      generatedAt: new Date().toISOString(),
    });
  } catch {
    notice = null;
  }

  function handleProceedToPreview() {
    if (!statement.trim() || statement.trim().length < 10) {
      setValidationError(t('dispute.statementTooShort'));
      statementRef.current?.focus();
      return;
    }
    setValidationError(null);
    setPreviewMode(true);
    requestAnimationFrame(() => documentRef.current?.focus());
  }

  function backToDraft() {
    setPreviewMode(false);
    requestAnimationFrame(() => statementRef.current?.focus());
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
- Recorded Hourly Rate: ${notice.financialSummary.hourlyRateText}
- Base Pay: ${notice.financialSummary.basePayText}
- Overtime Earnings: ${notice.financialSummary.overtimePayText}
- Gross Earnings: ${notice.financialSummary.grossPayText}
- Recorded Deductions: ${notice.financialSummary.totalDeductionsText}
- Net Payable: ${notice.financialSummary.netPayText}
- Amount in Dispute: ${notice.financialSummary.outstandingText}

WORKER'S FACTUAL STATEMENT:
"${notice.workerStatement}"

RECORD REFERENCES:
- Payslip Reference: ${notice.recordReference.payslipId}
- Payslip Status: ${notice.recordReference.payslipStatusText}
- Sealed Work Receipt: ${notice.cryptographicProof.isSealed ? `${notice.cryptographicProof.receiptId} (${notice.cryptographicProof.canonicalDigest})` : notice.cryptographicProof.receiptId}

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

  const footer = !previewMode ? (
    <div className="form-actions dispute-actions">
      <Button variant="quiet" onClick={onClose}>
        {t('action.cancel')}
      </Button>
      <Button variant="primary" onClick={handleProceedToPreview}>
        {t('dispute.reviewNotice')}
      </Button>
    </div>
  ) : (
    <div className="form-actions dispute-actions">
      <Button variant="secondary" onClick={handleDownloadText}>
        <Download className="icon-sm" aria-hidden="true" />
        <span>{t('dispute.downloadText')}</span>
      </Button>
      <Button variant="primary" onClick={() => window.print()}>
        <Printer className="icon-sm" aria-hidden="true" />
        <span>{t('dispute.printPdf')}</span>
      </Button>
    </div>
  );

  return (
    <Sheet open={isOpen} onClose={onClose} title={t('dispute.title')} className="dispute-sheet" footer={footer}>
      {!previewMode ? (
        <div className="dispute-draft">
          <p className="m-0">{t('dispute.draftNotice')}</p>

          <fieldset className="form-step">
            <legend id="dispute-category">{t('dispute.categoryLabel')}</legend>
            <div className="choice-grid" role="radiogroup" aria-labelledby="dispute-category">
              {CATEGORIES.map((k) => (
                <label key={k} className="check">
                  <input type="radio" name="dispute-category" value={k} checked={category === k} onChange={() => setCategory(k)} />
                  <span>{t(`dispute.cat.${k}` as MessageKey)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="form-step">
            <Field label={t('dispute.statementLabel')} hint={t('dispute.statementHint')} error={validationError ?? undefined}>
              <textarea
                ref={statementRef}
                rows={4}
                value={statement}
                onChange={(e) => {
                  setStatement(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                maxLength={2000}
              />
            </Field>
            <p className="dispute-example">{t('dispute.example', { text: t(`dispute.example.${category}` as MessageKey) })}</p>
            <DictateButton onText={(text) => setStatement((s) => `${s}${s ? ' ' : ''}${text}`.slice(0, 2000))} />
          </div>

          <Notice kind="warning">
            <strong>{t('dispute.disclaimerTitle')}</strong> {t('dispute.disclaimerShort')}
          </Notice>
        </div>
      ) : notice ? (
        <div className="dispute-preview">
          <Button variant="quiet" className="btn btn-quiet btn-sm dispute-back" onClick={backToDraft}>
            <ArrowLeft className="icon-sm" aria-hidden="true" />
            <span>{t('dispute.editStatement')}</span>
          </Button>
          <p className="dispute-language">
            <Scale className="icon-sm" aria-hidden="true" />
            {t('dispute.englishNote')}
          </p>
          <div className="dispute-document" id="dispute-printable-area" ref={documentRef} tabIndex={-1} lang="en" aria-label={notice.noticeReference}>
            <div className="notice-document">
              <div className="notice-header">
                <div>
                  <h3 className="notice-heading">FACTUAL WAGE DISCREPANCY NOTICE</h3>
                  <span className="notice-ref">Ref: {notice.noticeReference}</span>
                </div>
                <div className="notice-date">
                  <span>Date: {notice.dateGenerated}</span>
                </div>
              </div>

              <hr className="notice-divider" />

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
                      <td>Recorded Hourly Rate:</td>
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
                      <td>Recorded Deductions:</td>
                      <td>
                        <strong>{notice.financialSummary.totalDeductionsText}</strong>
                      </td>
                    </tr>
                    <tr className="notice-row-emphasis">
                      <td>Net Payable Amount:</td>
                      <td>
                        <strong>{notice.financialSummary.netPayText}</strong>
                      </td>
                      <td>Amount in Dispute:</td>
                      <td>
                        <strong>{notice.financialSummary.outstandingText}</strong>
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
                <span className="notice-subhead">RECORD REFERENCES</span>
                <div className="notice-crypto-box">
                  <div>
                    <strong>Payslip Reference:</strong> <code>{notice.recordReference.payslipId}</code> ({notice.recordReference.payslipStatusText})
                  </div>
                  <div>
                    <strong>Sealed Work Receipt:</strong> <code className="text-break">{notice.cryptographicProof.receiptId}</code>
                  </div>
                  {notice.cryptographicProof.isSealed && (
                    <div>
                      <strong>HMAC Canonical Digest:</strong> <code className="text-break">{notice.cryptographicProof.canonicalDigest}</code>
                    </div>
                  )}
                </div>
              </div>

              <div className="notice-legal-footer">
                <p className="notice-disclaimer-text">{notice.disclaimer}</p>
                <p className="notice-statutory-text">{notice.statutoryContext}</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Notice kind="warning">{t('common.error')}</Notice>
      )}
    </Sheet>
  );
}
