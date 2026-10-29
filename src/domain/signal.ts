// Safe Signal — Privacy-conscious detection of recurring workplace hazard patterns.
// Strictly enforces minimum cohort suppression to protect confidential reporter privacy.
import type { Severity } from '../shared/types';

export const SAFE_SIGNAL_MIN_COHORT = 3;

export type SignalRuleType = 'category_cluster' | 'persistent_unresolved' | 'severity_escalation' | 'reopened_cluster';

export interface SignalReportInput {
  id: string;
  category: string;
  severity: Severity;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SafeSignalCandidate {
  id: string;
  rule: SignalRuleType;
  title: string;
  category: string;
  categoryLabel: string;
  severityLevel: Severity;
  reportCount: number;
  timeWindow: string;
  severityDistribution: Record<Severity, number>;
  statusSummary: {
    unresolvedCount: number;
    resolvedCount: number;
    reopenedCount: number;
  };
  confidence: 'possible_pattern' | 'recurrent_hazard';
  recommendedActions: string[];
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function getDominantSeverity(distribution: Record<Severity, number>): Severity {
  if (distribution.critical > 0) return 'critical';
  if (distribution.high > 0) return 'high';
  if (distribution.medium > 0) return 'medium';
  return 'low';
}

function initializeSeverityDistribution(): Record<Severity, number> {
  return { low: 0, medium: 0, high: 0, critical: 0 };
}

/**
 * Detects clusters of multiple safety reports in the same hazard category within a sliding time window.
 * Requires at least SAFE_SIGNAL_MIN_COHORT reports; smaller groups are strictly suppressed to protect anonymity.
 */
export function detectCategoryClusters(
  reports: SignalReportInput[],
  categoryMap: Map<string, string>,
  now: Date,
  windowDays = 14,
  minCohort = SAFE_SIGNAL_MIN_COHORT,
): SafeSignalCandidate[] {
  const windowStartMs = now.getTime() - windowDays * 86400000;
  const recent = reports.filter((r) => Date.parse(r.createdAt) >= windowStartMs);

  const byCategory = new Map<string, SignalReportInput[]>();
  for (const r of recent) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  const signals: SafeSignalCandidate[] = [];

  for (const [category, items] of byCategory.entries()) {
    // Minimum cohort threshold enforcement: single or paired reports are suppressed
    if (items.length < minCohort) continue;

    const severityDist = initializeSeverityDistribution();
    let unresolved = 0;
    let resolved = 0;
    let reopened = 0;

    for (const item of items) {
      severityDist[item.severity]++;
      if (item.status === 'reopened') reopened++;
      else if (item.status === 'resolved') resolved++;
      else unresolved++;
    }

    const dominant = getDominantSeverity(severityDist);
    const catLabel = categoryMap.get(category) ?? category;

    signals.push({
      id: `sig_cluster_${category}_${now.toISOString().slice(0, 10)}`,
      rule: 'category_cluster',
      title: `Frequent hazard reports: ${catLabel}`,
      category,
      categoryLabel: catLabel,
      severityLevel: dominant,
      reportCount: items.length,
      timeWindow: `Past ${windowDays} days`,
      severityDistribution: severityDist,
      statusSummary: {
        unresolvedCount: unresolved,
        resolvedCount: resolved,
        reopenedCount: reopened,
      },
      confidence: items.length >= 5 ? 'recurrent_hazard' : 'possible_pattern',
      recommendedActions: [
        `Initiate a workplace review focused on ${catLabel.toLowerCase()} safety controls.`,
        `Inspect current site conditions with safety committee or crew supervisors.`,
        `Check if existing risk mitigations have been bypassed or require structural maintenance.`,
      ],
    });
  }

  return signals;
}

/**
 * Detects hazard categories with reports that remain unresolved beyond the threshold period.
 */
export function detectPersistentUnresolved(
  reports: SignalReportInput[],
  categoryMap: Map<string, string>,
  now: Date,
  daysThreshold = 7,
  minCohort = SAFE_SIGNAL_MIN_COHORT,
): SafeSignalCandidate[] {
  const cutoffMs = now.getTime() - daysThreshold * 86400000;
  const persistent = reports.filter((r) => r.status !== 'resolved' && Date.parse(r.createdAt) <= cutoffMs);

  const byCategory = new Map<string, SignalReportInput[]>();
  for (const r of persistent) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  const signals: SafeSignalCandidate[] = [];

  for (const [category, items] of byCategory.entries()) {
    if (items.length < minCohort) continue;

    const severityDist = initializeSeverityDistribution();
    for (const item of items) severityDist[item.severity]++;

    const catLabel = categoryMap.get(category) ?? category;

    signals.push({
      id: `sig_persist_${category}_${now.toISOString().slice(0, 10)}`,
      rule: 'persistent_unresolved',
      title: `Persistent unresolved hazard: ${catLabel}`,
      category,
      categoryLabel: catLabel,
      severityLevel: getDominantSeverity(severityDist),
      reportCount: items.length,
      timeWindow: `Older than ${daysThreshold} days`,
      severityDistribution: severityDist,
      statusSummary: {
        unresolvedCount: items.length,
        resolvedCount: 0,
        reopenedCount: items.filter((i) => i.status === 'reopened').length,
      },
      confidence: 'recurrent_hazard',
      recommendedActions: [
        `Assign dedicated engineering or facility lead to unblock pending remediation.`,
        `Review procurement or contractor delays impacting resolution.`,
        `Provide an interim safety bulletin to workers operating in affected areas.`,
      ],
    });
  }

  return signals;
}

/**
 * Detects patterns where report severity in a category escalates over time.
 */
export function detectSeverityEscalations(
  reports: SignalReportInput[],
  categoryMap: Map<string, string>,
  now: Date,
  windowDays = 30,
  minCohort = SAFE_SIGNAL_MIN_COHORT,
): SafeSignalCandidate[] {
  const windowStartMs = now.getTime() - windowDays * 86400000;
  const inWindow = reports
    .filter((r) => Date.parse(r.createdAt) >= windowStartMs)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const byCategory = new Map<string, SignalReportInput[]>();
  for (const r of inWindow) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  const signals: SafeSignalCandidate[] = [];

  for (const [category, items] of byCategory.entries()) {
    if (items.length < minCohort) continue;

    const firstHalf = items.slice(0, Math.floor(items.length / 2));
    const secondHalf = items.slice(Math.floor(items.length / 2));

    const avgFirst = firstHalf.reduce((sum, i) => sum + SEVERITY_WEIGHT[i.severity], 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((sum, i) => sum + SEVERITY_WEIGHT[i.severity], 0) / secondHalf.length;

    // Detect upward severity trend
    if (avgSecond - avgFirst >= 1.0) {
      const severityDist = initializeSeverityDistribution();
      for (const item of items) severityDist[item.severity]++;

      const catLabel = categoryMap.get(category) ?? category;

      signals.push({
        id: `sig_escalate_${category}_${now.toISOString().slice(0, 10)}`,
        rule: 'severity_escalation',
        title: `Severity escalation observed: ${catLabel}`,
        category,
        categoryLabel: catLabel,
        severityLevel: getDominantSeverity(severityDist),
        reportCount: items.length,
        timeWindow: `Past ${windowDays} days`,
        severityDistribution: severityDist,
        statusSummary: {
          unresolvedCount: items.filter((i) => i.status !== 'resolved').length,
          resolvedCount: items.filter((i) => i.status === 'resolved').length,
          reopenedCount: items.filter((i) => i.status === 'reopened').length,
        },
        confidence: 'recurrent_hazard',
        recommendedActions: [
          `Escalate immediately to senior site operations for safety inspection.`,
          `Recent reports indicate worsening conditions or failure of initial temporary fixes.`,
          `Implement mandatory stand-down or safety briefing before work resumes in high-risk zones.`,
        ],
      });
    }
  }

  return signals;
}

/**
 * Runs the comprehensive Safe Signal rule evaluation suite.
 */
export function analyzeSafeSignals(
  reports: SignalReportInput[],
  categories: { key: string; label: string }[],
  now: Date,
): SafeSignalCandidate[] {
  const categoryMap = new Map(categories.map((c) => [c.key, c.label]));

  const clusters = detectCategoryClusters(reports, categoryMap, now);
  const persistent = detectPersistentUnresolved(reports, categoryMap, now);
  const escalations = detectSeverityEscalations(reports, categoryMap, now);

  // Return combined signals sorted by severity weight descending, then report count descending
  return [...clusters, ...persistent, ...escalations].sort((a, b) => {
    const diff = SEVERITY_WEIGHT[b.severityLevel] - SEVERITY_WEIGHT[a.severityLevel];
    if (diff !== 0) return diff;
    return b.reportCount - a.reportCount;
  });
}
