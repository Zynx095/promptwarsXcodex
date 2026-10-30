import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context';
import { buildMerkleTree, computeReceiptLeafHash, generateMerkleProof } from '../../domain/merkle';
import { computeCheckpointSignature, type CheckpointHeader } from '../../domain/proof';
import { getReceiptById } from '../repositories/receipts';
import {
  getCheckpointByReceiptId,
  getCheckpointEntries,
  getLatestCheckpoint,
  getUncheckpointedReceipts,
  insertCheckpointWithEntries,
  toProofCheckpointDTO,
  type CheckpointEntryRow,
  type CheckpointRow,
} from '../repositories/checkpoints';
import type { CanonicalReceiptData, IndependentVerificationBundle, ProofCheckpointDTO, ReceiptInclusionProofDTO } from '../../shared/types';

/**
 * Returns the signing secret for a given checkpoint key ID, falling back to checkpointSigningSecret.
 */
export function getCheckpointSecretForKey(ctx: AppContext, keyId?: string | null): string {
  if (keyId && ctx.config.checkpointSigningKeys && ctx.config.checkpointSigningKeys[keyId]) {
    return ctx.config.checkpointSigningKeys[keyId];
  }
  return ctx.config.checkpointSigningSecret;
}

/**
 * Creates an append-only cryptographic checkpoint for all pending uncheckpointed receipts in an organization.
 */
export function generateCheckpointForOrg(ctx: AppContext, orgId: string): ProofCheckpointDTO | null {
  const uncheckpointed = getUncheckpointedReceipts(ctx.db, orgId, 1000);
  if (uncheckpointed.length === 0) {
    const latest = getLatestCheckpoint(ctx.db, orgId);
    return latest ? toProofCheckpointDTO(latest) : null;
  }

  const leafHashes = uncheckpointed.map((r) => computeReceiptLeafHash(r.canonical_digest));
  const tree = buildMerkleTree(leafHashes);

  const prev = getLatestCheckpoint(ctx.db, orgId);
  const sequence = (prev?.sequence ?? 0) + 1;
  const previousCheckpointRoot = prev?.merkle_root ?? null;

  const now = ctx.now().toISOString();
  const keyId = ctx.config.activeCheckpointKeyId;
  const secret = getCheckpointSecretForKey(ctx, keyId);
  const id = `chk_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  const header: CheckpointHeader = {
    id,
    orgId,
    sequence,
    merkleRoot: tree.root,
    receiptCount: uncheckpointed.length,
    previousCheckpointRoot,
    keyId,
    createdAt: now,
  };

  const signature = computeCheckpointSignature(secret, header);

  const checkpointRow: CheckpointRow = {
    id,
    org_id: orgId,
    sequence,
    merkle_root: tree.root,
    receipt_count: uncheckpointed.length,
    previous_checkpoint_root: previousCheckpointRoot,
    key_id: keyId,
    signature,
    created_at: now,
  };

  const entries: CheckpointEntryRow[] = uncheckpointed.map((r, idx) => ({
    checkpoint_id: id,
    receipt_id: r.id,
    leaf_index: idx,
    leaf_hash: leafHashes[idx]!,
  }));

  insertCheckpointWithEntries(ctx.db, checkpointRow, entries);
  return toProofCheckpointDTO(checkpointRow);
}

/**
 * Builds a Merkle inclusion proof for a specific receipt within its committed checkpoint.
 */
export function getReceiptInclusionProof(
  ctx: AppContext,
  orgId: string,
  receiptId: string,
): { proof: ReceiptInclusionProofDTO; checkpoint: ProofCheckpointDTO } | null {
  const result = getCheckpointByReceiptId(ctx.db, receiptId);
  if (!result || result.checkpoint.org_id !== orgId) {
    return null;
  }

  const { checkpoint, entry } = result;
  const allEntries = getCheckpointEntries(ctx.db, checkpoint.id);
  const leafHashes = allEntries.map((e) => e.leaf_hash);
  const tree = buildMerkleTree(leafHashes);
  const auditPath = generateMerkleProof(tree, entry.leaf_index);

  const receipt = getReceiptById(ctx.db, orgId, receiptId);
  if (!receipt) return null;

  const proof: ReceiptInclusionProofDTO = {
    receiptId,
    canonicalDigest: receipt.canonical_digest,
    leafHash: entry.leaf_hash,
    leafIndex: entry.leaf_index,
    checkpointId: checkpoint.id,
    checkpointSequence: checkpoint.sequence,
    merkleRoot: checkpoint.merkle_root,
    auditPath,
  };

  return {
    proof,
    checkpoint: toProofCheckpointDTO(checkpoint),
  };
}

/**
 * Assembles a self-contained Independent Verification Bundle for a work receipt.
 * Contains everything required for external verification without internal credentials.
 */
export function getIndependentVerificationBundle(ctx: AppContext, orgId: string, receiptId: string): IndependentVerificationBundle | null {
  const receiptRow = getReceiptById(ctx.db, orgId, receiptId);
  if (!receiptRow) return null;

  const inclusion = getReceiptInclusionProof(ctx, orgId, receiptId);
  if (!inclusion) return null;

  const receiptData = JSON.parse(receiptRow.receipt_json) as CanonicalReceiptData;

  return {
    version: '1.0',
    receipt: receiptData,
    canonicalDigest: receiptRow.canonical_digest,
    leafHash: inclusion.proof.leafHash,
    leafIndex: inclusion.proof.leafIndex,
    auditPath: inclusion.proof.auditPath,
    checkpoint: inclusion.checkpoint,
  };
}
