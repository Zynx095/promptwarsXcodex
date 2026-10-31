import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db';
import { shiftDurationMinutes } from '../../domain/attendance';
import { localDate } from '../../shared/time';
import type { AttendanceAuth, CheckInMethod, ShiftDTO, ShiftSource } from '../../shared/types';

export interface ShiftRow {
  id: string;
  orgId: string;
  workerId: string;
  workerName?: string;
  checkInAt: string;
  checkOutAt: string | null;
  source: ShiftSource;
  checkInMethod: CheckInMethod;
  checkInAuth?: AttendanceAuth;
  checkOutAuth?: AttendanceAuth | null;
  corrected: number;
  synthetic: number;
}

const COLS = `s.id, s.org_id AS orgId, s.worker_id AS workerId, s.check_in_at AS checkInAt, s.check_out_at AS checkOutAt,
  s.source, s.check_in_method AS checkInMethod, s.check_in_auth AS checkInAuth, s.check_out_auth AS checkOutAuth, s.corrected, s.is_synthetic AS synthetic`;

export function toShiftDTO(row: ShiftRow, timeZone: string): ShiftDTO {
  return {
    id: row.id,
    workerId: row.workerId,
    ...(row.workerName !== undefined ? { workerName: row.workerName } : {}),
    checkInAt: row.checkInAt,
    checkOutAt: row.checkOutAt,
    status: row.checkOutAt ? 'completed' : 'open',
    durationMinutes: shiftDurationMinutes(row),
    localDate: localDate(row.checkInAt, timeZone),
    source: row.source,
    checkInMethod: row.checkInMethod,
    checkInAuth: row.checkInAuth ?? 'session',
    checkOutAuth: row.checkOutAuth ?? null,
    corrected: Boolean(row.corrected),
    synthetic: Boolean(row.synthetic),
  };
}

export function getOpenShift(db: Db, workerId: string): ShiftRow | undefined {
  return db.get<ShiftRow>(`SELECT ${COLS} FROM shifts s WHERE s.worker_id = @workerId AND s.check_out_at IS NULL`, { workerId });
}

export function getShift(db: Db, orgId: string, id: string): ShiftRow | undefined {
  return db.get<ShiftRow>(`SELECT ${COLS}, u.name AS workerName FROM shifts s JOIN users u ON u.id = s.worker_id WHERE s.id = @id AND s.org_id = @orgId`, {
    id,
    orgId,
  });
}

export function insertShift(
  db: Db,
  s: {
    orgId: string;
    workerId: string;
    checkInAt: string;
    checkOutAt?: string | null;
    source: ShiftSource;
    method?: CheckInMethod;
    auth?: AttendanceAuth;
    synthetic?: boolean;
    at: string;
  },
): string {
  const id = randomUUID();
  db.run(
    `INSERT INTO shifts (id, org_id, worker_id, check_in_at, check_out_at, source, check_in_method, check_in_auth, is_synthetic, created_at, updated_at)
     VALUES (@id, @orgId, @workerId, @checkInAt, @checkOutAt, @source, @method, @auth, @synthetic, @at, @at)`,
    { id, ...s, checkOutAt: s.checkOutAt ?? null, method: s.method ?? 'app', auth: s.auth ?? 'session', synthetic: s.synthetic ?? false },
  );
  return id;
}

/** Closes an open shift. Returns false if it was already closed (e.g. a concurrent request). */
export function closeShift(db: Db, id: string, checkOutAt: string, at: string, auth: AttendanceAuth = 'session'): boolean {
  return (
    db.run(`UPDATE shifts SET check_out_at = @checkOutAt, check_out_auth = @auth, updated_at = @at WHERE id = @id AND check_out_at IS NULL`, {
      id,
      checkOutAt,
      at,
      auth,
    }) === 1
  );
}

export function updateShiftTimes(db: Db, orgId: string, id: string, checkInAt: string, checkOutAt: string | null, at: string): void {
  db.run(`UPDATE shifts SET check_in_at = @checkInAt, check_out_at = @checkOutAt, corrected = 1, updated_at = @at WHERE id = @id AND org_id = @orgId`, {
    id,
    orgId,
    checkInAt,
    checkOutAt,
    at,
  });
}

/** Shifts for one worker whose check-in falls in [start, end). */
export function listWorkerShifts(db: Db, workerId: string, start: string, end: string, limit = 500): ShiftRow[] {
  return db.all<ShiftRow>(
    `SELECT ${COLS} FROM shifts s WHERE s.worker_id = @workerId AND s.check_in_at >= @start AND s.check_in_at < @end
     ORDER BY s.check_in_at DESC LIMIT @limit`,
    { workerId, start, end, limit },
  );
}

/** All shifts in the organisation with check-in in [start, end), bounded for dashboard aggregation. */
export function listOrgShiftsInRange(db: Db, orgId: string, start: string, end: string): ShiftRow[] {
  return db.all<ShiftRow>(
    `SELECT ${COLS} FROM shifts s WHERE s.org_id = @orgId AND s.check_in_at >= @start AND s.check_in_at < @end
     ORDER BY s.check_in_at LIMIT 20000`,
    { orgId, start, end },
  );
}

export function countOpenShifts(db: Db, orgId: string): number {
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM shifts WHERE org_id = @orgId AND check_out_at IS NULL`, { orgId })!.n;
}

export function openShiftWorkerIds(db: Db, orgId: string): Set<string> {
  return new Set(
    db.all<{ workerId: string }>(`SELECT worker_id AS workerId FROM shifts WHERE org_id = @orgId AND check_out_at IS NULL`, { orgId }).map((r) => r.workerId),
  );
}

export function searchOrgShifts(
  db: Db,
  orgId: string,
  f: { workerId?: string; status?: 'open' | 'completed'; start?: string; end?: string; limit: number; offset: number },
) {
  const where = `s.org_id = @orgId
    AND (@workerId IS NULL OR s.worker_id = @workerId)
    AND (@status IS NULL OR (@status = 'open' AND s.check_out_at IS NULL) OR (@status = 'completed' AND s.check_out_at IS NOT NULL))
    AND (@start IS NULL OR s.check_in_at >= @start)
    AND (@end IS NULL OR s.check_in_at < @end)`;
  const params = { orgId, workerId: f.workerId ?? null, status: f.status ?? null, start: f.start ?? null, end: f.end ?? null };
  const items = db.all<ShiftRow>(
    `SELECT ${COLS}, u.name AS workerName FROM shifts s JOIN users u ON u.id = s.worker_id
     WHERE ${where} ORDER BY s.check_in_at DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit: f.limit, offset: f.offset },
  );
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM shifts s WHERE ${where}`, params)!.n;
  return { items, total };
}
