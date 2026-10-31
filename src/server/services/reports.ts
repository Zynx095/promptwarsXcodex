// Safety reports. Confidential reports never store the reporter's user ID; a keyed reference
// lets only the reporter find their own report again.
import { randomUUID } from 'node:crypto';
import { assertTransition } from '../../domain/safety';
import { calculateAccountabilityMetrics, type AccountabilityEventInput, type AccountabilityReportInput } from '../../domain/accountability';
import { canSeeReporter, type Actor } from '../../domain/access';
import { DomainError } from '../../domain/errors';
import { getIndustry, isHazardCategory } from '../../shared/industries';
import { localDate, localRangeToUtc } from '../../shared/time';
import type { ReportCreateInput } from '../../shared/schemas';
import type { AccountabilityMetricsDTO, ReportEventDTO, ReportStatus, SafetyReportDTO, Severity } from '../../shared/types';
import { nowIso, type AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { reporterRef, scopedReporterRef } from '../auth/crypto';
import { recordAudit } from '../repositories/audit';
import { findSessionUser } from '../repositories/users';
import { invalidateSignalCache } from './signal';
import { createNotification, notifyAdmins } from '../repositories/notifications';
import { notFound } from '../http';
import { countEvidence, listEvidence } from './evidence';
import type { ClosureDTO, EvidenceOutcome, InspectionDTO } from '../../shared/types';

interface ReportRow {
  id: string;
  orgId: string;
  reporterId: string | null;
  reporterRef: string | null;
  reporterName: string | null;
  confidential: number;
  category: string;
  severity: Severity;
  title: string;
  description: string;
  location: string;
  status: ReportStatus;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  actionTaken: string | null;
  followUpDate: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationNote: string | null;
  synthetic: number;
  siteName: string | null;
  inspectionChecks: string;
  workerResponse: 'confirmed' | 'disputed' | null;
  workerResponseNote: string | null;
  workerResponseAt: string | null;
}

const SELECT = `SELECT r.id, r.org_id AS orgId, r.reporter_id AS reporterId, r.reporter_ref AS reporterRef, u.name AS reporterName,
  r.confidential, r.category, r.severity, r.title, r.description, r.location, r.status, r.assignee,
  r.created_at AS createdAt, r.updated_at AS updatedAt, r.resolved_at AS resolvedAt,
  r.action_taken AS actionTaken, r.follow_up_date AS followUpDate, r.verified_at AS verifiedAt,
  r.verified_by AS verifiedBy, r.verification_note AS verificationNote,
  r.is_synthetic AS synthetic, s.name AS siteName, r.inspection_checks AS inspectionChecks,
  r.worker_response AS workerResponse, r.worker_response_note AS workerResponseNote, r.worker_response_at AS workerResponseAt
  FROM safety_reports r LEFT JOIN users u ON u.id = r.reporter_id LEFT JOIN sites s ON s.id = r.site_id AND s.org_id = r.org_id`;

/** How long the reporter has to confirm or dispute a fix before an independent administrator may verify it. */
export const CONFIRMATION_WINDOW_HOURS: Record<Severity, number> = { critical: 24, high: 48, medium: 72, low: 72 };

function closureFor(
  ctx: AppContext,
  row: Pick<ReportRow, 'id' | 'orgId' | 'severity' | 'resolvedAt' | 'workerResponse' | 'workerResponseNote' | 'workerResponseAt'>,
): ClosureDTO {
  const twoKey = countEvidence(ctx, row.orgId, row.id, 'hazard') > 0;
  const escalationAt = row.resolvedAt ? new Date(new Date(row.resolvedAt).getTime() + CONFIRMATION_WINDOW_HOURS[row.severity] * 3_600_000) : null;
  return {
    policy: twoKey ? 'two_key' : 'standard',
    workerResponse: row.workerResponse,
    workerResponseNote: row.workerResponseNote,
    workerResponseAt: row.workerResponseAt,
    escalationAt: escalationAt?.toISOString() ?? null,
    escalationOpen: escalationAt !== null && ctx.now().getTime() >= escalationAt.getTime(),
    remediationPhotos: countEvidence(ctx, row.orgId, row.id, 'remediation'),
  };
}

function isMine(ctx: AppContext, actor: Actor, row: ReportRow): boolean {
  if (row.reporterId === actor.id) return true;
  if (!row.reporterRef) return false;
  const currentRef = scopedReporterRef(ctx.config.signalPseudonymSecret, actor.orgId, actor.id);
  if (row.reporterRef === currentRef) return true;
  const legacyRef1 = reporterRef(ctx.config.signalPseudonymSecret, actor.id);
  if (row.reporterRef === legacyRef1) return true;
  const legacyRef2 = reporterRef(ctx.config.sessionSecret, actor.id);
  return row.reporterRef === legacyRef2;
}

function toDTO(ctx: AppContext, actor: Actor, row: ReportRow): SafetyReportDTO {
  const mine = isMine(ctx, actor, row);
  const confidential = Boolean(row.confidential);
  return {
    id: row.id,
    category: row.category,
    severity: row.severity,
    title: row.title,
    description: row.description,
    location: row.location,
    status: row.status,
    confidential,
    reporterName: canSeeReporter(actor, { confidential, isMine: mine }) ? (mine && confidential ? 'You (confidential)' : row.reporterName) : null,
    isMine: mine,
    assignee: row.assignee,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
    actionTaken: row.actionTaken ?? null,
    followUpDate: row.followUpDate ?? null,
    verifiedAt: row.verifiedAt ?? null,
    verifiedBy: row.verifiedBy ?? null,
    verificationNote: row.verificationNote ?? null,
    synthetic: Boolean(row.synthetic),
    siteName: row.siteName,
    inspectionChecks: JSON.parse(row.inspectionChecks || '[]') as string[],
  };
}

function history(ctx: AppContext, orgId: string, reportId: string, confidential: boolean): ReportEventDTO[] {
  return ctx.db
    .all<{ id: string; fromStatus: ReportStatus | null; toStatus: ReportStatus; note: string; actorRole: string; actorName: string | null; createdAt: string }>(
      `SELECT e.id, e.from_status AS fromStatus, e.to_status AS toStatus, e.note, e.actor_role AS actorRole, u.name AS actorName, e.created_at AS createdAt
       FROM report_events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.report_id = @reportId AND e.org_id = @orgId ORDER BY e.created_at, e.rowid`,
      { reportId, orgId },
    )
    .map((e) => ({
      id: e.id,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      note: e.note,
      actorLabel: e.actorRole === 'reporter' ? (confidential ? 'Reporter (confidential)' : (e.actorName ?? 'Reporter')) : (e.actorName ?? 'Administrator'),
      createdAt: e.createdAt,
    }));
}

export function createReport(
  ctx: AppContext,
  org: OrgRow,
  actor: Actor,
  input: Omit<ReportCreateInput, 'inspectionChecks'> & { inspectionChecks?: ReportCreateInput['inspectionChecks'] },
  opts: { synthetic?: boolean; at?: string } = {},
) {
  if (!isHazardCategory(org.industry, input.category)) {
    throw new DomainError('INVALID_CATEGORY', 'Choose one of the listed hazard categories.');
  }
  const checks = input.inspectionChecks ?? [];
  const offered = getIndustry(org.industry).inspectionChecks;
  if (checks.some((c) => !offered.includes(c))) throw new DomainError('INVALID_CATEGORY', 'Choose from the listed inspection points.');
  const siteId = input.siteId || null;
  if (siteId && !ctx.db.get(`SELECT 1 AS ok FROM sites WHERE id = @siteId AND org_id = @orgId AND active = 1`, { siteId, orgId: org.id })) {
    throw new DomainError('INVALID_CATEGORY', 'Choose one of the listed sites.');
  }
  const id = randomUUID();
  const at = opts.at ?? nowIso(ctx);
  ctx.db.tx(() => {
    ctx.db.run(
      `INSERT INTO safety_reports (id, org_id, reporter_id, reporter_ref, confidential, category, severity, title, description, location, status, created_at, updated_at, is_synthetic, site_id, inspection_checks)
       VALUES (@id, @orgId, @reporterId, @reporterRef, @confidential, @category, @severity, @title, @description, @location, 'submitted', @at, @at, @synthetic, @siteId, @checks)`,
      {
        id,
        orgId: org.id,
        reporterId: input.confidential ? null : actor.id,
        reporterRef: input.confidential ? scopedReporterRef(ctx.config.signalPseudonymSecret, org.id, actor.id) : null,
        confidential: input.confidential,
        category: input.category,
        severity: input.severity,
        title: input.title,
        description: input.description,
        location: input.location,
        at,
        synthetic: opts.synthetic ?? false,
        siteId,
        checks: JSON.stringify(checks),
      },
    );
    ctx.db.run(
      `INSERT INTO report_events (id, org_id, report_id, from_status, to_status, note, actor_id, actor_role, created_at)
       VALUES (@eid, @orgId, @id, NULL, 'submitted', '', @actorId, 'reporter', @at)`,
      { eid: randomUUID(), orgId: org.id, id, actorId: input.confidential ? null : actor.id, at },
    );
    recordAudit(ctx.db, {
      orgId: org.id,
      actorId: input.confidential ? null : actor.id,
      entityType: 'safety_report',
      entityId: id,
      action: 'create',
      after: { severity: input.severity, category: input.category, confidential: input.confidential },
      at,
    });
    if (input.severity === 'critical' || input.severity === 'high') {
      notifyAdmins(ctx.db, {
        orgId: org.id,
        type: 'safety_alert',
        title: `High-Severity Safety Report (${input.severity.toUpperCase()})`,
        body: `A ${input.severity} severity report was filed: "${input.title}" at ${input.location || 'worksite'}.`,
        link: `/admin/reports`,
        nowIso: at,
      });
    }
  });

  invalidateSignalCache(actor.orgId);
  return getReport(ctx, actor, id)!;
}

export function getReport(ctx: AppContext, actor: Actor, id: string): SafetyReportDTO | undefined {
  const row = ctx.db.get<ReportRow>(`${SELECT} WHERE r.id = @id AND r.org_id = @orgId`, { id, orgId: actor.orgId });
  if (!row) return undefined;
  // Workers may only open their own reports.
  if (actor.role !== 'admin' && !isMine(ctx, actor, row)) return undefined;
  return {
    ...toDTO(ctx, actor, row),
    history: history(ctx, actor.orgId, id, Boolean(row.confidential)),
    evidence: listEvidence(ctx, actor.orgId, id),
    closure: closureFor(ctx, row),
  };
}

export function listMyReports(ctx: AppContext, actor: Actor, limit: number): SafetyReportDTO[] {
  const currentRef = scopedReporterRef(ctx.config.signalPseudonymSecret, actor.orgId, actor.id);
  const legacyRef1 = reporterRef(ctx.config.signalPseudonymSecret, actor.id);
  const legacyRef2 = reporterRef(ctx.config.sessionSecret, actor.id);
  return ctx.db
    .all<ReportRow>(
      `${SELECT} WHERE r.org_id = @orgId AND (r.reporter_id = @id OR r.reporter_ref IN (@currentRef, @legacyRef1, @legacyRef2)) ORDER BY r.created_at DESC LIMIT @limit`,
      {
        orgId: actor.orgId,
        id: actor.id,
        currentRef,
        legacyRef1,
        legacyRef2,
        limit,
      },
    )
    .map((r) => toDTO(ctx, actor, r));
}

export interface ReportFilters {
  status?: ReportStatus | 'unresolved';
  severity?: Severity;
  category?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export function listOrgReports(ctx: AppContext, org: OrgRow, actor: Actor, f: ReportFilters) {
  const range = f.from || f.to ? localRangeToUtc(f.from ?? '2000-01-01', f.to ?? '2999-12-31', org.timezone) : null;
  const where = `r.org_id = @orgId
    AND (@status IS NULL OR (@status = 'unresolved' AND r.status NOT IN ('resolved', 'follow_up_pending', 'outcome_verified')) OR r.status = @status)
    AND (@severity IS NULL OR r.severity = @severity)
    AND (@category IS NULL OR r.category = @category)
    AND (@start IS NULL OR r.created_at >= @start)
    AND (@end IS NULL OR r.created_at < @end)`;
  const params = {
    orgId: org.id,
    status: f.status ?? null,
    severity: f.severity ?? null,
    category: f.category ?? null,
    start: range?.start ?? null,
    end: range?.end ?? null,
  };
  const items = ctx.db
    .all<ReportRow>(
      `${SELECT} WHERE ${where}
       ORDER BY CASE WHEN r.status IN ('resolved', 'outcome_verified') THEN 1 ELSE 0 END,
         CASE r.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, r.created_at DESC
       LIMIT @limit OFFSET @offset`,
      { ...params, limit: f.limit, offset: f.offset },
    )
    .map((r) => toDTO(ctx, actor, r));
  const total = ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM safety_reports r WHERE ${where}`, params)!.n;
  return { items, total, limit: f.limit, offset: f.offset };
}

export type ReportTransitionArg = {
  to: ReportStatus;
  note?: string;
  assignee?: string | null;
  actionTaken?: string | null;
  followUpDate?: string | null;
  verifiedBy?: string | null;
  verificationNote?: string | null;
};

export function transitionReport(ctx: AppContext, actor: Actor, id: string, input: ReportTransitionArg, opts: { at?: string } = {}) {
  const at = opts.at ?? nowIso(ctx);
  ctx.db.tx(() => {
    const row = ctx.db.get<{
      status: ReportStatus;
      assignee: string | null;
      severity: Severity;
      resolvedAt: string | null;
      workerResponse: string | null;
      reporterActive: number | null;
      reporterId: string | null;
    }>(
      `SELECT r.status, r.assignee, r.severity, r.resolved_at AS resolvedAt, r.worker_response AS workerResponse,
         r.reporter_id AS reporterId, u.active AS reporterActive
       FROM safety_reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.id = @id AND r.org_id = @orgId`,
      { id, orgId: actor.orgId },
    );
    if (!row) throw notFound('Report');
    const note = input.note || '';
    assertTransition(row.status, input.to, note);

    // Two-key closure, for reports that came with photos of the hazard
    const twoKey = countEvidence(ctx, actor.orgId, id, 'hazard') > 0;
    if (twoKey && input.to === 'resolved' && countEvidence(ctx, actor.orgId, id, 'remediation') === 0) {
      throw new DomainError(
        'REMEDIATION_PHOTO_REQUIRED',
        'Add a photo of the fixed hazard before marking it resolved, so the reporter can compare before and after.',
      );
    }
    let escalated = false;
    if (twoKey && input.to === 'outcome_verified' && row.workerResponse !== 'confirmed') {
      const deadline = row.resolvedAt ? new Date(row.resolvedAt).getTime() + CONFIRMATION_WINDOW_HOURS[row.severity] * 3_600_000 : null;
      const reporterGone = row.reporterId !== null && row.reporterActive === 0;
      if (!reporterGone && (deadline === null || ctx.now().getTime() < deadline)) {
        throw new DomainError(
          'AWAITING_REPORTER',
          deadline === null
            ? 'The reporter has not confirmed the fix yet.'
            : `The reporter has not confirmed the fix yet. If they do not answer, an administrator other than the one who resolved it can verify the outcome after ${new Date(deadline).toISOString()}.`,
        );
      }
      const resolver = ctx.db.get<{ actor_id: string | null }>(
        `SELECT actor_id FROM report_events WHERE report_id = @id AND to_status = 'resolved' ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        { id },
      );
      if (resolver?.actor_id === actor.id) {
        throw new DomainError(
          'SELF_VERIFICATION_DISALLOWED',
          'Without the reporter confirming the fix, the outcome must be verified by an administrator other than the one who resolved it.',
        );
      }
      escalated = true;
    }
    const assignee = input.assignee === undefined ? row.assignee : input.assignee || null;
    const actionTaken = input.actionTaken !== undefined ? input.actionTaken : null;
    const followUpDate = input.followUpDate !== undefined ? input.followUpDate : null;

    let verifiedBy: string | null = null;
    let verificationNote: string | null = null;
    if (input.to === 'outcome_verified') {
      const orgRow = ctx.db.get<{ settings_json: string }>(`SELECT settings_json FROM organizations WHERE id = @orgId`, { orgId: actor.orgId });
      let requireIndependent = false;
      if (orgRow) {
        try {
          const settings = JSON.parse(orgRow.settings_json);
          requireIndependent = Boolean(settings.safety?.requireIndependentVerification);
        } catch {
          requireIndependent = false;
        }
      }

      const lastResolver = ctx.db.get<{ actor_id: string }>(
        `SELECT actor_id FROM report_events WHERE report_id = @id AND to_status = 'resolved' ORDER BY created_at DESC LIMIT 1`,
        { id },
      );
      // The account that resolved the report is the same one verifying it. A free-text "verifiedBy"
      // name typed by that account is an attestation, not independent verification.
      const isResolver = Boolean(lastResolver && lastResolver.actor_id === actor.id);
      const attestedName = input.verifiedBy?.trim() || null;

      if (isResolver && requireIndependent) {
        throw new DomainError(
          'SELF_VERIFICATION_DISALLOWED',
          'Organization policy requires an independent auditor or third party to verify outcome resolution; self-verification by the resolving administrator is disallowed.',
        );
      }

      const actorUser = findSessionUser(ctx.db, actor.id);
      const actorName = actorUser?.name || 'Admin';
      if (attestedName) {
        verifiedBy = isResolver ? `${attestedName} (recorded by resolving administrator ${actorName})` : attestedName;
      } else {
        verifiedBy = isResolver ? `${actorName} (Self-verification)` : actorName;
      }
      verificationNote = input.verificationNote?.trim() || note.trim();
      if (escalated) verifiedBy = `${verifiedBy} (escalated: the reporter did not confirm in time)`;
    }

    const changed = ctx.db.run(
      `UPDATE safety_reports SET
         status = @to,
         assignee = @assignee,
         updated_at = @at,
         resolved_at = CASE
           WHEN @to = 'resolved' THEN @at
           WHEN @to IN ('follow_up_pending', 'outcome_verified') AND resolved_at IS NOT NULL THEN resolved_at
           WHEN @to = 'reopened' THEN NULL
           ELSE resolved_at
         END,
         action_taken = CASE WHEN @actionTaken IS NOT NULL THEN @actionTaken ELSE action_taken END,
         follow_up_date = CASE WHEN @followUpDate IS NOT NULL THEN @followUpDate ELSE follow_up_date END,
         verified_at = CASE WHEN @to = 'outcome_verified' THEN @at WHEN @to = 'reopened' THEN NULL ELSE verified_at END,
         verified_by = CASE WHEN @to = 'outcome_verified' THEN @verifiedBy WHEN @to = 'reopened' THEN NULL ELSE verified_by END,
         verification_note = CASE WHEN @to = 'outcome_verified' THEN @verificationNote WHEN @to = 'reopened' THEN NULL ELSE verification_note END,
         worker_response = CASE WHEN @to IN ('resolved', 'reopened') THEN NULL ELSE worker_response END,
         worker_response_note = CASE WHEN @to IN ('resolved', 'reopened') THEN NULL ELSE worker_response_note END,
         worker_response_at = CASE WHEN @to IN ('resolved', 'reopened') THEN NULL ELSE worker_response_at END
       WHERE id = @id AND org_id = @orgId AND status = @from`,
      {
        id,
        orgId: actor.orgId,
        to: input.to,
        from: row.status,
        assignee,
        at,
        actionTaken,
        followUpDate,
        verifiedBy,
        verificationNote,
      },
    );
    if (changed !== 1) throw new DomainError('CONFLICT', 'This report was changed by someone else. Reload and try again.');
    ctx.db.run(
      `INSERT INTO report_events (id, org_id, report_id, from_status, to_status, note, actor_id, actor_role, created_at)
       VALUES (@eid, @orgId, @id, @from, @to, @note, @actorId, 'admin', @at)`,
      { eid: randomUUID(), orgId: actor.orgId, id, from: row.status, to: input.to, note: input.note || '', actorId: actor.id, at },
    );
    recordAudit(ctx.db, {
      orgId: actor.orgId,
      actorId: actor.id,
      entityType: 'safety_report',
      entityId: id,
      action: 'status_change',
      before: { status: row.status, assignee: row.assignee },
      after: { status: input.to, assignee, actionTaken, followUpDate },
      reason: input.note || null,
      at,
    });
    const reportRow = ctx.db.get<{ reporter_id: string | null; title: string }>(
      `SELECT reporter_id, title FROM safety_reports WHERE id = @id AND org_id = @orgId`,
      { id, orgId: actor.orgId },
    );
    if (reportRow?.reporter_id) {
      createNotification(ctx.db, {
        orgId: actor.orgId,
        userId: reportRow.reporter_id,
        type: 'safety_update',
        title: twoKey && input.to === 'resolved' ? 'Check the fix to your safety report' : `Safety Report Status: ${input.to.replace(/_/g, ' ')}`,
        body:
          twoKey && input.to === 'resolved'
            ? `Your safety report "${reportRow.title}" was marked fixed, with a photo. Compare it with your photo and confirm the fix or say what is still wrong.`
            : `Your safety report "${reportRow.title}" status changed to ${input.to.replace(/_/g, ' ')}.${input.note ? ` Note: ${input.note}` : ''}`,
        link: twoKey && input.to === 'resolved' ? `/worker/reports/${id}` : '/worker/reports',
        nowIso: at,
      });
    }
  });

  invalidateSignalCache(actor.orgId);
  return getReport(ctx, actor, id)!;
}

export function reportCounts(ctx: AppContext, orgId: string) {
  return ctx.db.all<{ status: ReportStatus; severity: Severity }>(
    `SELECT status, severity FROM safety_reports WHERE org_id = @orgId AND status NOT IN ('resolved', 'follow_up_pending', 'outcome_verified') LIMIT 10000`,
    { orgId },
  );
}

export function getAccountabilityMetrics(ctx: AppContext, org: OrgRow): AccountabilityMetricsDTO {
  const reports = ctx.db.all<AccountabilityReportInput>(
    `SELECT id, category, severity, status, created_at AS createdAt, resolved_at AS resolvedAt,
            follow_up_date AS followUpDate, action_taken AS actionTaken, verified_at AS verifiedAt, verified_by AS verifiedBy
     FROM safety_reports
     WHERE org_id = @orgId
     ORDER BY created_at DESC
     LIMIT 5000`,
    { orgId: org.id },
  );

  const events = ctx.db.all<AccountabilityEventInput>(
    `SELECT report_id AS reportId, from_status AS fromStatus, to_status AS toStatus, created_at AS createdAt
     FROM report_events
     WHERE org_id = @orgId
     ORDER BY created_at ASC`,
    { orgId: org.id },
  );

  const todayIso = localDate(ctx.now(), org.timezone);
  return calculateAccountabilityMetrics(reports, events, todayIso);
}

/**
 * The reporter's answer to a fix: confirm it, or dispute it (which reopens the report). Works for
 * confidential reports through the reporter's keyed reference; no identity is added to the record.
 */
export function respondToFix(ctx: AppContext, actor: Actor, id: string, decision: 'confirmed' | 'disputed', note: string) {
  const at = nowIso(ctx);
  ctx.db.tx(() => {
    const row = ctx.db.get<ReportRow>(`${SELECT} WHERE r.id = @id AND r.org_id = @orgId`, { id, orgId: actor.orgId });
    if (!row || !isMine(ctx, actor, row)) throw notFound('Report');
    if (row.status !== 'resolved' && row.status !== 'follow_up_pending') {
      throw new DomainError('INVALID_TRANSITION', 'You can confirm or dispute a fix only after the report is marked resolved.');
    }
    if (row.workerResponse) throw new DomainError('CONFLICT', 'You have already answered for this fix.');
    const confidential = Boolean(row.confidential);
    const actorId = confidential ? null : actor.id;
    if (decision === 'confirmed') {
      ctx.db.run(
        `UPDATE safety_reports SET worker_response = 'confirmed', worker_response_note = @note, worker_response_at = @at, updated_at = @at
         WHERE id = @id AND org_id = @orgId AND worker_response IS NULL`,
        { id, orgId: actor.orgId, note: note.trim() || null, at },
      );
      ctx.db.run(
        `INSERT INTO report_events (id, org_id, report_id, from_status, to_status, note, actor_id, actor_role, created_at)
         VALUES (@eid, @orgId, @id, @status, @status, @note, @actorId, 'reporter', @at)`,
        {
          eid: randomUUID(),
          orgId: actor.orgId,
          id,
          status: row.status,
          note: `Reporter confirmed the fix.${note.trim() ? ` ${note.trim()}` : ''}`,
          actorId,
          at,
        },
      );
    } else {
      assertTransition(row.status, 'reopened', note);
      ctx.db.run(
        `UPDATE safety_reports SET status = 'reopened', resolved_at = NULL, verified_at = NULL, verified_by = NULL, verification_note = NULL,
           worker_response = NULL, worker_response_note = NULL, worker_response_at = NULL, updated_at = @at
         WHERE id = @id AND org_id = @orgId AND status = @from`,
        { id, orgId: actor.orgId, from: row.status, at },
      );
      ctx.db.run(
        `INSERT INTO report_events (id, org_id, report_id, from_status, to_status, note, actor_id, actor_role, created_at)
         VALUES (@eid, @orgId, @id, @from, 'reopened', @note, @actorId, 'reporter', @at)`,
        { eid: randomUUID(), orgId: actor.orgId, id, from: row.status, note: `Reporter disputed the fix: ${note.trim()}`, actorId, at },
      );
    }
    recordAudit(ctx.db, {
      orgId: actor.orgId,
      actorId,
      entityType: 'safety_report',
      entityId: id,
      action: decision === 'confirmed' ? 'fix_confirmed' : 'fix_disputed',
      before: { status: row.status },
      after: { status: decision === 'confirmed' ? row.status : 'reopened' },
      reason: note.trim() || null,
      at,
    });
    notifyAdmins(ctx.db, {
      orgId: actor.orgId,
      type: decision === 'confirmed' ? 'safety_update' : 'safety_alert',
      title: decision === 'confirmed' ? 'Reporter confirmed a fix' : 'Reporter disputed a fix',
      body:
        decision === 'confirmed'
          ? `The reporter of "${row.title}" confirmed the fix. The outcome can now be verified.`
          : `The reporter of "${row.title}" says the hazard is not fixed: ${note.trim()}. The report is open again.`,
      link: `/admin/reports/${id}`,
      nowIso: at,
    });
  });
  invalidateSignalCache(actor.orgId);
  return getReport(ctx, actor, id)!;
}

const OUTCOME_RANK: Record<EvidenceOutcome, number> = {
  potential_hazard: 4,
  ppe_may_be_missing: 3,
  manual_inspection_required: 2,
  unable_to_determine: 1,
  no_visible_issue: 0,
};

/** Reports that came with photos, newest first, with their photo, review and closure state. */
export function listInspections(ctx: AppContext, org: OrgRow, actor: Actor, limit = 100): InspectionDTO[] {
  const rows = ctx.db.all<ReportRow>(
    `${SELECT} WHERE r.org_id = @orgId AND EXISTS (SELECT 1 FROM report_evidence e WHERE e.report_id = r.id AND e.org_id = r.org_id)
     ORDER BY CASE WHEN r.status = 'outcome_verified' THEN 1 ELSE 0 END, r.created_at DESC LIMIT @limit`,
    { orgId: org.id, limit },
  );
  return rows.map((row) => {
    const evidence = listEvidence(ctx, org.id, row.id);
    const hazard = evidence.filter((e) => e.stage === 'hazard');
    const remediation = evidence.filter((e) => e.stage === 'remediation');
    const analysed = evidence.filter((e) => e.analysis);
    const worst = analysed.reduce<EvidenceOutcome | null>(
      (w, e) => (w === null || OUTCOME_RANK[e.analysis!.outcome] > OUTCOME_RANK[w] ? e.analysis!.outcome : w),
      null,
    );
    return {
      report: toDTO(ctx, actor, row),
      hazardPhotos: hazard.length,
      remediationPhotos: remediation.length,
      worstOutcome: worst,
      analysedPhotos: analysed.length,
      pendingReviews: analysed.filter((e) => e.reviewStatus === 'pending').length,
      beforeId: hazard[0]?.id ?? null,
      afterId: remediation[remediation.length - 1]?.id ?? null,
      closure: closureFor(ctx, row),
    };
  });
}
