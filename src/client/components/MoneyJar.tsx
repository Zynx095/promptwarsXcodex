// FairShift Money Jar Component
// Visual earnings explanation making wage math understandable to workers with limited financial/numerical literacy.
// Non-reliant on color alone: includes explicit figures, high-contrast labels, SVG texture patterns, and speech synthesis.
import { useI18n, type MessageKey } from '../lib/i18n';
import { formatMinutes, hoursDecimal } from '../lib/format';
import { formatMoney } from '../../shared/money';
import type { PayslipDTO } from '../../shared/types';
import { deriveMoneyJarModel } from '../../domain/moneyJar';
import { Badge, Notice } from './ui';
import { ReadAloudButton } from './Voice';
import { CheckCircle2, Clock, MinusCircle, Wallet, AlertCircle, FileCheck, HelpCircle } from 'lucide-react';

export function MoneyJar({ slip }: { slip: PayslipDTO }) {
  const { t, locale } = useI18n();
  const model = deriveMoneyJarModel(slip);
  const m = (minor: number) => formatMoney(minor, model.currency, locale);

  const baseLayer = model.layers.find((l) => l.id === 'base');
  const otLayer = model.layers.find((l) => l.id === 'overtime');
  const netLayer = model.layers.find((l) => l.id === 'net');

  // Plain-language voice script for speech synthesis
  const voiceScript = [
    model.isZeroEarnings
      ? t('jar.voiceZero') || 'No earnings recorded for this pay period.'
      : `${t('jar.voiceIntro') || 'Here is your earnings explanation.'} ${t('jar.baseWages')}: ${m(model.basePayMinor)}. ${
          model.overtimePayMinor > 0 ? `${t('jar.overtimeWages')}: ${m(model.overtimePayMinor)}. ` : ''
        }${model.totalDeductionsMinor > 0 ? `${t('jar.deductions')}: ${m(model.totalDeductionsMinor)}. ` : ''}${t('jar.netPayable')}: ${m(
          model.netPayMinor,
        )}. ${t(model.comparison.paid.statusLabelKey as MessageKey) || model.comparison.paid.defaultStatusLabel}.`,
  ].join(' ');

  return (
    <section className="money-jar-card" aria-labelledby="money-jar-heading">
      <div className="money-jar-header">
        <div>
          <h3 id="money-jar-heading" className="money-jar-title">
            <span className="jar-sparkle-icon" aria-hidden="true">
              🏺
            </span>
            <span>{t('jar.title') || 'FairShift Money Jar — Visual Earnings Explanation'}</span>
          </h3>
          <p className="money-jar-subtitle">
            {t('jar.subtitle') || 'A clear, transparent breakdown of how your work hours translate into approved wages.'}
          </p>
        </div>
        <ReadAloudButton text={voiceScript} className="jar-voice-btn" />
      </div>

      {model.isZeroEarnings ? (
        <Notice kind="info">
          <div className="flex items-center gap-2">
            <AlertCircle className="icon" aria-hidden="true" />
            <span>{t('jar.zeroEarningsNotice') || 'Zero earnings recorded for this period. No completed shifts found.'}</span>
          </div>
        </Notice>
      ) : (
        <div className="money-jar-grid">
          {/* Visual Container (The Jar) */}
          <div className="jar-visual-container" role="img" aria-label={`Visual earnings jar: ${voiceScript}`}>
            {/* SVG Hatching Patterns for Color-Independent Texture */}
            <svg className="jar-pattern-defs" aria-hidden="true" width="0" height="0">
              <defs>
                <pattern id="pattern-overtime" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                  <line x1="0" y1="0" x2="0" y2="8" stroke="#ffffff" strokeWidth="2.5" strokeOpacity="0.45" />
                </pattern>
                <pattern id="pattern-base" width="12" height="12" patternUnits="userSpaceOnUse">
                  <circle cx="6" cy="6" r="2" fill="#ffffff" fillOpacity="0.35" />
                </pattern>
                <pattern id="pattern-deduction" width="6" height="6" patternTransform="rotate(-45 0 0)" patternUnits="userSpaceOnUse">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" strokeWidth="1.5" strokeOpacity="0.4" />
                </pattern>
              </defs>
            </svg>

            {/* Physical Jar Frame */}
            <div className="jar-glass-body">
              <div className="jar-lid" aria-hidden="true">
                <span className="jar-lid-knob" />
              </div>

              <div className="jar-interior">
                {/* Overtime Top Layer */}
                {model.overtimePayMinor > 0 && (
                  <div
                    className="jar-layer layer-overtime"
                    style={{ height: `${otLayer?.percentage ?? 15}%` }}
                    title={`${t('jar.overtimeWages')}: ${m(model.overtimePayMinor)}`}
                  >
                    <div className="jar-layer-texture pattern-ot" />
                    <span className="jar-layer-badge">
                      <Clock className="icon-sm" aria-hidden="true" />
                      <span>
                        {t('jar.overtimeShort') || 'OT'}: {m(model.overtimePayMinor)}
                      </span>
                    </span>
                  </div>
                )}

                {/* Base Pay Main Layer */}
                <div
                  className="jar-layer layer-base"
                  style={{ height: `${baseLayer?.percentage ?? 85}%` }}
                  title={`${t('jar.baseWages')}: ${m(model.basePayMinor)}`}
                >
                  <div className="jar-layer-texture pattern-base" />
                  <span className="jar-layer-badge">
                    <Wallet className="icon-sm" aria-hidden="true" />
                    <span>
                      {t('jar.baseShort') || 'Base'}: {m(model.basePayMinor)}
                    </span>
                  </span>
                </div>
              </div>

              {/* Deductions Outflow Indicator */}
              {model.totalDeductionsMinor > 0 && (
                <div className="jar-deduction-callout" role="note" aria-label={`Deductions: ${m(model.totalDeductionsMinor)}`}>
                  <MinusCircle className="icon-sm text-bad" aria-hidden="true" />
                  <span>
                    −{t('jar.deductionsShort') || 'Deductions'}: <strong>{m(model.totalDeductionsMinor)}</strong>
                  </span>
                </div>
              )}
            </div>

            {/* Prominent Net Payable Baseplate */}
            <div className="jar-net-hero">
              <span className="jar-net-label">{t('jar.netPayable') || 'Take-Home Wages (Net Payable)'}</span>
              <div className="jar-net-amount">{m(model.netPayMinor)}</div>
              <div className="jar-status-pill">
                {model.status === 'issued' ? (
                  <Badge tone="good">
                    <FileCheck className="icon-sm" aria-hidden="true" />
                    <span>{t('jar.statusApproved') || 'Approved for Payment'}</span>
                  </Badge>
                ) : (
                  <Badge tone="warn">
                    <AlertCircle className="icon-sm" aria-hidden="true" />
                    <span>{t('jar.statusPending') || 'Estimated — Pending Final Approval'}</span>
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Detailed Legend & Accessible Ledger */}
          <div className="jar-ledger-container">
            <h4 className="jar-section-subtitle">{t('jar.ledgerTitle') || 'Earnings & Reductions Summary'}</h4>
            <ul className="jar-ledger-list">
              <li className="jar-ledger-item item-base">
                <div className="jar-item-info">
                  <div className="jar-legend-dot dot-base" aria-hidden="true" />
                  <div>
                    <strong>{t('jar.baseWages') || 'Base Wages'}</strong>
                    <div className="muted small">
                      {hoursDecimal(model.comparison.worked.regularMinutes)} hrs @ {m(slip.breakdown.hourlyRateMinor)}/hr
                    </div>
                  </div>
                </div>
                <strong className="jar-item-val">{m(model.basePayMinor)}</strong>
              </li>

              {model.overtimePayMinor > 0 && (
                <li className="jar-ledger-item item-ot">
                  <div className="jar-item-info">
                    <div className="jar-legend-dot dot-ot" aria-hidden="true" />
                    <div>
                      <strong>{t('jar.overtimeWages') || 'Overtime Earnings'}</strong>
                      <div className="muted small">
                        {hoursDecimal(model.comparison.worked.overtimeMinutes)} hrs @ {(slip.breakdown.overtimeMultiplierBp / 10000).toFixed(1)}×
                        rate
                      </div>
                    </div>
                  </div>
                  <strong className="jar-item-val text-amber">{m(model.overtimePayMinor)}</strong>
                </li>
              )}

              {model.totalDeductionsMinor > 0 && (
                <li className="jar-ledger-item item-ded">
                  <div className="jar-item-info">
                    <div className="jar-legend-dot dot-ded" aria-hidden="true" />
                    <div>
                      <strong>{t('jar.deductions') || 'Authorized Deductions'}</strong>
                      <div className="muted small">
                        {model.deductionLines.map((d) => `${d.label}${d.capped ? ' (capped)' : ''}`).join(', ')}
                      </div>
                    </div>
                  </div>
                  <strong className="jar-item-val text-bad">−{m(model.totalDeductionsMinor)}</strong>
                </li>
              )}

              <li className="jar-ledger-item item-net highlight">
                <div className="jar-item-info">
                  <CheckCircle2 className="icon text-good" aria-hidden="true" />
                  <div>
                    <strong>{t('jar.netPayable') || 'Net Payable Amount'}</strong>
                    <div className="muted small">{t('jar.netDescription') || 'Gross earnings minus authorized deductions'}</div>
                  </div>
                </div>
                <strong className="jar-item-val text-good text-lg">{m(model.netPayMinor)}</strong>
              </li>
            </ul>

            <div className="jar-trust-guarantee">
              <span className="small text-muted flex items-start gap-1">
                <HelpCircle className="icon-sm mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  {t('jar.guaranteeNote') ||
                    'Amounts are sealed by cryptographic work receipts and matched to verified check-in records.'}
                </span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Agreed vs Worked vs Paid Three-Part Comparison */}
      <div className="comparison-section mt-4" aria-labelledby="comparison-heading">
        <h4 id="comparison-heading" className="jar-section-subtitle">
          {t('jar.comparisonTitle') || 'Agreed vs Worked vs Paid Reconciliation'}
        </h4>
        <div className="comparison-grid">
          {/* Card 1: Agreed */}
          <div className="comparison-card card-agreed">
            <div className="comparison-header">
              <span className="comparison-badge badge-agreed">{t('jar.agreed') || '1. Agreed'}</span>
              <span className="comparison-subtitle">{t('jar.agreedDesc') || 'Contracted Terms'}</span>
            </div>
            {model.comparison.agreed.isAvailable ? (
              <div className="comparison-body">
                <div className="comparison-figure">{m(model.comparison.agreed.expectedBasePayMinor)}</div>
                <ul className="comparison-details">
                  <li>
                    {t('jar.hourlyRate') || 'Rate'}: <strong>{m(model.comparison.agreed.hourlyRateMinor)}/hr</strong>
                  </li>
                  <li>
                    {t('jar.scheduledHours') || 'Schedule'}:{' '}
                    <strong>{formatMinutes(model.comparison.agreed.scheduledDailyMinutes)}/day</strong>
                  </li>
                  <li>
                    {t('jar.workedDays') || 'Working Days'}: <strong>{model.comparison.agreed.workedDaysCount} days</strong>
                  </li>
                </ul>
              </div>
            ) : (
              <div className="comparison-body muted small">{model.comparison.agreed.unavailableReason}</div>
            )}
          </div>

          {/* Card 2: Worked */}
          <div className="comparison-card card-worked">
            <div className="comparison-header">
              <span className="comparison-badge badge-worked">{t('jar.worked') || '2. Worked'}</span>
              <span className="comparison-subtitle">{t('jar.workedDesc') || 'Recorded Shifts'}</span>
            </div>
            <div className="comparison-body">
              <div className="comparison-figure">{m(model.comparison.worked.grossPayMinor)}</div>
              <ul className="comparison-details">
                <li>
                  {t('jar.regularTime') || 'Regular'}: <strong>{formatMinutes(model.comparison.worked.regularMinutes)}</strong>
                </li>
                <li>
                  {t('jar.overtime') || 'Overtime'}: <strong>{formatMinutes(model.comparison.worked.overtimeMinutes)}</strong>
                </li>
                <li>
                  {t('jar.totalHours') || 'Total Time'}:{' '}
                  <strong>{formatMinutes(model.comparison.worked.totalWorkedMinutes)}</strong>
                </li>
              </ul>
            </div>
          </div>

          {/* Card 3: Paid / Payable */}
          <div className="comparison-card card-paid">
            <div className="comparison-header">
              <span className="comparison-badge badge-paid">{t('jar.paid') || '3. Payable / Paid'}</span>
              <span className="comparison-subtitle">{t('jar.paidDesc') || 'Disbursement Status'}</span>
            </div>
            <div className="comparison-body">
              <div className="comparison-figure text-good">{m(model.comparison.paid.outstandingAmountMinor)}</div>
              <ul className="comparison-details">
                <li>
                  {t('jar.disbursed') || 'Disbursed'}: <strong>{m(model.comparison.paid.disbursedAmountMinor)}</strong>
                </li>
                <li>
                  {t('jar.outstanding') || 'Outstanding'}:{' '}
                  <strong className="text-good">{m(model.comparison.paid.outstandingAmountMinor)}</strong>
                </li>
                <li>
                  {t('jar.status') || 'Status'}:{' '}
                  <span className="badge-status-inline">{t(model.comparison.paid.statusLabelKey as MessageKey) || model.comparison.paid.defaultStatusLabel}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
