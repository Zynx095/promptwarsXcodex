import type { ReportStatus, Severity } from '../shared/types';
import { isUnresolved } from './safety';

export interface AccountabilityReportInput {
  id: string;
  category: string;
  severity: Severity;
  status: ReportStatus;
  createdAt: string;
  resolvedAt: string | null;
  followUpDate?: string | null;
  actionTaken?: string | null;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
}

export interface AccountabilityEventInput {
  reportId: string;
  fromStatus: ReportStatus | null;
  toStatus: ReportStatus;
  createdAt: string;
}

export interface AccountabilityMetricsResult {
  totalReports: number;
  openReports: number;
  resolvedCount: number;
  followUpPendingCount: number;
  verifiedCount: number;
  reopenedCount: number;
  meanTimeToAcknowledgeMinutes: number | null;
  meanTimeToResolveMinutes: number | null;
  meanTimeToVerifyMinutes?: number | null;
  verificationRatePercent: number;
  reopenRatePercent: number;
  overdueFollowUps: number;
}

/**
 * Calculates deterministic safety accountability metrics from reports and event audit trails.
 */
export function calculateAccountabilityMetrics(
  reports: AccountabilityReportInput[],
  events: AccountabilityEventInput[],
  todayIso: string,
): AccountabilityMetricsResult {
  const totalReports = reports.length;
  const openReports = reports.filter((r) => isUnresolved(r.status)).length;
  const resolvedCount = reports.filter((r) => r.status === 'resolved').length;
  const followUpPendingCount = reports.filter((r) => r.status === 'follow_up_pending').length;
  const verifiedCount = reports.filter((r) => r.status === 'outcome_verified').length;

  // Track unique reports that were ever reopened
  const reopenedSet = new Set<string>();
  for (const e of events) {
    if (e.toStatus === 'reopened') {
      reopenedSet.add(e.reportId);
    }
  }
  const reopenedCount = reopenedSet.size;

  // Group events by report
  const eventsByReport = new Map<string, AccountabilityEventInput[]>();
  for (const e of events) {
    const list = eventsByReport.get(e.reportId) ?? [];
    list.push(e);
    eventsByReport.set(e.reportId, list);
  }

  // Calculate Mean Time to Acknowledge (MTTA)
  let totalAckMinutes = 0;
  let ackCount = 0;

  for (const report of reports) {
    const reportEvents = eventsByReport.get(report.id) ?? [];
    const ackEvent = reportEvents.find((e) => e.toStatus === 'acknowledged');
    if (ackEvent) {
      const createdTime = new Date(report.createdAt).getTime();
      const ackTime = new Date(ackEvent.createdAt).getTime();
      if (!isNaN(createdTime) && !isNaN(ackTime) && ackTime >= createdTime) {
        totalAckMinutes += Math.round((ackTime - createdTime) / 60000);
        ackCount++;
      }
    }
  }

  const meanTimeToAcknowledgeMinutes = ackCount > 0 ? Math.round(totalAckMinutes / ackCount) : null;

  // Calculate Mean Time to Resolve (MTTR)
  let totalResolveMinutes = 0;
  let resolveCount = 0;

  for (const report of reports) {
    const reportEvents = eventsByReport.get(report.id) ?? [];
    const resolveEvent = reportEvents.find((e) => e.toStatus === 'resolved');
    if (resolveEvent) {
      const createdTime = new Date(report.createdAt).getTime();
      const resTime = new Date(resolveEvent.createdAt).getTime();
      if (!isNaN(createdTime) && !isNaN(resTime) && resTime >= createdTime) {
        totalResolveMinutes += Math.round((resTime - createdTime) / 60000);
        resolveCount++;
      }
    } else if (report.resolvedAt) {
      const createdTime = new Date(report.createdAt).getTime();
      const resTime = new Date(report.resolvedAt).getTime();
      if (!isNaN(createdTime) && !isNaN(resTime) && resTime >= createdTime) {
        totalResolveMinutes += Math.round((resTime - createdTime) / 60000);
        resolveCount++;
      }
    }
  }

  const meanTimeToResolveMinutes = resolveCount > 0 ? Math.round(totalResolveMinutes / resolveCount) : null;

  // Calculate Mean Time to Independently Verify Outcome (MTTV)
  let totalVerifyMinutes = 0;
  let verifyCount = 0;

  for (const report of reports) {
    const reportEvents = eventsByReport.get(report.id) ?? [];
    const verifyEvent = reportEvents.find((e) => e.toStatus === 'outcome_verified');
    if (verifyEvent) {
      const createdTime = new Date(report.createdAt).getTime();
      const verTime = new Date(verifyEvent.createdAt).getTime();
      if (!isNaN(createdTime) && !isNaN(verTime) && verTime >= createdTime) {
        totalVerifyMinutes += Math.round((verTime - createdTime) / 60000);
        verifyCount++;
      }
    } else if (report.verifiedAt) {
      const createdTime = new Date(report.createdAt).getTime();
      const verTime = new Date(report.verifiedAt).getTime();
      if (!isNaN(createdTime) && !isNaN(verTime) && verTime >= createdTime) {
        totalVerifyMinutes += Math.round((verTime - createdTime) / 60000);
        verifyCount++;
      }
    }
  }

  const meanTimeToVerifyMinutes = verifyCount > 0 ? Math.round(totalVerifyMinutes / verifyCount) : null;

  // Outcome verification rate: verified / (resolved + followUpPending + verified)
  const totalCompletedAction = resolvedCount + followUpPendingCount + verifiedCount;
  const verificationRatePercent = totalCompletedAction > 0 ? Math.round((verifiedCount / totalCompletedAction) * 100) : 0;

  // Reopen rate: reopened / (totalCompletedAction + reopened)
  const totalResolutionCycles = totalCompletedAction + reopenedCount;
  const reopenRatePercent = totalResolutionCycles > 0 ? Math.round((reopenedCount / totalResolutionCycles) * 100) : 0;

  // Overdue follow ups: follow_up_pending with followUpDate < today
  const overdueFollowUps = reports.filter((r) => r.status === 'follow_up_pending' && r.followUpDate && r.followUpDate < todayIso).length;

  return {
    totalReports,
    openReports,
    resolvedCount,
    followUpPendingCount,
    verifiedCount,
    reopenedCount,
    meanTimeToAcknowledgeMinutes,
    meanTimeToResolveMinutes,
    ...(meanTimeToVerifyMinutes !== null ? { meanTimeToVerifyMinutes } : {}),
    verificationRatePercent,
    reopenRatePercent,
    overdueFollowUps,
  };
}
