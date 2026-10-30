// Environmental Heat Stress & Occupational Safety Assessment
// Implements the NOAA/NWS Rothfusz regression algorithm for Heat Index (HI),
// mapped to National Disaster Management Authority (NDMA) guidelines and Indian occupational standards.
// Distinguishes Heat Index from Wet Bulb Globe Temperature (WBGT).
import { DomainError } from './errors';

export type HeatRiskLevel = 'normal' | 'caution' | 'extreme_caution' | 'danger' | 'extreme_danger';

export interface HeatStressAssessment {
  ambientTempC: number;
  relativeHumidity: number;
  heatIndexC: number;
  heatIndexF: number;
  riskLevel: HeatRiskLevel;
  riskLabelKey: string;
  defaultRiskLabel: string;
  badgeTone: 'good' | 'info' | 'warn' | 'bad';
  hydrationGuideline: string;
  restCycleGuideline: string;
  workModification: string;
  symptomsToWatch: string[];
  isExtremeHazard: boolean;
  sourceAttribution: string;
}

export interface WeatherPreset {
  id: string;
  labelKey: string;
  defaultLabel: string;
  tempC: number;
  humidity: number;
  description: string;
}

export const INDIAN_WEATHER_PRESETS: WeatherPreset[] = [
  {
    id: 'delhi_summer',
    labelKey: 'heat.presetDelhi',
    defaultLabel: 'Delhi Dry Heat (42°C, 25% RH)',
    tempC: 42,
    humidity: 25,
    description: 'Dry summer conditions with intense direct solar radiation',
  },
  {
    id: 'chennai_coastal',
    labelKey: 'heat.presetChennai',
    defaultLabel: 'Chennai Coastal Humid (36°C, 75% RH)',
    tempC: 36,
    humidity: 75,
    description: 'High coastal humidity impairing natural sweat evaporation',
  },
  {
    id: 'kolkata_monsoon',
    labelKey: 'heat.presetKolkata',
    defaultLabel: 'Kolkata Monsoon (35°C, 80% RH)',
    tempC: 35,
    humidity: 80,
    description: 'Post-rain high-moisture atmosphere with elevated heat index',
  },
  {
    id: 'bengaluru_moderate',
    labelKey: 'heat.presetBengaluru',
    defaultLabel: 'Bengaluru Moderate (30°C, 50% RH)',
    tempC: 30,
    humidity: 50,
    description: 'Moderate inland plateau conditions within standard tolerance',
  },
];

export const NDMA_SOURCE_ATTRIBUTION =
  'Based on National Disaster Management Authority (NDMA) Guidelines on Heat-Wave Management (2019/2024), Factories Act 1948, and NOAA National Weather Service heat-index standards. Heat Index reflects shaded "apparent temperature"; direct sunlight can increase effective heat index by up to 8°C (15°F).';

/**
 * Computes the Heat Index using the NWS / NOAA Rothfusz regression algorithm.
 * Input: dry bulb ambient temperature in °C and relative humidity (0-100%).
 */
export function calculateHeatIndex(tempC: number, humidity: number): { heatIndexC: number; heatIndexF: number } {
  if (tempC < -10 || tempC > 65) {
    throw new DomainError('INVALID_PAY_INPUT', 'Temperature must be between -10°C and 65°C.');
  }
  if (humidity < 0 || humidity > 100) {
    throw new DomainError('INVALID_PAY_INPUT', 'Relative humidity must be between 0% and 100%.');
  }

  const T = (tempC * 9) / 5 + 32; // Fahrenheit
  const R = humidity;

  // Simple Steadman formula check
  let HI = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + R * 0.094);

  // If HI >= 80°F, use the full Rothfusz regression equation
  if (HI >= 80) {
    HI =
      -42.379 +
      2.04901523 * T +
      10.14333127 * R -
      0.22475541 * T * R -
      0.00683783 * T * T -
      0.05481717 * R * R +
      0.00122874 * T * T * R +
      0.00085282 * T * R * R -
      0.00000199 * T * T * R * R;

    // Low humidity adjustment
    if (R < 13 && T >= 80 && T <= 112) {
      const adj = ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
      HI -= adj;
    }
    // High humidity adjustment
    else if (R > 85 && T >= 80 && T <= 87) {
      const adj = ((R - 85) / 10) * ((87 - T) / 5);
      HI += adj;
    }
  }

  // Clamped result converted back to Celsius
  const hiF = Math.round(HI * 10) / 10;
  const hiC = Math.round((((HI - 32) * 5) / 9) * 10) / 10;

  return { heatIndexC: hiC, heatIndexF: hiF };
}

/**
 * Classifies the Heat Index into occupational safety tiers and provides
 * NDMA/Indian statutory work-rest recommendations.
 */
export function assessHeatStress(tempC: number, humidity: number): HeatStressAssessment {
  const { heatIndexC, heatIndexF } = calculateHeatIndex(tempC, humidity);

  let riskLevel: HeatRiskLevel = 'normal';
  let badgeTone: 'good' | 'info' | 'warn' | 'bad' = 'good';
  let riskLabelKey = 'heat.risk.normal';
  let defaultRiskLabel = 'Normal / Low Risk';
  let hydrationGuideline = 'Drink 250ml water every 30 minutes. Keep potable water accessible.';
  let restCycleGuideline = 'Standard break cycle: 15 minutes rest per 4 hours of physical shift.';
  let workModification = 'Normal outdoor construction and campus maintenance work permitted.';
  let isExtremeHazard = false;

  const symptomsToWatch = ['Heavy sweating and extreme thirst', 'Mild fatigue and sluggishness'];

  if (heatIndexC >= 51) {
    riskLevel = 'extreme_danger';
    badgeTone = 'bad';
    riskLabelKey = 'heat.risk.extreme_danger';
    defaultRiskLabel = 'Extreme Danger (Heat Stroke Highly Likely)';
    hydrationGuideline = 'MANDATORY: Drink 250ml water every 10-15 minutes with ORS / electrolytes. Do not wait for thirst.';
    restCycleGuideline = 'SUSPEND heavy outdoor physical work. Work limited to early morning (before 10 AM) or shaded areas.';
    workModification = 'Stop direct sun exposure (concrete pouring, roof scaffolding, road laying suspended).';
    symptomsToWatch.push('Heat Stroke Warning: Hot, dry skin (cessation of sweating), mental confusion, fainting. CALL 108 IMMEDIATELY.');
    isExtremeHazard = true;
  } else if (heatIndexC >= 39) {
    riskLevel = 'danger';
    badgeTone = 'bad';
    riskLabelKey = 'heat.risk.danger';
    defaultRiskLabel = 'Danger (Heat Exhaustion Likely, Heat Stroke Possible)';
    hydrationGuideline = 'Drink 250ml cool water or lemon water every 15 minutes. Cool water points must be within 50m of work.';
    restCycleGuideline = 'Mandatory 30-45 minutes rest in cool shade for every 45 minutes of heavy work.';
    workModification = 'Shift strenuous tasks to early morning (6 AM - 11 AM). Rotate workers frequently.';
    symptomsToWatch.push('Heat Exhaustion: Dizziness, nausea, vomiting, rapid heartbeat, headache. Move to shade immediately.');
    isExtremeHazard = true;
  } else if (heatIndexC >= 32) {
    riskLevel = 'extreme_caution';
    badgeTone = 'warn';
    riskLabelKey = 'heat.risk.extreme_caution';
    defaultRiskLabel = 'Extreme Caution (Heat Cramps & Exhaustion Likely)';
    hydrationGuideline = 'Drink 250ml water every 15-20 minutes. Avoid caffeinated or sugary beverages.';
    restCycleGuideline = 'Mandatory 15 minutes shade break every hour during peak heat hours (12 PM - 3 PM).';
    workModification = 'Provide ventilated shaded rest shelters. Ensure head protection (wide-brim helmets/cloth liners).';
    symptomsToWatch.push('Heat Cramps: Painful muscle spasms in legs or abdomen. Rest in shade and drink fluids.');
  } else if (heatIndexC >= 27) {
    riskLevel = 'caution';
    badgeTone = 'info';
    riskLabelKey = 'heat.risk.caution';
    defaultRiskLabel = 'Caution (Fatigue Possible with Prolonged Exposure)';
    hydrationGuideline = 'Drink 250ml water every 20-25 minutes.';
    restCycleGuideline = '10 minutes rest break in shade every 2 hours.';
    workModification = 'Encourage hydration breaks. Monitor unacclimatized new workers.';
  }

  return {
    ambientTempC: tempC,
    relativeHumidity: humidity,
    heatIndexC,
    heatIndexF,
    riskLevel,
    riskLabelKey,
    defaultRiskLabel,
    badgeTone,
    hydrationGuideline,
    restCycleGuideline,
    workModification,
    symptomsToWatch,
    isExtremeHazard,
    sourceAttribution: NDMA_SOURCE_ATTRIBUTION,
  };
}
