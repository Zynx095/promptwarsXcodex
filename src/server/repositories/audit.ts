import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db';
import type { AuditEventDTO } from '../../shared/types';

export interface AuditInput {
  orgId: string;
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  at: string;
}

export function recordAudit(db: Db, e: AuditInput): void {
  db.run(
    `INSERT INTO audit_events (id, org_id, actor_id, entity_type, entity_id, action, before_json, after_json, reason, created_at)
     VALUES (@id, @orgId, @actorId, @entityType, @entityId, @action, @before, @after, @reason, @at)`,
    {
      id: randomUUID(),
      orgId: e.orgId,
      actorId: e.actorId,
      entityType: e.entityType,
      entityId: e.entityId,
      action: e.action,
      before: e.before === undefined ? null : JSON.stringify(e.before),
      after: e.after === undefined ? null : JSON.stringify(e.after),
      reason: e.reason ?? null,
      at: e.at,
    },
  );
}

export function listAudit(db: Db, orgId: string, opts: { entityType?: string; entityId?: string; limit: number; offset: number }) {
  const where = `a.org_id = @orgId AND (@entityType IS NULL OR a.entity_type = @entityType) AND (@entityId IS NULL OR a.entity_id = @entityId)`;
  const params = { orgId, entityType: opts.entityType ?? null, entityId: opts.entityId ?? null };
  const rows = db.all<{
    id: string;
    actorName: string | null;
    entityType: string;
    entityId: string;
    action: string;
    before_json: string | null;
    after_json: string | null;
    reason: string | null;
    createdAt: string;
  }>(
    `SELECT a.id, u.name AS actorName, a.entity_type AS entityType, a.entity_id AS entityId, a.action,
            a.before_json, a.after_json, a.reason, a.created_at AS createdAt
     FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
     WHERE ${where} ORDER BY a.created_at DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit: opts.limit, offset: opts.offset },
  );
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_events a WHERE ${where}`, params)!.n;
  const items: AuditEventDTO[] = rows.map((r) => ({
    id: r.id,
    actorName: r.actorName ?? 'System',
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    before: r.before_json ? JSON.parse(r.before_json) : null,
    after: r.after_json ? JSON.parse(r.after_json) : null,
    reason: r.reason,
    createdAt: r.createdAt,
  }));
  return { items, total, limit: opts.limit, offset: opts.offset };
}
