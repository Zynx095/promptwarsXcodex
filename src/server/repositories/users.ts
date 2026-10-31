import type { Db } from '../db/db';
import type { Role } from '../../shared/types';
import { randomUUID } from 'node:crypto';

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

export function getSessionVersion(db: Db, id: string): number {
  return db.get<{ v: number }>(`SELECT session_version AS v FROM users WHERE id = @id`, { id })?.v ?? 0;
}

/** Invalidates every session cookie issued to the user before this call. */
export function bumpSessionVersion(db: Db, id: string): void {
  db.run(`UPDATE users SET session_version = session_version + 1 WHERE id = @id`, { id });
}

/** Raises the stored session version to `version` if it is lower; never lowers it. */
export function raiseSessionVersion(db: Db, id: string, version: number): void {
  db.run(`UPDATE users SET session_version = @version WHERE id = @id AND session_version < @version`, { id, version });
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
  // Deactivation also revokes existing sessions, so reactivating later does not revive old cookies.
  db.run(
    `UPDATE users SET hourly_rate_minor = COALESCE(@rate, hourly_rate_minor), active = COALESCE(@active, active),
       session_version = session_version + CASE WHEN @active = 0 THEN 1 ELSE 0 END
     WHERE id = @id AND org_id = @orgId AND role = 'worker'`,
    { id, orgId, rate: patch.hourlyRateMinor ?? null, active: patch.active ?? null },
  );
}

export function createWorker(
  db: Db,
  data: {
    orgId: string;
    name: string;
    phone: string;
    pinHash: string;
    jobTitle?: string;
    team?: string;
    hourlyRateMinor: number;
    nowIso: string;
  },
): WorkerRow {
  const id = `usr_${randomUUID()}`;
  db.run(
    `INSERT INTO users (id, org_id, role, name, phone, pin_hash, job_title, team, hourly_rate_minor, active, is_synthetic, created_at)
     VALUES (@id, @orgId, 'worker', @name, @phone, @pinHash, @jobTitle, @team, @hourlyRateMinor, 1, 0, @nowIso)`,
    {
      id,
      orgId: data.orgId,
      name: data.name,
      phone: data.phone,
      pinHash: data.pinHash,
      jobTitle: data.jobTitle ?? '',
      team: data.team ?? '',
      hourlyRateMinor: data.hourlyRateMinor,
      nowIso: data.nowIso,
    },
  );

  return {
    id,
    orgId: data.orgId,
    role: 'worker',
    name: data.name,
    phone: data.phone,
    jobTitle: data.jobTitle ?? '',
    team: data.team ?? '',
    hourlyRateMinor: data.hourlyRateMinor,
    active: true,
    synthetic: false,
  };
}

export function userName(db: Db, orgId: string, id: string | null): string | null {
  if (!id) return null;
  return db.get<{ name: string }>(`SELECT name FROM users WHERE id = @id AND org_id = @orgId`, { id, orgId })?.name ?? null;
}

export function findUserByIdentity(db: Db, provider: string, providerUserId: string): SessionUserRow | undefined {
  const row = db.get<SessionUserRow>(
    `SELECT u.id, u.org_id AS orgId, u.role, u.name, u.job_title AS jobTitle, u.team, u.active
     FROM users u
     JOIN auth_identities i ON i.user_id = u.id
     WHERE i.provider = @provider AND i.provider_user_id = @providerUserId`,
    { provider, providerUserId },
  );
  return toBool(row);
}

export function findUserByIdentityEmail(db: Db, email: string): SessionUserRow | undefined {
  const row = db.get<SessionUserRow>(
    `SELECT u.id, u.org_id AS orgId, u.role, u.name, u.job_title AS jobTitle, u.team, u.active
     FROM users u
     JOIN auth_identities i ON i.user_id = u.id
     WHERE LOWER(i.email) = LOWER(@email)`,
    { email },
  );
  return toBool(row);
}

export function linkIdentity(
  db: Db,
  item: {
    id: string;
    userId: string;
    provider: string;
    providerUserId: string;
    email?: string | null;
    createdAt: string;
    lastSignInAt?: string | null;
  },
): void {
  db.run(
    `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, email, created_at, last_sign_in_at)
     VALUES (@id, @userId, @provider, @providerUserId, @email, @createdAt, @lastSignInAt)
     ON CONFLICT(provider, provider_user_id) DO UPDATE SET
       last_sign_in_at = excluded.last_sign_in_at,
       email = COALESCE(excluded.email, auth_identities.email)`,
    {
      id: item.id,
      userId: item.userId,
      provider: item.provider,
      providerUserId: item.providerUserId,
      email: item.email ?? null,
      createdAt: item.createdAt,
      lastSignInAt: item.lastSignInAt ?? item.createdAt,
    },
  );
}

export function updateIdentityLastSignIn(db: Db, provider: string, providerUserId: string, now: string): void {
  db.run(
    `UPDATE auth_identities SET last_sign_in_at = @now
     WHERE provider = @provider AND provider_user_id = @providerUserId`,
    { provider, providerUserId, now },
  );
}
