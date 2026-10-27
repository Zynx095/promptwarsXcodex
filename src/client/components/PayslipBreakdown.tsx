// Readable payslip with a plain-language explanation of every figure.
import { useI18n } from '../lib/i18n';
import { formatDate, formatMinutes, hoursDecimal } from '../lib/format';
import { formatMoney, formatMultiplier, formatPercent } from '../../shared/money';
import type { DeductionLine, PayslipDTO } from '../../shared/types';
import { Badge, Notice } from './ui';
import { ReadAloudButton } from './Voice';

export function PayslipBreakdown({ slip }: { slip: PayslipDTO }) {
  const { t, locale } = useI18n();
  const b = slip.breakdown;
  const m = (minor: number) => formatMoney(minor, slip.currency);

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
    <article className="payslip" aria-label={`${t('pay.period')} ${slip.periodStart} – ${slip.periodEnd}`}>
      <div className="pay-hero">
        <div className="row">
          <span className="small">{t('pay.net')}</span>
          {slip.status === 'issued' && slip.issuedAt ? (
            <Badge tone="good">{t('pay.issuedOn', { date: formatDate(slip.issuedAt.slice(0, 10), locale) })}</Badge>
          ) : (
            <Badge tone="warn">{t('pay.estimate')}</Badge>
          )}
        </div>
        <span className="pay-net">{m(b.netPayMinor)}</span>
        <span className="small">
          {t('pay.period')}: {formatDate(slip.periodStart, locale)} – {formatDate(slip.periodEnd, locale)} · {slip.workerName}
        </span>
      </div>

      <dl>
        <dt>{t('pay.regularHours')}</dt>
        <dd>{formatMinutes(b.regularMinutes)}</dd>
        <dt>{t('pay.overtimeHours')}</dt>
        <dd>{formatMinutes(b.overtimeMinutes)}</dd>
        <dt>{t('pay.rate')}</dt>
        <dd>{m(b.hourlyRateMinor)}</dd>
        <dt>{t('pay.base')}</dt>
        <dd>{m(b.basePayMinor)}</dd>
        <dt>{t('pay.overtimePay')}</dt>
        <dd>{m(b.overtimePayMinor)}</dd>
        <dt>
          <strong>{t('pay.gross')}</strong>
        </dt>
        <dd>
          <strong>{m(b.grossPayMinor)}</strong>
        </dd>
        {b.deductions.map((d) => (
          <FragmentRow key={d.code} label={`− ${d.label}`} value={m(d.amountMinor)} note={`${deductionBasis(d)}${d.capped ? `. ${t('pay.capped')}` : ''}`} />
        ))}
        <dt>{t('pay.totalDeductions')}</dt>
        <dd>{m(b.totalDeductionsMinor)}</dd>
        <dt className="total">{t('pay.net')}</dt>
        <dd className="total">{m(b.netPayMinor)}</dd>
      </dl>

      {b.openShiftsExcluded > 0 ? <Notice kind="warning">{t('pay.openExcluded', { count: b.openShiftsExcluded })}</Notice> : null}

      <section className="explain" aria-labelledby="pay-how">
        <h3 id="pay-how">
          {t('pay.how')}
          <ReadAloudButton text={[...steps, summary].join('. ')} />
        </h3>
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
        <details className="mt-4">
          <summary>{t('pay.byDay')}</summary>
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
        </details>
      ) : null}

      <p className="muted small mt-4">{slip.synthetic ? t('pay.syntheticNote') : t('pay.realNote')}</p>
    </article>
  );
}

function FragmentRow({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <>
      <dt>
        {label}
        <br />
        <span className="small">{note}</span>
      </dt>
      <dd>{value}</dd>
    </>
  );
}
