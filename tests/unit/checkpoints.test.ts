import { describe, expect, it } from 'vitest';
import {
  computeCheckpointSignature,
  computeReceiptDigest,
  validateReceiptVersionChain,
  verifyCheckpointSignature,
  verifyIndependentBundle,
} from '../../src/domain/proof';
import { buildMerkleTree, computeReceiptLeafHash, generateMerkleProof } from '../../src/domain/merkle';
import type { CanonicalReceiptData, IndependentVerificationBundle, ProofCheckpointDTO } from '../../src/shared/types';

describe('Proof Checkpoints and Independent Bundle Verification', () => {
  const receiptSecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const checkpointSecret = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

  const sampleReceipt: CanonicalReceiptData = {
    shiftId: 'shf_1',
    workerId: 'usr_1',
    orgId: 'org_1',
    version: 1,
    status: 'finalized',
    checkInAt: '2026-10-27T08:00:00.000Z',
    checkOutAt: '2026-10-27T17:00:00.000Z',
    durationMinutes: 540,
    rules: {
      scheduledDailyMinutes: 480,
      hourlyRateMinor: 10000,
      overtimeMultiplierBp: 15000,
      currency: 'INR',
    },
    earnings: {
      durationMinutes: 540,
      regularMinutes: 480,
      overtimeMinutes: 60,
      basePayMinor: 80000,
      overtimePayMinor: 15000,
      grossPayMinor: 95000,
      estimatedNetPayMinor: 95000,
    },
    issuedAt: '2026-10-27T17:00:05.000Z',
  };

  const digest = computeReceiptDigest(receiptSecret, sampleReceipt);
  const leafHash = computeReceiptLeafHash(digest);
  const tree = buildMerkleTree([leafHash]);
  const auditPath = generateMerkleProof(tree, 0);

  const unsignedCheckpoint: Omit<ProofCheckpointDTO, 'signature'> = {
    id: 'chk_test_1',
    orgId: 'org_1',
    sequence: 1,
    merkleRoot: tree.root,
    receiptCount: 1,
    previousCheckpointRoot: null,
    keyId: 'chk_v1',
    createdAt: '2026-10-27T18:00:00.000Z',
  };

  const signature = computeCheckpointSignature(checkpointSecret, unsignedCheckpoint);
  const checkpoint: ProofCheckpointDTO = {
    ...unsignedCheckpoint,
    signature,
  };

  it('signs and verifies checkpoint headers with dedicated key', () => {
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyCheckpointSignature(checkpointSecret, checkpoint)).toBe(true);

    // Rejects wrong secret
    expect(verifyCheckpointSignature('wrong_secret_12345678901234567890', checkpoint)).toBe(false);

    // Rejects tampered sequence
    expect(verifyCheckpointSignature(checkpointSecret, { ...checkpoint, sequence: 2 })).toBe(false);

    // Rejects tampered root
    expect(verifyCheckpointSignature(checkpointSecret, { ...checkpoint, merkleRoot: 'deadbeef'.repeat(8) })).toBe(false);
  });

  it('independently verifies valid bundle without server database or receipt secret', () => {
    const bundle: IndependentVerificationBundle = {
      version: '1.0',
      receipt: sampleReceipt,
      canonicalDigest: digest,
      leafHash,
      leafIndex: 0,
      auditPath,
      checkpoint,
    };

    // Without the HMAC checkpoint key only internal Merkle consistency can be shown — never "anchored".
    const resultNoSecret = verifyIndependentBundle(bundle);
    expect(resultNoSecret.valid).toBe(true);
    expect(resultNoSecret.authenticated).toBe(false);
    expect(resultNoSecret.trustStatus).toBe('unauthenticated_inclusion');

    // With the organisation's checkpoint key the signed root is authenticated
    const resultWithSecret = verifyIndependentBundle(bundle, checkpointSecret);
    expect(resultWithSecret.valid).toBe(true);
    expect(resultWithSecret.authenticated).toBe(true);
    expect(resultWithSecret.trustStatus).toBe('valid_and_anchored');

    // With both keys the receipt contents are bound to the digest as well
    expect(verifyIndependentBundle(bundle, checkpointSecret, receiptSecret).trustStatus).toBe('valid_and_anchored');
  });

  it('rejects a bundle whose receipt contents were altered after export when the receipt key is supplied', () => {
    const bundle: IndependentVerificationBundle = {
      version: '1.0',
      receipt: { ...sampleReceipt, earnings: { ...sampleReceipt.earnings, grossPayMinor: 1 } },
      canonicalDigest: digest,
      leafHash,
      leafIndex: 0,
      auditPath,
      checkpoint,
    };
    const res = verifyIndependentBundle(bundle, checkpointSecret, receiptSecret);
    expect(res.valid).toBe(false);
    expect(res.trustStatus).toBe('invalid_digest');
  });

  it('reports a self-consistent forged bundle as unauthenticated rather than anchored', () => {
    const forgedDigest = 'ab'.repeat(32);
    const forgedLeaf = computeReceiptLeafHash(forgedDigest);
    const forgedTree = buildMerkleTree([forgedLeaf]);
    const forged: IndependentVerificationBundle = {
      version: '1.0',
      receipt: sampleReceipt,
      canonicalDigest: forgedDigest,
      leafHash: forgedLeaf,
      leafIndex: 0,
      auditPath: generateMerkleProof(forgedTree, 0),
      checkpoint: { ...checkpoint, merkleRoot: forgedTree.root },
    };
    expect(verifyIndependentBundle(forged).trustStatus).toBe('unauthenticated_inclusion');
    expect(verifyIndependentBundle(forged, checkpointSecret).trustStatus).toBe('invalid_checkpoint_signature');
  });

  it('returns a structured failure instead of throwing for malformed bundles', () => {
    const malformed: unknown[] = [
      null,
      'bundle',
      { version: '1.0' },
      { version: '1.0', receipt: sampleReceipt, canonicalDigest: 'not-hex', leafHash, auditPath, checkpoint },
      { version: '1.0', receipt: sampleReceipt, canonicalDigest: digest, auditPath, checkpoint },
      { version: '1.0', receipt: sampleReceipt, canonicalDigest: digest, leafHash, auditPath: 'x', checkpoint },
      { version: '1.0', receipt: sampleReceipt, canonicalDigest: digest, leafHash, auditPath: [{ position: 'up', hash: leafHash }], checkpoint },
      { version: '1.0', receipt: sampleReceipt, canonicalDigest: digest, leafHash, auditPath, checkpoint: { ...checkpoint, merkleRoot: 42 } },
    ];
    for (const b of malformed) {
      const res = verifyIndependentBundle(b as IndependentVerificationBundle, checkpointSecret, receiptSecret);
      expect(res.valid).toBe(false);
      expect(res.authenticated).toBe(false);
    }
  });

  it('rejects bundle with corrupted leaf hash or canonical digest', () => {
    const corruptedDigest = digest.replace(/^[0-9a-f]{4}/, 'dead');
    const bundle: IndependentVerificationBundle = {
      version: '1.0',
      receipt: sampleReceipt,
      canonicalDigest: corruptedDigest,
      leafHash,
      leafIndex: 0,
      auditPath,
      checkpoint,
    };

    const res = verifyIndependentBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.trustStatus).toBe('invalid_digest');
  });

  it('rejects bundle with forged audit path', () => {
    const fakeTree = buildMerkleTree([computeReceiptLeafHash(digest.replace(/^[0-9a-f]{4}/, '1111'))]);
    const fakeProof = generateMerkleProof(fakeTree, 0);

    const bundle: IndependentVerificationBundle = {
      version: '1.0',
      receipt: sampleReceipt,
      canonicalDigest: digest,
      leafHash,
      leafIndex: 0,
      auditPath: fakeProof,
      checkpoint: {
        ...checkpoint,
        merkleRoot: fakeTree.root,
      },
    };

    // Tree doesn't match original leaf hash
    const res = verifyIndependentBundle(bundle);
    expect(res.valid).toBe(false);
    expect(res.trustStatus).toBe('invalid_proof');
  });

  it('rejects bundle when checkpoint signature fails verification', () => {
    const bundle: IndependentVerificationBundle = {
      version: '1.0',
      receipt: sampleReceipt,
      canonicalDigest: digest,
      leafHash,
      leafIndex: 0,
      auditPath,
      checkpoint: {
        ...checkpoint,
        signature: 'deadbeef'.repeat(8),
      },
    };

    const res = verifyIndependentBundle(bundle, checkpointSecret);
    expect(res.valid).toBe(false);
    expect(res.trustStatus).toBe('invalid_checkpoint_signature');
  });

  it('validates receipt version chains and detects missing links', () => {
    // Valid unbroken chain
    const validChain = [
      { id: 'rcpt_1', version: 1, previousVersionId: null },
      { id: 'rcpt_2', version: 2, previousVersionId: 'rcpt_1' },
      { id: 'rcpt_3', version: 3, previousVersionId: 'rcpt_2' },
    ];
    expect(validateReceiptVersionChain(validChain).valid).toBe(true);

    // Broken: v1 has a previous version
    const invalidV1 = [{ id: 'rcpt_1', version: 1, previousVersionId: 'some_other' }];
    expect(validateReceiptVersionChain(invalidV1).valid).toBe(false);

    // Broken: skipped v2
    const skippedV2 = [
      { id: 'rcpt_1', version: 1, previousVersionId: null },
      { id: 'rcpt_3', version: 3, previousVersionId: 'rcpt_1' },
    ];
    expect(validateReceiptVersionChain(skippedV2).valid).toBe(false);
    expect(validateReceiptVersionChain(skippedV2).brokenAtVersion).toBe(3);

    // Broken: wrong previousVersionId
    const wrongParent = [
      { id: 'rcpt_1', version: 1, previousVersionId: null },
      { id: 'rcpt_2', version: 2, previousVersionId: 'wrong_parent' },
    ];
    expect(validateReceiptVersionChain(wrongParent).valid).toBe(false);
    expect(validateReceiptVersionChain(wrongParent).brokenAtVersion).toBe(2);
  });
});
