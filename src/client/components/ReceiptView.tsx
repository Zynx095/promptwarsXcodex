import { useState, useEffect } from 'react';
import { CheckCircle2, ShieldAlert, ShieldCheck, History, ArrowRight, Download, Link2, Printer } from 'lucide-react';
import { useI18n } from '../lib/i18n';

import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { formatDate, formatDateTime, formatMinutes } from '../lib/format';
import { formatMoney } from '../../shared/money';
import { useMe } from '../lib/session';
import type { IndependentVerificationBundle, WorkReceiptDTO } from '../../shared/types';
import { Badge, Button, Card, Loading, Notice } from './ui';

export function ReceiptModal({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const me = useMe();
  const receipts = useApi<{ current: WorkReceiptDTO | null; history: WorkReceiptDTO[] }>(`/receipts/shift/${shiftId}`);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null);
  const [anchoredState, setAnchoredState] = useState<boolean | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const activeReceipt =
    selectedVersion && receipts.data ? (receipts.data.history.find((r) => r.version === selectedVersion) ?? receipts.data.current) : receipts.data?.current;

  async function handleVerify(receiptId: string) {
    setVerifying(true);
    try {
      const endpoint = me.user.role === 'admin' ? `/admin/receipts/${receiptId}/verify` : `/receipts/${receiptId}/verify`;
      const res = await api<{ verified: boolean; anchored?: boolean; trustStatus?: string }>(endpoint);
      setVerifyResult(res.verified);
      setAnchoredState(res.anchored ?? null);
    } catch {
      setVerifyResult(false);
    } finally {
      setVerifying(false);
    }
  }

  async function handleExportBundle(receiptId: string) {
    setExporting(true);
    try {
      const endpoint = me.user.role === 'admin' ? `/admin/receipts/${receiptId}/bundle` : `/receipts/${receiptId}/bundle`;
      const bundle = await api<IndependentVerificationBundle>(endpoint);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fairshift-receipt-${receiptId}-proof-bundle.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('Proof bundle is not yet anchored in a finalized checkpoint batch.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-card" style={{ maxWidth: 640 }} role="dialog" aria-modal="true" aria-labelledby="receipt-title">
        <div className="row justify-between items-start mb-3">
          <div>
            <h3 id="receipt-title" className="dialog-title m-0">
              {t('receipt.title')}
            </h3>
            {activeReceipt ? (
              <p className="muted small m-0 mt-1">
                {formatDate(activeReceipt.data.checkInAt.slice(0, 10), locale)} · {t('receipt.version', { version: activeReceipt.version })}
              </p>
            ) : null}
          </div>
          {activeReceipt ? <Badge tone={activeReceipt.status === 'finalized' ? 'good' : 'warn'}>{t(`receipt.status.${activeReceipt.status}`)}</Badge> : null}
        </div>

        {receipts.loading && !receipts.data ? <Loading /> : null}

        {receipts.data && !receipts.data.current ? <Notice kind="info">No receipt available for this shift.</Notice> : null}

        {activeReceipt ? (
          <div className="flex flex-col gap-3">
            {/* Version History Selector */}
            {receipts.data && receipts.data.history.length > 1 ? (
              <div className="auth-tabs m-0">
                <span className="flex items-center gap-1 text-xs muted font-semibold px-2">
                  <History style={{ width: 14, height: 14 }} aria-hidden="true" />
                  {t('receipt.history')}:
                </span>
                {receipts.data.history.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`auth-tab-btn ${activeReceipt.version === r.version ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedVersion(r.version);
                      setVerifyResult(null);
                    }}
                  >
                    v{r.version} {r.version === receipts.data?.current?.version ? '(current)' : ''}
                  </button>
                ))}
              </div>
            ) : null}

            {/* Shift Recorded Timestamps */}
            <div className="card p-3 m-0" style={{ background: 'rgba(58, 15, 52, 0.03)' }}>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="muted block text-xs">{t('att.in')}</span>
                  <strong>{formatDateTime(activeReceipt.data.checkInAt, me.org.timezone, locale)}</strong>
                </div>
                <div>
                  <span className="muted block text-xs">{t('att.out')}</span>
                  <strong>{formatDateTime(activeReceipt.data.checkOutAt, me.org.timezone, locale)}</strong>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-aubergine/10 text-sm flex justify-between">
                <span className="muted">{t('att.hours')}</span>
                <strong>{formatMinutes(activeReceipt.data.durationMinutes)}</strong>
              </div>
            </div>

            {/* Correction Diff Audit Callout (if present) */}
            {activeReceipt.data.correction ? (
              <div className="alert alert-warning p-3 m-0">
                <div className="text-xs font-bold uppercase tracking-wider mb-1">{t('receipt.correctionTitle')}</div>
                <p className="text-sm m-0 mb-1">{t('receipt.correctedBy', { actor: activeReceipt.data.correction.correctedBy })}</p>
                <p className="text-sm m-0 mb-2 italic">&ldquo;{activeReceipt.data.correction.reason}&rdquo;</p>
                <div className="bg-white/80 rounded p-2 text-xs flex flex-col gap-1">
                  {activeReceipt.data.correction.changes.durationMinutes ? (
                    <div className="flex justify-between items-center">
                      <span>{t('att.hours')}</span>
                      <span className="font-mono flex items-center gap-1">
                        {formatMinutes(activeReceipt.data.correction.changes.durationMinutes.before)}
                        <ArrowRight style={{ width: 12, height: 12 }} aria-hidden="true" />
                        <strong>{formatMinutes(activeReceipt.data.correction.changes.durationMinutes.after)}</strong>
                      </span>
                    </div>
                  ) : null}
                  {activeReceipt.data.correction.changes.grossPayMinor ? (
                    <div className="flex justify-between items-center pt-1 border-t border-aubergine/10 font-semibold">
                      <span>{t('receipt.delta', { delta: '' })}</span>
                      <Badge tone={activeReceipt.data.correction.changes.grossPayMinor.deltaMinor >= 0 ? 'good' : 'warn'}>
                        {activeReceipt.data.correction.changes.grossPayMinor.deltaMinor >= 0 ? '+' : ''}
                        {formatMoney(activeReceipt.data.correction.changes.grossPayMinor.deltaMinor, activeReceipt.data.rules.currency)}
                      </Badge>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Transparent Calculation Breakdown */}
            <Card title={t('receipt.breakdown')} className="m-0 p-3">
              <div className="text-xs muted mb-2 flex flex-col gap-1">
                <span>{t('receipt.scheduled', { hours: formatMinutes(activeReceipt.data.rules.scheduledDailyMinutes) })}</span>
                <span>{t('receipt.rate', { rate: formatMoney(activeReceipt.data.rules.hourlyRateMinor, activeReceipt.data.rules.currency) })}</span>
              </div>
              <ul className="list-none p-0 m-0 flex flex-col gap-1 text-sm">
                <li className="flex justify-between py-1 border-b border-aubergine/10">
                  <span>
                    {t('receipt.regularPay', {
                      hours: formatMinutes(activeReceipt.data.earnings.regularMinutes),
                      amount: '',
                    })}
                  </span>
                  <strong>{formatMoney(activeReceipt.data.earnings.basePayMinor, activeReceipt.data.rules.currency)}</strong>
                </li>
                {activeReceipt.data.earnings.overtimeMinutes > 0 ? (
                  <li className="flex justify-between py-1 border-b border-aubergine/10 text-amber-900">
                    <span>
                      {t('receipt.overtimePay', {
                        hours: formatMinutes(activeReceipt.data.earnings.overtimeMinutes),
                        multiplier: String(activeReceipt.data.rules.overtimeMultiplierBp / 10000),
                        amount: '',
                      })}
                    </span>
                    <strong>{formatMoney(activeReceipt.data.earnings.overtimePayMinor, activeReceipt.data.rules.currency)}</strong>
                  </li>
                ) : null}
                <li className="flex justify-between py-2 text-base font-bold text-aubergine">
                  <span>{t('receipt.gross', { amount: '' })}</span>
                  <span>{formatMoney(activeReceipt.data.earnings.grossPayMinor, activeReceipt.data.rules.currency)}</span>
                </li>
              </ul>
            </Card>

            {/* Plain-Language Worker Guarantee */}
            <div className="card p-3 m-0" style={{ background: 'rgba(234, 170, 0, 0.08)', borderColor: 'rgba(234, 170, 0, 0.3)' }}>
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck style={{ width: 16, height: 16, color: 'var(--c-navy)' }} aria-hidden="true" />
                <strong className="text-xs uppercase tracking-wider" style={{ color: 'var(--c-navy)' }}>
                  {t('receipt.guaranteeTitle') || 'FairShift Worker Guarantee'}
                </strong>
              </div>
              <p className="text-xs m-0" style={{ color: 'var(--c-heading)', lineHeight: 1.4 }}>
                {t('receipt.guaranteeText') ||
                  'This receipt is sealed with cryptographic math. Once issued, your employer cannot alter your hours, overtime, or pay calculation without creating a visible versioned trail.'}
              </p>
            </div>

            {/* Cryptographic Digest & Tamper Verification */}

            <div className="card p-3 m-0 bg-aubergine/5">
              {(() => {
                const isAnchored = anchoredState !== null ? anchoredState : Boolean(activeReceipt.anchored);
                return (
                  <>
                    <div className="flex justify-between items-center flex-wrap gap-2 mb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted">{t('receipt.digest')}</span>
                      <div className="flex items-center gap-2">
                        <Badge tone={isAnchored ? 'good' : 'info'}>
                          <Link2 style={{ width: 12, height: 12, marginRight: 4 }} aria-hidden="true" />
                          {isAnchored ? 'Merkle Anchored' : 'Pending Checkpoint'}
                        </Badge>
                        {verifyResult === true || (verifyResult === null && activeReceipt.verified) ? (
                          <span className="flex items-center gap-1 text-xs font-semibold text-emerald-800">
                            <ShieldCheck style={{ width: 14, height: 14 }} aria-hidden="true" />
                            {isAnchored ? 'Sealed & Anchored' : t('receipt.verified')}
                          </span>
                        ) : verifyResult === false ? (
                          <span className="flex items-center gap-1 text-xs font-bold text-ruby-700">
                            <ShieldAlert style={{ width: 14, height: 14 }} aria-hidden="true" />
                            {t('receipt.tampered')}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-xs muted m-0 mb-2">
                      {isAnchored
                        ? 'This receipt is included in a signed Merkle checkpoint. The exported bundle shows the inclusion path; confirming the checkpoint signature requires the organisation’s checkpoint key. The seal proves the record has not changed since it was issued, not that the original entry was correct.'
                        : 'This receipt is cryptographically sealed with the organization key. It will be batched into the next checkpoint.'}
                    </p>
                    <code className="block p-2 rounded bg-black/5 font-mono text-xs break-all mb-3">{activeReceipt.canonicalDigest}</code>
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      {isAnchored ? (
                        <Button variant="secondary" className="btn btn-secondary btn-sm" busy={exporting} onClick={() => handleExportBundle(activeReceipt.id)}>
                          <Download className="icon" aria-hidden="true" style={{ width: 14, height: 14 }} />
                          Export Proof Bundle
                        </Button>
                      ) : (
                        <span />
                      )}
                      <Button variant="secondary" className="btn btn-secondary btn-sm" busy={verifying} onClick={() => handleVerify(activeReceipt.id)}>
                        <CheckCircle2 className="icon" aria-hidden="true" style={{ width: 14, height: 14 }} />
                        {verifying ? t('receipt.verifying') : t('receipt.verifyAction')}
                      </Button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        ) : null}

        <div className="dialog-actions mt-4" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer style={{ width: 14, height: 14, marginRight: 4 }} aria-hidden="true" />
            <span>{t('pay.print') || 'Print'}</span>
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('receipt.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
