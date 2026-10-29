import { describe, expect, it } from 'vitest';
import {
  analyzeSafeSignals,
  detectCategoryClusters,
  detectPersistentUnresolved,
  detectSeverityEscalations,
  type SignalReportInput,
} from '../../src/domain/signal';

describe('Safe Signal — Recurring Hazard Pattern Detection & Privacy Safeguards', () => {
  const now = new Date('2026-10-30T10:00:00.000Z');
  const categories = [
    { key: 'fall', label: 'Falls and working at height' },
    { key: 'electrical', label: 'Electrical safety' },
    { key: 'ppe', label: 'Personal protective equipment' },
    { key: 'equipment', label: 'Tools and machinery' },
  ];
  const categoryMap = new Map(categories.map((c) => [c.key, c.label]));

  it('strictly suppresses cohorts with fewer than 3 reports to preserve reporter anonymity', () => {
    // Only 2 reports in 'ppe' category: below the minimum cohort size of 3
    const smallCohort: SignalReportInput[] = [
      { id: 'rep_1', category: 'ppe', severity: 'medium', status: 'submitted', createdAt: '2026-10-25T08:00:00Z', resolvedAt: null },
      { id: 'rep_2', category: 'ppe', severity: 'medium', status: 'acknowledged', createdAt: '2026-10-26T09:00:00Z', resolvedAt: null },
    ];

    const clusters = detectCategoryClusters(smallCohort, categoryMap, now);
    expect(clusters).toHaveLength(0);

    const allSignals = analyzeSafeSignals(smallCohort, categories, now);
    expect(allSignals).toHaveLength(0);
  });

  it('detects category clusters once the minimum cohort threshold of 3 is reached', () => {
    // 3 reports in 'fall' category
    const validCohort: SignalReportInput[] = [
      { id: 'rep_1', category: 'fall', severity: 'medium', status: 'submitted', createdAt: '2026-10-22T08:00:00Z', resolvedAt: null },
      { id: 'rep_2', category: 'fall', severity: 'high', status: 'in_progress', createdAt: '2026-10-24T09:00:00Z', resolvedAt: null },
      { id: 'rep_3', category: 'fall', severity: 'critical', status: 'submitted', createdAt: '2026-10-28T10:00:00Z', resolvedAt: null },
    ];

    const clusters = detectCategoryClusters(validCohort, categoryMap, now);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.category).toBe('fall');
    expect(clusters[0]?.reportCount).toBe(3);
    expect(clusters[0]?.severityLevel).toBe('critical'); // Highest observed
    expect(clusters[0]?.severityDistribution).toEqual({ low: 0, medium: 1, high: 1, critical: 1 });
    expect(clusters[0]?.statusSummary.unresolvedCount).toBe(3);
  });

  it('guarantees that output contains zero reporter identifiers or exact timestamps', () => {
    const reports: SignalReportInput[] = [
      { id: 'rep_1', category: 'electrical', severity: 'high', status: 'submitted', createdAt: '2026-10-20T08:12:43.123Z', resolvedAt: null },
      { id: 'rep_2', category: 'electrical', severity: 'critical', status: 'acknowledged', createdAt: '2026-10-22T14:45:12.456Z', resolvedAt: null },
      { id: 'rep_3', category: 'electrical', severity: 'high', status: 'in_progress', createdAt: '2026-10-25T17:30:00.000Z', resolvedAt: null },
    ];

    const signals = analyzeSafeSignals(reports, categories, now);
    expect(signals.length).toBeGreaterThan(0);

    for (const signal of signals) {
      // Must not contain any reporter ID or raw timestamp strings
      const serialized = JSON.stringify(signal);
      expect(serialized).not.toContain('usr_');
      expect(serialized).not.toContain('Lakshmi');
      expect(serialized).not.toContain('Ravi');
      expect(serialized).not.toContain('08:12:43');
      expect(serialized).not.toContain('14:45:12');
      // Only coarse, privacy-safe window descriptions
      expect(signal.timeWindow).toMatch(/Past \d+ days|Older than \d+ days/);
    }
  });

  it('detects persistent unresolved hazard patterns older than threshold', () => {
    // 3 reports created 12, 10, and 9 days ago, still unresolved
    const persistentReports: SignalReportInput[] = [
      { id: 'rep_1', category: 'equipment', severity: 'medium', status: 'submitted', createdAt: '2026-10-18T08:00:00Z', resolvedAt: null },
      { id: 'rep_2', category: 'equipment', severity: 'high', status: 'acknowledged', createdAt: '2026-10-20T08:00:00Z', resolvedAt: null },
      { id: 'rep_3', category: 'equipment', severity: 'medium', status: 'in_progress', createdAt: '2026-10-21T08:00:00Z', resolvedAt: null },
    ];

    const persistent = detectPersistentUnresolved(persistentReports, categoryMap, now, 7);
    expect(persistent).toHaveLength(1);
    expect(persistent[0]?.rule).toBe('persistent_unresolved');
    expect(persistent[0]?.category).toBe('equipment');
    expect(persistent[0]?.reportCount).toBe(3);
  });

  it('detects severity escalation when hazard conditions deteriorate over time', () => {
    // 4 reports: first two are low severity, second two are high and critical
    const escalatingReports: SignalReportInput[] = [
      { id: 'rep_1', category: 'fall', severity: 'low', status: 'submitted', createdAt: '2026-10-05T08:00:00Z', resolvedAt: null },
      { id: 'rep_2', category: 'fall', severity: 'low', status: 'acknowledged', createdAt: '2026-10-10T08:00:00Z', resolvedAt: null },
      { id: 'rep_3', category: 'fall', severity: 'high', status: 'submitted', createdAt: '2026-10-22T08:00:00Z', resolvedAt: null },
      { id: 'rep_4', category: 'fall', severity: 'critical', status: 'in_progress', createdAt: '2026-10-26T08:00:00Z', resolvedAt: null },
    ];

    const escalations = detectSeverityEscalations(escalatingReports, categoryMap, now, 30);
    expect(escalations).toHaveLength(1);
    expect(escalations[0]?.rule).toBe('severity_escalation');
    expect(escalations[0]?.category).toBe('fall');
    expect(escalations[0]?.reportCount).toBe(4);
    expect(escalations[0]?.severityLevel).toBe('critical');
  });

  it('handles empty or non-matching inputs gracefully without errors', () => {
    expect(analyzeSafeSignals([], categories, now)).toEqual([]);
  });
});
