// The Money Jar: one picture of a pay period. The jar fills with what the recorded work earned
// (regular pay, then overtime on top); a dashed line marks what the agreed rate and schedule
// imply for the days worked; the hatched top slice is what deductions remove, leaving the
// take-home amount. Every figure comes from the payslip breakdown (integer paise). FairShift
// holds no payment records, so "paid" is stated as not recorded, never shown as an amount.
import { useId } from 'react';
import { useI18n, useMoney } from '../lib/i18n';
import { formatDate, formatMinutes } from '../lib/format';
import { formatMultiplier } from '../../shared/money';
import type { PayslipDTO } from '../../shared/types';
import { deriveMoneyJarModel } from '../../domain/moneyJar';
import { ReadAloudButton } from './Voice';

// Jar geometry in SVG units.
const BODY = 'M58 50 h84 v6 c0 10 34 12 34 40 v134 c0 16 -12 26 -28 26 h-96 c-16 0 -28 -10 -28 -26 v-134 c0 -28 34 -30 34 -40 z';
const FILL_TOP = 66;
const FILL_BOTTOM = 256;

export function MoneyJar({ slip }: { slip: PayslipDTO }) {
  const { t, locale } = useI18n();
  const money = useMoney();
  const uid = useId().replace(/:/g, '');
  const model = deriveMoneyJarModel(slip);
  const m = (minor: number) => money(minor, model.currency);
  const { agreed, worked, paid } = model.comparison;
  const b = slip.breakdown;

  const scale = Math.max(agreed.isAvailable ? agreed.expectedBasePayMinor : 0, model.grossPayMinor, 1) * 1.15;
  const span = FILL_BOTTOM - FILL_TOP;
  const h = (minor: number) => (Math.max(0, minor) / scale) * span;
  const baseH = h(model.basePayMinor);
  const otH = h(model.overtimePayMinor);
  const dedH = Math.min(h(model.totalDeductionsMinor), baseH + otH);
  const agreedY = FILL_BOTTOM - h(agreed.expectedBasePayMinor);
  const surfaceY = FILL_BOTTOM - baseH - otH;
  const difference = model.grossPayMinor - agreed.expectedBasePayMinor;
  const issued = slip.status === 'issued';

  const spoken = model.isZeroEarnings
    ? t('jar.voiceZero')
    : [
        agreed.isAvailable ? `${t('jar.agreedLabel')}: ${m(agreed.expectedBasePayMinor)}` : '',
        `${t('jar.workedLabel')}: ${m(model.grossPayMinor)}`,
        model.totalDeductionsMinor > 0 ? `${t('pay.deductions')}: ${m(model.totalDeductionsMinor)}` : '',
        `${t('pay.net')}: ${m(model.netPayMinor)}`,
        `${t('jar.paidLabel')}: ${t('jar.paymentSeeCheck')}`,
      ]
        .filter(Boolean)
        .join('. ');

  return (
    <section className="jar" aria-labelledby={`${uid}-title`}>
      <div className="jar-head">
        <div>
          <h2 id={`${uid}-title`} className="jar-title">
            {t('jar.heading')}
          </h2>
          <p className="jar-period">
            {formatDate(slip.periodStart, locale)} – {formatDate(slip.periodEnd, locale)}
          </p>
        </div>
        <span className={`badge ${issued ? 'badge-good' : 'badge-warn'}`}>
          {issued && slip.issuedAt ? t('pay.issuedOn', { date: formatDate(slip.issuedAt.slice(0, 10), locale) }) : t('pay.estimate')}
        </span>
      </div>

      <div className="jar-body">
        <figure className="jar-figure">
          <svg viewBox="0 0 200 270" className="jar-svg" role="img" aria-labelledby={`${uid}-desc`}>
            <desc id={`${uid}-desc`}>{spoken}</desc>
            <defs>
              <clipPath id={`${uid}-clip`}>
                <path d={BODY} />
              </clipPath>
              {/* Glass: brighter at the left where the light falls, tinted silver at the right edge. */}
              <linearGradient id={`${uid}-glass`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
                <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.35" />
                <stop offset="1" stopColor="#dde3e8" stopOpacity="0.75" />
              </linearGradient>
              <linearGradient id={`${uid}-pay`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#5b2452" />
                <stop offset="1" stopColor="#24081f" />
              </linearGradient>
              <linearGradient id={`${uid}-ot`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#f4c02a" />
                <stop offset="1" stopColor="#eaaa00" />
              </linearGradient>
              <linearGradient id={`${uid}-lid`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#5b2452" />
                <stop offset="1" stopColor="#3a0f34" />
              </linearGradient>
              {/* Deductions are a see-through hatch, so the pay layers underneath stay visible. */}
              <pattern id={`${uid}-hatch`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="4" height="8" fill="#ffffff" fillOpacity="0.78" />
              </pattern>
            </defs>
            <rect x="52" y="14" width="96" height="26" rx="7" fill={`url(#${uid}-lid)`} />
            <rect x="56" y="16" width="88" height="3" rx="1.5" className="jar-rim" />
            <rect x="60" y="36" width="80" height="16" rx="3" fill="#5b2452" />
            <path d={BODY} fill={`url(#${uid}-glass)`} />
            <g clipPath={`url(#${uid}-clip)`}>
              <g className="jar-fill">
                <rect x="0" y={FILL_BOTTOM - baseH} width="200" height={baseH} fill={`url(#${uid}-pay)`} />
                <rect x="0" y={surfaceY} width="200" height={otH} fill={`url(#${uid}-ot)`} />
                {baseH + otH > 0 ? <line x1="0" x2="200" y1={surfaceY + 1} y2={surfaceY + 1} className="jar-meniscus" /> : null}
                {dedH > 0 ? (
                  <>
                    <rect x="0" y={FILL_BOTTOM - baseH - otH} width="200" height={dedH} fill={`url(#${uid}-hatch)`} />
                    <line x1="0" x2="200" y1={FILL_BOTTOM - baseH - otH + dedH} y2={FILL_BOTTOM - baseH - otH + dedH} className="jar-cut" />
                  </>
                ) : null}
              </g>
              {agreed.isAvailable ? (
                <g className="jar-agreed">
                  <line x1="0" x2="200" y1={agreedY} y2={agreedY} className="halo" />
                  <line x1="0" x2="200" y1={agreedY} y2={agreedY} className="dash" />
                </g>
              ) : null}
            </g>
            <path d={BODY} className="jar-outline" />
            <path d="M40 104 v96" className="jar-shine" />
            <path d="M50 214 v18" className="jar-shine-thin" />
            <path d="M162 112 c3 12 3 30 2 44" className="jar-shine-thin" />
          </svg>
        </figure>

        <dl className="jar-legend">
          <div className="jar-row">
            <dt>
              <span className="swatch swatch-agreed" aria-hidden="true" />
              {t('jar.agreedLabel')}
            </dt>
            <dd className="figure">{agreed.isAvailable ? m(agreed.expectedBasePayMinor) : '—'}</dd>
            <dd className="jar-explain">
              {agreed.isAvailable
                ? t('jar.agreedExplain', {
                    days: agreed.workedDaysCount,
                    hours: formatMinutes(agreed.scheduledDailyMinutes),
                    rate: m(agreed.hourlyRateMinor),
                  })
                : t('jar.agreedUnavailable')}
            </dd>
          </div>
          <div className="jar-row">
            <dt>
              <span className="swatch swatch-worked" aria-hidden="true" />
              {t('jar.workedLabel')}
            </dt>
            <dd className="figure">{m(model.grossPayMinor)}</dd>
            <dd className="jar-explain">
              {t('jar.workedExplain', { regular: formatMinutes(worked.regularMinutes), overtime: formatMinutes(worked.overtimeMinutes) })}
              {agreed.isAvailable && difference !== 0 ? (
                <span className={`jar-diff ${difference > 0 ? 'is-more' : 'is-less'}`}>
                  {difference > 0 ? t('jar.moreThanAgreed', { amount: m(difference) }) : t('jar.lessThanAgreed', { amount: m(-difference) })}
                </span>
              ) : null}
            </dd>
          </div>
          {model.totalDeductionsMinor > 0 ? (
            <div className="jar-row">
              <dt>
                <span className="swatch swatch-deduction" aria-hidden="true" />
                {t('pay.deductions')}
              </dt>
              <dd className="figure">− {m(model.totalDeductionsMinor)}</dd>
              <dd className="jar-explain">{model.deductionLines.map((d) => d.label).join(', ')}</dd>
            </div>
          ) : null}
          <div className="jar-row jar-row-total">
            <dt>
              <span className="swatch swatch-net" aria-hidden="true" />
              {t('pay.net')}
            </dt>
            <dd className="figure">{m(model.netPayMinor)}</dd>
            <dd className="jar-explain">{issued ? t('jar.issuedExplain') : t('jar.estimateExplain')}</dd>
          </div>
          <div className="jar-row jar-row-paid">
            <dt>{t('jar.paidLabel')}</dt>
            <dd className="jar-explain">{paid.paymentRecorded ? null : t('jar.paymentSeeCheck')}</dd>
          </div>
        </dl>
      </div>

      {model.isZeroEarnings ? <p className="jar-empty">{t('jar.zeroEarningsNotice')}</p> : null}

      <div className="jar-foot">
        <details className="jar-glossary">
          <summary>{t('jar.wordsTitle')}</summary>
          <dl>
            <dt>{t('jar.agreedLabel')}</dt>
            <dd>{t('jar.agreedDefinition')}</dd>
            <dt>{t('jar.workedLabel')}</dt>
            <dd>{t('jar.workedDefinition')}</dd>
            <dt>{t('pay.overtimePay')}</dt>
            <dd>{t('jar.overtimeDefinition', { hours: formatMinutes(b.scheduledDailyMinutes), multiplier: formatMultiplier(b.overtimeMultiplierBp) })}</dd>
            <dt>{t('pay.deductions')}</dt>
            <dd>{t('jar.deductionsDefinition')}</dd>
            <dt>{t('pay.net')}</dt>
            <dd>{t('jar.netDefinition')}</dd>
            <dt>{t('jar.paidLabel')}</dt>
            <dd>{t('jar.paidDefinition')}</dd>
          </dl>
        </details>
        <ReadAloudButton text={spoken} />
      </div>
    </section>
  );
}
