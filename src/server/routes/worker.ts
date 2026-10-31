// Worker-facing API. Every handler acts on the signed-in worker's own records only.
import { Router, type Request } from 'express';
import {
  checkInSchema,
  checkOutSchema,
  passkeyRegistrationSchema,
  type PasskeyAssertion,
  dateRangeSchema,
  evidenceUploadSchema,
  feedbackCreateSchema,
  fixResponseSchema,
  paginationSchema,
  payCheckQuerySchema,
  qrResolveSchema,
  reportCreateSchema,
  skillCreateSchema,
} from '../../shared/schemas';
import { addDays, localDate, localRangeToUtc } from '../../shared/time';
import type { AppContext } from '../context';
import { notFound, param, parse } from '../http';
import { requireRole, requireUser } from '../auth/session';
import { requireOrg } from '../repositories/orgs';
import { listWorkerShifts, toShiftDTO } from '../repositories/shifts';
import { attendanceStatus, checkIn, checkOut, defaultRange, type AttendanceProof } from '../services/attendance';
import {
  attendanceOptions,
  listPasskeys,
  passkeyRequired,
  registerPasskey,
  registrationOptions,
  revokePasskey,
  verifyAttendancePasskey,
} from '../services/passkeys';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { SessionUserRow } from '../repositories/users';
import { DomainError } from '../../domain/errors';
import { z } from 'zod';
import { getPayslip, listPayslips, previewPayslip } from '../services/payslips';
import { createReport, getReport, listMyReports, respondToFix } from '../services/reports';
import { addEvidence, getEvidenceImage, verifyEvidence } from '../services/evidence';
import { listSites } from '../repositories/sites';
import { RateLimiter } from '../rateLimit';
import { submitFeedback } from '../services/feedback';
import { listAlerts } from '../services/fatigue';
import { addSkill, listSkills } from '../services/skills';
import { getShiftReceipts, verifyReceipt } from '../services/receipts';
import { getIndependentVerificationBundle } from '../services/checkpoints';
import { getShift } from '../repositories/shifts';
import { canViewWorkerRecord } from '../../domain/access';
import { describeQr, resolveQrToken } from '../services/siteQr';
import { defaultPayCheckRange, payCheck } from '../services/payments';

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

  // A worker with a registered passkey must prove it is them with a fresh passkey check for every
  // check-in and check-out; the server verifies it before anything is recorded.
  const passkeyAttempts = new RateLimiter(20, 15 * 60_000, 'Too many passkey attempts. Wait 15 minutes and try again.');
  async function attendanceProof(user: SessionUserRow, purpose: 'check-in' | 'check-out', assertion: PasskeyAssertion | undefined): Promise<AttendanceProof> {
    if (!passkeyRequired(ctx, user.id)) return { auth: 'session' };
    if (!assertion) throw new DomainError('PASSKEY_REQUIRED', 'Confirm it is you with your passkey to continue.');
    passkeyAttempts.take(user.id, ctx.now().getTime());
    const { label } = await verifyAttendancePasskey(ctx, user, purpose, assertion as AuthenticationResponseJSON);
    return { auth: 'passkey', credentialLabel: label };
  }

  r.post('/attendance/passkey-options', worker, async (req, res) => {
    const { user } = session(req);
    const { action } = parse(z.object({ action: z.enum(['check-in', 'check-out']) }), req.body);
    passkeyAttempts.take(user.id, ctx.now().getTime());
    res.json(await attendanceOptions(ctx, user, action));
  });

  r.post('/attendance/check-in', worker, async (req, res) => {
    const { user, org } = session(req);
    const { siteCode, qrToken, passkey, queuedAt } = parse(checkInSchema, req.body ?? {});
    // A bad or expired QR code fails before the passkey check, so the worker is not asked twice
    if (qrToken) resolveQrToken(ctx, org, qrToken);
    const proof = await attendanceProof(user, 'check-in', passkey);
    res.status(201).json(checkIn(ctx, org, user.id, siteCode, proof, { qrToken, queuedAt }));
  });

  r.post('/attendance/check-out', worker, async (req, res) => {
    const { user, org } = session(req);
    const { passkey, queuedAt } = parse(checkOutSchema, req.body ?? {});
    const proof = await attendanceProof(user, 'check-out', passkey);
    res.json(checkOut(ctx, org, user.id, proof, queuedAt));
  });

  // What a scanned site QR code points to, so the worker can confirm before anything is recorded
  const qrLookups = new RateLimiter(30, 15 * 60_000, 'Too many QR scans. Wait a few minutes and try again.');
  r.post('/attendance/qr/resolve', worker, (req, res) => {
    const { user, org } = session(req);
    const { token } = parse(qrResolveSchema, req.body ?? {});
    qrLookups.take(user.id, ctx.now().getTime());
    res.json(describeQr(ctx, org, user.id, token));
  });

  // ---- Passkeys: register, list and remove this worker's own ----
  r.get('/passkeys', worker, (req, res) => {
    const { user } = session(req);
    res.json(listPasskeys(ctx, user.id));
  });

  r.post('/passkeys/register-options', worker, async (req, res) => {
    const { user } = session(req);
    passkeyAttempts.take(user.id, ctx.now().getTime());
    res.json(await registrationOptions(ctx, user));
  });

  r.post('/passkeys/register', worker, async (req, res) => {
    const { user } = session(req);
    const { response, label } = parse(passkeyRegistrationSchema, req.body);
    res.status(201).json(await registerPasskey(ctx, user, response as RegistrationResponseJSON, label));
  });

  r.post('/passkeys/:id/revoke', worker, (req, res) => {
    const { user } = session(req);
    if (revokePasskey(ctx, user.id, user.orgId, user.id, param(req, 'id')) === 0) throw notFound('Passkey');
    res.json(listPasskeys(ctx, user.id));
  });

  r.get('/attendance/shifts', worker, (req, res) => {
    const { user, org } = session(req);
    const q = parse(dateRangeSchema, req.query);
    const range = { ...defaultRange(ctx, org.timezone, 30), ...q };
    const { start, end } = localRangeToUtc(range.from, range.to, org.timezone);
    const shifts = listWorkerShifts(ctx.db, user.id, start, end, 200).map((s) => toShiftDTO(s, org.timezone));
    res.json({ range, items: shifts });
  });

  // ---- Pay check: verified hours at the configured rate vs payments recorded by the employer ----
  r.get('/pay-check', worker, (req, res) => {
    const { user, org } = session(req);
    const q = parse(payCheckQuerySchema, req.query);
    const range = { ...defaultPayCheckRange(ctx, org.timezone), ...q };
    res.json(payCheck(ctx, org, user.id, range.from, range.to));
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

  // ---- Safety photos (reporters add the hazard, administrators the fix) ----
  const uploads = new RateLimiter(30, 60 * 60_000, 'Too many photos in the last hour. Try again later.');
  r.post('/reports/:id/evidence', async (req, res) => {
    const user = requireUser(req);
    const org = requireOrg(ctx.db, user.orgId);
    const report = getReport(ctx, user, param(req, 'id'));
    if (!report) throw notFound('Report');
    const upload = parse(evidenceUploadSchema, req.body);
    uploads.take(user.id, ctx.now().getTime());
    res.status(201).json(await addEvidence(ctx, org, user, report, upload));
  });

  r.get('/reports/:id/evidence/:evidenceId/image', (req, res) => {
    const user = requireUser(req);
    const report = getReport(ctx, user, param(req, 'id'));
    if (!report) throw notFound('Photo');
    const image = getEvidenceImage(ctx, user.orgId, report.id, param(req, 'evidenceId'));
    if (!image) throw notFound('Photo');
    // Private to this person's session: never stored by shared caches, never sniffed as another type
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', image.mime);
    res.setHeader('Content-Disposition', 'inline; filename="safety-photo"');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.end(image.bytes);
  });

  r.get('/reports/:id/evidence/:evidenceId/verify', (req, res) => {
    const user = requireUser(req);
    const report = getReport(ctx, user, param(req, 'id'));
    if (!report) throw notFound('Photo');
    const result = verifyEvidence(ctx, user.orgId, report.id, param(req, 'evidenceId'));
    if (!result) throw notFound('Photo');
    res.json(result);
  });

  r.post('/reports/:id/response', worker, (req, res) => {
    const { user } = session(req);
    const { decision, note } = parse(fixResponseSchema, req.body);
    res.json(respondToFix(ctx, user, param(req, 'id'), decision, note));
  });

  // Active sites, so a report can say where the hazard is
  r.get('/sites', worker, (req, res) => {
    const { org } = session(req);
    res.json({
      items: listSites(ctx.db, org.id)
        .filter((s) => s.active)
        .map((s) => ({ id: s.id, name: s.name })),
    });
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
      trustStatus: result.trustStatus,
      anchored: Boolean(result.checkpoint),
    });
  });

  r.get('/receipts/:id/bundle', worker, (req, res) => {
    const { user, org } = session(req);
    const receiptId = param(req, 'id');
    const result = verifyReceipt(ctx, org.id, receiptId);
    if (!canViewWorkerRecord(user, { orgId: org.id, workerId: result.receipt.workerId })) {
      throw notFound('Work receipt');
    }
    const bundle = getIndependentVerificationBundle(ctx, org.id, receiptId);
    if (!bundle) {
      throw notFound('Independent verification bundle (checkpoint pending)');
    }
    res.json(bundle);
  });

  return r;
}
