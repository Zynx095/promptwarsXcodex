// Worker-facing API. Every handler acts on the signed-in worker's own records only.
import { Router, type Request } from 'express';
import { checkInSchema, dateRangeSchema, feedbackCreateSchema, paginationSchema, reportCreateSchema, skillCreateSchema } from '../../shared/schemas';
import { addDays, localDate, localRangeToUtc } from '../../shared/time';
import type { AppContext } from '../context';
import { notFound, param, parse } from '../http';
import { requireRole, requireUser } from '../auth/session';
import { requireOrg } from '../repositories/orgs';
import { listWorkerShifts, toShiftDTO } from '../repositories/shifts';
import { attendanceStatus, checkIn, checkOut, defaultRange } from '../services/attendance';
import { getPayslip, listPayslips, previewPayslip } from '../services/payslips';
import { createReport, getReport, listMyReports } from '../services/reports';
import { submitFeedback } from '../services/feedback';
import { listAlerts } from '../services/fatigue';
import { addSkill, listSkills } from '../services/skills';
import { getShiftReceipts, verifyReceipt } from '../services/receipts';
import { getShift } from '../repositories/shifts';
import { canViewWorkerRecord } from '../../domain/access';

export function workerRoutes(ctx: AppContext): Router {
  const r = Router();
  const worker = requireRole('worker');
  const session = (req: Request) => {
    const user = requireUser(req);
    return { user, org: requireOrg(ctx.db, user.orgId) };
  };

  // ---- Attendance ----
  r.get('/attendance/status', worker, (req, res) => {
    const { user, org } = session(req);
    res.json(attendanceStatus(ctx, org, user.id));
  });

  r.post('/attendance/check-in', worker, (req, res) => {
    const { user, org } = session(req);
    const { siteCode } = parse(checkInSchema, req.body ?? {});
    res.status(201).json(checkIn(ctx, org, user.id, siteCode));
  });

  r.post('/attendance/check-out', worker, (req, res) => {
    const { user, org } = session(req);
    res.json(checkOut(ctx, org, user.id));
  });

  r.get('/attendance/shifts', worker, (req, res) => {
    const { user, org } = session(req);
    const q = parse(dateRangeSchema, req.query);
    const range = { ...defaultRange(ctx, org.timezone, 30), ...q };
    const { start, end } = localRangeToUtc(range.from, range.to, org.timezone);
    const shifts = listWorkerShifts(ctx.db, user.id, start, end, 200).map((s) => toShiftDTO(s, org.timezone));
    res.json({ range, items: shifts });
  });

  // ---- Payslips ----
  r.get('/payslips', worker, (req, res) => {
    const { user } = session(req);
    const p = parse(paginationSchema, req.query);
    res.json(listPayslips(ctx, user.orgId, user.id, p.limit, p.offset));
  });

  r.get('/payslips/preview', worker, (req, res) => {
    const { user, org } = session(req);
    const q = parse(dateRangeSchema, req.query);
    const today = localDate(ctx.now(), org.timezone);
    // Default: current week to date (Monday start).
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const from = q.from ?? addDays(today, -dow);
    const to = q.to ?? today;
    res.json(previewPayslip(ctx, org, user.id, from, to));
  });

  r.get('/payslips/:id', worker, (req, res) => {
    const { user } = session(req);
    const slip = getPayslip(ctx, user.orgId, param(req, 'id'));
    // Not-found and not-yours look identical so identifiers cannot be probed.
    if (!slip || !canViewWorkerRecord(user, { orgId: user.orgId, workerId: slip.workerId })) throw notFound('Payslip');
    res.json(slip);
  });

  // ---- Safety reports ----
  r.post('/reports', worker, (req, res) => {
    const { user, org } = session(req);
    const input = parse(reportCreateSchema, req.body);
    res.status(201).json(createReport(ctx, org, user, input));
  });

  r.get('/reports/mine', worker, (req, res) => {
    const { user } = session(req);
    res.json({ items: listMyReports(ctx, user, 100) });
  });

  // Shared by workers (own reports only) and admins (any report in their organisation).
  r.get('/reports/:id', (req, res) => {
    const user = requireUser(req);
    const report = getReport(ctx, user, param(req, 'id'));
    if (!report) throw notFound('Report');
    res.json(report);
  });

  // ---- Feedback ----
  r.post('/feedback', worker, (req, res) => {
    const { org } = session(req);
    submitFeedback(ctx, org, parse(feedbackCreateSchema, req.body));
    res.status(201).json({ ok: true });
  });

  // ---- Fatigue-risk alerts about the worker's own hours ----
  r.get('/alerts/mine', worker, (req, res) => {
    const { user } = session(req);
    res.json({ items: listAlerts(ctx, user.orgId, { workerId: user.id, limit: 50 }) });
  });

  // ---- Skill passport ----
  r.get('/skills/mine', worker, (req, res) => {
    const { user, org } = session(req);
    res.json({ items: listSkills(ctx, org, user.id) });
  });

  r.post('/skills', worker, (req, res) => {
    const { user, org } = session(req);
    const id = addSkill(ctx, org, user, user.id, parse(skillCreateSchema, req.body));
    res.status(201).json({ id });
  });

  // ---- FairShift Proof (Work Receipts) ----
  r.get('/receipts/shift/:shiftId', worker, (req, res) => {
    const { user, org } = session(req);
    const shiftId = param(req, 'shiftId');
    const shift = getShift(ctx.db, org.id, shiftId);
    if (!shift || !canViewWorkerRecord(user, { orgId: org.id, workerId: shift.workerId })) {
      throw notFound('Shift receipt');
    }
    res.json(getShiftReceipts(ctx, org.id, shiftId));
  });

  r.get('/receipts/:id', worker, (req, res) => {
    const { user, org } = session(req);
    const receiptId = param(req, 'id');
    const result = verifyReceipt(ctx, org.id, receiptId);
    if (!canViewWorkerRecord(user, { orgId: org.id, workerId: result.receipt.workerId })) {
      throw notFound('Work receipt');
    }
    res.json(result);
  });

  r.get('/receipts/:id/verify', worker, (req, res) => {
    const { user, org } = session(req);
    const receiptId = param(req, 'id');
    const result = verifyReceipt(ctx, org.id, receiptId);
    if (!canViewWorkerRecord(user, { orgId: org.id, workerId: result.receipt.workerId })) {
      throw notFound('Work receipt');
    }
    res.json({
      receiptId,
      version: result.receipt.version,
      canonicalDigest: result.receipt.canonicalDigest,
      verified: result.verified,
    });
  });

  return r;
}
