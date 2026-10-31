// Site QR display and validation. The employer console starts a display for a site; while it is
// active the server hands out a fresh signed token every QR_ROTATE_SECONDS. Every check is made with
// the server's clock: the phone's clock is never consulted.
import { DomainError } from '../../domain/errors';
import { localDate, localRangeToUtc } from '../../shared/time';
import type { QrResolveDTO, SiteDTO, SiteQrStateDTO } from '../../shared/types';
import { nowIso, type AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { getSiteByCode, getSiteById } from '../repositories/sites';
import { recordAudit } from '../repositories/audit';
import { notFound } from '../http';
import { buildSiteQrToken, newQrNonce, parseSiteQrToken, QR_ROTATE_SECONDS, QR_TTL_SECONDS, verifySiteQrSignature } from '../auth/siteQr';

interface SessionRow {
  active: number;
  startedAt: string | null;
}

interface TokenRow {
  nonce: string;
  siteId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

function session(ctx: AppContext, siteId: string): SessionRow | undefined {
  return ctx.db.get<SessionRow>(`SELECT active, started_at AS startedAt FROM site_qr_sessions WHERE site_id = @siteId`, { siteId });
}

function requireSite(ctx: AppContext, org: OrgRow, siteId: string): SiteDTO {
  const site = getSiteById(ctx.db, org.id, siteId);
  if (!site) throw notFound('Site');
  return site;
}

function latestLiveToken(ctx: AppContext, siteId: string, at: string): TokenRow | undefined {
  return ctx.db.get<TokenRow>(
    `SELECT nonce, site_id AS siteId, issued_at AS issuedAt, expires_at AS expiresAt, revoked_at AS revokedAt FROM site_qr_tokens
     WHERE site_id = @siteId AND revoked_at IS NULL AND expires_at > @at ORDER BY issued_at DESC LIMIT 1`,
    { siteId, at },
  );
}

function issueToken(ctx: AppContext, org: OrgRow, siteId: string): TokenRow {
  const now = ctx.now();
  // Whole seconds, so the issue time in the token matches the stored row exactly
  const issued = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const row: TokenRow = {
    nonce: newQrNonce(),
    siteId,
    issuedAt: issued.toISOString(),
    expiresAt: new Date(issued.getTime() + QR_TTL_SECONDS * 1000).toISOString(),
    revokedAt: null,
  };
  ctx.db.run(`INSERT INTO site_qr_tokens (nonce, org_id, site_id, issued_at, expires_at) VALUES (@nonce, @orgId, @siteId, @issuedAt, @expiresAt)`, {
    nonce: row.nonce,
    orgId: org.id,
    siteId,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
  });
  // Tokens nobody used are kept for a day, then dropped; used ones stay with the check-in they proved
  ctx.db.run(`DELETE FROM site_qr_tokens WHERE site_id = @siteId AND expires_at < @cutoff AND nonce NOT IN (SELECT nonce FROM site_qr_uses)`, {
    siteId,
    cutoff: new Date(now.getTime() - 86400000).toISOString(),
  });
  return row;
}

function revokeLive(ctx: AppContext, siteId: string): void {
  const at = nowIso(ctx);
  ctx.db.run(`UPDATE site_qr_tokens SET revoked_at = @at WHERE site_id = @siteId AND revoked_at IS NULL AND expires_at > @at`, { siteId, at });
}

/** The current display state. While active, rotates the token when the current one is due. */
export function getQrState(ctx: AppContext, org: OrgRow, siteId: string): SiteQrStateDTO {
  const site = requireSite(ctx, org, siteId);
  const s = session(ctx, siteId);
  const active = Boolean(s?.active) && site.active;
  const at = nowIso(ctx);
  let token: TokenRow | undefined;
  if (active) {
    token = ctx.db.tx(() => {
      const live = latestLiveToken(ctx, siteId, at);
      const due = !live || ctx.now().getTime() - Date.parse(live.issuedAt) >= QR_ROTATE_SECONDS * 1000;
      return due ? issueToken(ctx, org, siteId) : live;
    });
  }
  const today = localDate(ctx.now(), org.timezone);
  const { start, end } = localRangeToUtc(today, today, org.timezone);
  const checkInsToday = ctx.db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM shifts WHERE org_id = @orgId AND site_id = @siteId AND check_in_at >= @start AND check_in_at < @end`,
    { orgId: org.id, siteId, start, end },
  )!.n;
  return {
    site,
    active,
    startedAt: active ? (s?.startedAt ?? null) : null,
    token: token ? buildSiteQrToken(ctx.config.sessionSecret, org.id, siteId, site.code, new Date(token.issuedAt), token.nonce) : null,
    issuedAt: token?.issuedAt ?? null,
    rotatesAt: token ? new Date(Date.parse(token.issuedAt) + QR_ROTATE_SECONDS * 1000).toISOString() : null,
    expiresAt: token?.expiresAt ?? null,
    serverNow: at,
    rotateSeconds: QR_ROTATE_SECONDS,
    ttlSeconds: QR_TTL_SECONDS,
    checkInsToday,
  };
}

export function startQr(ctx: AppContext, org: OrgRow, actorId: string, siteId: string): SiteQrStateDTO {
  const site = requireSite(ctx, org, siteId);
  if (!site.active) throw new DomainError('SITE_INACTIVE', 'Activate this site before showing its check-in QR code.');
  const at = nowIso(ctx);
  ctx.db.tx(() => {
    ctx.db.run(
      `INSERT INTO site_qr_sessions (site_id, org_id, active, started_by, started_at, stopped_at) VALUES (@siteId, @orgId, 1, @actorId, @at, NULL)
       ON CONFLICT(site_id) DO UPDATE SET active = 1, started_by = @actorId, started_at = @at, stopped_at = NULL`,
      { siteId, orgId: org.id, actorId, at },
    );
    revokeLive(ctx, siteId);
    recordAudit(ctx.db, { orgId: org.id, actorId, entityType: 'site', entityId: siteId, action: 'qr_start', at });
  });
  return getQrState(ctx, org, siteId);
}

export function stopQr(ctx: AppContext, org: OrgRow, actorId: string, siteId: string): SiteQrStateDTO {
  requireSite(ctx, org, siteId);
  const at = nowIso(ctx);
  ctx.db.tx(() => {
    ctx.db.run(`UPDATE site_qr_sessions SET active = 0, stopped_at = @at WHERE site_id = @siteId AND org_id = @orgId`, { siteId, orgId: org.id, at });
    revokeLive(ctx, siteId);
    recordAudit(ctx.db, { orgId: org.id, actorId, entityType: 'site', entityId: siteId, action: 'qr_stop', at });
  });
  return getQrState(ctx, org, siteId);
}

/** Replaces the code on screen now; the old one stops working immediately. */
export function refreshQr(ctx: AppContext, org: OrgRow, siteId: string): SiteQrStateDTO {
  requireSite(ctx, org, siteId);
  if (!session(ctx, siteId)?.active) throw new DomainError('QR_INACTIVE', 'Start the QR display for this site first.');
  ctx.db.tx(() => {
    revokeLive(ctx, siteId);
    issueToken(ctx, org, siteId);
  });
  return getQrState(ctx, org, siteId);
}

export interface ResolvedQr {
  site: SiteDTO;
  nonce: string;
  expiresAt: string;
}

/**
 * Checks a scanned token for the signed-in worker's organisation. Throws a DomainError with a
 * specific code for each way it can fail; never records anything.
 */
export function resolveQrToken(ctx: AppContext, org: OrgRow, token: string): ResolvedQr {
  const parsed = parseSiteQrToken(token);
  const invalid = () => new DomainError('QR_INVALID', 'This QR code is not a valid check-in code for your workplace.');
  if (!parsed) throw invalid();
  const site = getSiteByCode(ctx.db, org.id, parsed.siteCode);
  // A code for another organisation, an unknown site or an edited token all fail the same way
  if (!site || !verifySiteQrSignature(ctx.config.sessionSecret, org.id, site.id, parsed)) throw invalid();
  const row = ctx.db.get<TokenRow>(
    `SELECT nonce, site_id AS siteId, issued_at AS issuedAt, expires_at AS expiresAt, revoked_at AS revokedAt FROM site_qr_tokens
     WHERE nonce = @nonce AND org_id = @orgId`,
    { nonce: parsed.nonce, orgId: org.id },
  );
  if (!row || row.siteId !== site.id || Math.floor(Date.parse(row.issuedAt) / 1000) !== parsed.issuedSec) throw invalid();
  if (!site.active) throw new DomainError('SITE_INACTIVE', `${site.name} is not an active site. Ask your supervisor.`);
  if (!session(ctx, site.id)?.active || row.revokedAt) {
    throw new DomainError('QR_INACTIVE', 'This QR code was replaced or the display was stopped. Scan the code on the screen now.');
  }
  if (ctx.now().getTime() >= Date.parse(row.expiresAt)) {
    throw new DomainError('QR_EXPIRED', 'This QR code has expired. Scan the code on the screen now; it changes every 30 seconds.');
  }
  return { site, nonce: row.nonce, expiresAt: row.expiresAt };
}

export function qrUsedBy(ctx: AppContext, nonce: string, workerId: string): boolean {
  return Boolean(ctx.db.get(`SELECT 1 AS ok FROM site_qr_uses WHERE nonce = @nonce AND worker_id = @workerId`, { nonce, workerId }));
}

export function describeQr(ctx: AppContext, org: OrgRow, workerId: string, token: string): QrResolveDTO {
  const q = resolveQrToken(ctx, org, token);
  return { siteId: q.site.id, siteName: q.site.name, siteAddress: q.site.address, expiresAt: q.expiresAt, alreadyUsed: qrUsedBy(ctx, q.nonce, workerId) };
}

/** Records that this worker used this code for this shift; the primary key rejects a second use. */
export function recordQrUse(ctx: AppContext, nonce: string, workerId: string, shiftId: string): void {
  ctx.db.run(`INSERT INTO site_qr_uses (nonce, worker_id, shift_id, used_at) VALUES (@nonce, @workerId, @shiftId, @at)`, {
    nonce,
    workerId,
    shiftId,
    at: nowIso(ctx),
  });
}
