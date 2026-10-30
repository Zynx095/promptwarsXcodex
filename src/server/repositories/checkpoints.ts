import type { Db } from '../db/db';
import type { ProofCheckpointDTO } from '../../shared/types';

export interface CheckpointRow {
  id: string;
  org_id: string;
  sequence: number;
  merkle_root: string;
  receipt_count: number;
  previous_checkpoint_root: string | null;
  key_id: string;
  signature: string;
  created_at: string;
}

export interface CheckpointEntryRow {
  checkpoint_id: string;
  receipt_id: string;
  leaf_index: number;
  leaf_hash: string;
}

export function toProofCheckpointDTO(row: CheckpointRow): ProofCheckpointDTO {
  return {
    id: row.id,
    orgId: row.org_id,
    sequence: row.sequence,
    merkleRoot: row.merkle_root,
    receiptCount: row.receipt_count,
    previousCheckpointRoot: row.previous_checkpoint_root,
    keyId: row.key_id,
    signature: row.signature,
    createdAt: row.created_at,
  };
}

export function getLatestCheckpoint(db: Db, orgId: string): CheckpointRow | undefined {
  return db.get<CheckpointRow>(
    `SELECT id, org_id, sequence, merkle_root, receipt_count, previous_checkpoint_root, key_id, signature, created_at
     FROM receipt_checkpoints
     WHERE org_id = @orgId
     ORDER BY sequence DESC
     LIMIT 1`,
    { orgId },
  );
}

export function getCheckpointById(db: Db, orgId: string, checkpointId: string): CheckpointRow | undefined {
  return db.get<CheckpointRow>(
    `SELECT id, org_id, sequence, merkle_root, receipt_count, previous_checkpoint_root, key_id, signature, created_at
     FROM receipt_checkpoints
     WHERE org_id = @orgId AND id = @checkpointId
     LIMIT 1`,
    { orgId, checkpointId },
  );
}

export function getCheckpointByReceiptId(db: Db, receiptId: string): { checkpoint: CheckpointRow; entry: CheckpointEntryRow } | undefined {
  const row = db.get<CheckpointRow & CheckpointEntryRow>(
    `SELECT c.id, c.org_id, c.sequence, c.merkle_root, c.receipt_count, c.previous_checkpoint_root, c.key_id, c.signature, c.created_at,
            e.checkpoint_id, e.receipt_id, e.leaf_index, e.leaf_hash
     FROM receipt_checkpoint_entries e
     JOIN receipt_checkpoints c ON c.id = e.checkpoint_id
     WHERE e.receipt_id = @receiptId
     LIMIT 1`,
    { receiptId },
  );
  if (!row) return undefined;
  return {
    checkpoint: {
      id: row.id,
      org_id: row.org_id,
      sequence: row.sequence,
      merkle_root: row.merkle_root,
      receipt_count: row.receipt_count,
      previous_checkpoint_root: row.previous_checkpoint_root,
      key_id: row.key_id,
      signature: row.signature,
      created_at: row.created_at,
    },
    entry: {
      checkpoint_id: row.checkpoint_id,
      receipt_id: row.receipt_id,
      leaf_index: row.leaf_index,
      leaf_hash: row.leaf_hash,
    },
  };
}

export function listCheckpoints(db: Db, orgId: string, limit = 50): CheckpointRow[] {
  return db.all<CheckpointRow>(
    `SELECT id, org_id, sequence, merkle_root, receipt_count, previous_checkpoint_root, key_id, signature, created_at
     FROM receipt_checkpoints
     WHERE org_id = @orgId
     ORDER BY sequence DESC
     LIMIT @limit`,
    { orgId, limit },
  );
}

export function getCheckpointEntries(db: Db, checkpointId: string): CheckpointEntryRow[] {
  return db.all<CheckpointEntryRow>(
    `SELECT checkpoint_id, receipt_id, leaf_index, leaf_hash
     FROM receipt_checkpoint_entries
     WHERE checkpoint_id = @checkpointId
     ORDER BY leaf_index ASC`,
    { checkpointId },
  );
}

export function getUncheckpointedReceipts(db: Db, orgId: string, limit = 1000): { id: string; canonical_digest: string; created_at: string }[] {
  return db.all<{ id: string; canonical_digest: string; created_at: string }>(
    `SELECT r.id, r.canonical_digest, r.created_at
     FROM work_receipts r
     LEFT JOIN receipt_checkpoint_entries e ON e.receipt_id = r.id
     WHERE r.org_id = @orgId AND e.receipt_id IS NULL
     ORDER BY r.created_at ASC
     LIMIT @limit`,
    { orgId, limit },
  );
}

export function insertCheckpointWithEntries(db: Db, checkpoint: CheckpointRow, entries: CheckpointEntryRow[]): void {
  db.tx(() => {
    db.run(
      `INSERT INTO receipt_checkpoints (id, org_id, sequence, merkle_root, receipt_count, previous_checkpoint_root, key_id, signature, created_at)
       VALUES (@id, @orgId, @sequence, @merkleRoot, @receiptCount, @previousCheckpointRoot, @keyId, @signature, @createdAt)`,
      {
        id: checkpoint.id,
        orgId: checkpoint.org_id,
        sequence: checkpoint.sequence,
        merkleRoot: checkpoint.merkle_root,
        receiptCount: checkpoint.receipt_count,
        previousCheckpointRoot: checkpoint.previous_checkpoint_root,
        keyId: checkpoint.key_id,
        signature: checkpoint.signature,
        createdAt: checkpoint.created_at,
      },
    );

    for (const e of entries) {
      db.run(
        `INSERT INTO receipt_checkpoint_entries (checkpoint_id, receipt_id, leaf_index, leaf_hash)
         VALUES (@checkpointId, @receiptId, @leafIndex, @leafHash)`,
        {
          checkpointId: e.checkpoint_id,
          receiptId: e.receipt_id,
          leafIndex: e.leaf_index,
          leafHash: e.leaf_hash,
        },
      );
    }
  });
}
