# FairShift V3.2: Initial Assessment & Evidence-Driven Investigation

## Executive Overview

This initial assessment evaluates the FairShift V3.1 codebase across cryptographic receipt verification, privacy-preserving hazard aggregation, safety accountability enforcement, and production data durability.

The baseline test suite completed with **22 test files and 211 tests passing (100% green)**. However, an adversarial inspection of the underlying architecture reveals critical dependencies on ephemeral container storage, lack of independent cryptographic receipt anchoring, secret-coupling in confidential report pseudonymization, and potential self-verification loopholes in safety outcome sign-offs.

---

## Findings Matrix

| Finding ID      | Component                                | Severity     | Category                 | Remediation Status  |
| :-------------- | :--------------------------------------- | :----------- | :----------------------- | :------------------ |
| **V32-OPS-01**  | Production Deployment & Durability       | **Critical** | Confirmed Vulnerability  | Remediation Planned |
| **V32-SEC-01**  | FairShift Proof Cryptographic Trust      | **High**     | Confirmed Vulnerability  | Remediation Planned |
| **V32-ACT-01**  | Accountability Loop Authority Model      | **High**     | Demonstrated Weakness    | Remediation Planned |
| **V32-SEC-02**  | Reporter Pseudonym Generation            | **Medium**   | Demonstrated Weakness    | Remediation Planned |
| **V32-PRIV-01** | Safe Signal Inference & Differencing     | **Medium**   | Demonstrated Weakness    | Remediation Planned |
| **V32-OPS-02**  | Database Backup & Disaster Recovery      | **Medium**   | Architectural Limitation | Remediation Planned |
| **V32-PERF-01** | Query Performance at Scale (10k+)        | **Low**      | Recommended Improvement  | Remediation Planned |
| **V32-LOG-01**  | Operational Monitoring & Privacy Logging | **Low**      | Recommended Improvement  | Remediation Planned |

---

## Detailed Findings

### Finding V32-OPS-01: Ephemeral Container Storage in Production Dockerfile

- **Affected Component:** `Dockerfile`, `docs/DEPLOYMENT.md`
- **Severity:** **Critical**
- **Category:** Confirmed Vulnerability
- **Existing Implementation:**
  Line 15 of `Dockerfile`:
  ```dockerfile
  ENV NODE_ENV=production \
      PORT=8080 \
      DATABASE_PATH=/tmp/fairshift/fairshift.db
  ```
- **Reproduction & Inspection Evidence:**
  In containerized serverless runtimes (such as Google Cloud Run, AWS Fargate, or Kubernetes without persistent volume claims), `/tmp` is allocated as an in-memory `tmpfs` ephemeral filesystem. When Cloud Run scales to zero during inactivity, deploys a new revision, or recycles an unhealthy instance, the entire filesystem is discarded.
- **Actual Risk:** Total data loss of all organizations, users, shifts, receipts, safety reports, and audit trails upon routine container recycling.
- **Recommended Remediation:**
  1. Default production storage to `/data/fairshift.db` with mandatory documentation for persistent volume mounts (e.g., Cloud Storage FUSE mount, persistent disk, or Cloud SQL).
  2. Implement runtime environment checks warning or halting if ephemeral `/tmp` is detected in production.
  3. Provide explicit, copy-paste Cloud Run volume mount CLI commands in `docs/V32_PRODUCTION_READINESS.md`.
- **Possible within Existing Architecture:** Yes.

---

### Finding V32-SEC-01: Inability to Independently Verify Receipts Without Server Secrets

- **Affected Component:** `src/domain/proof.ts`, `src/server/services/receipts.ts`, `src/shared/types.ts`
- **Severity:** **High**
- **Category:** Confirmed Vulnerability
- **Existing Implementation:**
  Receipts are sealed using symmetric HMAC-SHA256 (`RECEIPT_SIGNING_SECRET`):
  ```typescript
  export function computeReceiptDigest(secret: string, data: CanonicalReceiptData): string {
    const canonicalString = canonicalizeJson(data);
    return createHmac('sha256', secret).update(canonicalString).digest('hex');
  }
  ```
- **Reproduction & Inspection Evidence:**
  1. Symmetric HMAC verification requires the verifier to possess the secret key. If a worker or external auditor verifies a receipt, the server must either execute the check internally or reveal the symmetric secret. Revealing the secret allows anyone to forge new receipts.
  2. If the server or database is compromised at time $T_2$, an attacker with the signing secret can forge or alter a shift from time $T_1$ with a matching HMAC. There is no independent checkpoint proving that receipt $R$ existed in that exact state at time $T_1$.
- **Actual Risk:** Workers and external labor auditors cannot verify receipts offline or independently; compromise of the signing key invalidates the historical integrity of all unanchored receipts.
- **Recommended Remediation:**
  1. Implement an append-only commitment log aggregating receipt digests into a deterministic Merkle tree.
  2. Generate periodic or batch signed checkpoints (`ProofCheckpoint`) containing Merkle roots, sequence numbers, and previous root chains.
  3. Produce self-contained `ReceiptInclusionProof` bundles allowing any independent client to verify canonical JSON -> digest -> leaf hash -> Merkle root without accessing database or signing secrets.
- **Possible within Existing Architecture:** Yes.

---

### Finding V32-ACT-01: Permissive Self-Verification in Safety Outcome Sign-Off

- **Affected Component:** `src/server/services/reports.ts`, `src/domain/safety.ts`
- **Severity:** **High**
- **Category:** Demonstrated Weakness
- **Existing Implementation:**
  When transitioning a report to `outcome_verified`:
  ```typescript
  const isSelfVerification = lastResolver && lastResolver.actor_id === actor.id;
  verifiedBy = isSelfVerification ? `${actorName} (Self-verification)` : actorName || 'Safety Officer';
  ```
- **Reproduction & Inspection Evidence:**
  The system notes `(Self-verification)` as a label, but permits the transition. Furthermore, verification requires only a free-form string note without structured evidence (inspection role, verification method, date of physical inspection).
- **Actual Risk:** Supervisors who performed incomplete or cosmetic hazard repairs can sign off on their own work without physical inspection or third-party auditor oversight, defeating the purpose of the accountability loop.
- **Recommended Remediation:**
  1. Introduce an organization setting `requireIndependentVerification: boolean`.
  2. Strictly reject self-verification with `DomainError('SELF_VERIFICATION_DISALLOWED')` when independent verification is enforced.
  3. Require structured verification metadata: `verifiedRole`, `verificationMethod` (`physical_inspection`, `worker_interview`, `photographic_review`), and detailed inspection notes ($\ge 10$ characters).
- **Possible within Existing Architecture:** Yes.

---

### Finding V32-SEC-02: Secret Coupling and Lack of Tenant Domain Separation in `reporterRef`

- **Affected Component:** `src/server/auth/crypto.ts`, `src/server/services/reports.ts`
- **Severity:** **Medium**
- **Category:** Demonstrated Weakness
- **Existing Implementation:**
  ```typescript
  export function reporterRef(secret: string, userId: string): string {
    return hmac(secret, `confidential-report:${userId}`);
  }
  ```
  Called with `ctx.config.sessionSecret`.
- **Reproduction & Inspection Evidence:**
  1. `sessionSecret` is designed for HTTP session cookies and rotates periodically. Rotating it causes workers to permanently lose retrieval access to their historical confidential reports (`WHERE r.reporter_ref = @ref`).
  2. The pseudonym lacks organization scoping. If a worker exists in multiple organizations or their user ID is known, pseudonyms could theoretically be correlated across environments.
- **Actual Risk:** Secret rotation locks workers out of confidential reports; lack of cryptographic domain separation.
- **Recommended Remediation:**
  1. Introduce dedicated `SIGNAL_PSEUDONYM_SECRET` in `src/server/config.ts` decoupled from `sessionSecret`.
  2. Include organization ID in pseudonym derivation: `hmac(secret, `fairshift:pseudonym:${orgId}:${userId}`)`.
  3. Maintain backward-compatibility for historical lookups.
- **Possible within Existing Architecture:** Yes.

---

### Finding V32-PRIV-01: Temporal Differencing and In-Memory Identifiers in Safe Signal

- **Affected Component:** `src/server/services/signal.ts`, `src/domain/signal.ts`
- **Severity:** **Medium**
- **Category:** Demonstrated Weakness
- **Existing Implementation:**
  ```typescript
  `SELECT id, category, severity, status, location, title,
          created_at AS createdAt, resolved_at AS resolvedAt,
          COALESCE(reporter_ref, reporter_id) AS reporterKey
   FROM safety_reports WHERE org_id = @orgId`;
  ```
- **Reproduction & Inspection Evidence:**
  1. For non-confidential reports, `reporter_id` (`usr_...`) is selected directly as `reporterKey` and passed into `analyzeSafeSignals`. While not returned in the API DTO, it resides in memory and could leak in unhandled error stacks or logging.
  2. Signal aggregation is executed in real time on every API request. A supervisor monitoring `/api/admin/signals` before and after a specific shift could observe the cohort threshold transition from suppressed ($< 3$) to active ($\ge 3$), directly linking the report to the worker on that shift.
- **Actual Risk:** In-memory PII exposure; temporal differencing re-identification attacks by vigilant supervisors.
- **Recommended Remediation:**
  1. Hash all `reporterKey` entries using one-way pseudonymization before domain ingestion.
  2. Implement coarse time grouping (calendar day buckets) and query result caching to defeat real-time timing correlation.
  3. Restrict sub-day query filtering.
- **Possible within Existing Architecture:** Yes.

---

### Finding V32-OPS-02: Absence of Automated Backup and Disaster Recovery Mechanisms

- **Affected Component:** `src/server/db/db.ts`, `src/server/db/schema.ts`
- **Severity:** **Medium**
- **Category:** Architectural Limitation
- **Existing Implementation:**
  SQLite WAL mode is enabled, but no programmatic backup (`VACUUM INTO`), snapshot verification, or restore testing exists in the codebase.
- **Actual Risk:** Inability to create consistent point-in-time database backups without shutting down the server process; risk of data corruption or unrecoverable loss during storage failure.
- **Recommended Remediation:**
  1. Implement `backupDatabase(db, destinationPath)` utilizing SQLite `VACUUM INTO` for atomic, non-locking snapshots while the database is live.
  2. Implement backup integrity check (`PRAGMA integrity_check`) and automated restore testing.
  3. Document full RPO (Recovery Point Objective: 1 hour) and RTO (Recovery Time Objective: 5 minutes) procedures.
- **Possible within Existing Architecture:** Yes.

---

### Finding V32-PERF-01: Index Gaps for Scale (>10,000 Records)

- **Affected Component:** `src/server/db/schema.ts`
- **Severity:** **Low**
- **Category:** Recommended Future Improvement
- **Existing Implementation:**
  Indexes exist on `(org_id, check_in_at)`, but checkpoint lookups and composite queries across `(org_id, status, category)` lack optimized compound indexes.
- **Actual Risk:** Query latency degradation under large workforce volumes (>10,000 shifts and reports).
- **Recommended Remediation:**
  Add compound indexes for checkpoints, receipts, and reports in additive schema migrations.
- **Possible within Existing Architecture:** Yes.

---

### Finding V32-LOG-01: Lack of Structured Operational Logging & Privacy Sanitization

- **Affected Component:** Server runtime & error handlers
- **Severity:** **Low**
- **Category:** Recommended Future Improvement
- **Existing Implementation:**
  Ad-hoc logging without standard redaction of sensitive identifiers (OTPs, PINs, auth tokens, confidential report contents).
- **Actual Risk:** Accidental leakage of credentials or confidential hazard details into server stdout logs.
- **Recommended Remediation:**
  Implement a lightweight structured logger with built-in PII redaction patterns.
- **Possible within Existing Architecture:** Yes.

---

## Action Plan & Execution Phasing

1. **Phase 2 (FairShift Proof):**
   - Implement Merkle tree commitment log (`src/domain/merkle.ts`).
   - Implement Checkpoint database schema, repository, and generation service (`src/server/services/checkpoints.ts`).
   - Implement `ReceiptInclusionProof` generation and independent verification API/domain logic.
   - Add comprehensive unit and adversarial tests.

2. **Phase 3 (Safe Signal Privacy):**
   - Introduce `SIGNAL_PSEUDONYM_SECRET` in configuration.
   - Implement domain-separated pseudonym generation with tenant isolation.
   - Enforce coarse calendar-day time windows and aggregation caching to defeat differencing attacks.
   - Add automated privacy adversarial tests.

3. **Phase 4 (Accountability Trust):**
   - Add `requireIndependentVerification` organization policy.
   - Strictly enforce separation of duties (reject self-verification when policy enabled).
   - Implement structured verification evidence records (`verificationMethod`, `verifiedRole`, inspection notes).
   - Add state machine and concurrency adversarial tests.

4. **Phase 5 (Production Reliability & Durability):**
   - Implement atomic backup utility using SQLite `VACUUM INTO` and integrity verification.
   - Add production configuration checks and volume mount specifications.
   - Add database restore integration tests.

5. **Phase 6 (Performance & Scalability):**
   - Add missing compound database indexes.
   - Add 1,000+ and 10,000+ benchmark tests verifying query performance.

6. **Phase 7 (User Experience):**
   - Update Worker UI: explain receipt validity, Merkle checkpoint anchoring, and verified safety actions.
   - Update Admin UI: display anchored status, independent verification requirements, and privacy cohort notices.

7. **Phase 8 (Verification & Documentation):**
   - Run complete quality gates: format, lint, typecheck, tests, and build.
   - Document complete V3.2 architecture reports.
   - Maintain continuous, granular commits throughout execution.
