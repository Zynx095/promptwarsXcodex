// Environmental Heat Stress Assessment
// Implements the NOAA/NWS Heat Index procedure (Steadman simple formula + Rothfusz regression) and
// NWS risk categories, with advisory hydration and timing guidance attributed to OSHA/NIOSH and NDMA.
// Heat Index is a shaded temperature-humidity estimate; it is not a WBGT occupational exposure measurement.
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
  'Heat Index: NOAA/NWS Rothfusz regression and NWS risk categories. Hydration amounts: OSHA/NIOSH guidance (about 1 cup / 250 ml every 15–20 minutes during work in heat). Timing and ORS advice: NDMA heat-wave guidelines. This is advisory guidance, not a statutory requirement. Heat Index assumes shade and light wind; full sun can add up to 15°F (about 8°C). It is not a WBGT measurement and does not account for workload, clothing or acclimatisation.';

/** NWS heat index category boundaries in °F: Caution 80–90, Extreme Caution 90–103, Danger 103–124, Extreme Danger 125+. */
export const NWS_HEAT_INDEX_THRESHOLDS_F = { caution: 80, extremeCaution: 90, danger: 103, extremeDanger: 125 } as const;

/**
 * Computes the Heat Index using the NWS procedure (WPC "The Heat Index Equation").
 * Input: dry bulb ambient temperature in °C and relative humidity (0-100%).
 *
 * The simple Steadman formula is computed first and averaged with the air temperature; only if that
 * average is 80°F or more is the Rothfusz regression applied, with the NWS low- and high-humidity
 * adjustments. The regression is not valid beyond the conditions Steadman studied, so results at
 * extreme temperature/humidity combinations are rough estimates.
 */
export function calculateHeatIndex(tempC: number, humidity: number): { heatIndexC: number; heatIndexF: number } {
  if (!Number.isFinite(tempC) || tempC < -10 || tempC > 65) {
    throw new DomainError('INVALID_PAY_INPUT', 'Temperature must be between -10°C and 65°C.');
  }
  if (!Number.isFinite(humidity) || humidity < 0 || humidity > 100) {
    throw new DomainError('INVALID_PAY_INPUT', 'Relative humidity must be between 0% and 100%.');
  }

  const T = (tempC * 9) / 5 + 32; // Fahrenheit
  const R = humidity;

  // Simple formula averaged with the temperature (NWS procedure)
  let HI = (0.5 * (T + 61.0 + (T - 68.0) * 1.2 + R * 0.094) + T) / 2;

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
      HI -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    }
    // High humidity adjustment
    else if (R > 85 && T >= 80 && T <= 87) {
      HI += ((R - 85) / 10) * ((87 - T) / 5);
    }
  }

  const hiF = Math.round(HI * 10) / 10;
  const hiC = Math.round((((HI - 32) * 5) / 9) * 10) / 10;

  return { heatIndexC: hiC, heatIndexF: hiF };
}

const HYDRATION_IN_HEAT = 'Drink about 1 cup (250 ml) of cool water every 15–20 minutes while working, even if not thirsty.';

/**
 * Classifies the Heat Index into the NWS categories and attaches advisory guidance. Each
 * recommendation is attributed in NDMA_SOURCE_ATTRIBUTION; none is presented as a legal requirement.
 */
export function assessHeatStress(tempC: number, humidity: number): HeatStressAssessment {
  const { heatIndexC, heatIndexF } = calculateHeatIndex(tempC, humidity);
  const t = NWS_HEAT_INDEX_THRESHOLDS_F;

  let riskLevel: HeatRiskLevel = 'normal';
  let badgeTone: 'good' | 'info' | 'warn' | 'bad' = 'good';
  let riskLabelKey = 'heat.risk.normal';
  let defaultRiskLabel = 'Normal / Low Risk';
  let hydrationGuideline = 'Drink water regularly through the shift, even if not thirsty. Keep drinking water close to the work area.';
  let restCycleGuideline = 'Normal breaks. Watch new or unacclimatised workers, who are more vulnerable to heat.';
  let workModification = 'Normal outdoor construction and campus maintenance work, with shade and drinking water available.';
  let isExtremeHazard = false;

  const symptomsToWatch = ['Heavy sweating and extreme thirst', 'Mild fatigue and sluggishness'];

  if (heatIndexF >= t.extremeDanger) {
    riskLevel = 'extreme_danger';
    badgeTone = 'bad';
    riskLabelKey = 'heat.risk.extreme_danger';
    defaultRiskLabel = 'Extreme Danger (Heat Stroke Highly Likely)';
    hydrationGuideline = `${HYDRATION_IN_HEAT} Use ORS if sweating heavily.`;
    restCycleGuideline = 'Stop strenuous outdoor work in direct sun unless essential; resume only under a work-rest schedule set by a supervisor.';
    workModification = 'Move work to shade or indoors, or reschedule it to the early morning. Never work alone in these conditions.';
    symptomsToWatch.push('Heat Stroke Warning: Hot, dry skin (cessation of sweating), mental confusion, fainting. CALL 108 IMMEDIATELY.');
    isExtremeHazard = true;
  } else if (heatIndexF >= t.danger) {
    riskLevel = 'danger';
    badgeTone = 'bad';
    riskLabelKey = 'heat.risk.danger';
    defaultRiskLabel = 'Danger (Heat Exhaustion Likely, Heat Stroke Possible)';
    hydrationGuideline = `${HYDRATION_IN_HEAT} Use ORS if sweating heavily.`;
    restCycleGuideline =
      'Take frequent, longer rest breaks in a cool, shaded place. A supervisor should set the work-rest schedule, ideally from a WBGT measurement.';
    workModification = 'Avoid strenuous outdoor work between 12 PM and 3 PM; move heavy tasks to the early morning and work in pairs.';
    symptomsToWatch.push('Heat Exhaustion: Dizziness, nausea, vomiting, rapid heartbeat, headache. Move to shade immediately.');
    isExtremeHazard = true;
  } else if (heatIndexF >= t.extremeCaution) {
    riskLevel = 'extreme_caution';
    badgeTone = 'warn';
    riskLabelKey = 'heat.risk.extreme_caution';
    defaultRiskLabel = 'Extreme Caution (Heat Cramps & Exhaustion Likely)';
    hydrationGuideline = `${HYDRATION_IN_HEAT} Avoid alcohol and very sugary or caffeinated drinks.`;
    restCycleGuideline = 'Take more frequent rest breaks in shade, especially between 12 PM and 3 PM.';
    workModification = 'Provide shaded rest areas and head covering. Schedule strenuous tasks for cooler hours where possible.';
    symptomsToWatch.push('Heat Cramps: Painful muscle spasms in legs or abdomen. Rest in shade and drink fluids.');
  } else if (heatIndexF >= t.caution) {
    riskLevel = 'caution';
    badgeTone = 'info';
    riskLabelKey = 'heat.risk.caution';
    defaultRiskLabel = 'Caution (Fatigue Possible with Prolonged Exposure)';
    hydrationGuideline = HYDRATION_IN_HEAT;
    restCycleGuideline = 'Take short breaks in shade; fatigue is possible with prolonged exposure or heavy work.';
    workModification = 'Make sure shade and cool drinking water are near the work area. Watch unacclimatised workers.';
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
