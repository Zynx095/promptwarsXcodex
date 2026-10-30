import { describe, expect, it } from 'vitest';
import { assessHeatStress, calculateHeatIndex, INDIAN_WEATHER_PRESETS, NDMA_SOURCE_ATTRIBUTION, NWS_HEAT_INDEX_THRESHOLDS_F } from '../../src/domain/heat';

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
    expect(extremeDanger.restCycleGuideline).toMatch(/^Stop strenuous outdoor work/);
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

  const fToC = (f: number) => ((f - 32) * 5) / 9;

  it.each([
    // [air °F, RH %, NWS heat index chart value °F]
    [80, 40, 80],
    [90, 40, 93],
    [96, 65, 121],
    [100, 55, 124],
    [86, 90, 105], // exercises the high-humidity adjustment
    [104, 10, 99], // exercises the low-humidity adjustment (chart is undefined below 40% RH; NWS formula value)
  ])('approximates the NWS heat index chart for %d°F at %d%% RH', (tF, rh, expectedF) => {
    // Rothfusz is a regression fit of Steadman's table (about ±1.3°F) and the chart is rounded to whole degrees.
    expect(Math.abs(calculateHeatIndex(fToC(tF), rh).heatIndexF - expectedF)).toBeLessThanOrEqual(2.5);
  });

  it('averages the simple formula with the air temperature below 80°F, as the NWS procedure specifies', () => {
    // 70°F at 50% RH: simple formula 69.05°F, averaged with 70°F -> 69.5°F (the unaveraged value was returned before)
    expect(calculateHeatIndex(fToC(70), 50).heatIndexF).toBe(69.5);
  });

  it('assigns risk levels from the NWS °F category boundaries across the full input range', () => {
    const t = NWS_HEAT_INDEX_THRESHOLDS_F;
    for (let c = 20; c <= 50; c += 0.5) {
      for (let rh = 10; rh <= 95; rh += 5) {
        const a = assessHeatStress(c, rh);
        const f = a.heatIndexF;
        const expected =
          f >= t.extremeDanger
            ? 'extreme_danger'
            : f >= t.danger
              ? 'danger'
              : f >= t.extremeCaution
                ? 'extreme_caution'
                : f >= t.caution
                  ? 'caution'
                  : 'normal';
        expect(a.riskLevel, `${c}°C ${rh}% -> ${f}°F`).toBe(expected);
      }
    }
  });

  it('rejects missing or non-numeric environmental input', () => {
    expect(() => calculateHeatIndex(Number.NaN, 50)).toThrow();
    expect(() => calculateHeatIndex(30, Number.NaN)).toThrow();
    expect(() => calculateHeatIndex(Number.POSITIVE_INFINITY, 50)).toThrow();
  });

  it('presents guidance as advisory and never as a statutory or mandatory requirement', () => {
    expect(NDMA_SOURCE_ATTRIBUTION).toMatch(/not a statutory requirement/);
    expect(NDMA_SOURCE_ATTRIBUTION).toMatch(/not a WBGT measurement/);
    expect(NDMA_SOURCE_ATTRIBUTION).not.toMatch(/Factories Act/);
    for (let c = 20; c <= 50; c += 2) {
      const a = assessHeatStress(c, 70);
      for (const text of [a.hydrationGuideline, a.restCycleGuideline, a.workModification]) {
        expect(text).not.toMatch(/mandatory|MANDATORY|statutory/);
      }
    }
  });
});
