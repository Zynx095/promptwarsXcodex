// Possible pay shortfall indicator. Shows the arithmetic, not just a verdict: verified hours at the
// configured rate (the same calculation as the payslip), what the employer recorded as paid, and
// the difference. It is an indicator for a conversation, not a legal finding.
import { useState } from 'react';
import { CircleAlert, CircleCheck, CircleHelp, Scale, TriangleAlert } from 'lucide-react';
import { useI18n, useMoney, type MessageKey } from '../lib/i18n';
import { useApi } from '../lib/useApi';
import { qs } from '../lib/api';
import { formatDate, formatMinutes, formatPeriod, hoursDecimal } from '../lib/format';
import { formatMultiplier } from '../../shared/money';
import { addDays } from '../../shared/time';
import type { PayCheckDTO, PaymentMethod, ShortfallStatus } from '../../shared/types';
import { Async } from './ui';

export const SHORTFALL_STATUS: Record<ShortfallStatus, { key: MessageKey; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  no_discrepancy: { key: 'paycheck.statusOk', tone: 'good' },
  possible_shortfall: { key: 'paycheck.statusPossible', tone: 'warn' },
  requires_review: { key: 'paycheck.statusReview', tone: 'bad' },
  unavailable: { key: 'paycheck.statusUnavailable', tone: 'neutral' },
};

const METHOD: Record<PaymentMethod, MessageKey> = {
  cash: 'paycheck.methodCash',
  bank_transfer: 'paycheck.methodBank',
  upi: 'paycheck.methodUpi',
  cheque: 'paycheck.methodCheque',
  other: 'paycheck.methodOther',
};

function StatusIcon({ status }: { status: ShortfallStatus }) {
  if (status === 'no_discrepancy') return <CircleCheck className="icon" aria-hidden="true" />;
  if (status === 'possible_shortfall') return <TriangleAlert className="icon" aria-hidden="true" />;
  if (status === 'requires_review') return <CircleAlert className="icon" aria-hidden="true" />;
  return <CircleHelp className="icon" aria-hidden="true" />;
}

export function ShortfallBadge({ status }: { status: ShortfallStatus }) {
  const { t } = useI18n();
  const s = SHORTFALL_STATUS[status];
  return <span className={`badge badge-${s.tone}`}>{t(s.key)}</span>;
}

export function PayCheckDetail({ check }: { check: PayCheckDTO }) {
  const { t, locale } = useI18n();
  const money = useMoney();
  const m = (minor: number) => money(minor, check.currency);
  const r = check.result;
  const e = r.expected;
  const s = SHORTFALL_STATUS[r.status];

  return (
    <div className={`paycheck paycheck-${r.status}`}>
      <p className={`paycheck-verdict tone-${s.tone}`}>
        <StatusIcon status={r.status} />
        <strong>{t(s.key)}</strong>
      </p>

      {r.status === 'unavailable' ? (
        <p className="paycheck-unavailable">{r.reasons.includes('rate_missing') ? t('paycheck.rateMissing') : t('paycheck.calcFailed')}</p>
      ) : (
        <dl className="paycheck-figures">
          <div>
            <dt>{t('paycheck.expected')}</dt>
            <dd className="figure">{m(e?.netPayMinor ?? 0)}</dd>
          </div>
          <div>
            <dt>{t('paycheck.recorded')}</dt>
            <dd className="figure">{m(r.recordedMinor)}</dd>
          </div>
          <div className={r.outstandingMinor > 0 ? 'is-gap' : undefined}>
            <dt>{r.overpaidMinor > 0 ? t('paycheck.overpaid') : t('paycheck.outstanding')}</dt>
            <dd className="figure">{m(r.overpaidMinor > 0 ? r.overpaidMinor : r.outstandingMinor)}</dd>
          </div>
        </dl>
      )}

      {r.reasons.includes('no_payment_recorded') ? <p className="paycheck-note">{t('paycheck.noPayments')}</p> : null}
      {check.openShiftsExcluded > 0 ? <p className="paycheck-note">{t('paycheck.openShifts', { count: check.openShiftsExcluded })}</p> : null}
      {check.excludedPayments.length > 0 ? <p className="paycheck-note">{t('paycheck.excluded', { count: check.excludedPayments.length })}</p> : null}

      {e ? (
        <details className="paycheck-calc">
          <summary>{t('paycheck.howCalculated')}</summary>
          <ol className="explain">
            <li>{t('paycheck.shifts', { count: check.shiftsCounted, hours: formatMinutes(e.regularMinutes + e.overtimeMinutes) })}</li>
            <li>{t('pay.explainBase', { hours: hoursDecimal(e.regularMinutes), rate: m(check.rate.hourlyRateMinor), amount: m(e.basePayMinor) })}</li>
            <li>
              {t('pay.explainOvertime', {
                hours: hoursDecimal(e.overtimeMinutes),
                rate: m(check.rate.hourlyRateMinor),
                multiplier: formatMultiplier(check.rate.overtimeMultiplierBp),
                amount: m(e.overtimePayMinor),
              })}
            </li>
            <li>{t('pay.explainNet', { gross: m(e.grossPayMinor), deductions: m(e.totalDeductionsMinor), net: m(e.netPayMinor) })}</li>
            <li>{t('paycheck.explainCompare', { expected: m(e.netPayMinor), recorded: m(r.recordedMinor), gap: m(r.outstandingMinor) })}</li>
          </ol>
        </details>
      ) : null}

      <h3 className="paycheck-subhead">{t('paycheck.payments')}</h3>
      {check.payments.length === 0 ? (
        <p className="muted small">{t('paycheck.noPaymentsShort')}</p>
      ) : (
        <ul className="paycheck-payments">
          {check.payments.map((p) => (
            <li key={p.id}>
              <span className="paycheck-pay-main">
                <strong className="figure">{m(p.amountMinor)}</strong>
                <span>
                  {p.kind === 'adjustment' ? `${t('paycheck.adjustment')}, ` : ''}
                  {t(METHOD[p.method])}, {formatDate(p.paidOn, locale)}
                </span>
              </span>
              <span className="paycheck-pay-meta">
                {formatPeriod(p.periodStart, p.periodEnd, locale)}
                {p.reference ? ` · ${p.reference}` : ''}
                {p.note ? ` · ${p.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="paycheck-disclaimer">{t('paycheck.disclaimer')}</p>
    </div>
  );
}

export interface PayPeriodOption {
  key: string;
  label: string;
  from: string;
  to: string;
}

/** The last full Monday-to-Sunday week before `today` (the demo's payslip cycle). */
export function lastFullWeek(today: string): { from: string; to: string } {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const from = addDays(today, -dow - 7);
  return { from, to: addDays(from, 6) };
}

/** This month, last month and recent payslip periods, for the worker's period picker. */
export function payPeriodOptions(
  today: string,
  payslips: { periodStart: string; periodEnd: string }[],
  label: (key: MessageKey, vars?: Record<string, string>) => string,
  locale: string,
): PayPeriodOption[] {
  const firstThis = `${today.slice(0, 8)}01`;
  const lastPrev = addDays(firstThis, -1);
  const options: PayPeriodOption[] = payslips.slice(0, 6).map((p) => ({
    key: `slip:${p.periodStart}:${p.periodEnd}`,
    label: label('paycheck.payslipPeriod', { period: formatPeriod(p.periodStart, p.periodEnd, locale) }),
    from: p.periodStart,
    to: p.periodEnd,
  }));
  options.push({ key: 'this-month', label: label('paycheck.thisMonth'), from: firstThis, to: today });
  options.push({ key: 'last-month', label: label('paycheck.lastMonth'), from: `${lastPrev.slice(0, 8)}01`, to: lastPrev });
  return options;
}

/** The worker's pay check: pick a period, see the calculation. */
export function PayCheckCard({ options, initialKey }: { options: PayPeriodOption[]; initialKey?: string }) {
  const { t } = useI18n();
  const [key, setKey] = useState(initialKey ?? options[0]?.key ?? 'this-month');
  const chosen = options.find((o) => o.key === key) ?? options[0];
  const check = useApi<PayCheckDTO>(chosen ? `/pay-check${qs({ from: chosen.from, to: chosen.to })}` : null);

  return (
    <section className="card paycheck-card" aria-labelledby="paycheck-title">
      <div className="paycheck-head">
        <h2 id="paycheck-title" className="card-title">
          <Scale className="icon" aria-hidden="true" />
          {t('paycheck.title')}
        </h2>
      </div>
      <p className="card-sub">{t('paycheck.intro')}</p>
      {options.length > 1 ? (
        <div className="field paycheck-period">
          <label htmlFor="paycheck-period">{t('paycheck.period')}</label>
          <select id="paycheck-period" value={chosen?.key} onChange={(e) => setKey(e.target.value)}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <Async state={check}>{(c) => <PayCheckDetail check={c} />}</Async>
      <p className="muted small m-0">{t('paycheck.nextStep')}</p>
    </section>
  );
}
