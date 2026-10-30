import type { AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { getIndustry } from '../../shared/industries';
import { analyzeSafeSignals, SAFE_SIGNAL_MIN_COHORT, type SignalReportInput } from '../../domain/signal';
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

/**
 * Analyzes organization safety reports to detect recurring hazard patterns.
 * Strictly avoids querying or exposing confidential reporter identities.
 */
export function getSafeSignals(ctx: AppContext, org: OrgRow, opts: { category?: string } = {}): SafeSignalResponse {
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

  const inputs: SignalReportInput[] = rows.map((r) => ({
    id: r.id,
    category: r.category,
    severity: r.severity,
    status: r.status,
    location: r.location,
    title: r.title,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    reporterKey: r.reporterKey,
  }));

  const categories = getIndustry(org.industry).hazardCategories;
  let signals = analyzeSafeSignals(inputs, categories, ctx.now());

  if (opts.category) {
    const targetCat = opts.category.trim();
    signals = signals.filter((s) => s.category === targetCat);
  }

  return {
    signals,
    cohortThreshold: SAFE_SIGNAL_MIN_COHORT,
    analyzedReportCount: rows.length,
  };
}
