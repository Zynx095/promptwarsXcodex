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
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * Analyzes organization safety reports to detect recurring hazard patterns.
 * Strictly avoids querying or exposing confidential reporter identities.
 */
export function getSafeSignals(ctx: AppContext, org: OrgRow): SafeSignalResponse {
  // Query only privacy-safe aggregation columns; reporter_id and reporter_ref are never selected
  const rows = ctx.db.all<SafeReportRow>(
    `SELECT id, category, severity, status, created_at AS createdAt, resolved_at AS resolvedAt
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
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  }));

  const categories = getIndustry(org.industry).hazardCategories;
  const signals = analyzeSafeSignals(inputs, categories, ctx.now());

  return {
    signals,
    cohortThreshold: SAFE_SIGNAL_MIN_COHORT,
    analyzedReportCount: rows.length,
  };
}
