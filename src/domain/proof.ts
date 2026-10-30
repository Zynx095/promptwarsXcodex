// FairShift Proof — Canonical serialization, cryptographic digests, and earnings calculations.
import { createHmac } from 'node:crypto';
import { safeEqual } from '../server/auth/crypto';
import { payForMinutes } from '../shared/money';
import { minutesBetween } from '../shared/time';
import { DomainError } from './errors';
import { computeReceiptLeafHash, verifyMerkleProof } from './merkle';
import type {
  CanonicalReceiptData,
  IndependentVerificationBundle,
  ProofCheckpointDTO,
  ReceiptCalculationRule,
  ReceiptCorrectionDiff,
  ReceiptEarningsBreakdown,
  VerificationTrustStatus,
} from '../shared/types';

export type {
  CanonicalReceiptData,
  IndependentVerificationBundle,
  ProofCheckpointDTO,
  ReceiptCalculationRule,
  ReceiptCorrectionDiff,
  ReceiptEarningsBreakdown,
  VerificationTrustStatus,
};

/**
 * Deterministically serializes any JavaScript object or primitive into canonical JSON.
 * Keys are sorted recursively, guaranteeing byte-for-byte reproducibility regardless of key insertion order.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map((k) => JSON.stringify(k) + ':' + canonicalizeJson((obj as Record<string, unknown>)[k]));
  return '{' + entries.join(',') + '}';
}

/**
 * Computes a cryptographic HMAC-SHA256 digest of the canonical receipt data.
 */
export function computeReceiptDigest(secret: string, data: CanonicalReceiptData): string {
  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
    throw new DomainError('INVALID_SIGNING_SECRET', 'A valid non-empty signing secret is required to sign work receipts.');
  }
  if (!data || typeof data !== 'object') {
    throw new DomainError('INVALID_RECEIPT_DATA', 'Receipt data must be a valid object.');
  }
  const canonicalString = canonicalizeJson(data);
  return createHmac('sha256', secret).update(canonicalString).digest('hex');
}

/**
 * Verifies that the provided receipt data matches its stored cryptographic digest.
 * Safely guards against missing keys, malformed digests, non-hex strings, and parsing anomalies.
 */
export function verifyReceiptDigest(secret: string, data: CanonicalReceiptData, expectedDigest: string): boolean {
  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) return false;
  if (!expectedDigest || typeof expectedDigest !== 'string') return false;
  // A valid SHA-256 hex digest must be exactly 64 hexadecimal characters
  if (!/^[0-9a-fA-F]{64}$/.test(expectedDigest)) return false;
  try {
    const computed = computeReceiptDigest(secret, data);
    return safeEqual(computed.toLowerCase(), expectedDigest.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Calculates earnings for a completed shift using organization pay rules and daily scheduled thresholds.
 * Takes into account worked minutes already accumulated on the same calendar day by completed prior shifts.
 */
export function calculateShiftEarnings(
  shift: { checkInAt: string; checkOutAt: string },
  priorWorkedMinutesOnDay: number,
  scheduledDailyMinutes: number,
  hourlyRateMinor: number,
  overtimeMultiplierBp: number,
): ReceiptEarningsBreakdown {
  if (!shift.checkOutAt) {
    throw new DomainError('INVALID_SHIFT_TIMES', 'Cannot calculate earnings for an open shift.');
  }

  const durationMinutes = minutesBetween(shift.checkInAt, shift.checkOutAt);
  if (durationMinutes < 0) {
    throw new DomainError('INVALID_SHIFT_TIMES', 'Check-out time must be after check-in time.');
  }

  // Determine how many minutes of this shift fall into regular vs overtime based on daily quota
  const remainingRegularQuota = Math.max(0, scheduledDailyMinutes - priorWorkedMinutesOnDay);
  const regularMinutes = Math.min(durationMinutes, remainingRegularQuota);
  const overtimeMinutes = Math.max(0, durationMinutes - regularMinutes);

  const basePayMinor = payForMinutes(regularMinutes, hourlyRateMinor);
  const overtimePayMinor = payForMinutes(overtimeMinutes, hourlyRateMinor, overtimeMultiplierBp);
  const grossPayMinor = basePayMinor + overtimePayMinor;

  // In shift receipts without period deduction reconciliations, estimated net equals gross before payslip
  const estimatedNetPayMinor = grossPayMinor;

  return {
    durationMinutes,
    regularMinutes,
    overtimeMinutes,
    basePayMinor,
    overtimePayMinor,
    grossPayMinor,
    estimatedNetPayMinor,
  };
}

/**
 * Computes a structured diff between a previous receipt version and a corrected receipt version.
 */
export function buildCorrectionDiff(
  prev: CanonicalReceiptData,
  curr: {
    checkInAt: string;
    checkOutAt: string;
    durationMinutes: number;
    rules?: ReceiptCalculationRule;
    earnings: ReceiptEarningsBreakdown;
  },
  meta: {
    correctedAt: string;
    correctedBy: string;
    reason: string;
  },
): ReceiptCorrectionDiff {
  const changes: ReceiptCorrectionDiff['changes'] = {};

  if (prev.checkInAt !== curr.checkInAt) {
    changes.checkInAt = { before: prev.checkInAt, after: curr.checkInAt };
  }
  if (prev.checkOutAt !== curr.checkOutAt) {
    changes.checkOutAt = { before: prev.checkOutAt, after: curr.checkOutAt };
  }
  if (prev.durationMinutes !== curr.durationMinutes) {
    changes.durationMinutes = { before: prev.durationMinutes, after: curr.durationMinutes };
  }
  if (curr.rules && prev.rules.hourlyRateMinor !== curr.rules.hourlyRateMinor) {
    changes.hourlyRateMinor = { before: prev.rules.hourlyRateMinor, after: curr.rules.hourlyRateMinor };
  }
  if (prev.earnings.basePayMinor !== curr.earnings.basePayMinor) {
    changes.basePayMinor = { before: prev.earnings.basePayMinor, after: curr.earnings.basePayMinor };
  }
  if (prev.earnings.overtimeMinutes !== curr.earnings.overtimeMinutes) {
    changes.overtimeMinutes = { before: prev.earnings.overtimeMinutes, after: curr.earnings.overtimeMinutes };
  }
  if (prev.earnings.overtimePayMinor !== curr.earnings.overtimePayMinor) {
    changes.overtimePayMinor = { before: prev.earnings.overtimePayMinor, after: curr.earnings.overtimePayMinor };
  }
  if (prev.earnings.grossPayMinor !== curr.earnings.grossPayMinor) {
    changes.grossPayMinor = {
      before: prev.earnings.grossPayMinor,
      after: curr.earnings.grossPayMinor,
      deltaMinor: curr.earnings.grossPayMinor - prev.earnings.grossPayMinor,
    };
  }

  return {
    previousVersion: prev.version,
    correctedAt: meta.correctedAt,
    correctedBy: meta.correctedBy,
    reason: meta.reason,
    changes,
  };
}

export interface CheckpointHeader {
  id: string;
  orgId: string;
  sequence: number;
  merkleRoot: string;
  receiptCount: number;
  previousCheckpointRoot: string | null;
  keyId: string;
  createdAt: string;
}

/**
 * Computes a cryptographic HMAC-SHA256 signature for a checkpoint header.
 */
export function computeCheckpointSignature(secret: string, header: CheckpointHeader): string {
  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
    throw new DomainError('INVALID_SIGNING_SECRET', 'A valid non-empty signing secret is required to sign checkpoints.');
  }
  const canonical = canonicalizeJson(header);
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

/**
 * Verifies that a checkpoint's signature matches its header attributes.
 */
export function verifyCheckpointSignature(secret: string, checkpoint: ProofCheckpointDTO): boolean {
  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) return false;
  if (!checkpoint.signature || !/^[0-9a-fA-F]{64}$/.test(checkpoint.signature)) return false;
  const header: CheckpointHeader = {
    id: checkpoint.id,
    orgId: checkpoint.orgId,
    sequence: checkpoint.sequence,
    merkleRoot: checkpoint.merkleRoot,
    receiptCount: checkpoint.receiptCount,
    previousCheckpointRoot: checkpoint.previousCheckpointRoot,
    keyId: checkpoint.keyId,
    createdAt: checkpoint.createdAt,
  };
  try {
    const computed = computeCheckpointSignature(secret, header);
    return safeEqual(computed.toLowerCase(), checkpoint.signature.toLowerCase());
  } catch {
    return false;
  }
}

export interface BundleVerificationResult {
  valid: boolean;
  trustStatus: VerificationTrustStatus;
  /** True only when the checkpoint signature was checked with the organisation's checkpoint key. */
  authenticated: boolean;
  reason?: string;
}

const HEX64 = /^[0-9a-fA-F]{64}$/;

function isWellFormedBundle(bundle: unknown): bundle is IndependentVerificationBundle {
  if (!bundle || typeof bundle !== 'object') return false;
  const b = bundle as Partial<IndependentVerificationBundle>;
  const c = b.checkpoint as Partial<ProofCheckpointDTO> | undefined;
  return (
    b.version === '1.0' &&
    !!b.receipt &&
    typeof b.receipt === 'object' &&
    typeof b.canonicalDigest === 'string' &&
    HEX64.test(b.canonicalDigest) &&
    typeof b.leafHash === 'string' &&
    HEX64.test(b.leafHash) &&
    Array.isArray(b.auditPath) &&
    b.auditPath.length <= 64 &&
    !!c &&
    typeof c === 'object' &&
    typeof c.merkleRoot === 'string' &&
    HEX64.test(c.merkleRoot)
  );
}

/**
 * Verifies a verification bundle containing receipt, Merkle proof, and checkpoint. Never throws.
 *
 * Without secrets this only proves internal consistency: the leaf and audit path evaluate to the
 * checkpoint root stated in the same bundle. Checkpoints and receipt digests are HMAC-SHA256, so
 * authenticity can only be established by a holder of the organisation's keys (`checkpointSecret`
 * for the checkpoint signature, `receiptSecret` to bind the receipt contents to the digest).
 * Integrity is relative to the recorded inputs; it does not prove the original record was truthful.
 */
export function verifyIndependentBundle(bundle: IndependentVerificationBundle, checkpointSecret?: string, receiptSecret?: string): BundleVerificationResult {
  if (!isWellFormedBundle(bundle)) {
    return { valid: false, trustStatus: 'invalid_digest', authenticated: false, reason: 'Malformed verification bundle structure' };
  }

  try {
    // 1. Bind the receipt contents to the canonical digest (requires the receipt signing key)
    if (receiptSecret && !verifyReceiptDigest(receiptSecret, bundle.receipt, bundle.canonicalDigest)) {
      return { valid: false, trustStatus: 'invalid_digest', authenticated: false, reason: 'Receipt contents do not match the canonical digest' };
    }

    // 2. Verify canonical digest against leaf data
    const leafHash = computeReceiptLeafHash(bundle.canonicalDigest);
    if (!safeEqual(leafHash.toLowerCase(), bundle.leafHash.toLowerCase())) {
      return { valid: false, trustStatus: 'invalid_digest', authenticated: false, reason: 'Leaf hash does not match canonical digest' };
    }

    // 3. Verify Merkle inclusion proof against checkpoint root
    const proofValid = verifyMerkleProof(bundle.leafHash, bundle.auditPath, bundle.checkpoint.merkleRoot);
    if (!proofValid) {
      return {
        valid: false,
        trustStatus: 'invalid_proof',
        authenticated: false,
        reason: 'Merkle inclusion proof does not evaluate to checkpoint root',
      };
    }

    // 4. Without the checkpoint key the root itself is unauthenticated: anyone can build a consistent bundle.
    if (!checkpointSecret) {
      return {
        valid: true,
        trustStatus: 'unauthenticated_inclusion',
        authenticated: false,
        reason: 'Merkle inclusion is internally consistent, but the checkpoint signature was not checked (HMAC key required)',
      };
    }

    if (!verifyCheckpointSignature(checkpointSecret, bundle.checkpoint)) {
      return { valid: false, trustStatus: 'invalid_checkpoint_signature', authenticated: false, reason: 'Checkpoint signature verification failed' };
    }
  } catch {
    return { valid: false, trustStatus: 'invalid_digest', authenticated: false, reason: 'Malformed verification bundle structure' };
  }

  return { valid: true, trustStatus: 'valid_and_anchored', authenticated: true };
}

/**
 * Verifies that a sequence of receipt versions forms an unbroken historical chain.
 */
export function validateReceiptVersionChain(history: { id: string; version: number; previousVersionId: string | null }[]): {
  valid: boolean;
  brokenAtVersion?: number;
} {
  if (history.length === 0) return { valid: true };
  const sorted = [...history].sort((a, b) => a.version - b.version);
  const first = sorted[0];
  if (!first || first.version !== 1 || first.previousVersionId !== null) {
    return { valid: false, brokenAtVersion: first?.version };
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr || curr.version !== prev.version + 1 || curr.previousVersionId !== prev.id) {
      return { valid: false, brokenAtVersion: curr?.version };
    }
  }
  return { valid: true };
}
