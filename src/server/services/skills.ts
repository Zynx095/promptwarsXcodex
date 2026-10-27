// Skill passport. Workers record self-reported entries; only an administrator of the same
// organisation can mark an entry as employer-verified. No external verification is claimed.
import { randomUUID } from 'node:crypto';
import { localDate } from '../../shared/time';
import type { SkillCreateInput } from '../../shared/schemas';
import type { SkillDTO, SkillKind, Verification } from '../../shared/types';
import { nowIso, type AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { recordAudit } from '../repositories/audit';
import { notFound } from '../http';

interface SkillRow {
  id: string;
  workerId: string;
  kind: SkillKind;
  name: string;
  description: string;
  issuer: string;
  issuedOn: string | null;
  expiresOn: string | null;
  verification: Verification;
  verifiedByName: string | null;
  createdAt: string;
  synthetic: number;
}

export function listSkills(ctx: AppContext, org: OrgRow, workerId: string): SkillDTO[] {
  const today = localDate(ctx.now(), org.timezone);
  return ctx.db
    .all<SkillRow>(
      `SELECT s.id, s.worker_id AS workerId, s.kind, s.name, s.description, s.issuer, s.issued_on AS issuedOn, s.expires_on AS expiresOn,
         s.verification, v.name AS verifiedByName, s.created_at AS createdAt, s.is_synthetic AS synthetic
       FROM skills s LEFT JOIN users v ON v.id = s.verified_by
       WHERE s.org_id = @orgId AND s.worker_id = @workerId ORDER BY s.kind, s.name LIMIT 200`,
      { orgId: org.id, workerId },
    )
    .map((r) => ({ ...r, synthetic: Boolean(r.synthetic), expired: r.expiresOn !== null && r.expiresOn < today }));
}

export function addSkill(
  ctx: AppContext,
  org: OrgRow,
  actor: { id: string; role: 'worker' | 'admin' },
  workerId: string,
  input: SkillCreateInput,
  opts: { synthetic?: boolean } = {},
): string {
  const id = randomUUID();
  const verified = actor.role === 'admin';
  const at = nowIso(ctx);
  ctx.db.tx(() => {
    ctx.db.run(
      `INSERT INTO skills (id, org_id, worker_id, kind, name, description, issuer, issued_on, expires_on, verification, verified_by, added_by, created_at, is_synthetic)
       VALUES (@id, @orgId, @workerId, @kind, @name, @description, @issuer, @issuedOn, @expiresOn, @verification, @verifiedBy, @addedBy, @at, @synthetic)`,
      {
        id,
        orgId: org.id,
        workerId,
        kind: input.kind,
        name: input.name,
        description: input.description,
        issuer: input.issuer,
        issuedOn: input.issuedOn ?? null,
        expiresOn: input.expiresOn ?? null,
        verification: verified ? 'employer_verified' : 'self_reported',
        verifiedBy: verified ? actor.id : null,
        addedBy: actor.id,
        at,
        synthetic: opts.synthetic ?? false,
      },
    );
    recordAudit(ctx.db, { orgId: org.id, actorId: actor.id, entityType: 'skill', entityId: id, action: 'create', after: { workerId, name: input.name }, at });
  });
  return id;
}

export function setSkillVerification(ctx: AppContext, org: OrgRow, adminId: string, skillId: string, verified: boolean): void {
  const row = ctx.db.get<{ verification: Verification }>(`SELECT verification FROM skills WHERE id = @id AND org_id = @orgId`, {
    id: skillId,
    orgId: org.id,
  });
  if (!row) throw notFound('Skill record');
  const at = nowIso(ctx);
  ctx.db.tx(() => {
    ctx.db.run(`UPDATE skills SET verification = @v, verified_by = @by WHERE id = @id AND org_id = @orgId`, {
      id: skillId,
      orgId: org.id,
      v: verified ? 'employer_verified' : 'self_reported',
      by: verified ? adminId : null,
    });
    recordAudit(ctx.db, {
      orgId: org.id,
      actorId: adminId,
      entityType: 'skill',
      entityId: skillId,
      action: verified ? 'verify' : 'unverify',
      before: { verification: row.verification },
      after: { verification: verified ? 'employer_verified' : 'self_reported' },
      at,
    });
  });
}

export function skillWorkerId(ctx: AppContext, orgId: string, skillId: string): string | undefined {
  return ctx.db.get<{ workerId: string }>(`SELECT worker_id AS workerId FROM skills WHERE id = @id AND org_id = @orgId`, { id: skillId, orgId })?.workerId;
}
