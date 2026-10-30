// Environmental Heat Safety & Outdoor Occupational Assessment Widget
// Interactive calculator using NOAA Rothfusz Heat Index and NDMA frontline worker guidance.
// Includes regional Indian presets, speech synthesis, and direct hazard reporting.
import { useState, useId } from 'react';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Link } from '../lib/router';
import {
  assessHeatStress,
  INDIAN_WEATHER_PRESETS,
  type HeatStressAssessment,
} from '../../domain/heat';
import { Badge, Notice } from './ui';
import { ReadAloudButton } from './Voice';
import { Sun, Droplets, Thermometer, AlertTriangle, ShieldCheck, Flame, HeartPulse, Flag } from 'lucide-react';

export function HeatSafetyWidget({ initialTemp = 34, initialHumidity = 60 }: { initialTemp?: number; initialHumidity?: number }) {
  const { t } = useI18n();
  const tempId = useId();
  const humidityId = useId();

  const [tempC, setTempC] = useState<number>(initialTemp);
  const [humidity, setHumidity] = useState<number>(initialHumidity);

  const assessment: HeatStressAssessment = assessHeatStress(tempC, humidity);

  const voiceScript = `${t('heat.title') || 'Environmental Heat Safety Assessment'}. ${
    t('heat.heatIndex') || 'Derived Heat Index'
  }: ${assessment.heatIndexC} degrees Celsius. ${t('heat.riskLevel') || 'Risk Level'}: ${
    t(assessment.riskLabelKey as MessageKey) || assessment.defaultRiskLabel
  }. ${assessment.hydrationGuideline} ${assessment.restCycleGuideline}`;

  return (
    <section className="heat-widget-card" aria-labelledby="heat-widget-heading">
      <div className="heat-widget-header">
        <div>
          <div className="flex items-center gap-2">
            <Sun className="icon text-amber" aria-hidden="true" />
            <h3 id="heat-widget-heading" className="heat-widget-title">
              {t('heat.title') || 'Environmental Heat Safety & Outdoor Assessment'}
            </h3>
          </div>
          <p className="heat-widget-subtitle">
            {t('heat.subtitle') ||
              'Occupational heat-stress monitoring and NDMA hydration guidelines for frontline worksites.'}
          </p>
        </div>
        <ReadAloudButton text={voiceScript} />
      </div>

      {/* Preset Buttons */}
      <div className="heat-presets-row">
        <span className="small font-bold text-muted">{t('heat.presets') || 'Indian Weather Presets'}:</span>
        <div className="heat-preset-pills">
          {INDIAN_WEATHER_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`preset-pill ${tempC === p.tempC && humidity === p.humidity ? 'active' : ''}`}
              onClick={() => {
                setTempC(p.tempC);
                setHumidity(p.humidity);
              }}
              title={p.description}
            >
              {t(p.labelKey as MessageKey) || p.defaultLabel}
            </button>
          ))}
        </div>
      </div>

      <div className="heat-calculator-grid">
        {/* Controls */}
        <div className="heat-controls">
          <div className="field">
            <div className="flex justify-between items-center">
              <label htmlFor={tempId}>
                <Thermometer className="icon-sm inline mr-1" aria-hidden="true" />
                {t('heat.temp') || 'Ambient Temperature (°C)'}
              </label>
              <strong>{tempC}°C</strong>
            </div>
            <input
              id={tempId}
              type="range"
              min={20}
              max={50}
              step={1}
              value={tempC}
              onChange={(e) => setTempC(Number(e.target.value))}
            />
          </div>

          <div className="field">
            <div className="flex justify-between items-center">
              <label htmlFor={humidityId}>
                <Droplets className="icon-sm inline mr-1 text-info" aria-hidden="true" />
                {t('heat.humidity') || 'Relative Humidity (%)'}
              </label>
              <strong>{humidity}%</strong>
            </div>
            <input
              id={humidityId}
              type="range"
              min={10}
              max={95}
              step={1}
              value={humidity}
              onChange={(e) => setHumidity(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Heat Index Gauge / Result Card */}
        <div className={`heat-result-card tone-${assessment.badgeTone}`}>
          <div className="heat-gauge-top">
            <span className="heat-gauge-label">{t('heat.heatIndex') || 'Derived Heat Index'}</span>
            <Badge tone={assessment.badgeTone}>{t(assessment.riskLabelKey as MessageKey) || assessment.defaultRiskLabel}</Badge>
          </div>
          <div className="heat-metric-hero">
            <span className="heat-metric-val">{assessment.heatIndexC}°C</span>
            <span className="heat-metric-sub">({assessment.heatIndexF}°F apparent heat in shade)</span>
          </div>

          {assessment.isExtremeHazard && (
            <div className="heat-hazard-flag">
              <Flame className="icon-sm text-bad shrink-0" aria-hidden="true" />
              <span>Severe heat conditions: follow mandatory NDMA shade and hydration intervals.</span>
            </div>
          )}
        </div>
      </div>

      {/* Advisory Guidelines */}
      <div className="heat-advisory-grid">
        <div className="heat-guideline-box">
          <div className="flex items-center gap-1.5 font-bold mb-1">
            <Droplets className="icon-sm text-info" aria-hidden="true" />
            <span>Hydration Schedule</span>
          </div>
          <p className="m-0 small">{assessment.hydrationGuideline}</p>
        </div>

        <div className="heat-guideline-box">
          <div className="flex items-center gap-1.5 font-bold mb-1">
            <ShieldCheck className="icon-sm text-good" aria-hidden="true" />
            <span>Rest & Shade Work Cycle</span>
          </div>
          <p className="m-0 small">{assessment.restCycleGuideline}</p>
        </div>

        <div className="heat-guideline-box">
          <div className="flex items-center gap-1.5 font-bold mb-1">
            <AlertTriangle className="icon-sm text-amber" aria-hidden="true" />
            <span>Work Modification</span>
          </div>
          <p className="m-0 small">{assessment.workModification}</p>
        </div>

        <div className="heat-guideline-box">
          <div className="flex items-center gap-1.5 font-bold mb-1">
            <HeartPulse className="icon-sm text-bad" aria-hidden="true" />
            <span>Symptoms to Watch Out For</span>
          </div>
          <ul className="m-0 p-0 pl-4 small">
            {assessment.symptomsToWatch.map((s, idx) => (
              <li key={idx}>{s}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Bottom Action & Source Attribution */}
      <div className="heat-widget-footer">
        <span className="small text-muted flex items-start gap-1">
          <span>{assessment.sourceAttribution}</span>
        </span>
        <Link to="/worker/reports/new" className="btn btn-secondary btn-sm">
          <Flag className="icon-sm text-amber" aria-hidden="true" />
          <span>Report Heat Hazard</span>
        </Link>
      </div>
    </section>
  );
}
