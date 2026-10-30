// FairShift Proof: the receipt for one shift. The seal states exactly what the server checked
// (the record against its HMAC seal and, when present, its checkpoint) and what that does not
// prove. Cryptographic details stay in an expandable section for people who need them.
import { useState } from 'react';
import { CircleAlert, CircleCheck, Clock3, Download, Printer, RefreshCw } from 'lucide-react';
import { useI18n, useMoney } from '../lib/i18n';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { formatDate, formatDateTime, formatMinutes } from '../lib/format';
import { formatMultiplier } from '../../shared/money';
import { useMe } from '../lib/session';
import type { IndependentVerificationBundle, ReceiptVerificationResponse, VerificationTrustStatus, WorkReceiptDTO } from '../../shared/types';
import { Button, ErrorBox, Notice, Skeleton } from './ui';
import { Sheet } from './Sheet';

type SealTone = 'good' | 'pending' | 'bad' | 'caution' | 'checking';

function sealFor(status: VerificationTrustStatus | null, checking: boolean): SealTone {
  if (checking || status === null) return 'checking';
  if (status === 'valid_and_anchored') return 'good';
  if (status === 'valid_unanchored') return 'pending';
  if (status === 'invalid_digest') return 'bad';
  return 'caution';
}

function Seal({ tone }: { tone: SealTone }) {
  const Icon = tone === 'good' ? CircleCheck : tone === 'pending' ? Clock3 : tone === 'checking' ? RefreshCw : CircleAlert;
  return (
    <span className={`seal seal-${tone}`} aria-hidden="true">
      <Icon className="seal-icon" />
    </span>
  );
}

export function ReceiptModal({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const money = useMoney();
  const me = useMe();
  const base = me.user.role === 'admin' ? '/admin/receipts' : '/receipts';
  const receipts = useApi<{ current: WorkReceiptDTO | null; history: WorkReceiptDTO[] }>(`${base}/shift/${shiftId}`);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);

  const history = receipts.data?.history ?? [];
  const active = (selectedVersion !== null ? history.find((r) => r.version === selectedVersion) : null) ?? receipts.data?.current ?? null;
  // The seal of whichever version is on screen is checked as soon as it is shown.
  const verification = useApi<ReceiptVerificationResponse>(active ? `${base}/${active.id}` : null);

  async function exportBundle(receiptId: string) {
    setExporting(true);
    setExportError(false);
    try {
      const bundle = await api<IndependentVerificationBundle>(`${base}/${receiptId}/bundle`);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fairshift-receipt-${receiptId}-proof.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  const result = verification.data && active && verification.data.receipt.id === active.id ? verification.data : null;
  const status = result?.trustStatus ?? null;
  const failed = verification.error !== null;
  const tone: SealTone = failed ? 'caution' : sealFor(status, verification.loading);
  const checkpoint = result?.checkpoint ?? null;
  const title = active ? t('receipt.titleFor', { date: formatDate(active.data.checkInAt.slice(0, 10), locale) }) : t('receipt.title');

  const sealHeadline =
    tone === 'checking'
      ? t('proof.sealChecking')
      : tone === 'good' || tone === 'pending'
        ? t('proof.sealUnchanged')
        : tone === 'bad'
          ? t('proof.sealBroken')
          : failed
            ? t('proof.sealUnavailable')
            : t('proof.sealPartial');
  const sealDetail =
    tone === 'good' && checkpoint
      ? t('proof.sealAnchoredDetail', { sequence: checkpoint.sequence, date: formatDate(checkpoint.createdAt.slice(0, 10), locale) })
      : tone === 'pending'
        ? t('proof.sealUnanchoredDetail')
        : tone === 'bad'
          ? t('proof.sealBrokenDetail')
          : tone === 'caution'
            ? t('proof.sealPartialDetail')
            : '';

  const d = active?.data;
  const m = (minor: number) => money(minor, d?.rules.currency);
  const sortedHistory = [...history].sort((a, b) => b.version - a.version);
  const currentVersion = receipts.data?.current?.version;

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      className="receipt-sheet"
      footer={
        <>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="icon" aria-hidden="true" />
            {t('pay.print')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('receipt.close')}
          </Button>
        </>
      }
    >
      {receipts.error ? <ErrorBox error={receipts.error} onRetry={receipts.reload} /> : null}
      {receipts.loading && !receipts.data ? (
        <div className="receipt-loading">
          <Skeleton height={64} width="100%" />
          <Skeleton height={120} width="100%" />
        </div>
      ) : null}
      {receipts.data && !receipts.data.current ? <Notice kind="info">{t('receipt.none')}</Notice> : null}

      {active && d ? (
        <div className="receipt">
          <section className={`seal-panel seal-panel-${tone}`} aria-live="polite">
            <Seal tone={tone} />
            <div className="seal-text">
              <p className="seal-headline">{sealHeadline}</p>
              {sealDetail ? <p className="seal-detail">{sealDetail}</p> : null}
              <p className="seal-limits">{t('proof.sealLimits')}</p>
              {tone !== 'checking' ? (
                <button type="button" className="btn btn-link" onClick={verification.reload}>
                  {t('proof.checkAgain')}
                </button>
              ) : null}
            </div>
          </section>

          {selectedVersion !== null && selectedVersion !== currentVersion ? (
            <Notice kind="info">{t('receipt.viewingOld', { version: active.version })}</Notice>
          ) : null}

          <dl className="receipt-facts">
            <div>
              <dt>{t('att.in')}</dt>
              <dd className="figure">{formatDateTime(d.checkInAt, me.org.timezone, locale)}</dd>
            </div>
            <div>
              <dt>{t('att.out')}</dt>
              <dd className="figure">{formatDateTime(d.checkOutAt, me.org.timezone, locale)}</dd>
            </div>
            <div>
              <dt>{t('att.hours')}</dt>
              <dd className="figure">{formatMinutes(d.durationMinutes)}</dd>
            </div>
          </dl>

          <section aria-labelledby="receipt-pay">
            <h3 id="receipt-pay" className="receipt-heading">
              {t('receipt.payForShift')}
            </h3>
            <table className="ledger receipt-ledger">
              <tbody>
                <tr>
                  <th scope="row">
                    {t('pay.base')}
                    <span className="ledger-note">
                      {formatMinutes(d.earnings.regularMinutes)} × {m(d.rules.hourlyRateMinor)}
                    </span>
                  </th>
                  <td className="figure">{m(d.earnings.basePayMinor)}</td>
                </tr>
                {d.earnings.overtimeMinutes > 0 ? (
                  <tr>
                    <th scope="row">
                      {t('pay.overtimePay')}
                      <span className="ledger-note">
                        {formatMinutes(d.earnings.overtimeMinutes)} × {m(d.rules.hourlyRateMinor)} × {formatMultiplier(d.rules.overtimeMultiplierBp)}
                      </span>
                    </th>
                    <td className="figure">{m(d.earnings.overtimePayMinor)}</td>
                  </tr>
                ) : null}
                <tr className="ledger-total">
                  <th scope="row">{t('receipt.totalForShift')}</th>
                  <td className="figure">{m(d.earnings.grossPayMinor)}</td>
                </tr>
              </tbody>
            </table>
            <p className="receipt-note">{active.status === 'finalized' ? t('receipt.finalNote') : t('receipt.estimateNote')}</p>
          </section>

          {sortedHistory.length > 1 ? (
            <section aria-labelledby="receipt-versions">
              <h3 id="receipt-versions" className="receipt-heading">
                {t('receipt.changes')}
              </h3>
              <ol className="versions">
                {sortedHistory.map((r) => {
                  const c = r.data.correction;
                  const selected = r.id === active.id;
                  return (
                    <li key={r.id} className={selected ? 'is-selected' : undefined}>
                      <button type="button" className="version" aria-pressed={selected} onClick={() => setSelectedVersion(r.version)}>
                        <span className="version-title">
                          {r.version === currentVersion ? t('receipt.versionCurrent', { version: r.version }) : t('receipt.version', { version: r.version })}
                        </span>
                        {c ? (
                          <span className="version-body">
                            <span>{t('receipt.changedBy', { actor: c.correctedBy, date: formatDate(c.correctedAt.slice(0, 10), locale) })}</span>
                            <span className="version-reason">“{c.reason}”</span>
                            {c.changes.durationMinutes ? (
                              <span>
                                {t('receipt.hoursChange', {
                                  before: formatMinutes(c.changes.durationMinutes.before),
                                  after: formatMinutes(c.changes.durationMinutes.after),
                                })}
                              </span>
                            ) : null}
                            {c.changes.grossPayMinor ? (
                              <span>
                                {t('receipt.payChange', {
                                  before: m(c.changes.grossPayMinor.before),
                                  after: m(c.changes.grossPayMinor.after),
                                })}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="version-body">{t('receipt.versionOriginal', { date: formatDate(r.createdAt.slice(0, 10), locale) })}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          <details className="receipt-tech">
            <summary>{t('proof.technical')}</summary>
            <dl>
              <dt>{t('proof.digest')}</dt>
              <dd>
                <code>{active.canonicalDigest}</code>
              </dd>
              <dt>{t('proof.key')}</dt>
              <dd>
                <code>{active.keyId ?? 'v1'}</code>
              </dd>
              <dt>{t('proof.checkpoint')}</dt>
              <dd>
                {checkpoint ? (
                  <>
                    #{checkpoint.sequence}, {formatDateTime(checkpoint.createdAt, me.org.timezone, locale)}
                    <code className="block">{checkpoint.merkleRoot}</code>
                  </>
                ) : (
                  t('proof.noCheckpoint')
                )}
              </dd>
              <dt>{t('proof.status')}</dt>
              <dd>
                <code>{status ?? '—'}</code>
              </dd>
            </dl>
            {checkpoint ? (
              <>
                <p className="receipt-note">{t('proof.downloadHint')}</p>
                <Button variant="secondary" className="btn btn-secondary btn-sm" busy={exporting} onClick={() => void exportBundle(active.id)}>
                  <Download className="icon-sm" aria-hidden="true" />
                  {t('proof.downloadBundle')}
                </Button>
              </>
            ) : null}
            {exportError ? <p className="field-error">{t('proof.downloadFailed')}</p> : null}
          </details>
        </div>
      ) : null}
    </Sheet>
  );
}
