// Recorded wage payments and the pay check (expected vs recorded) built on them. Payments are
// what the employer records as paid; FairShift never transfers, deducts or edits money.
import { randomUUID } from 'node:crypto';
import { dailyBreakdown, totals } from '../../domain/attendance';
import { DomainError } from '../../domain/errors';
import { assessPayShortfall } from '../../domain/payShortfall';
import type { PaymentCreateInput } from '../../shared/schemas';
import { addDays, localDate, localRangeToUtc } from '../../shared/time';
import type { PayCheckDTO, PayCheckSummaryDTO, PaymentDTO, PaymentMethod, ShortfallStatus } from '../../shared/types';
import { nowIso, type AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { listWorkerShifts } from '../repositories/shifts';
import { getWorker, listWorkers } from '../repositories/users';
import { recordAudit } from '../repositories/audit';
import { createNotification } from '../repositories/notifications';
import { notFound } from '../http';

interface PaymentRow {
  id: string;
  workerId: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: number;
  kind: 'payment' | 'adjustment';
  method: PaymentMethod;
  paidOn: string;
  reference: string;
  note: string;
  recordedByName: string | null;
  createdAt: string;
  synthetic: number;
}

const SELECT = `SELECT p.id, p.worker_id AS workerId, p.period_start AS periodStart, p.period_end AS periodEnd, p.amount_minor AS amountMinor,
  p.kind, p.method, p.paid_on AS paidOn, p.reference, p.note, u.name AS recordedByName, p.created_at AS createdAt, p.is_synthetic AS synthetic
  FROM wage_payments p LEFT JOIN users u ON u.id = p.recorded_by`;

const toDTO = (r: PaymentRow): PaymentDTO => ({ ...r, synthetic: Boolean(r.synthetic) });

/** Payments for one worker whose covered period overlaps [from, to]. */
function overlapping(ctx: AppContext, orgId: string, workerId: string, from: string, to: string): PaymentDTO[] {
  return ctx.db
    .all<PaymentRow>(
      `${SELECT} WHERE p.org_id = @orgId AND p.worker_id = @workerId AND p.period_start <= @to AND p.period_end >= @from
       ORDER BY p.paid_on DESC, p.created_at DESC`,
      { orgId, workerId, from, to },
    )
    .map(toDTO);
}

export function listPayments(ctx: AppContext, orgId: string, workerId: string, limit = 100): PaymentDTO[] {
  return ctx.db
    .all<PaymentRow>(`${SELECT} WHERE p.org_id = @orgId AND p.worker_id = @workerId ORDER BY p.paid_on DESC, p.created_at DESC LIMIT @limit`, {
      orgId,
      workerId,
      limit,
    })
    .map(toDTO);
}

export function orgHasPayments(ctx: AppContext, orgId: string): boolean {
  return Boolean(ctx.db.get(`SELECT 1 AS ok FROM wage_payments WHERE org_id = @orgId LIMIT 1`, { orgId }));
}

export function recordPayment(
  ctx: AppContext,
  org: OrgRow,
  actorId: string | null,
  input: PaymentCreateInput,
  opts: { synthetic?: boolean; at?: string; notify?: boolean } = {},
): PaymentDTO {
  const worker = getWorker(ctx.db, org.id, input.workerId);
  if (!worker) throw notFound('Worker');
  const today = localDate(ctx.now(), org.timezone);
  if (input.paidOn > today) throw new DomainError('INVALID_PAYMENT', 'The payment date cannot be in the future.');
  const id = randomUUID();
  const at = opts.at ?? nowIso(ctx);
  ctx.db.tx(() => {
    ctx.db.run(
      `INSERT INTO wage_payments (id, org_id, worker_id, period_start, period_end, amount_minor, kind, method, paid_on, reference, note, recorded_by, created_at, is_synthetic)
       VALUES (@id, @orgId, @workerId, @periodStart, @periodEnd, @amountMinor, @kind, @method, @paidOn, @reference, @note, @actorId, @at, @synthetic)`,
      { id, orgId: org.id, ...input, actorId, at, synthetic: opts.synthetic ?? org.synthetic },
    );
    recordAudit(ctx.db, {
      orgId: org.id,
      actorId,
      entityType: 'wage_payment',
      entityId: id,
      action: input.kind === 'adjustment' ? 'record_adjustment' : 'record_payment',
      after: { workerId: input.workerId, periodStart: input.periodStart, periodEnd: input.periodEnd, method: input.method, paidOn: input.paidOn },
      reason: input.note || null,
      at,
    });
    if (opts.notify !== false) {
      createNotification(ctx.db, {
        orgId: org.id,
        userId: worker.id,
        type: 'system',
        title: 'Payment recorded',
        body: `Your employer recorded a ${input.kind} for ${input.periodStart} to ${input.periodEnd}. Open Pay to compare it with your verified hours.`,
        link: '/worker/payslips',
        nowIso: at,
      });
    }
  });
  return toDTO(ctx.db.get<PaymentRow>(`${SELECT} WHERE p.id = @id`, { id })!);
}

/** Expected earnings from verified shifts vs recorded payments for one worker and period. */
export function payCheck(ctx: AppContext, org: OrgRow, workerId: string, from: string, to: string): PayCheckDTO {
  const worker = getWorker(ctx.db, org.id, workerId);
  if (!worker) throw notFound('Worker');
  const { start, end } = localRangeToUtc(from, to, org.timezone);
  const shifts = listWorkerShifts(ctx.db, workerId, start, end, 2000);
  const closed = shifts.filter((s) => s.checkOutAt);
  const t = totals(dailyBreakdown(closed, org.timezone, org.settings.pay.scheduledDailyMinutes));
  const all = overlapping(ctx, org.id, workerId, from, to);
  const payments = all.filter((p) => p.periodStart >= from && p.periodEnd <= to);
  const excludedPayments = all.filter((p) => !(p.periodStart >= from && p.periodEnd <= to));
  const result = assessPayShortfall({
    hourlyRateMinor: worker.hourlyRateMinor,
    rules: org.settings.pay,
    regularMinutes: t.regularMinutes,
    overtimeMinutes: t.overtimeMinutes,
    openShiftsExcluded: shifts.length - closed.length,
    payments,
    excludedPayments: excludedPayments.length,
  });
  return {
    workerId,
    workerName: worker.name,
    jobTitle: worker.jobTitle,
    period: { from, to },
    currency: org.currency,
    rate: {
      hourlyRateMinor: worker.hourlyRateMinor,
      overtimeMultiplierBp: org.settings.pay.overtimeMultiplierBp,
      scheduledDailyMinutes: org.settings.pay.scheduledDailyMinutes,
      deductions: org.settings.pay.deductions,
    },
    shiftsCounted: closed.length,
    openShiftsExcluded: shifts.length - closed.length,
    result,
    payments,
    excludedPayments,
    synthetic: org.synthetic,
  };
}

export function orgPayCheck(ctx: AppContext, org: OrgRow, from: string, to: string): PayCheckSummaryDTO {
  const counts: Record<ShortfallStatus, number> = { no_discrepancy: 0, possible_shortfall: 0, requires_review: 0, unavailable: 0 };
  const items = listWorkers(ctx.db, org.id)
    .filter((w) => w.active)
    .map((w) => {
      const c = payCheck(ctx, org, w.id, from, to);
      counts[c.result.status]++;
      return {
        workerId: w.id,
        workerName: w.name,
        jobTitle: w.jobTitle,
        team: w.team,
        status: c.result.status,
        expectedNetMinor: c.result.expected?.netPayMinor ?? null,
        recordedMinor: c.result.recordedMinor,
        outstandingMinor: c.result.outstandingMinor,
        paymentCount: c.result.paymentCount,
      };
    });
  return { period: { from, to }, currency: org.currency, counts, items, paymentsRecorded: orgHasPayments(ctx, org.id) };
}

/** Default pay-check period: the current calendar month up to today (organisation time). */
export function defaultPayCheckRange(ctx: AppContext, timeZone: string): { from: string; to: string } {
  const to = localDate(ctx.now(), timeZone);
  return { from: `${to.slice(0, 8)}01`, to };
}

/** The previous calendar month, for seed data and quick navigation. */
export function previousMonth(date: string): { from: string; to: string } {
  const firstThis = `${date.slice(0, 8)}01`;
  const lastPrev = addDays(firstThis, -1);
  return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev };
}
