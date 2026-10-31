// Employer/admin API. All routes require an admin session and are scoped to that admin's organisation.
import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  dateRangeSchema,
  feedbackQuerySchema,
  feedbackStatusSchema,
  evidenceReviewSchema,
  orgSettingsSchema,
  paginationSchema,
  payCheckQuerySchema,
  paymentCreateSchema,
  payslipIssueSchema,
  reportQuerySchema,
  reportTransitionSchema,
  shiftCorrectionSchema,
  shiftQuerySchema,
  siteCreateSchema,
  skillCreateSchema,
  skillVerifySchema,
  workerCreateSchema,
  workerUpdateSchema,
} from '../../shared/schemas';
import { localDate, localRangeToUtc } from '../../shared/time';
import type { SiteCodeDTO, SiteDTO, WorkerDTO } from '../../shared/types';
import { currentSiteCode } from '../auth/siteCode';
import { validatePayRules } from '../../domain/payroll';
import { attendanceState } from '../../domain/attendance';
import type { AppContext } from '../context';
import { HttpError, notFound, param, parse } from '../http';
import { requireRole, requireUser } from '../auth/session';
import { requireOrg, updateOrgSettings } from '../repositories/orgs';
import { createWorker, getWorker, listWorkers, updateWorker } from '../repositories/users';
import { createSite, listSites, toggleSiteActive } from '../repositories/sites';
import { hashPin } from '../auth/crypto';
import { isUniqueViolation } from '../db/db';

import { listOrgShiftsInRange, openShiftWorkerIds, searchOrgShifts, toShiftDTO } from '../repositories/shifts';
import { listAudit, recordAudit } from '../repositories/audit';
import { correctShift, defaultRange } from '../services/attendance';
import { buildDashboard } from '../services/dashboard';
import { getPayslip, issuePayslip, listPayslips, previewPayslip } from '../services/payslips';
import { buildPayrollCsv, type PayrollCsvRow } from '../services/payrollCsv';
import { getAccountabilityMetrics, getReport, listInspections, listOrgReports, transitionReport } from '../services/reports';
import { reviewEvidence } from '../services/evidence';
import { revokePasskey } from '../services/passkeys';
import { feedbackSummary, listFeedback, setFeedbackStatus } from '../services/feedback';
import { acknowledgeAlert, listAlerts } from '../services/fatigue';
import { addSkill, listSkills, setSkillVerification, skillWorkerId } from '../services/skills';
import { getSecretForKey, getShiftReceipts, verifyReceipt } from '../services/receipts';
import { generateCheckpointForOrg, getCheckpointSecretForKey, getIndependentVerificationBundle } from '../services/checkpoints';
import { listCheckpoints } from '../repositories/checkpoints';
import { verifyIndependentBundle } from '../../domain/proof';
import type { IndependentVerificationBundle } from '../../shared/types';
import { getSafeSignals } from '../services/signal';
import { getQrState, refreshQr, startQr, stopQr } from '../services/siteQr';
import { defaultPayCheckRange, listPayments, orgPayCheck, payCheck, recordPayment } from '../services/payments';
import { buildRetentionPanel } from '../services/retention';

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

  r.post('/workers', (req, res) => {
    const { user, org } = session(req);
    const input = parse(workerCreateSchema, req.body);
    const nowIso = ctx.now().toISOString();

    try {
      const created = ctx.db.tx(() => {
        const pinHash = hashPin(input.pin);
        const worker = createWorker(ctx.db, {
          orgId: org.id,
          name: input.name,
          phone: input.phone,
          pinHash,
          jobTitle: input.jobTitle,
          team: input.team,
          hourlyRateMinor: input.hourlyRateMinor,
          nowIso,
        });

        recordAudit(ctx.db, {
          orgId: org.id,
          actorId: user.id,
          entityType: 'worker',
          entityId: worker.id,
          action: 'create',
          after: {
            name: worker.name,
            phone: worker.phone,
            jobTitle: worker.jobTitle,
            team: worker.team,
            hourlyRateMinor: worker.hourlyRateMinor,
          },
          at: nowIso,
        });

        return worker;
      });

      const dto: WorkerDTO = {
        id: created.id,
        name: created.name,
        phone: created.phone,
        jobTitle: created.jobTitle,
        team: created.team,
        hourlyRateMinor: created.hourlyRateMinor,
        active: created.active,
        synthetic: created.synthetic,
        attendanceState: 'not_started',
      };

      res.status(201).json(dto);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError(409, 'PHONE_ALREADY_EXISTS', 'A user with this phone number already exists.');
      }
      throw err;
    }
  });

  // Current rotating site check-in code, for display at the workplace.
  r.get('/site-code', (req, res) => {
    const { org } = session(req);
    const body: SiteCodeDTO = { ...currentSiteCode(ctx.config.sessionSecret, org.id, ctx.now()), requireSiteCode: org.settings.attendance.requireSiteCode };
    res.json(body);
  });

  // ---- Sites ----
  r.get('/sites', (req, res) => {
    const { org } = session(req);
    const items: SiteDTO[] = listSites(ctx.db, org.id);
    res.json({ items });
  });

  r.post('/sites', (req, res) => {
    const { user, org } = session(req);
    const input = parse(siteCreateSchema, req.body);
    const nowIso = ctx.now().toISOString();

    try {
      const site = ctx.db.tx(() => {
        const created = createSite(ctx.db, {
          orgId: org.id,
          name: input.name,
          code: input.code,
          address: input.address,
          nowIso,
        });

        recordAudit(ctx.db, {
          orgId: org.id,
          actorId: user.id,
          entityType: 'site',
          entityId: created.id,
          action: 'create',
          after: created,
          at: nowIso,
        });

        return created;
      });

      res.status(201).json(site);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError(409, 'DUPLICATE_SITE_CODE', 'A site with this code already exists in your organization.');
      }
      throw err;
    }
  });

  r.patch('/sites/:id/status', (req, res) => {
    const { user, org } = session(req);
    const id = param(req, 'id');
    const schema = z.object({ active: z.boolean() });
    const { active } = parse(schema, req.body);
    const ok = toggleSiteActive(ctx.db, org.id, id, active);
    if (!ok) throw notFound('Site');

    recordAudit(ctx.db, {
      orgId: org.id,
      actorId: user.id,
      entityType: 'site',
      entityId: id,
      action: 'update_status',
      after: { active },
      at: ctx.now().toISOString(),
    });

    res.json({ ok: true, active });
  });

  // ---- Rotating site QR check-in display ----
  r.get('/sites/:id/qr', (req, res) => {
    const { org } = session(req);
    res.json(getQrState(ctx, org, param(req, 'id')));
  });
  r.post('/sites/:id/qr/start', (req, res) => {
    const { user, org } = session(req);
    res.json(startQr(ctx, org, user.id, param(req, 'id')));
  });
  r.post('/sites/:id/qr/stop', (req, res) => {
    const { user, org } = session(req);
    res.json(stopQr(ctx, org, user.id, param(req, 'id')));
  });
  r.post('/sites/:id/qr/refresh', (req, res) => {
    const { org } = session(req);
    res.json(refreshQr(ctx, org, param(req, 'id')));
  });

  // ---- Recorded payments and the possible pay shortfall indicator ----
  r.get('/pay-check', (req, res) => {
    const { org } = session(req);
    const q = parse(payCheckQuerySchema, req.query);
    const range = { ...defaultPayCheckRange(ctx, org.timezone), ...q };
    res.json(orgPayCheck(ctx, org, range.from, range.to));
  });
  r.get('/pay-check/:workerId', (req, res) => {
    const { org } = session(req);
    const q = parse(payCheckQuerySchema, req.query);
    const range = { ...defaultPayCheckRange(ctx, org.timezone), ...q };
    res.json(payCheck(ctx, org, param(req, 'workerId'), range.from, range.to));
  });
  r.post('/payments', (req, res) => {
    const { user, org } = session(req);
    res.status(201).json(recordPayment(ctx, org, user.id, parse(paymentCreateSchema, req.body)));
  });
  r.get('/workers/:id/payments', (req, res) => {
    const { org } = session(req);
    const id = param(req, 'id');
    if (!getWorker(ctx.db, org.id, id)) throw notFound('Worker');
    res.json({ items: listPayments(ctx, org.id, id) });
  });

  // ---- Retention attention panel (read-only, rule-based) ----
  r.get('/retention', (req, res) => {
    const { org } = session(req);
    res.json(buildRetentionPanel(ctx, org));
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

  r.get('/payslips/export.csv', (req, res) => {
    const { user, org } = session(req);
    // Validated dates: they are also written into the Content-Disposition header.
    const q = parse(dateRangeSchema, req.query);
    const from = q.from ?? '2000-01-01';
    const to = q.to ?? '2099-12-31';

    const slips = ctx.db.all<PayrollCsvRow>(
      `SELECT p.id, p.worker_id, u.name AS worker_name, u.phone, p.period_start, p.period_end,
              p.currency, p.gross_pay_minor, p.net_pay_minor, p.issued_at, p.breakdown_json
       FROM payslips p
       JOIN users u ON u.id = p.worker_id AND u.org_id = p.org_id
       WHERE p.org_id = @orgId AND p.period_start >= @from AND p.period_end <= @to
       ORDER BY p.period_start DESC, u.name ASC`,
      { orgId: org.id, from, to },
    );

    const csv = buildPayrollCsv(slips);

    recordAudit(ctx.db, {
      orgId: org.id,
      actorId: user.id,
      entityType: 'payroll',
      entityId: org.id,
      action: 'export_csv',
      after: { from, to, recordCount: slips.length },
      at: ctx.now().toISOString(),
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fairshift_payroll_${org.id}_${from}_${to}.csv"`);
    res.send(csv);
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

  r.get('/reports/accountability', (req, res) => {
    const { org } = session(req);
    res.json(getAccountabilityMetrics(ctx, org));
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

  // A person's decision on the advisory analysis of one photo
  r.post('/reports/:id/evidence/:evidenceId/review', (req, res) => {
    const { user } = session(req);
    const report = getReport(ctx, user, param(req, 'id'));
    if (!report) throw notFound('Report');
    const { decision, note } = parse(evidenceReviewSchema, req.body);
    res.json(reviewEvidence(ctx, user, report.id, param(req, 'evidenceId'), decision, note));
  });

  // A worker who lost or replaced their phone: remove their passkeys so they can check in with
  // their sign-in again and register the new phone. Recorded in the audit log.
  r.post('/workers/:id/passkeys/revoke', (req, res) => {
    const { user, org } = session(req);
    const worker = getWorker(ctx.db, org.id, param(req, 'id'));
    if (!worker) throw notFound('Worker');
    res.json({ revoked: revokePasskey(ctx, user.id, org.id, worker.id, null) });
  });

  // Reports that came with photos, for the inspection view
  r.get('/inspections', (req, res) => {
    const { user, org } = session(req);
    res.json({ items: listInspections(ctx, org, user) });
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
      trustStatus: result.trustStatus,
      anchored: Boolean(result.checkpoint),
    });
  });

  r.get('/receipts/:id/bundle', (req, res) => {
    const { org } = session(req);
    const receiptId = param(req, 'id');
    const bundle = getIndependentVerificationBundle(ctx, org.id, receiptId);
    if (!bundle) {
      throw notFound('Independent verification bundle (checkpoint pending)');
    }
    res.json(bundle);
  });

  // ---- Independent Proof Checkpoints ----
  r.get('/checkpoints', (req, res) => {
    const { org } = session(req);
    res.json({ items: listCheckpoints(ctx.db, org.id, 100) });
  });

  r.post('/checkpoints/generate', (req, res) => {
    const { org } = session(req);
    const checkpoint = generateCheckpointForOrg(ctx, org.id);
    res.json({ checkpoint, generated: Boolean(checkpoint) });
  });

  r.post('/checkpoints/verify-bundle', (req, res) => {
    const { org } = session(req);
    const bundle = req.body as IndependentVerificationBundle;
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
      res.status(400).json({ error: { code: 'INVALID_BUNDLE', message: 'Valid verification bundle object required.' } });
      return;
    }
    // Only this organisation's keys may be used as an oracle, and only for this organisation's bundles.
    if (bundle.checkpoint?.orgId !== org.id || bundle.receipt?.orgId !== org.id) {
      res.json({ valid: false, trustStatus: 'wrong_organization', authenticated: false, reason: 'Bundle does not belong to this organisation' });
      return;
    }
    const checkpointKeyId = bundle.checkpoint.keyId;
    if (typeof checkpointKeyId !== 'string' || !Object.hasOwn(ctx.config.checkpointSigningKeys, checkpointKeyId)) {
      res.json({ valid: false, trustStatus: 'unknown_key', authenticated: false, reason: 'Checkpoint key is not recognised' });
      return;
    }
    const receiptKeyId = typeof bundle.receipt.keyId === 'string' ? bundle.receipt.keyId : 'v1';
    const result = verifyIndependentBundle(bundle, getCheckpointSecretForKey(ctx, checkpointKeyId), getSecretForKey(ctx, receiptKeyId));
    res.json(result);
  });

  // ---- Safe Signal (Recurring Hazard Detection) ----
  r.get('/signals', (req, res) => {
    const { org } = session(req);
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    res.json(getSafeSignals(ctx, org, { category }));
  });

  return r;
}
