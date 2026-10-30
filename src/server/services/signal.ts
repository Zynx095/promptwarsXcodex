import type { AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { getIndustry } from '../../shared/industries';
import { analyzeSafeSignals, SAFE_SIGNAL_MIN_COHORT, type SignalReportInput } from '../../domain/signal';
import { signalAggregationKey } from '../auth/crypto';
import type { SafeSignalResponse, Severity } from '../../shared/types';

interface SafeReportRow {
  id: string;
  category: string;
  severity: Severity;
  status: string;
  location: string | null;
  title: string;
  createdAt: string;
  resolvedAt: string | null;
  reporterKey: string | null;
}

interface SignalCacheEntry {
  cachedAtMs: number;
  response: SafeSignalResponse;
}

const signalCache = new Map<string, SignalCacheEntry>();

export function invalidateSignalCache(orgId?: string): void {
  if (!orgId) {
    signalCache.clear();
    return;
  }
  for (const key of signalCache.keys()) {
    if (key.startsWith(`${orgId}:`)) {
      signalCache.delete(key);
    }
  }
}

export function clearSignalCache(): void {
  signalCache.clear();
}

/**
 * Analyzes organization safety reports to detect recurring hazard patterns.
 * Strictly avoids querying or exposing confidential reporter identities.
 * Enforces one-way pseudonymization of in-memory reporter keys and stable snapshot caching.
 */
export function getSafeSignals(ctx: AppContext, org: OrgRow, opts: { category?: string; forceRefresh?: boolean } = {}): SafeSignalResponse {
  const cacheKey = `${org.id}:${opts.category || '*'}`;
  const nowMs = ctx.now().getTime();
  const cached = signalCache.get(cacheKey);

  // Return cached snapshot within 15-second window unless forceRefresh requested
  if (!opts.forceRefresh && cached && nowMs - cached.cachedAtMs < 15_000 && nowMs >= cached.cachedAtMs) {
    return cached.response;
  }

  // Query only privacy-safe aggregation columns; reporter_id and reporter_ref are converted
  // into an opaque internal pseudonym (reporterKey) and NEVER returned to the client.
  const rows = ctx.db.all<SafeReportRow>(
    `SELECT id, category, severity, status, location, title,
            created_at AS createdAt, resolved_at AS resolvedAt,
            COALESCE(reporter_ref, reporter_id) AS reporterKey
     FROM safety_reports
     WHERE org_id = @orgId
     ORDER BY created_at DESC
     LIMIT 5000`,
    { orgId: org.id },
  );

  // Cryptographically transform reporterKey with domain separation so raw user IDs never exist in domain memory
  const inputs: SignalReportInput[] = rows.map((r) => ({
    id: r.id,
    category: r.category,
    severity: r.severity,
    status: r.status,
    location: r.location,
    title: r.title,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    reporterKey: r.reporterKey ? signalAggregationKey(ctx.config.signalPseudonymSecret, org.id, r.reporterKey) : null,
  }));

  const categories = getIndustry(org.industry).hazardCategories;
  let signals = analyzeSafeSignals(inputs, categories, ctx.now());

  if (opts.category) {
    const targetCat = opts.category.trim();
    signals = signals.filter((s) => s.category === targetCat);
  }

  const response: SafeSignalResponse = {
    signals,
    cohortThreshold: SAFE_SIGNAL_MIN_COHORT,
    analyzedReportCount: rows.length,
  };

  signalCache.set(cacheKey, { cachedAtMs: nowMs, response });
  return response;
}
