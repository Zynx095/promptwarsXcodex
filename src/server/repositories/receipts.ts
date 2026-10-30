import type { Db } from '../db/db';
import type { CanonicalReceiptData, WorkReceiptDTO } from '../../shared/types';

export interface WorkReceiptRow {
  id: string;
  org_id: string;
  shift_id: string;
  worker_id: string;
  version: number;
  previous_version_id: string | null;
  key_id: string;
  canonical_digest: string;
  status: 'estimated' | 'finalized';
  receipt_json: string;
  correction_reason: string | null;
  created_at: string;
  created_by: string | null;
}

export function insertReceipt(
  db: Db,
  receipt: {
    id: string;
    orgId: string;
    shiftId: string;
    workerId: string;
    version: number;
    previousVersionId?: string | null;
    keyId?: string;
    canonicalDigest: string;
    status: 'estimated' | 'finalized';
    data: CanonicalReceiptData;
    correctionReason?: string | null;
    createdAt: string;
    createdBy?: string | null;
  },
): void {
  db.run(
    `INSERT INTO work_receipts (
      id, org_id, shift_id, worker_id, version, previous_version_id,
      key_id, canonical_digest, status, receipt_json, correction_reason, created_at, created_by
    ) VALUES (
      @id, @orgId, @shiftId, @workerId, @version, @previousVersionId,
      @keyId, @canonicalDigest, @status, @receiptJson, @correctionReason, @createdAt, @createdBy
    )`,
    {
      id: receipt.id,
      orgId: receipt.orgId,
      shiftId: receipt.shiftId,
      workerId: receipt.workerId,
      version: receipt.version,
      previousVersionId: receipt.previousVersionId ?? null,
      keyId: receipt.keyId ?? 'v1',
      canonicalDigest: receipt.canonicalDigest,
      status: receipt.status,
      receiptJson: JSON.stringify(receipt.data),
      correctionReason: receipt.correctionReason ?? null,
      createdAt: receipt.createdAt,
      createdBy: receipt.createdBy ?? null,
    },
  );
}

export function getLatestReceiptForShift(db: Db, orgId: string, shiftId: string): WorkReceiptRow | undefined {
  return db.get<WorkReceiptRow>(
    `SELECT * FROM work_receipts
     WHERE org_id = @orgId AND shift_id = @shiftId
     ORDER BY version DESC LIMIT 1`,
    { orgId, shiftId },
  );
}

export function getReceiptHistoryForShift(db: Db, orgId: string, shiftId: string): WorkReceiptRow[] {
  return db.all<WorkReceiptRow>(
    `SELECT * FROM work_receipts
     WHERE org_id = @orgId AND shift_id = @shiftId
     ORDER BY version DESC`,
    { orgId, shiftId },
  );
}

export function getReceiptById(db: Db, orgId: string, id: string): WorkReceiptRow | undefined {
  return db.get<WorkReceiptRow>(
    `SELECT * FROM work_receipts
     WHERE org_id = @orgId AND id = @id`,
    { orgId, id },
  );
}

export function markReceiptsFinalizedForPeriod(db: Db, orgId: string, workerId: string, startIso: string, endIso: string): void {
  // Finds latest receipts for shifts that fall within the period and sets status to finalized
  db.run(
    `UPDATE work_receipts
     SET status = 'finalized'
     WHERE org_id = @orgId AND worker_id = @workerId AND shift_id IN (
       SELECT id FROM shifts WHERE org_id = @orgId AND worker_id = @workerId AND check_in_at >= @startIso AND check_in_at < @endIso
     )`,
    { orgId, workerId, startIso, endIso },
  );
}

export function toWorkReceiptDTO(row: WorkReceiptRow, verified?: boolean, checkpointInfo?: { anchored: boolean; checkpointId: string | null }): WorkReceiptDTO {
  return {
    id: row.id,
    shiftId: row.shift_id,
    workerId: row.worker_id,
    orgId: row.org_id,
    version: row.version,
    previousVersionId: row.previous_version_id,
    keyId: row.key_id ?? 'v1',
    canonicalDigest: row.canonical_digest,
    status: row.status,
    data: JSON.parse(row.receipt_json) as CanonicalReceiptData,
    correctionReason: row.correction_reason,
    createdAt: row.created_at,
    createdBy: row.created_by,
    verified,
    anchored: checkpointInfo?.anchored ?? false,
    checkpointId: checkpointInfo?.checkpointId ?? null,
  };
}
