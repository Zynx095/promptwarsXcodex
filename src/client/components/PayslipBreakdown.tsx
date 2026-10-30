// The pay statement: a ruled ledger of hours, earnings and deductions with a plain-language
// walk-through of every step. All figures come from the server's breakdown.
import { useId } from 'react';
import { useI18n, useMoney } from '../lib/i18n';
import { formatDate, formatMinutes, formatPeriod, hoursDecimal } from '../lib/format';
import { formatMultiplier, formatPercent } from '../../shared/money';
import type { DeductionLine, PayslipDTO } from '../../shared/types';
import { Notice } from './ui';
import { ReadAloudButton } from './Voice';
import { WeekStrip } from './WeekStrip';

export function PayslipBreakdown({ slip }: { slip: PayslipDTO }) {
  const { t, locale } = useI18n();
  const money = useMoney();
  const id = useId();
  const b = slip.breakdown;
  const m = (minor: number) => money(minor, slip.currency);
  const issued = slip.status === 'issued' && slip.issuedAt;

  const deductionBasis = (d: DeductionLine) =>
    d.kind === 'fixed'
      ? t('pay.dedFixed')
      : t(d.kind === 'percent_of_base' ? 'pay.dedPercentBase' : 'pay.dedPercentGross', { percent: formatPercent(d.value) });

  const steps = [
    `${t('pay.explainHours', {
      regular: formatMinutes(b.regularMinutes),
      overtime: formatMinutes(b.overtimeMinutes),
      from: formatDate(slip.periodStart, locale),
      to: formatDate(slip.periodEnd, locale),
    })} ${t('pay.explainRule', { scheduled: formatMinutes(b.scheduledDailyMinutes) })}`,
    t('pay.explainBase', { hours: hoursDecimal(b.regularMinutes), rate: m(b.hourlyRateMinor), amount: m(b.basePayMinor) }),
    t('pay.explainOvertime', {
      hours: hoursDecimal(b.overtimeMinutes),
      rate: m(b.hourlyRateMinor),
      multiplier: formatMultiplier(b.overtimeMultiplierBp),
      amount: m(b.overtimePayMinor),
    }),
    ...b.deductions.map((d) => `${d.label}: ${deductionBasis(d)} = ${m(d.amountMinor)}${d.capped ? ` (${t('pay.capped')})` : ''}`),
  ];
  const summary = t('pay.explainNet', { gross: m(b.grossPayMinor), deductions: m(b.totalDeductionsMinor), net: m(b.netPayMinor) });

  return (
    <article className="statement" aria-labelledby={`${id}-title`}>
      <header className="statement-head">
        <div>
          <h2 id={`${id}-title`} className="statement-title">
            {t('pay.statement')}
          </h2>
          <p className="statement-meta">
            {slip.workerName}
            <br />
            {t('pay.period')}: {formatPeriod(slip.periodStart, slip.periodEnd, locale)}
          </p>
        </div>
        <span className={`badge ${issued ? 'badge-good' : 'badge-warn'}`}>
          {issued ? t('pay.issuedOn', { date: formatDate(slip.issuedAt!.slice(0, 10), locale) }) : t('pay.estimate')}
        </span>
      </header>

      <table className="ledger">
        <caption className="visually-hidden">{t('pay.statement')}</caption>
        <tbody>
          <tr className="ledger-group">
            <th colSpan={2} scope="colgroup">
              {t('pay.hoursGroup')}
            </th>
          </tr>
          <tr>
            <th scope="row">{t('pay.regularHours')}</th>
            <td className="figure">{formatMinutes(b.regularMinutes)}</td>
          </tr>
          <tr>
            <th scope="row">{t('pay.overtimeHours')}</th>
            <td className="figure">{formatMinutes(b.overtimeMinutes)}</td>
          </tr>
          <tr className="ledger-group">
            <th colSpan={2} scope="colgroup">
              {t('pay.earningsGroup')}
            </th>
          </tr>
          <tr>
            <th scope="row">{t('pay.rate')}</th>
            <td className="figure">{m(b.hourlyRateMinor)}</td>
          </tr>
          <tr>
            <th scope="row">{t('pay.base')}</th>
            <td className="figure">{m(b.basePayMinor)}</td>
          </tr>
          <tr>
            <th scope="row">
              {t('pay.overtimePay')} <span className="ledger-note">{t('pay.overtimeRateNote', { multiplier: formatMultiplier(b.overtimeMultiplierBp) })}</span>
            </th>
            <td className="figure">{m(b.overtimePayMinor)}</td>
          </tr>
          <tr className="ledger-subtotal">
            <th scope="row">{t('pay.gross')}</th>
            <td className="figure">{m(b.grossPayMinor)}</td>
          </tr>
          {b.deductions.length > 0 ? (
            <>
              <tr className="ledger-group">
                <th colSpan={2} scope="colgroup">
                  {t('pay.deductions')}
                </th>
              </tr>
              {b.deductions.map((d) => (
                <tr key={d.code}>
                  <th scope="row">
                    {d.label}
                    <span className="ledger-note">
                      {deductionBasis(d)}
                      {d.capped ? `. ${t('pay.capped')}` : ''}
                    </span>
                  </th>
                  <td className="figure">− {m(d.amountMinor)}</td>
                </tr>
              ))}
              <tr className="ledger-subtotal">
                <th scope="row">{t('pay.totalDeductions')}</th>
                <td className="figure">− {m(b.totalDeductionsMinor)}</td>
              </tr>
            </>
          ) : null}
          <tr className="ledger-total">
            <th scope="row">{t('pay.net')}</th>
            <td className="figure">{m(b.netPayMinor)}</td>
          </tr>
        </tbody>
      </table>

      {b.openShiftsExcluded > 0 ? <Notice kind="warning">{t('pay.openExcluded', { count: b.openShiftsExcluded })}</Notice> : null}

      <section className="explain" aria-labelledby={`${id}-how`}>
        <div className="explain-head">
          <h3 id={`${id}-how`}>{t('pay.how')}</h3>
          <ReadAloudButton text={[...steps, summary].join('. ')} />
        </div>
        <ol>
          {steps.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
          <li>
            <strong>{summary}</strong>
          </li>
        </ol>
      </section>

      {b.days.length > 0 ? (
        <details className="statement-days">
          <summary>{t('pay.byDay')}</summary>
          {b.days.length <= 7 ? (
            <WeekStrip from={slip.periodStart} to={slip.periodEnd} days={b.days} scheduledMinutes={b.scheduledDailyMinutes} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('att.date')}</th>
                    <th scope="col" className="num">
                      {t('att.hours')}
                    </th>
                    <th scope="col" className="num">
                      {t('pay.regularHours')}
                    </th>
                    <th scope="col" className="num">
                      {t('pay.overtimeHours')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {b.days.map((d) => (
                    <tr key={d.date}>
                      <td>{formatDate(d.date, locale)}</td>
                      <td className="num">{formatMinutes(d.workedMinutes)}</td>
                      <td className="num">{formatMinutes(d.regularMinutes)}</td>
                      <td className="num">{formatMinutes(d.overtimeMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      ) : null}

      <p className="statement-foot">{slip.synthetic ? t('pay.syntheticNote') : t('pay.realNote')}</p>
    </article>
  );
}
