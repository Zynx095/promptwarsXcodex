import { useState, useEffect } from 'react';
import { CheckCircle2, ShieldAlert, ShieldCheck, History, ArrowRight } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { formatDate, formatDateTime, formatMinutes } from '../lib/format';
import { formatMoney } from '../../shared/money';
import { useMe } from '../lib/session';
import type { WorkReceiptDTO } from '../../shared/types';
import { Badge, Button, Card, Loading, Notice } from './ui';

export function ReceiptModal({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const me = useMe();
  const receipts = useApi<{ current: WorkReceiptDTO | null; history: WorkReceiptDTO[] }>(`/receipts/shift/${shiftId}`);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null);

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
      const res = await api<{ verified: boolean }>(`/receipts/${receiptId}/verify`);
      setVerifyResult(res.verified);
    } catch {
      setVerifyResult(false);
    } finally {
      setVerifying(false);
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

            {/* Cryptographic Digest & Tamper Verification */}
            <div className="card p-3 m-0 bg-aubergine/5">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold uppercase tracking-wider text-muted">{t('receipt.digest')}</span>
                {verifyResult === true || (verifyResult === null && activeReceipt.verified) ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-emerald-800">
                    <ShieldCheck style={{ width: 14, height: 14 }} aria-hidden="true" />
                    {t('receipt.verified')}
                  </span>
                ) : verifyResult === false ? (
                  <span className="flex items-center gap-1 text-xs font-bold text-ruby-700">
                    <ShieldAlert style={{ width: 14, height: 14 }} aria-hidden="true" />
                    {t('receipt.tampered')}
                  </span>
                ) : null}
              </div>
              <code className="block p-2 rounded bg-black/5 font-mono text-xs break-all mb-2">{activeReceipt.canonicalDigest}</code>
              <div className="flex justify-end">
                <Button variant="secondary" className="btn btn-secondary btn-sm" busy={verifying} onClick={() => handleVerify(activeReceipt.id)}>
                  <CheckCircle2 className="icon" aria-hidden="true" style={{ width: 14, height: 14 }} />
                  {verifying ? t('receipt.verifying') : t('receipt.verifyAction')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="dialog-actions mt-4">
          <Button variant="primary" onClick={onClose}>
            {t('receipt.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
