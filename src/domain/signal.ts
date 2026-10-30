// Safe Signal — Privacy-conscious detection of recurring workplace hazard patterns.
// Strictly enforces minimum cohort suppression to protect confidential reporter privacy.
import type { Severity } from '../shared/types';

export const SAFE_SIGNAL_MIN_COHORT = 3;
export const SAFE_SIGNAL_MIN_DISTINCT_REPORTERS = 2;

export type SignalRuleType = 'category_cluster' | 'persistent_unresolved' | 'severity_escalation' | 'reopened_cluster';

export interface SignalReportInput {
  id: string;
  category: string;
  severity: Severity;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  reporterKey?: string | null;
  location?: string | null;
  title?: string | null;
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

export function parseValidDate(dateStr: string): number | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const ms = Date.parse(dateStr);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Deduplicates immediate duplicate submissions from the same reporter in the same category and title within 15 minutes.
 */
export function deduplicateReports(reports: SignalReportInput[]): SignalReportInput[] {
  const seen = new Map<string, number>();
  const out: SignalReportInput[] = [];

  for (const r of reports) {
    const targetIdentifier = (r.title || r.location || '').trim().toLowerCase();
    const reporter = r.reporterKey || 'anon';
    const key = `${reporter}:${r.category}:${targetIdentifier}`;
    const ts = parseValidDate(r.createdAt);
    if (ts === null) continue;

    const lastTs = seen.get(key);
    if (lastTs !== undefined && Math.abs(ts - lastTs) < 15 * 60 * 1000) {
      continue;
    }
    seen.set(key, ts);
    out.push(r);
  }
  return out;
}

/**
 * Verifies diversity of reporters to prevent a single reporter from self-inflating a cluster or exposing themselves.
 */
export function hasSufficientDistinctReporters(items: SignalReportInput[], minDistinct: number = 1): boolean {
  const distinct = new Set(items.map((i) => i.reporterKey || i.id));
  return distinct.size >= minDistinct;
}

/**
 * Detects clusters of multiple safety reports in the same hazard category within a sliding time window.
 * Requires at least SAFE_SIGNAL_MIN_COHORT reports and multi-reporter diversity.
 */
export function detectCategoryClusters(
  reports: SignalReportInput[],
  categoryMap: Map<string, string>,
  now: Date,
  windowDays = 14,
  minCohort = SAFE_SIGNAL_MIN_COHORT,
  minDistinct = 1,
): SafeSignalCandidate[] {
  const windowStartMs = now.getTime() - windowDays * 86400000;
  const recent = reports.filter((r) => {
    const ts = parseValidDate(r.createdAt);
    if (ts === null) return false;
    return ts >= windowStartMs && ts <= now.getTime() + 60000;
  });

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
    if (!hasSufficientDistinctReporters(items, minDistinct)) continue;

    const severityDist = initializeSeverityDistribution();
    let unresolved = 0;
    let resolved = 0;
    let reopened = 0;

    for (const item of items) {
      severityDist[item.severity]++;
      if (item.status === 'reopened') reopened++;
      else if (item.status === 'resolved' || item.status === 'outcome_verified') resolved++;
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
  minDistinct = 1,
): SafeSignalCandidate[] {
  const cutoffMs = now.getTime() - daysThreshold * 86400000;
  const persistent = reports.filter((r) => {
    const ts = parseValidDate(r.createdAt);
    if (ts === null) return false;
    return r.status !== 'resolved' && r.status !== 'outcome_verified' && ts <= cutoffMs;
  });

  const byCategory = new Map<string, SignalReportInput[]>();
  for (const r of persistent) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  const signals: SafeSignalCandidate[] = [];

  for (const [category, items] of byCategory.entries()) {
    if (items.length < minCohort) continue;
    if (!hasSufficientDistinctReporters(items, minDistinct)) continue;

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
  minDistinct = 1,
): SafeSignalCandidate[] {
  const windowStartMs = now.getTime() - windowDays * 86400000;
  const inWindow = reports
    .filter((r) => {
      const ts = parseValidDate(r.createdAt);
      if (ts === null) return false;
      return ts >= windowStartMs && ts <= now.getTime() + 60000;
    })
    .sort((a, b) => (parseValidDate(a.createdAt) ?? 0) - (parseValidDate(b.createdAt) ?? 0));

  const byCategory = new Map<string, SignalReportInput[]>();
  for (const r of inWindow) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  const signals: SafeSignalCandidate[] = [];

  for (const [category, items] of byCategory.entries()) {
    if (items.length < minCohort) continue;
    if (!hasSufficientDistinctReporters(items, minDistinct)) continue;

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
          unresolvedCount: items.filter((i) => i.status !== 'resolved' && i.status !== 'outcome_verified').length,
          resolvedCount: items.filter((i) => i.status === 'resolved' || i.status === 'outcome_verified').length,
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
 * Detects recurrent hazards where remediated issues were reopened across multiple reports.
 */
export function detectReopenedClusters(
  reports: SignalReportInput[],
  categoryMap: Map<string, string>,
  now: Date,
  windowDays = 30,
  minCohort = SAFE_SIGNAL_MIN_COHORT,
  minDistinct = 1,
): SafeSignalCandidate[] {
  const windowStartMs = now.getTime() - windowDays * 86400000;
  const reopened = reports.filter((r) => {
    const ts = parseValidDate(r.createdAt);
    if (ts === null) return false;
    return r.status === 'reopened' && ts >= windowStartMs && ts <= now.getTime() + 60000;
  });

  const byCategory = new Map<string, SignalReportInput[]>();
  for (const r of reopened) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  const signals: SafeSignalCandidate[] = [];

  for (const [category, items] of byCategory.entries()) {
    if (items.length < minCohort) continue;
    if (!hasSufficientDistinctReporters(items, minDistinct)) continue;

    const severityDist = initializeSeverityDistribution();
    for (const item of items) severityDist[item.severity]++;

    const catLabel = categoryMap.get(category) ?? category;

    signals.push({
      id: `sig_reopened_${category}_${now.toISOString().slice(0, 10)}`,
      rule: 'reopened_cluster',
      title: `Recurrent hazard after resolution: ${catLabel}`,
      category,
      categoryLabel: catLabel,
      severityLevel: getDominantSeverity(severityDist),
      reportCount: items.length,
      timeWindow: `Past ${windowDays} days`,
      severityDistribution: severityDist,
      statusSummary: {
        unresolvedCount: items.length,
        resolvedCount: 0,
        reopenedCount: items.length,
      },
      confidence: 'recurrent_hazard',
      recommendedActions: [
        `Re-examine the original corrective action for structural inadequacy.`,
        `Conduct an on-site joint inspection with workers who operate in the affected zone.`,
        `Establish mandatory monitoring protocol before closing issues in this category.`,
      ],
    });
  }

  return signals;
}

/**
 * Runs the comprehensive Safe Signal rule evaluation suite.
 */
export function analyzeSafeSignals(reports: SignalReportInput[], categories: { key: string; label: string }[], now: Date): SafeSignalCandidate[] {
  const categoryMap = new Map(categories.map((c) => [c.key, c.label]));
  const deduplicated = deduplicateReports(reports);

  // Every rule needs both the report cohort and reporter diversity, so one worker cannot create
  // (or be singled out by) a pattern on their own.
  const k = SAFE_SIGNAL_MIN_COHORT;
  const d = SAFE_SIGNAL_MIN_DISTINCT_REPORTERS;
  const clusters = detectCategoryClusters(deduplicated, categoryMap, now, 14, k, d);
  const persistent = detectPersistentUnresolved(deduplicated, categoryMap, now, 7, k, d);
  const escalations = detectSeverityEscalations(deduplicated, categoryMap, now, 30, k, d);
  const reopened = detectReopenedClusters(deduplicated, categoryMap, now, 30, k, d);

  // Return combined signals sorted by severity weight descending, then report count descending
  return [...clusters, ...persistent, ...escalations, ...reopened].sort((a, b) => {
    const diff = SEVERITY_WEIGHT[b.severityLevel] - SEVERITY_WEIGHT[a.severityLevel];
    if (diff !== 0) return diff;
    return b.reportCount - a.reportCount;
  });
}
