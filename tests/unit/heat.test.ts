import { describe, expect, it } from 'vitest';
import {
  assessHeatStress,
  calculateHeatIndex,
  INDIAN_WEATHER_PRESETS,
  NDMA_SOURCE_ATTRIBUTION,
} from '../../src/domain/heat';

describe('FairShift Environmental Safety — Heat Stress & Occupational Health Audit', () => {
  it('accurately computes Heat Index using the Rothfusz algorithm', () => {
    // 35°C (95°F) at 70% RH is a classic high heat index condition
    const res = calculateHeatIndex(35, 70);
    expect(res.heatIndexC).toBeGreaterThan(45);
    expect(res.heatIndexF).toBeGreaterThan(115);

    // Mild condition: 25°C at 50% RH
    const mild = calculateHeatIndex(25, 50);
    expect(mild.heatIndexC).toBeLessThan(27);
  });

  it('classifies risk levels into appropriate occupational tiers', () => {
    // Normal (<27°C)
    const normal = assessHeatStress(22, 45);
    expect(normal.riskLevel).toBe('normal');
    expect(normal.badgeTone).toBe('good');
    expect(normal.isExtremeHazard).toBe(false);

    // Caution (27-32°C)
    const caution = assessHeatStress(28, 45);
    expect(caution.riskLevel).toBe('caution');
    expect(caution.badgeTone).toBe('info');

    // Extreme Caution (32-39°C)
    const extremeCaution = assessHeatStress(32, 50);
    expect(extremeCaution.riskLevel).toBe('extreme_caution');
    expect(extremeCaution.badgeTone).toBe('warn');

    // Danger (39-51°C)
    const danger = assessHeatStress(35, 50);
    expect(danger.riskLevel).toBe('danger');
    expect(danger.badgeTone).toBe('bad');
    expect(danger.isExtremeHazard).toBe(true);

    // Extreme Danger (>=51°C)
    const extremeDanger = assessHeatStress(42, 60);
    expect(extremeDanger.riskLevel).toBe('extreme_danger');
    expect(extremeDanger.badgeTone).toBe('bad');
    expect(extremeDanger.isExtremeHazard).toBe(true);
    expect(extremeDanger.restCycleGuideline).toContain('SUSPEND');
  });

  it('evaluates all regional Indian weather presets reliably', () => {
    for (const preset of INDIAN_WEATHER_PRESETS) {
      const assessment = assessHeatStress(preset.tempC, preset.humidity);
      expect(assessment.heatIndexC).toBeGreaterThan(20);
      expect(assessment.heatIndexC).toBeLessThan(75);
      expect(assessment.hydrationGuideline).toBeTruthy();
      expect(assessment.restCycleGuideline).toBeTruthy();
    }
  });

  it('rejects out-of-bound temperatures and relative humidities', () => {
    expect(() => calculateHeatIndex(-15, 50)).toThrow();
    expect(() => calculateHeatIndex(70, 50)).toThrow();
    expect(() => calculateHeatIndex(30, -5)).toThrow();
    expect(() => calculateHeatIndex(30, 105)).toThrow();
  });

  it('includes NDMA source attribution and symptom warnings on hazardous heat', () => {
    const hazard = assessHeatStress(38, 70);
    expect(hazard.sourceAttribution).toBe(NDMA_SOURCE_ATTRIBUTION);
    expect(hazard.symptomsToWatch.some((s) => s.includes('Heat Exhaustion') || s.includes('Heat Stroke'))).toBe(true);
  });
});
