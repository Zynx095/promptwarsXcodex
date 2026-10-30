import type { Db } from '../db/db';
import type { SiteDTO } from '../../shared/types';
import { randomUUID } from 'node:crypto';

export interface SiteRow {
  id: string;
  orgId: string;
  name: string;
  code: string;
  address: string;
  active: boolean;
  createdAt: string;
}

export function listSites(db: Db, orgId: string): SiteDTO[] {
  const rows = db.all<{
    id: string;
    org_id: string;
    name: string;
    code: string;
    address: string;
    active: number;
    created_at: string;
  }>(
    `SELECT id, org_id, name, code, address, active, created_at
     FROM sites
     WHERE org_id = @orgId
     ORDER BY active DESC, name ASC`,
    { orgId },
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    address: r.address,
    active: Boolean(r.active),
    createdAt: r.created_at,
  }));
}

export function getSiteById(db: Db, orgId: string, siteId: string): SiteDTO | undefined {
  const r = db.get<{
    id: string;
    org_id: string;
    name: string;
    code: string;
    address: string;
    active: number;
    created_at: string;
  }>(
    `SELECT id, org_id, name, code, address, active, created_at
     FROM sites
     WHERE id = @siteId AND org_id = @orgId`,
    { siteId, orgId },
  );
  if (!r) return undefined;
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    address: r.address,
    active: Boolean(r.active),
    createdAt: r.created_at,
  };
}

export function getSiteByCode(db: Db, orgId: string, code: string): SiteDTO | undefined {
  const r = db.get<{
    id: string;
    org_id: string;
    name: string;
    code: string;
    address: string;
    active: number;
    created_at: string;
  }>(
    `SELECT id, org_id, name, code, address, active, created_at
     FROM sites
     WHERE UPPER(code) = UPPER(@code) AND org_id = @orgId`,
    { code, orgId },
  );
  if (!r) return undefined;
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    address: r.address,
    active: Boolean(r.active),
    createdAt: r.created_at,
  };
}

export function createSite(
  db: Db,
  data: {
    orgId: string;
    name: string;
    code: string;
    address?: string;
    nowIso: string;
  },
): SiteDTO {
  const id = `site_${randomUUID()}`;
  db.run(
    `INSERT INTO sites (id, org_id, name, code, address, active, created_at)
     VALUES (@id, @orgId, @name, @code, @address, 1, @nowIso)`,
    {
      id,
      orgId: data.orgId,
      name: data.name,
      code: data.code.toUpperCase(),
      address: data.address ?? '',
      nowIso: data.nowIso,
    },
  );

  return {
    id,
    name: data.name,
    code: data.code.toUpperCase(),
    address: data.address ?? '',
    active: true,
    createdAt: data.nowIso,
  };
}

export function toggleSiteActive(db: Db, orgId: string, siteId: string, active: boolean): boolean {
  const changes = db.run(`UPDATE sites SET active = @active WHERE id = @siteId AND org_id = @orgId`, { siteId, orgId, active: active ? 1 : 0 });
  return changes > 0;
}
