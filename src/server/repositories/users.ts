import type { Db } from '../db/db';
import type { Role } from '../../shared/types';

export interface SessionUserRow {
  id: string;
  orgId: string;
  role: Role;
  name: string;
  jobTitle: string;
  team: string;
  active: boolean;
}

export interface WorkerRow extends SessionUserRow {
  phone: string;
  hourlyRateMinor: number;
  synthetic: boolean;
}

const USER_COLUMNS = `id, org_id AS orgId, role, name, job_title AS jobTitle, team, active`;
const WORKER_COLUMNS = `${USER_COLUMNS}, phone, hourly_rate_minor AS hourlyRateMinor, is_synthetic AS synthetic`;

function toBool<T extends { active: unknown; synthetic?: unknown }>(row: T | undefined): T | undefined {
  if (!row) return row;
  return { ...row, active: Boolean(row.active), ...('synthetic' in row ? { synthetic: Boolean(row.synthetic) } : {}) };
}

export function findSessionUser(db: Db, id: string): SessionUserRow | undefined {
  return toBool(db.get<SessionUserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = @id`, { id }));
}

export function findLoginByPhone(db: Db, phone: string) {
  return db.get<{ id: string; pinHash: string; active: number }>(`SELECT id, pin_hash AS pinHash, active FROM users WHERE phone = @phone`, { phone });
}

export function listWorkers(db: Db, orgId: string): WorkerRow[] {
  return db
    .all<WorkerRow>(`SELECT ${WORKER_COLUMNS} FROM users WHERE org_id = @orgId AND role = 'worker' ORDER BY name LIMIT 500`, { orgId })
    .map((r) => toBool(r)!);
}

/** Fetches a worker only if they belong to the given organisation. */
export function getWorker(db: Db, orgId: string, id: string): WorkerRow | undefined {
  return toBool(db.get<WorkerRow>(`SELECT ${WORKER_COLUMNS} FROM users WHERE id = @id AND org_id = @orgId AND role = 'worker'`, { id, orgId }));
}

export function countActiveWorkers(db: Db, orgId: string): number {
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE org_id = @orgId AND role = 'worker' AND active = 1`, { orgId })!.n;
}

export function updateWorker(db: Db, orgId: string, id: string, patch: { hourlyRateMinor?: number; active?: boolean }): void {
  db.run(
    `UPDATE users SET hourly_rate_minor = COALESCE(@rate, hourly_rate_minor), active = COALESCE(@active, active)
     WHERE id = @id AND org_id = @orgId AND role = 'worker'`,
    { id, orgId, rate: patch.hourlyRateMinor ?? null, active: patch.active ?? null },
  );
}

export function userName(db: Db, orgId: string, id: string | null): string | null {
  if (!id) return null;
  return db.get<{ name: string }>(`SELECT name FROM users WHERE id = @id AND org_id = @orgId`, { id, orgId })?.name ?? null;
}
