// Heat check: the worker enters temperature and humidity (or picks an example) and sees the NWS
// heat index, its risk category and advisory precautions. It is a shaded estimate from two
// numbers, not a WBGT measurement of the workplace, and it says so.
import { useId, useState } from 'react';
import { Droplets, HeartPulse, Sun, Thermometer, TriangleAlert, Umbrella } from 'lucide-react';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Link } from '../lib/router';
import { assessHeatStress, INDIAN_WEATHER_PRESETS } from '../../domain/heat';
import { ReadAloudButton } from './Voice';

export function HeatSafetyWidget({ initialTemp = 34, initialHumidity = 60 }: { initialTemp?: number; initialHumidity?: number }) {
  const { t } = useI18n();
  const tempId = useId();
  const humidityId = useId();
  const [tempC, setTempC] = useState<number>(initialTemp);
  const [humidity, setHumidity] = useState<number>(initialHumidity);
  const a = assessHeatStress(tempC, humidity);
  const risk = t(a.riskLabelKey as MessageKey) || a.defaultRiskLabel;

  const spoken = `${t('heat.heading')}. ${t('heat.heatIndex')}: ${a.heatIndexC} °C. ${risk}. ${a.hydrationGuideline} ${a.restCycleGuideline} ${a.workModification}`;

  return (
    <section className={`heat heat-${a.riskLevel}`} aria-labelledby="heat-heading">
      <div className="heat-head">
        <h2 id="heat-heading">
          <Sun className="icon" aria-hidden="true" />
          {t('heat.heading')}
        </h2>
        <p>{t('heat.intro')}</p>
      </div>

      <div className="heat-inputs">
        <div className="heat-input">
          <label htmlFor={tempId}>
            <Thermometer className="icon-sm" aria-hidden="true" />
            {t('heat.temp')}
          </label>
          <output htmlFor={tempId} className="figure">
            {tempC}°C
          </output>
          <input id={tempId} type="range" min={20} max={50} step={1} value={tempC} onChange={(e) => setTempC(Number(e.target.value))} />
        </div>
        <div className="heat-input">
          <label htmlFor={humidityId}>
            <Droplets className="icon-sm" aria-hidden="true" />
            {t('heat.humidity')}
          </label>
          <output htmlFor={humidityId} className="figure">
            {humidity}%
          </output>
          <input id={humidityId} type="range" min={10} max={95} step={1} value={humidity} onChange={(e) => setHumidity(Number(e.target.value))} />
        </div>
      </div>

      <div className="heat-presets" role="group" aria-label={t('heat.presets')}>
        {INDIAN_WEATHER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="heat-preset"
            aria-pressed={tempC === p.tempC && humidity === p.humidity}
            onClick={() => {
              setTempC(p.tempC);
              setHumidity(p.humidity);
            }}
          >
            {t(p.labelKey as MessageKey) || p.defaultLabel}
          </button>
        ))}
      </div>

      <div className="heat-result" aria-live="polite">
        <p className="heat-index">
          <span className="figure">{a.heatIndexC}°C</span>
          <span className="heat-index-label">
            {t('heat.heatIndex')}, {a.heatIndexF}°F
          </span>
        </p>
        <p className="heat-risk">{risk}</p>
      </div>

      <ul className="heat-advice">
        <li>
          <Droplets className="icon" aria-hidden="true" />
          <span>
            <strong>{t('heat.water')}</strong>
            {a.hydrationGuideline}
          </span>
        </li>
        <li>
          <Umbrella className="icon" aria-hidden="true" />
          <span>
            <strong>{t('heat.rest')}</strong>
            {a.restCycleGuideline}
          </span>
        </li>
        <li>
          <TriangleAlert className="icon" aria-hidden="true" />
          <span>
            <strong>{t('heat.work')}</strong>
            {a.workModification}
          </span>
        </li>
        <li>
          <HeartPulse className="icon" aria-hidden="true" />
          <span>
            <strong>{t('heat.symptoms')}</strong>
            {a.symptomsToWatch.join('. ')}
          </span>
        </li>
      </ul>
      <p className="heat-help">{t('heat.seekHelp')}</p>

      <details className="heat-sources">
        <summary>{t('heat.sourcesTitle')}</summary>
        <p>{a.sourceAttribution}</p>
      </details>

      <div className="heat-foot">
        <Link to="/worker/reports/new" className="btn btn-secondary">
          {t('heat.reportHeat')}
        </Link>
        <ReadAloudButton text={spoken} />
      </div>
    </section>
  );
}
