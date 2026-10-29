// Employer/admin API. All routes require an admin session and are scoped to that admin's organisation.
import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  dateRangeSchema,
  feedbackQuerySchema,
  feedbackStatusSchema,
  orgSettingsSchema,
  paginationSchema,
  payslipIssueSchema,
  reportQuerySchema,
  reportTransitionSchema,
  shiftCorrectionSchema,
  shiftQuerySchema,
  skillCreateSchema,
  skillVerifySchema,
  workerUpdateSchema,
} from '../../shared/schemas';
import { localDate, localRangeToUtc } from '../../shared/time';
import type { SiteCodeDTO, WorkerDTO } from '../../shared/types';
import { currentSiteCode } from '../auth/siteCode';
import { validatePayRules } from '../../domain/payroll';
import { attendanceState } from '../../domain/attendance';
import type { AppContext } from '../context';
import { notFound, param, parse } from '../http';
import { requireRole, requireUser } from '../auth/session';
import { requireOrg, updateOrgSettings } from '../repositories/orgs';
import { getWorker, listWorkers, updateWorker } from '../repositories/users';
import { listOrgShiftsInRange, openShiftWorkerIds, searchOrgShifts, toShiftDTO } from '../repositories/shifts';
import { listAudit, recordAudit } from '../repositories/audit';
import { correctShift, defaultRange } from '../services/attendance';
import { buildDashboard } from '../services/dashboard';
import { getPayslip, issuePayslip, listPayslips, previewPayslip } from '../services/payslips';
import { getReport, listOrgReports, transitionReport } from '../services/reports';
import { feedbackSummary, listFeedback, setFeedbackStatus } from '../services/feedback';
import { acknowledgeAlert, listAlerts } from '../services/fatigue';
import { addSkill, listSkills, setSkillVerification, skillWorkerId } from '../services/skills';
import { getShiftReceipts, verifyReceipt } from '../services/receipts';

export function adminRoutes(ctx: AppContext): Router {
  const r = Router();
  r.use(requireRole('admin'));
  const session = (req: Request) => {
    const user = requireUser(req);
    return { user, org: requireOrg(ctx.db, user.orgId) };
  };

  r.get('/dashboard', (req, res) => {
    const { org } = session(req);
    const q = parse(dateRangeSchema, req.query);
    const range = { ...defaultRange(ctx, org.timezone, 14), ...q };
    res.json(buildDashboard(ctx, org, range.from, range.to));
  });

  // ---- Workforce ----
  r.get('/workers', (req, res) => {
    const { org } = session(req);
    const today = localDate(ctx.now(), org.timezone);
    const { start, end } = localRangeToUtc(today, today, org.timezone);
    const open = openShiftWorkerIds(ctx.db, org.id);
    const todays = listOrgShiftsInRange(ctx.db, org.id, start, end);
    const items: WorkerDTO[] = listWorkers(ctx.db, org.id).map((w) => ({
      id: w.id,
      name: w.name,
      phone: w.phone,
      jobTitle: w.jobTitle,
      team: w.team,
      hourlyRateMinor: w.hourlyRateMinor,
      active: w.active,
      synthetic: w.synthetic,
      attendanceState: attendanceState(
        todays.filter((s) => s.workerId === w.id),
        open.has(w.id) ? { checkInAt: '', checkOutAt: null } : null,
      ),
    }));
    res.json({ items });
  });

  r.patch('/workers/:id', (req, res) => {
    const { user, org } = session(req);
    const id = param(req, 'id');
    const patch = parse(workerUpdateSchema, req.body);
    const before = getWorker(ctx.db, org.id, id);
    if (!before) throw notFound('Worker');
    ctx.db.tx(() => {
      updateWorker(ctx.db, org.id, id, patch);
      recordAudit(ctx.db, {
        orgId: org.id,
        actorId: user.id,
        entityType: 'worker',
        entityId: id,
        action: 'update',
        before: { hourlyRateMinor: before.hourlyRateMinor, active: before.active },
        after: patch,
        at: ctx.now().toISOString(),
      });
    });
    res.json({ ok: true });
  });

  // Current rotating site check-in code, for display at the workplace.
  r.get('/site-code', (req, res) => {
    const { org } = session(req);
    const body: SiteCodeDTO = { ...currentSiteCode(ctx.config.sessionSecret, org.id, ctx.now()), requireSiteCode: org.settings.attendance.requireSiteCode };
    res.json(body);
  });

  // ---- Shifts ----
  r.get('/shifts', (req, res) => {
    const { org } = session(req);
    const q = parse(shiftQuerySchema, req.query);
    const range = q.from || q.to ? localRangeToUtc(q.from ?? '2000-01-01', q.to ?? '2999-12-31', org.timezone) : null;
    const { items, total } = searchOrgShifts(ctx.db, org.id, {
      workerId: q.workerId,
      status: q.status,
      start: range?.start,
      end: range?.end,
      limit: q.limit,
      offset: q.offset,
    });
    res.json({ items: items.map((s) => toShiftDTO(s, org.timezone)), total, limit: q.limit, offset: q.offset });
  });

  r.patch('/shifts/:id', (req, res) => {
    const { user, org } = session(req);
    res.json(correctShift(ctx, org, user.id, param(req, 'id'), parse(shiftCorrectionSchema, req.body)));
  });

  r.get('/audit', (req, res) => {
    const { org } = session(req);
    const q = parse(paginationSchema.extend({ entityType: z.string().max(40).optional(), entityId: z.string().max(64).optional() }), req.query);
    res.json(listAudit(ctx.db, org.id, q));
  });

  // ---- Pay and fatigue rules ----
  r.get('/settings', (req, res) => {
    res.json(session(req).org.settings);
  });

  r.put('/settings', (req, res) => {
    const { user, org } = session(req);
    const settings = parse(orgSettingsSchema, req.body);
    validatePayRules(settings.pay);
    ctx.db.tx(() => {
      updateOrgSettings(ctx.db, org.id, settings);
      recordAudit(ctx.db, {
        orgId: org.id,
        actorId: user.id,
        entityType: 'org_settings',
        entityId: org.id,
        action: 'update',
        before: org.settings,
        after: settings,
        at: ctx.now().toISOString(),
      });
    });
    res.json(settings);
  });

  // ---- Payslips ----
  r.get('/payslips', (req, res) => {
    const { org } = session(req);
    const q = parse(paginationSchema.extend({ workerId: z.string().max(64).optional() }), req.query);
    res.json(listPayslips(ctx, org.id, q.workerId ?? null, q.limit, q.offset));
  });

  r.get('/payslips/preview', (req, res) => {
    const { org } = session(req);
    const q = parse(payslipIssueSchema, req.query);
    res.json(previewPayslip(ctx, org, q.workerId, q.from, q.to));
  });

  r.post('/payslips', (req, res) => {
    const { user, org } = session(req);
    const q = parse(payslipIssueSchema, req.body);
    res.status(201).json(issuePayslip(ctx, org, user.id, q.workerId, q.from, q.to));
  });

  r.get('/payslips/:id', (req, res) => {
    const { org } = session(req);
    const slip = getPayslip(ctx, org.id, param(req, 'id'));
    if (!slip) throw notFound('Payslip');
    res.json(slip);
  });

  // ---- Safety reports ----
  r.get('/reports', (req, res) => {
    const { user, org } = session(req);
    res.json(listOrgReports(ctx, org, user, parse(reportQuerySchema, req.query)));
  });

  r.post('/reports/:id/transition', (req, res) => {
    const { user } = session(req);
    res.json(transitionReport(ctx, user, param(req, 'id'), parse(reportTransitionSchema, req.body)));
  });

  r.get('/reports/:id', (req, res) => {
    const { user } = session(req);
    const report = getReport(ctx, user, param(req, 'id'));
    if (!report) throw notFound('Report');
    res.json(report);
  });

  // ---- Feedback ----
  r.get('/feedback', (req, res) => {
    const { org } = session(req);
    res.json(listFeedback(ctx, org.id, parse(feedbackQuerySchema, req.query)));
  });

  r.get('/feedback/summary', (req, res) => {
    res.json(feedbackSummary(ctx, session(req).org));
  });

  r.patch('/feedback/:id', (req, res) => {
    const { user, org } = session(req);
    setFeedbackStatus(ctx, org.id, user.id, param(req, 'id'), parse(feedbackStatusSchema, req.body).status);
    res.json({ ok: true });
  });

  // ---- Fatigue-risk alerts ----
  r.get('/alerts', (req, res) => {
    const { org } = session(req);
    const q = parse(z.object({ status: z.enum(['open', 'acknowledged']).optional(), workerId: z.string().max(64).optional() }), req.query);
    res.json({ items: listAlerts(ctx, org.id, { ...q, limit: 200 }) });
  });

  r.post('/alerts/:id/acknowledge', (req, res) => {
    const { user, org } = session(req);
    if (!acknowledgeAlert(ctx, org.id, user.id, param(req, 'id'))) throw notFound('Open alert');
    res.json({ ok: true });
  });

  // ---- Skill records ----
  r.get('/workers/:id/skills', (req, res) => {
    const { org } = session(req);
    const id = param(req, 'id');
    if (!getWorker(ctx.db, org.id, id)) throw notFound('Worker');
    res.json({ items: listSkills(ctx, org, id) });
  });

  r.post('/workers/:id/skills', (req, res) => {
    const { user, org } = session(req);
    const id = param(req, 'id');
    if (!getWorker(ctx.db, org.id, id)) throw notFound('Worker');
    res.status(201).json({ id: addSkill(ctx, org, user, id, parse(skillCreateSchema, req.body)) });
  });

  r.patch('/skills/:id', (req, res) => {
    const { user, org } = session(req);
    const id = param(req, 'id');
    if (!skillWorkerId(ctx, org.id, id)) throw notFound('Skill record');
    setSkillVerification(ctx, org, user.id, id, parse(skillVerifySchema, req.body).verified);
    res.json({ ok: true });
  });

  // ---- FairShift Proof (Work Receipts) ----
  r.get('/receipts/shift/:shiftId', (req, res) => {
    const { org } = session(req);
    const shiftId = param(req, 'shiftId');
    res.json(getShiftReceipts(ctx, org.id, shiftId));
  });

  r.get('/receipts/:id', (req, res) => {
    const { org } = session(req);
    const receiptId = param(req, 'id');
    res.json(verifyReceipt(ctx, org.id, receiptId));
  });

  r.get('/receipts/:id/verify', (req, res) => {
    const { org } = session(req);
    const receiptId = param(req, 'id');
    const result = verifyReceipt(ctx, org.id, receiptId);
    res.json({
      receiptId,
      version: result.receipt.version,
      canonicalDigest: result.receipt.canonicalDigest,
      verified: result.verified,
    });
  });

  return r;
}
