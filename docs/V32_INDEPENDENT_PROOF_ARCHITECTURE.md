# FairShift Proof: Independently Verifiable Receipts & Cryptographic Anchoring

## 1. Executive Summary & Threat Model

In FairShift, **Work Receipts** protect worker earnings against retroactive manipulation. Prior to V3.2, receipts were sealed exclusively with symmetric HMAC-SHA256 digests (`RECEIPT_SIGNING_SECRET`). While this guaranteed byte-level tamper detection under normal operation, it exhibited two architectural limitations:

1. **Symmetric Secret Exposure:** An external auditor, labor union representative, or worker reviewing their records could not independently verify a receipt without knowing the server's private HMAC secret. Revealing this secret would compromise the integrity of all future and past receipts.
2. **Post-Compromise Retroactive Forgery:** If an employer or attacker compromised the database and signing environment at time $T_2$, they could rewrite historical shift records from $T_1$ and calculate matching HMAC signatures. Without an immutable timestamped checkpoint, historical records could not be proven to have existed in that state prior to the compromise.

FairShift V3.2 resolves these challenges by introducing **Append-Only Cryptographic Checkpoints**, **Binary Merkle Tree Inclusion Proofs**, and **Self-Contained Independent Verification Bundles**.

---

## 2. Cryptographic Architecture

```
+-----------------------------------------------------------------------------------+
|                              Canonical Receipt Data                               |
|   { shiftId, workerId, orgId, version, rules, earnings, checkInAt, checkOutAt }   |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
                     Canonical JSON (Deterministic RFC 8785)
                                         │
                                         ▼
                 HMAC-SHA256 (RECEIPT_SIGNING_SECRET, CanonicalJSON)
                                         │
                                         ▼
                             canonicalDigest (64-char hex)
                                         │
                                         ▼
             Leaf Hash = SHA-256("fairshift:leaf:v1:" + canonicalDigest)
                                         │
                                         ▼
                      Binary Merkle Tree (RFC 6962 Style)
         Node Hash = SHA-256("fairshift:node:v1:" + leftHash + rightHash)
                                         │
                                         ▼
                                    merkleRoot
                                         │
                                         ▼
                     Signed Checkpoint (CHECKPOINT_SIGNING_SECRET)
    { id, orgId, sequence, merkleRoot, previousCheckpointRoot, signature, createdAt }
                                         │
                                         ▼
             Hash Chain: Checkpoint(N) -> Checkpoint(N-1) -> Genesis
```

---

## 3. Cryptographic Primitives & Specifications

### 3.1 Domain-Separated Leaf and Node Hashing

To prevent second-preimage attacks (where an interior node hash could be submitted as a leaf or vice versa), all hashes use explicit cryptographic domain separation prefixes:

- **Leaf Hash:** `SHA-256("fairshift:leaf:v1:" || canonicalDigest)`
- **Interior Node Hash:** `SHA-256("fairshift:node:v1:" || leftHash || rightHash)`
- **Empty Tree Root:** `SHA-256("fairshift:empty:v1")`

### 3.2 Binary Merkle Tree Balancing

When a level in the tree contains an odd number of elements, the final hash is duplicated to form a balanced pair. All hash comparisons use constant-time comparison (`timingSafeEqual`) on raw hex buffers.

### 3.3 Checkpoint Hash Chaining

Every checkpoint includes a monotonically increasing `sequence` number ($1, 2, 3, \dots$) and the `previousCheckpointRoot` of the preceding checkpoint. This forms an immutable hash chain for each organization, preventing silent deletion or reordering of historical batches.

---

## 4. Independent Verification Bundle

A worker or external auditor can export their receipt as a standalone, JSON-serializable bundle via:
`GET /api/receipts/:id/bundle` (worker) or `GET /api/admin/receipts/:id/bundle` (admin).

### Bundle Schema (`IndependentVerificationBundle` v1.0)

```json
{
  "version": "1.0",
  "receipt": {
    "shiftId": "shf_demo_c_ravi_1",
    "workerId": "usr_demo_c_ravi",
    "orgId": "org_demo_construction",
    "version": 1,
    "status": "finalized",
    "checkInAt": "2026-10-27T08:00:00.000Z",
    "checkOutAt": "2026-10-27T17:00:00.000Z",
    "durationMinutes": 540,
    "rules": {
      "scheduledDailyMinutes": 480,
      "hourlyRateMinor": 10000,
      "overtimeMultiplierBp": 15000,
      "currency": "INR"
    },
    "earnings": {
      "durationMinutes": 540,
      "regularMinutes": 480,
      "overtimeMinutes": 60,
      "basePayMinor": 80000,
      "overtimePayMinor": 15000,
      "grossPayMinor": 95000,
      "estimatedNetPayMinor": 95000
    },
    "issuedAt": "2026-10-27T17:00:05.000Z"
  },
  "canonicalDigest": "7b0a...4f1e",
  "leafHash": "a34c...9d22",
  "leafIndex": 0,
  "auditPath": [
    { "position": "right", "hash": "c81d...2301" },
    { "position": "left", "hash": "e92f...77aa" }
  ],
  "checkpoint": {
    "id": "chk_98e1a89c45014389",
    "orgId": "org_demo_construction",
    "sequence": 1,
    "merkleRoot": "f103...cc54",
    "receiptCount": 4,
    "previousCheckpointRoot": null,
    "keyId": "chk_v1",
    "signature": "d38a...1299",
    "createdAt": "2026-10-27T18:00:00.000Z"
  }
}
```

---

## 5. Bundle Verification and Its Trust Limits

Receipt digests and checkpoint signatures are both **HMAC-SHA256**. HMAC is a symmetric primitive: the same secret creates and checks a signature. A bundle is therefore verifiable in two different strengths:

| Verifier holds                     | What `verifyIndependentBundle` can establish                                                                                                     | Result status               |
| :--------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------- |
| Nothing (offline third party)      | The leaf hash and audit path evaluate to the root written in the same bundle. Anyone can build such a bundle, so this is **not** authentication. | `unauthenticated_inclusion` |
| Checkpoint key                     | The checkpoint header (root, sequence, previous root) was signed by the organisation.                                                            | `valid_and_anchored`        |
| Checkpoint key **and** receipt key | Additionally, the receipt body in the bundle is the one the digest was computed over (edits after export are detected).                          | `valid_and_anchored`        |

```typescript
import { verifyIndependentBundle } from 'fairshift/domain/proof';

verifyIndependentBundle(bundle); // { valid: true, authenticated: false, trustStatus: 'unauthenticated_inclusion' }
verifyIndependentBundle(bundle, checkpointKey, receiptKey); // { valid: true, authenticated: true, trustStatus: 'valid_and_anchored' }
```

`POST /api/admin/checkpoints/verify-bundle` performs the full check with the organisation's keys. It only accepts bundles whose receipt and checkpoint belong to the caller's organisation (`wrong_organization` otherwise) and reports unrecognised checkpoint key IDs as `unknown_key` instead of falling back to the active key. Malformed bundles return a structured failure, never a server error.

**This is not independent public verification.** A worker or labour inspector cannot authenticate a bundle without trusting the organisation (or a party holding its keys). Genuine offline verification needs an asymmetric signature (e.g. Ed25519, available in `node:crypto` without new dependencies) over the checkpoint header, with the public key published out of band, plus a public commitment to the receipt contents in the leaf (today the leaf is derived from the HMAC digest, which a keyless verifier cannot recompute). That change alters checkpoint and leaf formats, so it is deferred; see `docs/V41_ENGINEERING_AUDIT.md` for the migration plan.

Integrity is always relative to the recorded inputs: a valid seal shows a receipt has not changed since issue, not that the attendance it records was truthful.

### Verification Steps Executed

1. **Schema Check:** Validates structure, version `1.0`, and 64-hex digest, leaf and root fields.
2. **Receipt Binding (receipt key required):** Recomputes the HMAC digest over the canonical `bundle.receipt` and compares it with `bundle.canonicalDigest`.
3. **Leaf Integrity:** Recomputes `leafHash = SHA-256("fairshift:leaf:v1:" + bundle.canonicalDigest)` and asserts equality.
4. **Merkle Path Traversal:** Iteratively hashes the leaf through each step in `auditPath` according to `position` (`left` or `right`).
5. **Root Equality:** Verifies the computed root matches `bundle.checkpoint.merkleRoot`.
6. **Checkpoint Signature (checkpoint key required):** Verifies the HMAC-SHA256 signature of the checkpoint header.

---

## 6. Verification Statuses

| Status                         | Meaning                                                                                     |
| :----------------------------- | :------------------------------------------------------------------------------------------ |
| `valid_and_anchored`           | Receipt HMAC valid, leaf included in a checkpoint whose signature was checked with its key. |
| `valid_unanchored`             | Receipt HMAC valid, but not yet included in a checkpoint batch (e.g., brand-new shift).     |
| `unauthenticated_inclusion`    | Merkle path is internally consistent, but no key was available to authenticate the root.    |
| `wrong_organization`           | Bundle was submitted to an organisation that did not issue it.                              |
| `invalid_digest`               | Receipt body, digest or leaf hash do not match, or the bundle is malformed.                 |
| `invalid_proof`                | Merkle audit path does not evaluate to checkpoint root (tampered leaf or path).             |
| `invalid_checkpoint_signature` | Checkpoint header signature does not match the key.                                         |
| `missing_checkpoint`           | Checkpoint referenced by entry does not exist in the log.                                   |
| `unknown_key`                  | Key identifier not found in active or historical key maps.                                  |
| `broken_version_chain`         | Version sequence (v1 -> v2) or `previousVersionId` link is severed.                         |

---

## 7. Key Separation & Rotation Policy

| Key Type                | Environment Variable                                | Usage                          | Rotation Impact                                                                                                                                                          |
| :---------------------- | :-------------------------------------------------- | :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Receipt Signing Key** | `RECEIPT_SIGNING_SECRET`, `RECEIPT_KEYS_JSON`       | HMAC-SHA256 receipt sealing    | Historical receipts verify via `receipt.key_id`. Zero downtime.                                                                                                          |
| **Checkpoint Key**      | `CHECKPOINT_SIGNING_SECRET`, `CHECKPOINT_KEYS_JSON` | HMAC-SHA256 checkpoint headers | Checkpoints verify via `checkpoint.key_id`. Multi-key map.                                                                                                               |
| **Session Secret**      | `SESSION_SECRET`                                    | Web HttpOnly auth cookies      | Sessions expire on rotation. Receipt, checkpoint and signal keys fall back to this secret when their own variables are unset, so set them explicitly before rotating it. |
| **Signal Secret**       | `SIGNAL_PSEUDONYM_SECRET`                           | Reporter pseudonymization      | Worker report retrieval preserved across session cookie rotations.                                                                                                       |

### Compromise Analysis:

- If `RECEIPT_SIGNING_SECRET` is compromised at time $T_{comp}$, any receipt anchored in a checkpoint signed **prior** to $T_{comp}$ remains mathematically protected by the checkpoint hash chain.
- Forgers cannot alter receipts anchored in historical checkpoints without also forging the checkpoint signature and recalculating the entire subsequent checkpoint hash chain.
