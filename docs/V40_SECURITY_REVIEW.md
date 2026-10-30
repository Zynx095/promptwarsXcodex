# FairShift V4.0 — Security & Trust Boundary Review

## Executive Summary

FairShift V4.0 enforces rigorous cryptographic and architectural trust boundaries. This review documents the threat model, cryptographic invariants, privacy safeguards, and security boundary defenses.

---

## 1. Cryptographic Trust Model & Trust Boundaries

### A. FairShift Proof Architecture

FairShift Proof creates tamper-evident, version-chained receipts for work hours and calculated gross earnings:

- **Canonical Serialization**: JSON payloads are normalized with sorted object keys, fixed minor units (integer paise), and strict UTC ISO timestamps.
- **Sealing Mechanism**: Receipts are signed via HMAC-SHA256 using an organization secret (`RECEIPT_SIGNING_SECRET`).
- **Leaf Hashing**: Merkle tree leaves are computed using domain-separated prefixing:
  $$\text{Leaf} = \text{SHA256}(\text{"fairshift:leaf:v1:"} \mathbin{\Vert} \text{CanonicalDigest})$$
- **Node Hashing**: Internal tree nodes concatenate sorted left and right hashes with the domain prefix:
  $$\text{Node} = \text{SHA256}(\text{"fairshift:node:v1:"} \mathbin{\Vert} \text{Left} \mathbin{\Vert} \text{Right})$$

### B. Trust Boundary Analysis: Symmetric vs. Asymmetric Signatures

- **Current Mechanism**: Receipts and checkpoints are signed using HMAC-SHA256 with key identifier indexing (`key_id: 'v1'`, `key_id: 'chk_v1'`).
- **Security Boundary**: The signing secrets reside exclusively in the server environment and are **never transmitted to client web browsers** or bundled into static assets.
- **Verification Guarantee**:
  - The client UI verifies receipts by requesting server verification (`/api/receipts/:id/verify`), where the server recalculates the digest with the private secret.
  - Independent auditors receive self-contained proof bundles containing the binary Merkle root, leaf index, and inclusion path (`/api/receipts/:id/bundle`).
  - An auditor who possesses the verification key can independently verify that the receipt is an anchored leaf in the checkpoint tree without database access.
  - _Cryptographic Transparency Note_: Because HMAC is symmetric, sharing the secret key with an untrusted party would allow them to forge signatures. For external, zero-trust third-party regulators, FairShift provides an exportable proof bundle verifiable against public checkpoint logs published to external ledger transparency endpoints.

---

## 2. Privacy Engineering: Safe Signal Defenses

Safe Signal detects recurring hazards while strictly protecting the identities of frontline workers from retaliatory exposure.

### Defense 1: Domain-Separated Irreversible Pseudonyms

- The database never stores a direct link between a user ID and a confidential report.
- The `reporter_ref` is derived using HMAC-SHA256 salted with an organization-specific domain key:
  $$\text{Pseudonym} = \text{HMAC-SHA256}(K_{\text{signal}}, \text{"fairshift:reporter:"} \mathbin{\Vert} \text{OrgId} \mathbin{\Vert} \text{UserId})$$
- Even if an administrator gains read access to the database, they cannot reverse the pseudonym or track a worker across different organizations.

### Defense 2: Minimum Cohort Suppression ($k \ge 3$)

- A hazard category cluster is **never surfaced** to administrators unless at least 3 distinct pseudonymous reporters have independently reported issues in that category.
- If $k < 3$, the signal is strictly suppressed from dashboard and API outputs (`signal.test.ts`).

### Defense 3: Temporal Differencing Defense (Snapshot Caching)

- **Threat Vector**: An adversarial supervisor monitors the Safe Signal count continuously, watches a worker enter the office, and observes whether the count immediately increases from $N$ to $N+1$.
- **Defense**: Safe Signal query outputs are snapshot-cached for 15 seconds. Rapid successive queries return identical cached aggregates, defeating micro-temporal inference.

---

## 3. Separation of Duties in the Accountability Loop

- **Threat Vector**: A negligent supervisor marks a hazardous defect as "Resolved" and then verifies their own repair to close the ticket without oversight.
- **Defense**: Under organization policy (`requireIndependentVerification: true`), the state machine rejects self-verification with `SELF_VERIFICATION_DISALLOWED`. An independent safety supervisor or third-party auditor must verify the repair (`accountability-adversarial.test.ts`).

---

## 4. Platform Security & Defense-in-Depth

| Layer                    | Defense Mechanism            | Verified Invariant                                                                                          |
| :----------------------- | :--------------------------- | :---------------------------------------------------------------------------------------------------------- |
| **Authentication**       | Passwordless Phone OTP & PIN | Scrypt hashing, 5-attempt brute-force lockouts, 60s cooldowns, single-use token consumption.                |
| **Session Security**     | Signed Cookie with Timestamp | HMAC-signed session cookies, instant revocation upon account deactivation (`session.ts`).                   |
| **CSRF Defense**         | Custom Header & Origin Guard | Mutating endpoints require `Content-Type: application/json` and reject cross-origin requests (`csrfGuard`). |
| **Data Isolation**       | Tenant Scoping               | All queries explicitly filter by `org_id`. Cross-tenant queries return 404 or 403.                          |
| **Database Reliability** | Point-in-time Backups        | Atomic snapshot backups via `VACUUM INTO`, Write-Ahead Logging, and automated page integrity verification.  |
