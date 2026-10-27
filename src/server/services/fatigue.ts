import { randomUUID } from 'node:crypto';
import { evaluateFatigue } from '../../domain/fatigue';
import { nowIso, type AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { listWorkerShifts } from '../repositories/shifts';
import type { AlertDTO, FatigueRuleKey } from '../../shared/types';

const LOOKBACK_DAYS = 21;

/**
 * Re-evaluates a worker's recent shifts and stores any new findings. The unique key
 * (worker, rule, window) makes repeated evaluation idempotent: no duplicate alerts.
 */
export function evaluateWorkerFatigue(ctx: AppContext, org: OrgRow, workerId: string): number {
  const now = ctx.now();
  const start = new Date(now.getTime() - LOOKBACK_DAYS * 86400000).toISOString();
  const end = new Date(now.getTime() + 86400000).toISOString();
  const recent = listWorkerShifts(ctx.db, workerId, start, end);
  const findings = evaluateFatigue(recent, org.settings.fatigue, org.timezone, org.settings.pay.scheduledDailyMinutes);
  const at = nowIso(ctx);
  let created = 0;
  for (const f of findings) {
    created += ctx.db.run(
      `INSERT OR IGNORE INTO fatigue_alerts (id, org_id, worker_id, rule, window_key, observed_value, threshold, details, created_at)
       VALUES (@id, @orgId, @workerId, @rule, @windowKey, @observed, @threshold, @details, @at)`,
      {
        id: randomUUID(),
        orgId: org.id,
        workerId,
        rule: f.rule,
        windowKey: f.windowKey,
        observed: f.observedValue,
        threshold: f.threshold,
        details: f.details,
        at,
      },
    );
  }
  return created;
}

interface AlertRow {
  id: string;
  workerId: string;
  workerName: string;
  rule: FatigueRuleKey;
  windowKey: string;
  observedValue: number;
  threshold: number;
  details: string;
  status: 'open' | 'acknowledged';
  createdAt: string;
  acknowledgedAt: string | null;
}

const ALERT_SELECT = `SELECT a.id, a.worker_id AS workerId, u.name AS workerName, a.rule, a.window_key AS windowKey,
  a.observed_value AS observedValue, a.threshold, a.details, a.status, a.created_at AS createdAt, a.acknowledged_at AS acknowledgedAt
  FROM fatigue_alerts a JOIN users u ON u.id = a.worker_id`;

export function listAlerts(ctx: AppContext, orgId: string, f: { workerId?: string; status?: 'open' | 'acknowledged'; limit: number }): AlertDTO[] {
  return ctx.db.all<AlertRow>(
    `${ALERT_SELECT} WHERE a.org_id = @orgId AND (@workerId IS NULL OR a.worker_id = @workerId) AND (@status IS NULL OR a.status = @status)
     ORDER BY a.created_at DESC, a.window_key DESC LIMIT @limit`,
    { orgId, workerId: f.workerId ?? null, status: f.status ?? null, limit: f.limit },
  );
}

export function countOpenAlerts(ctx: AppContext, orgId: string): number {
  return ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM fatigue_alerts WHERE org_id = @orgId AND status = 'open'`, { orgId })!.n;
}

export function acknowledgeAlert(ctx: AppContext, orgId: string, actorId: string, id: string): boolean {
  return (
    ctx.db.run(
      `UPDATE fatigue_alerts SET status = 'acknowledged', acknowledged_at = @at, acknowledged_by = @actorId
       WHERE id = @id AND org_id = @orgId AND status = 'open'`,
      { id, orgId, actorId, at: nowIso(ctx) },
    ) === 1
  );
}
