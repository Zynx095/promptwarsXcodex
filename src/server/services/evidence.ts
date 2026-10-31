// Safety photos attached to reports: the hazard as the reporter saw it, and the fix as the
// organisation recorded it. Callers check that the person may see the report (getReport) before
// calling anything here; these functions add the rules that are specific to photos.
import { createHash, randomUUID } from 'node:crypto';
import { DomainError } from '../../domain/errors';
import { getIndustry, type PpeItem } from '../../shared/industries';
import type { EvidenceAnalysisDTO, EvidenceDTO, EvidenceStage, EvidenceVerificationDTO, SafetyReportDTO } from '../../shared/types';
import { nowIso, type AppContext } from '../context';
import type { OrgRow } from '../repositories/orgs';
import { hmac, safeEqual } from '../auth/crypto';
import { recordAudit } from '../repositories/audit';
import { cleanImage, ImageRejected, type EvidenceMime } from '../evidence/image';
import { getSecretForKey } from './receipts';
import { analyzeImage } from './vision';
import { HttpError } from '../http';
import type { Actor } from '../../domain/access';

export const MAX_PHOTOS_PER_STAGE = 6;
/** Photos of a closed report are kept this long after it was verified, then deleted. */
export const EVIDENCE_RETENTION_DAYS = 365;

interface EvidenceRow {
  id: string;
  orgId: string;
  reportId: string;
  stage: EvidenceStage;
  mime: EvidenceMime;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  caption: string;
  uploaderRole: 'reporter' | 'admin';
  uploaderName: string | null;
  seal: string;
  sealKeyId: string;
  createdAt: string;
  analysisStatus: EvidenceDTO['analysisStatus'];
  analysisJson: string | null;
  reviewStatus: EvidenceDTO['reviewStatus'];
  reviewNote: string | null;
  reviewedAt: string | null;
}

const SELECT = `SELECT e.id, e.org_id AS orgId, e.report_id AS reportId, e.stage, e.mime, e.size_bytes AS sizeBytes, e.width, e.height,
  e.sha256, e.caption, e.uploader_role AS uploaderRole, u.name AS uploaderName, e.seal, e.seal_key_id AS sealKeyId,
  e.created_at AS createdAt, e.analysis_status AS analysisStatus, e.analysis_json AS analysisJson,
  e.review_status AS reviewStatus, e.review_note AS reviewNote, e.reviewed_at AS reviewedAt
  FROM report_evidence e LEFT JOIN users u ON u.id = e.uploader_id`;

/** The record the seal covers. Changing any of these fields, or the bytes, breaks verification. */
function sealInput(e: {
  id: string;
  orgId: string;
  reportId: string;
  stage: string;
  sha256: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
}): string {
  return ['fairshift:evidence:v1', e.id, e.orgId, e.reportId, e.stage, e.sha256, e.mime, String(e.sizeBytes), e.createdAt].join('|');
}

function toDTO(row: EvidenceRow): EvidenceDTO {
  return {
    id: row.id,
    stage: row.stage,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    caption: row.caption,
    // A reporter upload never shows a name: for a confidential report it must not, and for a
    // named one the report already says who reported it.
    uploadedBy: row.uploaderRole === 'reporter' ? 'Reporter' : (row.uploaderName ?? 'Administrator'),
    createdAt: row.createdAt,
    analysisStatus: row.analysisStatus,
    analysis: row.analysisJson ? (JSON.parse(row.analysisJson) as EvidenceAnalysisDTO) : null,
    reviewStatus: row.reviewStatus,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt,
  };
}

export function listEvidence(ctx: AppContext, orgId: string, reportId: string): EvidenceDTO[] {
  return ctx.db
    .all<EvidenceRow>(`${SELECT} WHERE e.org_id = @orgId AND e.report_id = @reportId ORDER BY e.stage, e.created_at, e.rowid`, { orgId, reportId })
    .map(toDTO);
}

export function countEvidence(ctx: AppContext, orgId: string, reportId: string, stage: EvidenceStage): number {
  return ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM report_evidence WHERE org_id = @orgId AND report_id = @reportId AND stage = @stage`, {
    orgId,
    reportId,
    stage,
  })!.n;
}

export function requiredPpe(org: OrgRow): readonly PpeItem[] {
  return org.settings.safety?.requiredPpe ?? getIndustry(org.industry).requiredPpe;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface EvidenceUpload {
  stage: EvidenceStage;
  mime: string;
  data: string;
  caption?: string;
}

/**
 * Stores one photo. Hazard photos come from the reporter while the report is new; photos of the
 * fix come from administrators until the outcome is verified.
 */
export async function addEvidence(ctx: AppContext, org: OrgRow, actor: Actor, report: SafetyReportDTO, upload: EvidenceUpload): Promise<EvidenceDTO> {
  if (upload.stage === 'hazard') {
    if (!report.isMine) throw new HttpError(403, 'FORBIDDEN', 'Only the person who reported the hazard can add photos of it.');
    if (report.status !== 'submitted' && report.status !== 'acknowledged') {
      throw new DomainError('INVALID_TRANSITION', 'Photos of the hazard can be added only while the report is new.');
    }
  } else {
    if (actor.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Only administrators can add photos of the fix.');
    if (report.status === 'outcome_verified') throw new DomainError('INVALID_TRANSITION', 'The outcome is already verified.');
  }
  if (countEvidence(ctx, org.id, report.id, upload.stage) >= MAX_PHOTOS_PER_STAGE) {
    throw new DomainError('CONFLICT', `A report can hold at most ${MAX_PHOTOS_PER_STAGE} photos of each kind.`);
  }
  if (!BASE64.test(upload.data) || upload.data.length > 2_100_000) throw new HttpError(400, 'BAD_IMAGE', 'The photo could not be read.');

  let clean;
  try {
    clean = cleanImage(Buffer.from(upload.data, 'base64'), upload.mime);
  } catch (err) {
    if (err instanceof ImageRejected)
      throw new HttpError(err.code === 'TOO_LARGE' || err.code === 'TOO_MANY_PIXELS' ? 413 : 400, `IMAGE_${err.code}`, err.message);
    throw err;
  }

  const id = randomUUID();
  const at = nowIso(ctx);
  const sha256 = createHash('sha256').update(clean.bytes).digest('hex');
  const keyId = ctx.config.activeReceiptKeyId;
  const record = { id, orgId: org.id, reportId: report.id, stage: upload.stage, sha256, mime: clean.mime, sizeBytes: clean.bytes.length, createdAt: at };
  const seal = hmac(getSecretForKey(ctx, keyId), sealInput(record));
  const confidentialReporter = upload.stage === 'hazard' && report.confidential;

  ctx.db.tx(() => {
    ctx.db.run(
      `INSERT INTO report_evidence (id, org_id, report_id, stage, mime, bytes, size_bytes, width, height, sha256, caption, uploader_role, uploader_id, seal, seal_key_id, created_at)
       VALUES (@id, @orgId, @reportId, @stage, @mime, @bytes, @sizeBytes, @width, @height, @sha256, @caption, @role, @uploaderId, @seal, @keyId, @createdAt)`,
      {
        ...record,
        bytes: clean.bytes,
        width: clean.width,
        height: clean.height,
        caption: upload.caption?.trim().slice(0, 200) ?? '',
        role: upload.stage === 'hazard' ? 'reporter' : 'admin',
        uploaderId: confidentialReporter ? null : actor.id,
        seal,
        keyId,
      },
    );
    recordAudit(ctx.db, {
      orgId: org.id,
      actorId: confidentialReporter ? null : actor.id,
      entityType: 'safety_report',
      entityId: report.id,
      action: 'evidence_added',
      after: { evidenceId: id, stage: upload.stage, sha256, metadataRemoved: clean.removed },
      at,
    });
  });

  // Advisory analysis runs after the photo is safely stored, so a provider failure never loses it
  const result = await analyzeImage(ctx.config.googleVisionApiKey, ctx.fetch ?? fetch, clean.bytes, requiredPpe(org), nowIso(ctx));
  ctx.db.run(`UPDATE report_evidence SET analysis_status = @status, analysis_json = @json, analysis_at = @at WHERE id = @id`, {
    id,
    status: result.status,
    json: result.status === 'completed' ? JSON.stringify(result.analysis) : null,
    at: result.status === 'not_configured' ? null : nowIso(ctx),
  });
  return toDTO(ctx.db.get<EvidenceRow>(`${SELECT} WHERE e.id = @id`, { id })!);
}

/** The stored photo, for a person already allowed to see the report. */
export function getEvidenceImage(ctx: AppContext, orgId: string, reportId: string, evidenceId: string): { mime: string; bytes: Buffer } | undefined {
  const row = ctx.db.get<{ mime: string; bytes: Uint8Array }>(
    `SELECT mime, bytes FROM report_evidence WHERE id = @evidenceId AND report_id = @reportId AND org_id = @orgId`,
    {
      evidenceId,
      reportId,
      orgId,
    },
  );
  return row ? { mime: row.mime, bytes: Buffer.from(row.bytes) } : undefined;
}

/** Recomputes the hash of the stored bytes and checks the seal with the key it was made with. */
export function verifyEvidence(ctx: AppContext, orgId: string, reportId: string, evidenceId: string): EvidenceVerificationDTO | undefined {
  const row = ctx.db.get<EvidenceRow & { bytes: Uint8Array }>(
    `SELECT e.id, e.org_id AS orgId, e.report_id AS reportId, e.stage, e.mime, e.size_bytes AS sizeBytes, e.sha256, e.seal,
       e.seal_key_id AS sealKeyId, e.created_at AS createdAt, e.bytes
     FROM report_evidence e WHERE e.id = @evidenceId AND e.report_id = @reportId AND e.org_id = @orgId`,
    { evidenceId, reportId, orgId },
  );
  if (!row) return undefined;
  const actual = createHash('sha256').update(Buffer.from(row.bytes)).digest('hex');
  const hashMatches = actual === row.sha256 && Buffer.from(row.bytes).length === row.sizeBytes;
  const known = Boolean(ctx.config.receiptSigningKeys?.[row.sealKeyId]) || row.sealKeyId === ctx.config.activeReceiptKeyId;
  const sealValid = known && safeEqual(row.seal, hmac(getSecretForKey(ctx, row.sealKeyId), sealInput({ ...row, sha256: actual })));
  return { evidenceId: row.id, hashMatches, sealValid, keyId: row.sealKeyId, sha256: row.sha256, checkedAt: nowIso(ctx) };
}

/** A person's decision on the advisory analysis of one photo. */
export function reviewEvidence(
  ctx: AppContext,
  actor: Actor,
  reportId: string,
  evidenceId: string,
  decision: 'confirmed' | 'dismissed',
  note: string,
): EvidenceDTO {
  const at = nowIso(ctx);
  ctx.db.tx(() => {
    const changed = ctx.db.run(
      `UPDATE report_evidence SET review_status = @decision, review_note = @note, reviewed_by = @actorId, reviewed_at = @at
       WHERE id = @evidenceId AND report_id = @reportId AND org_id = @orgId`,
      { decision, note: note.trim() || null, actorId: actor.id, at, evidenceId, reportId, orgId: actor.orgId },
    );
    if (changed !== 1) throw new HttpError(404, 'NOT_FOUND', 'Photo not found.');
    recordAudit(ctx.db, {
      orgId: actor.orgId,
      actorId: actor.id,
      entityType: 'safety_report',
      entityId: reportId,
      action: 'evidence_reviewed',
      after: { evidenceId, decision },
      reason: note.trim() || null,
      at,
    });
  });
  return toDTO(ctx.db.get<EvidenceRow>(`${SELECT} WHERE e.id = @id`, { id: evidenceId })!);
}

/** Deletes photos of reports verified more than the retention period ago. Returns how many. */
export function purgeExpiredEvidence(ctx: AppContext, retentionDays = EVIDENCE_RETENTION_DAYS): number {
  const cutoff = new Date(ctx.now().getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  return ctx.db.run(
    `DELETE FROM report_evidence WHERE report_id IN (
       SELECT id FROM safety_reports WHERE status = 'outcome_verified' AND verified_at IS NOT NULL AND verified_at < @cutoff)`,
    { cutoff },
  );
}
