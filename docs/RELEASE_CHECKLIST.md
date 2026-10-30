# FairShift V4.0 — Release Candidate Checklist

This checklist verifies that the FairShift application meets production standards for security, performance, privacy, data integrity, and operational durability prior to enterprise deployment.

---

## 1. Cryptographic Trust & Verification Invariants

- [x] **Canonical Serialization**: Work receipt JSON payload is serialized deterministically with sorted object keys, fixed decimal precision, and standard timestamp formatting (`src/domain/proof.ts`).
- [x] **Key Isolation**: Receipt signing secrets (`RECEIPT_SIGNING_SECRET`) and Checkpoint secrets (`CHECKPOINT_SIGNING_SECRET`) are never bundled into client-side Vite builds or leaked via API endpoints.
- [x] **Key Rotation Architecture**: Supports multiple active and historical verification keys indexed by `key_id` (`v1`, `v2`, etc.).
- [x] **Binary Merkle Trees**: Inclusion proofs use domain-separated prefixes (`fairshift:leaf:v1:` and `fairshift:node:v1:`) to prevent second-preimage attacks.
- [x] **Independent Proof Bundles**: Offline verification bundles (`/api/receipts/:id/bundle`) can be mathematically verified by external regulators without access to the database or private keys.
- [x] **Finalized Pay Period Lock**: Once a payslip is issued covering a pay period, past shifts cannot be directly mutated without explicit retroactive adjustment logging.

---

## 2. Privacy & Safe Signal Protection

- [x] **Zero Identifier Leakage**: All API responses from `/api/admin/signals` strictly contain zero worker IDs, names, or raw session tokens.
- [x] **Domain-Separated Reporter Pseudonyms**: Reporter tokens use HMAC-SHA256 with distinct organizational domain salts (`fairshift:reporter:org_id:user_id`), preventing cross-organizational worker tracking.
- [x] **Cohort Suppression ($k \ge 3$)**: Recurring hazard signals are strictly suppressed unless at least 3 distinct pseudonymous reporters have independently submitted reports.
- [x] **Temporal Differencing Protection**: Safe Signal results are cached for 15 seconds to prevent rapid query subtraction attacks by malicious administrators attempting to unmask reporters.
- [x] **Confidential Reports Isolation**: Confidential hazard reports store `null` for `reporter_id` in the database; only the keyed reference is retained for the worker's own retrieval.

---

## 3. Separation of Duties & Accountability

- [x] **Multi-Stage Lifecycle**: Enforces formal transitions: `submitted` -> `acknowledged` -> `in_progress` -> `resolved` -> `follow_up_pending` -> `outcome_verified`.
- [x] **Independent Verification Policy**: When `requireIndependentVerification` is enabled in organization settings, the resolving administrator is blocked from verifying their own repair (`SELF_VERIFICATION_DISALLOWED`).
- [x] **Worker Reopen Authority**: Frontline workers who submitted non-confidential reports retain unilateral authority to reopen resolved reports if the hazard reoccurs.
- [x] **Audit Event Logging**: All state changes, wage adjustments, shift corrections, and CSV exports record immutable audit entries in `audit_events`.

---

## 4. Workforce & Site Operations

- [x] **Workforce Provisioning**: Administrators can provision new workers (`POST /api/admin/workers`) with role, hourly rate, and credentials.
- [x] **Immediate Account Deactivation**: Deactivating a worker immediately revokes session access across all routes and blocks attendance check-in.
- [x] **Multi-Site Administration**: Organizations can configure physical worksites and job codes (`GET /api/admin/sites`, `POST /api/admin/sites`, `PATCH /api/admin/sites/:id/status`).
- [x] **Rotating Site Codes**: Time-windowed HMAC site codes prevent remote attendance fraud.
- [x] **In-App Notification Center**: Real-time notification hub alerts workers to shift corrections, issued payslips, and safety report updates.
- [x] **Payroll Export & Print Layouts**: Tenant-scoped CSV payroll export (`/api/admin/payslips/export.csv`) and dedicated `@media print` clean payslip styling.

---

## 5. Production Durability & Cloud Reliability

- [x] **Persistent Database Volume**: Docker container defaults to `/data/fairshift.db`, designed for persistent volume mounts on Google Cloud Run or AWS ECS.
- [x] **Least-Privilege Execution**: Container runs as unprivileged `node` user (`UID 1000:GID 1000`). Root execution is disallowed.
- [x] **Atomic Point-in-Time Backups**: Production utility supports zero-lockpoint atomic snapshots using SQLite's built-in `VACUUM INTO`.
- [x] **Structural Integrity Checks**: PRAGMA integrity checks verify zero database page corruption (`verifyDbIntegrity`).
- [x] **WAL Journaling & Busy Timeouts**: Database operates in Write-Ahead Logging (`WAL`) mode with a 5000ms busy timeout to prevent write starvation.
- [x] **Security Headers**: HSTS (`max-age=31536000`), Content-Security-Policy, `nosniff`, `DENY` framing, and SameSite CSRF guards active in production mode.

---

## 6. Verification Quality Gates

| Verification Gate    | Command                | Status                                                |
| :------------------- | :--------------------- | :---------------------------------------------------- |
| **Code Formatting**  | `npm run format:check` | **PASS** (100% Prettier compliant)                    |
| **Static Linting**   | `npm run lint`         | **PASS** (0 errors, 0 warnings across all files)      |
| **Type Check**       | `npm run typecheck`    | **PASS** (Strict TypeScript `--noEmit`)               |
| **Test Suite**       | `npx vitest run`       | **PASS** (29 test files, 246 tests passing)           |
| **Production Build** | `npm run build`        | **PASS** (Vite client bundle & Esbuild server bundle) |

---

## Release Candidate Sign-Off

- **Version**: FairShift V4.0 (RC-1)
- **Engineered For**: Google Cloud Run / Containerized Environments
- **User Work Preserved**: Untracked `pitch-preparation/` directory is confirmed 100% intact.
