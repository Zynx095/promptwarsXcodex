// Safety reports. Confidential reports never store the reporter's user ID; a keyed reference
// lets only the reporter find their own report again.
import { randomUUID } from 'node:crypto';
import { assertTransition } from '../../domain/safety';
import { calculateAccountabilityMetrics, type AccountabilityEventInput, type AccountabilityReportInput } from '../../domain/accountability';
import { canSeeReporter, type Actor } from '../../domain/access';
import { DomainError } from '../../domain/errors';
import { isHazardCategory } from '../../shared/industries';
import { localDate, localRangeToUtc } from '../../shared/time';
import type { ReportCreateInput } from '../../shared/schemas';
import type { AccountabilityMetricsDTO, ReportEventDTO, ReportStatus, SafetyReportDTO, Severity } from '../../shared/types';
import { nowIso, type AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { reporterRef, scopedReporterRef } from '../auth/crypto';
import { recordAudit } from '../repositories/audit';
import { findSessionUser } from '../repositories/users';
import { invalidateSignalCache } from './signal';
import { notFound } from '../http';

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
}

const SELECT = `SELECT r.id, r.org_id AS orgId, r.reporter_id AS reporterId, r.reporter_ref AS reporterRef, u.name AS reporterName,
  r.confidential, r.category, r.severity, r.title, r.description, r.location, r.status, r.assignee,
  r.created_at AS createdAt, r.updated_at AS updatedAt, r.resolved_at AS resolvedAt,
  r.action_taken AS actionTaken, r.follow_up_date AS followUpDate, r.verified_at AS verifiedAt,
  r.verified_by AS verifiedBy, r.verification_note AS verificationNote,
  r.is_synthetic AS synthetic
  FROM safety_reports r LEFT JOIN users u ON u.id = r.reporter_id`;

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

export function createReport(ctx: AppContext, org: OrgRow, actor: Actor, input: ReportCreateInput, opts: { synthetic?: boolean; at?: string } = {}) {
  if (!isHazardCategory(org.industry, input.category)) {
    throw new DomainError('INVALID_CATEGORY', 'Choose one of the listed hazard categories.');
  }
  const id = randomUUID();
  const at = opts.at ?? nowIso(ctx);
  ctx.db.tx(() => {
    ctx.db.run(
      `INSERT INTO safety_reports (id, org_id, reporter_id, reporter_ref, confidential, category, severity, title, description, location, status, created_at, updated_at, is_synthetic)
       VALUES (@id, @orgId, @reporterId, @reporterRef, @confidential, @category, @severity, @title, @description, @location, 'submitted', @at, @at, @synthetic)`,
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
  });
  invalidateSignalCache(actor.orgId);
  return getReport(ctx, actor, id)!;
}

export function getReport(ctx: AppContext, actor: Actor, id: string): SafetyReportDTO | undefined {
  const row = ctx.db.get<ReportRow>(`${SELECT} WHERE r.id = @id AND r.org_id = @orgId`, { id, orgId: actor.orgId });
  if (!row) return undefined;
  // Workers may only open their own reports.
  if (actor.role !== 'admin' && !isMine(ctx, actor, row)) return undefined;
  return { ...toDTO(ctx, actor, row), history: history(ctx, actor.orgId, id, Boolean(row.confidential)) };
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
    const row = ctx.db.get<{ status: ReportStatus; assignee: string | null }>(
      `SELECT status, assignee FROM safety_reports WHERE id = @id AND org_id = @orgId`,
      { id, orgId: actor.orgId },
    );
    if (!row) throw notFound('Report');
    const note = input.note || '';
    assertTransition(row.status, input.to, note);
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
      const isSelfVerification = Boolean(lastResolver && lastResolver.actor_id === actor.id && !input.verifiedBy);

      if (isSelfVerification && requireIndependent) {
        throw new DomainError(
          'SELF_VERIFICATION_DISALLOWED',
          'Organization policy requires an independent auditor or third party to verify outcome resolution; self-verification by the resolving administrator is disallowed.',
        );
      }

      verifiedBy = input.verifiedBy?.trim() || null;
      if (!verifiedBy) {
        const actorUser = findSessionUser(ctx.db, actor.id);
        const actorName = actorUser?.name || 'Admin';
        verifiedBy = isSelfVerification ? `${actorName} (Self-verification)` : actorName || 'Safety Officer';
      }
      verificationNote = input.verificationNote?.trim() || note.trim();
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
         verification_note = CASE WHEN @to = 'outcome_verified' THEN @verificationNote WHEN @to = 'reopened' THEN NULL ELSE verification_note END
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
