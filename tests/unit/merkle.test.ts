import { describe, expect, it } from 'vitest';
import { buildMerkleTree, computeNodeHash, computeReceiptLeafHash, generateMerkleProof, hashSha256, verifyMerkleProof } from '../../src/domain/merkle';

describe('Merkle Tree and Inclusion Proofs', () => {
  const dummyDigest1 = hashSha256('shift_receipt_1');
  const dummyDigest2 = hashSha256('shift_receipt_2');
  const dummyDigest3 = hashSha256('shift_receipt_3');
  const dummyDigest4 = hashSha256('shift_receipt_4');
  const dummyDigest5 = hashSha256('shift_receipt_5');

  it('computes domain-separated leaf hashes rejecting invalid inputs', () => {
    const leaf = computeReceiptLeafHash(dummyDigest1);
    expect(leaf).toMatch(/^[0-9a-f]{64}$/);
    expect(() => computeReceiptLeafHash('invalid')).toThrow(/Invalid canonical digest/);
  });

  it('builds an empty Merkle tree with deterministic empty root', () => {
    const tree = buildMerkleTree([]);
    expect(tree.leaves).toHaveLength(0);
    expect(tree.root).toMatch(/^[0-9a-f]{64}$/);
  });

  it('builds a single-leaf tree and verifies inclusion proof', () => {
    const leaf = computeReceiptLeafHash(dummyDigest1);
    const tree = buildMerkleTree([leaf]);
    expect(tree.root).toBe(leaf);

    const proof = generateMerkleProof(tree, 0);
    expect(proof).toHaveLength(0);
    expect(verifyMerkleProof(leaf, proof, tree.root)).toBe(true);
  });

  it('builds a balanced 4-leaf tree and verifies every leaf proof', () => {
    const leaves = [dummyDigest1, dummyDigest2, dummyDigest3, dummyDigest4].map(computeReceiptLeafHash);
    const tree = buildMerkleTree(leaves);

    expect(tree.levels).toHaveLength(3); // leaves (4), level1 (2), root (1)
    expect(tree.root).toMatch(/^[0-9a-f]{64}$/);

    for (let i = 0; i < leaves.length; i++) {
      const proof = generateMerkleProof(tree, i);
      expect(proof).toHaveLength(2);
      expect(verifyMerkleProof(leaves[i]!, proof, tree.root)).toBe(true);
    }
  });

  it('builds an odd-sized 3-leaf tree and verifies duplicated sibling proof', () => {
    const leaves = [dummyDigest1, dummyDigest2, dummyDigest3].map(computeReceiptLeafHash);
    const tree = buildMerkleTree(leaves);

    for (let i = 0; i < leaves.length; i++) {
      const proof = generateMerkleProof(tree, i);
      expect(verifyMerkleProof(leaves[i]!, proof, tree.root)).toBe(true);
    }
  });

  it('builds an odd-sized 5-leaf tree across 4 levels and verifies all leaves', () => {
    const leaves = [dummyDigest1, dummyDigest2, dummyDigest3, dummyDigest4, dummyDigest5].map(computeReceiptLeafHash);
    const tree = buildMerkleTree(leaves);

    for (let i = 0; i < leaves.length; i++) {
      const proof = generateMerkleProof(tree, i);
      expect(verifyMerkleProof(leaves[i]!, proof, tree.root)).toBe(true);
    }
  });

  it('rejects tampered leaf hash with valid proof', () => {
    const leaves = [dummyDigest1, dummyDigest2, dummyDigest3, dummyDigest4].map(computeReceiptLeafHash);
    const tree = buildMerkleTree(leaves);
    const proof = generateMerkleProof(tree, 0);

    const tamperedLeaf = computeReceiptLeafHash(dummyDigest5);
    expect(verifyMerkleProof(tamperedLeaf, proof, tree.root)).toBe(false);
  });

  it('rejects tampered audit proof steps', () => {
    const leaves = [dummyDigest1, dummyDigest2, dummyDigest3, dummyDigest4].map(computeReceiptLeafHash);
    const tree = buildMerkleTree(leaves);
    const proof = generateMerkleProof(tree, 0);

    // Tamper one hash in the proof
    const tamperedProof = [{ position: proof[0]!.position, hash: dummyDigest5 }, ...proof.slice(1)];
    expect(verifyMerkleProof(leaves[0]!, tamperedProof, tree.root)).toBe(false);

    // Invert position
    const invertedProof = [{ position: (proof[0]!.position === 'left' ? 'right' : 'left') as 'left' | 'right', hash: proof[0]!.hash }, ...proof.slice(1)];
    expect(verifyMerkleProof(leaves[0]!, invertedProof, tree.root)).toBe(false);
  });

  it('rejects tampered root', () => {
    const leaves = [dummyDigest1, dummyDigest2].map(computeReceiptLeafHash);
    const tree = buildMerkleTree(leaves);
    const proof = generateMerkleProof(tree, 0);

    const tamperedRoot = hashSha256('tampered_root');
    expect(verifyMerkleProof(leaves[0]!, proof, tamperedRoot)).toBe(false);
  });

  it('throws when requesting proof for out-of-bounds leaf index', () => {
    const leaves = [dummyDigest1, dummyDigest2].map(computeReceiptLeafHash);
    const tree = buildMerkleTree(leaves);

    expect(() => generateMerkleProof(tree, -1)).toThrow(/out of bounds/);
    expect(() => generateMerkleProof(tree, 2)).toThrow(/out of bounds/);
  });

  it('defends against second-preimage collision with node prefix', () => {
    const leaf = computeReceiptLeafHash(dummyDigest1);
    const node = computeNodeHash(dummyDigest1, dummyDigest2);
    // leaf prefix prevents collision with node hash even if input matches
    expect(leaf).not.toBe(node);
  });
});
