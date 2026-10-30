// Payslip preview and issue. Hours always come from recorded shifts; issued payslips are
// immutable snapshots of the calculation at the time of issue.
import { randomUUID } from 'node:crypto';
import { buildPayBreakdown } from '../../domain/payroll';
import { DomainError } from '../../domain/errors';
import { localRangeToUtc } from '../../shared/time';
import type { PayBreakdown, PayslipDTO, PayslipListItem } from '../../shared/types';
import { nowIso, type AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { getWorker } from '../repositories/users';
import { listWorkerShifts } from '../repositories/shifts';
import { recordAudit } from '../repositories/audit';
import { markReceiptsFinalizedForPeriod } from '../repositories/receipts';
import { createNotification } from '../repositories/notifications';
import { notFound } from '../http';

export function previewPayslip(ctx: AppContext, org: OrgRow, workerId: string, from: string, to: string): PayslipDTO {
  const worker = getWorker(ctx.db, org.id, workerId);
  if (!worker) throw notFound('Worker');
  const { start, end } = localRangeToUtc(from, to, org.timezone);
  const shifts = listWorkerShifts(ctx.db, workerId, start, end, 1000);
  const breakdown = buildPayBreakdown(shifts, worker.hourlyRateMinor, org.settings.pay, org.timezone);
  return {
    id: null,
    workerId,
    workerName: worker.name,
    periodStart: from,
    periodEnd: to,
    status: 'preview',
    issuedAt: null,
    synthetic: org.synthetic,
    currency: org.currency,
    breakdown,
  };
}

export function issuePayslip(
  ctx: AppContext,
  org: OrgRow,
  actorId: string | null,
  workerId: string,
  from: string,
  to: string,
  opts: { synthetic?: boolean } = {},
): PayslipDTO {
  return ctx.db.tx(() => {
    const preview = previewPayslip(ctx, org, workerId, from, to);
    if (preview.breakdown.openShiftsExcluded > 0) {
      throw new DomainError('CONFLICT', 'This worker has an open shift in this period. Close or correct it before issuing a payslip.');
    }
    const exists = ctx.db.get<{ id: string }>(`SELECT id FROM payslips WHERE worker_id = @workerId AND period_start = @from AND period_end = @to`, {
      workerId,
      from,
      to,
    });
    if (exists) throw new DomainError('CONFLICT', 'A payslip has already been issued for this worker and period.');
    const id = randomUUID();
    const at = nowIso(ctx);
    ctx.db.run(
      `INSERT INTO payslips (id, org_id, worker_id, period_start, period_end, currency, breakdown_json, gross_pay_minor, net_pay_minor, issued_by, issued_at, is_synthetic)
       VALUES (@id, @orgId, @workerId, @from, @to, @currency, @json, @gross, @net, @actorId, @at, @synthetic)`,
      {
        id,
        orgId: org.id,
        workerId,
        from,
        to,
        currency: org.currency,
        json: JSON.stringify(preview.breakdown),
        gross: preview.breakdown.grossPayMinor,
        net: preview.breakdown.netPayMinor,
        actorId,
        at,
        synthetic: opts.synthetic ?? org.synthetic,
      },
    );
    // Audit records the issue event only; pay amounts are not duplicated into the audit log.
    recordAudit(ctx.db, { orgId: org.id, actorId, entityType: 'payslip', entityId: id, action: 'issue', after: { workerId, from, to }, at });
    const { start: startUtc, end: endUtc } = localRangeToUtc(from, to, org.timezone);
    markReceiptsFinalizedForPeriod(ctx.db, org.id, workerId, startUtc, endUtc);
    createNotification(ctx.db, {
      orgId: org.id,
      userId: workerId,
      type: 'payslip_issued',
      title: 'New Payslip Issued',
      body: `Your payslip for ${from} to ${to} has been issued. Net pay: ${org.currency} ${(preview.breakdown.netPayMinor / 100).toFixed(2)}`,
      link: `/worker/payslips/${id}`,
      nowIso: at,
    });
    return { ...preview, id, status: 'issued' as const, issuedAt: at, synthetic: opts.synthetic ?? org.synthetic };
  });
}

interface PayslipRow {
  id: string;
  orgId: string;
  workerId: string;
  workerName: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  breakdownJson: string;
  grossPayMinor: number;
  netPayMinor: number;
  issuedAt: string;
  synthetic: number;
}

const SELECT = `SELECT p.id, p.org_id AS orgId, p.worker_id AS workerId, u.name AS workerName, p.period_start AS periodStart,
  p.period_end AS periodEnd, p.currency, p.breakdown_json AS breakdownJson, p.gross_pay_minor AS grossPayMinor,
  p.net_pay_minor AS netPayMinor, p.issued_at AS issuedAt, p.is_synthetic AS synthetic
  FROM payslips p JOIN users u ON u.id = p.worker_id`;

/** Lists issued payslips in an organisation, optionally for one worker. */
export function listPayslips(ctx: AppContext, orgId: string, workerId: string | null, limit: number, offset: number) {
  const where = `p.org_id = @orgId AND (@workerId IS NULL OR p.worker_id = @workerId)`;
  const items: PayslipListItem[] = ctx.db
    .all<PayslipRow>(`${SELECT} WHERE ${where} ORDER BY p.period_end DESC, u.name LIMIT @limit OFFSET @offset`, {
      orgId,
      workerId,
      limit,
      offset,
    })
    .map((r) => ({
      id: r.id,
      workerId: r.workerId,
      workerName: r.workerName,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      netPayMinor: r.netPayMinor,
      grossPayMinor: r.grossPayMinor,
      issuedAt: r.issuedAt,
      synthetic: Boolean(r.synthetic),
    }));
  const total = ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM payslips p WHERE ${where}`, { orgId, workerId })!.n;
  return { items, total, limit, offset };
}

/** Fetches an issued payslip scoped to the organisation; callers enforce worker ownership. */
export function getPayslip(ctx: AppContext, orgId: string, id: string): PayslipDTO | undefined {
  const r = ctx.db.get<PayslipRow>(`${SELECT} WHERE p.id = @id AND p.org_id = @orgId`, { id, orgId });
  if (!r) return undefined;
  return {
    id: r.id,
    workerId: r.workerId,
    workerName: r.workerName,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    status: 'issued',
    issuedAt: r.issuedAt,
    synthetic: Boolean(r.synthetic),
    currency: r.currency,
    breakdown: JSON.parse(r.breakdownJson) as PayBreakdown,
  };
}
