// Merkle Tree and Cryptographic Inclusion Proofs for Independent Work Receipt Anchoring.
import { createHash, timingSafeEqual } from 'node:crypto';

export interface MerkleProofStep {
  position: 'left' | 'right';
  hash: string;
}

export interface MerkleTree {
  leaves: string[];
  levels: string[][];
  root: string;
}

const LEAF_PREFIX = 'fairshift:leaf:v1:';
const NODE_PREFIX = 'fairshift:node:v1:';
const EMPTY_ROOT = createHash('sha256').update('fairshift:empty:v1').digest('hex');

export function hashSha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Computes a domain-separated leaf hash from a receipt canonical digest.
 * Prefixing prevents second-preimage attacks between leaves and interior nodes.
 */
export function computeReceiptLeafHash(canonicalDigest: string): string {
  if (!canonicalDigest || !/^[0-9a-fA-F]{64}$/.test(canonicalDigest)) {
    throw new Error('Invalid canonical digest: must be a 64-character hex string');
  }
  return hashSha256(LEAF_PREFIX + canonicalDigest.toLowerCase());
}

/**
 * Computes an interior node hash from left and right child hashes.
 */
export function computeNodeHash(left: string, right: string): string {
  return hashSha256(NODE_PREFIX + left.toLowerCase() + right.toLowerCase());
}

/**
 * Builds a deterministic binary Merkle tree over an array of leaf hashes.
 * If a level has an odd number of elements, the last element is duplicated to form a balanced pair.
 */
export function buildMerkleTree(leafHashes: string[]): MerkleTree {
  if (leafHashes.length === 0) {
    return {
      leaves: [],
      levels: [[]],
      root: EMPTY_ROOT,
    };
  }

  // Validate all leaf hashes
  const validatedLeaves = leafHashes.map((h) => {
    if (!/^[0-9a-fA-F]{64}$/.test(h)) {
      throw new Error(`Invalid leaf hash: ${h}`);
    }
    return h.toLowerCase();
  });

  const levels: string[][] = [validatedLeaves];
  let currentLevel = validatedLeaves;

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]!;
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1]! : left;
      nextLevel.push(computeNodeHash(left, right));
    }
    levels.push(nextLevel);
    currentLevel = nextLevel;
  }

  return {
    leaves: validatedLeaves,
    levels,
    root: currentLevel[0] ?? EMPTY_ROOT,
  };
}

/**
 * Generates a Merkle inclusion proof for a leaf at the specified index.
 */
export function generateMerkleProof(tree: MerkleTree, leafIndex: number): MerkleProofStep[] {
  if (leafIndex < 0 || leafIndex >= tree.leaves.length) {
    throw new Error(`Leaf index ${leafIndex} out of bounds (total leaves: ${tree.leaves.length})`);
  }

  const proof: MerkleProofStep[] = [];
  let index = leafIndex;

  // Walk from bottom to top (excluding the root level)
  for (let l = 0; l < tree.levels.length - 1; l++) {
    const level = tree.levels[l];
    if (!level) continue;
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;

    let siblingHash: string;
    if (siblingIndex < level.length && level[siblingIndex]) {
      siblingHash = level[siblingIndex]!;
    } else {
      // Duplicated last node for odd length
      siblingHash = level[index]!;
    }

    proof.push({
      position: isRight ? 'left' : 'right',
      hash: siblingHash,
    });

    index = Math.floor(index / 2);
  }

  return proof;
}

/**
 * Independently verifies that a leaf hash belongs to a Merkle tree with the given expected root,
 * without needing the full tree or any server secrets.
 */
export function verifyMerkleProof(leafHash: string, proof: MerkleProofStep[], expectedRoot: string): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(leafHash)) return false;
  if (!/^[0-9a-fA-F]{64}$/.test(expectedRoot)) return false;
  if (!Array.isArray(proof)) return false;

  let current = leafHash.toLowerCase();

  for (const step of proof) {
    if (!step || typeof step !== 'object') return false;
    if (!/^[0-9a-fA-F]{64}$/.test(step.hash)) return false;
    const sibling = step.hash.toLowerCase();

    if (step.position === 'left') {
      current = computeNodeHash(sibling, current);
    } else if (step.position === 'right') {
      current = computeNodeHash(current, sibling);
    } else {
      return false;
    }
  }

  const currentBuf = Buffer.from(current, 'hex');
  const rootBuf = Buffer.from(expectedRoot.toLowerCase(), 'hex');
  return currentBuf.length === rootBuf.length && timingSafeEqual(currentBuf, rootBuf);
}
