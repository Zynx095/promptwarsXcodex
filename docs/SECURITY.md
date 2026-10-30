# Security and privacy

This document describes the controls FairShift implements and the gaps that remain. FairShift has not had an independent security review and is not production-certified.

## Implemented controls

**Authentication and sessions**

- **Multi-provider authentication:** Google OAuth 2.0 / OpenID Connect (OIDC), Phone OTP via SMS, GitHub OAuth, and employer-issued PIN.
- **PKCE & State Validation (OAuth):** Proof Key for Code Exchange (RFC 7636) with SHA-256 challenges. State cookies are HMAC-SHA256 signed with 10-minute expiry and constant-time validation to defeat login CSRF.
- **Token verification:** ID tokens are verified directly against Google's tokeninfo endpoint for audience matching (`aud === GOOGLE_CLIENT_ID`), issuer validation, cryptographic nonce verification against session state, expiration timestamp checking, and verified email status.
- **Phone OTP verification:** OTP codes are 6-digit cryptographically generated numbers (`crypto.randomInt`). Raw codes are never stored; only `HMAC_SHA256(SESSION_SECRET, phone:code)` is persisted.
- **OTP Brute-Force, Replay & Production Guards:** Maximum 5 verification attempts per code; challenges are marked consumed upon verification or exhaustion to prevent replay attacks. Consecutive dispatch is rate-limited to 60-second cooldowns and 4 requests per 15 minutes. In production mode (`production: true`), mock SMS provider activation is strictly blocked.
- **Identity isolation & provisioning:** Unprovisioned Google, GitHub, or phone identities are rejected with a clear message and cannot self-register as administrators.
- **Credentials:** phone number + PIN. PINs are hashed with scrypt and a per-user salt. Unknown accounts are checked against a dummy hash so response timing is similar.
- **Session cookie:** HttpOnly, `SameSite=Lax`, `Secure` in production. It contains user ID, a random 128-bit session identifier (`sid`) ensuring session rotation on every authentication event, and expiry, signed with HMAC-SHA256 (`SESSION_SECRET`) and checked in constant time, with a 12-hour lifetime.
- **Per-request reload:** role, organisation and active status are re-read from the database on every request; nothing in the cookie or request body is trusted for authorisation.
- **Login throttling:** 10 failed attempts per client IP + phone number per 15 minutes, held in memory per instance.

**Authorisation and data boundaries**

- **Server-enforced roles:** `requireRole('worker' | 'admin')` guards every route on the server. The client's role-aware navigation is a convenience only.
- **Organisation scoping:** every query filters on the session's `org_id`. Records from another organisation, or another worker's records, return `404` rather than `403`, so identifiers cannot be probed. Integration tests cover cross-organisation and cross-worker access by manipulated IDs.
- **Worker scoping:** workers can read only their own shifts, payslips, alerts, skills and reports.
- **Finalized Period Shift Lock:** shifts in pay periods with an issued payslip cannot be altered without an explicit retroactive payroll adjustment authorization (`isPayrollAdjustment: true`).

**Input and output handling**

- **Validation:** all request bodies and query strings are validated with zod schemas at the API boundary. Business rules (transitions, pay inputs, timestamps, categories per industry) are validated again in the domain layer.
- **SQL:** all SQL uses prepared statements with named parameters; no query is built from user input. The schema adds `CHECK` constraints, foreign keys and unique indexes.
- **Output:** React escapes all rendered text, and no `dangerouslySetInnerHTML` is used.
- **Errors:** responses carry a stable code and a user-safe message. Stack traces are logged server-side only, and request bodies are never logged.
- **Request size:** JSON bodies are limited to 32 KB.

**Browser protections**

- **CSRF:** `SameSite=Lax` cookies, state-changing requests must be `application/json` (not sendable cross-site without a CORS preflight), and requests with a mismatched `Origin` are rejected.
- **Headers:**
  - `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` and `Permissions-Policy`
  - in production, a strict Content-Security-Policy (`script-src 'self'`) and HSTS
  - API responses are `Cache-Control: no-store`

**Cryptographic work receipts (FairShift Proof)**

- **Canonical JSON serialization:** deterministic key sorting (RFC 8785 subset), uniform integer/float encoding, and whitespace normalization ensure byte-for-byte reproducibility across runtime platforms.
- **HMAC-SHA256 cryptographic digests:** receipts are sealed with `HMAC-SHA256(RECEIPT_SIGNING_SECRET, canonicalJson)` upon shift check-out. Any direct database tampering with hours, overtime, or pay rates causes immediate verification failure.
- **Multi-key management & rotation:** receipts carry explicit `key_id` attributes, decoupling receipt verification from session secret rotation and allowing zero-downtime key rotation with historical key maps (`RECEIPT_SIGNING_KEYS`).
- **Independent Merkle checkpoint anchoring:** receipts are batched into append-only cryptographic commitment logs. Domain-separated binary Merkle trees (`fairshift:leaf:v1:`) produce signed checkpoints linked via hash chains (`previousCheckpointRoot`).
- **Self-contained verification bundles:** workers and external auditors can export and verify independent proof bundles completely offline without requiring access to application databases or server signing secrets.
- **Constant-time verification:** digest verification uses `crypto.timingSafeEqual` with strict 64-char hex format validation to eliminate timing side-channel attacks and malformed signature exceptions.
- **Append-only version chaining:** administrator shift corrections do not overwrite historical receipts; they insert an incremented receipt version referencing `previous_version_id` with mandatory reason audit trails.
- **Lifecycle status transition:** receipts transition from `estimated` to `finalized` when the employer issues the period payslip, cementing immutable payroll records.

**Privacy and hazard aggregation (Safe Signal)**

- **Minimum cohort suppression ($k \ge 3$):** hazard patterns are surfaced only when at least 3 distinct reports exist in a category. Smaller sample sizes are suppressed to defeat singling-out and re-identification attacks.
- **Deduplication & distinct reporter tracking:** immediate duplicate submissions within 15 minutes are deduplicated. Minimum cohort rules evaluate distinct pseudonyms (`COALESCE(reporter_ref, reporter_id)`) internally to prevent single-worker Sybil cluster inflation and accidental self-exposure.
- **Dedicated pseudonym secret & tenant isolation:** confidential report pseudonyms use `scopedReporterRef(SIGNAL_PSEUDONYM_SECRET, orgId, userId)` with organization-scoped domain separation, preventing cross-tenant correlation and ensuring session cookie rotation never invalidates historical report lookups.
- **In-memory pseudonymization:** raw user IDs from non-confidential reports are hashed with `signalAggregationKey` prior to domain ingestion, eliminating user IDs from application memory during aggregation.
- **Differencing protection via snapshot caching:** aggregation responses are cached in 15-second sliding snapshot windows to defeat temporal differencing attacks by supervisors monitoring shift check-outs.
- **Identifier exclusion:** database queries explicitly omit `reporter_id`, `reporter_ref`, worker names, phone numbers, and sub-day timestamps.
- **Multi-tenant partitioning:** all hazard aggregation queries strictly filter on `org_id`, ensuring zero cross-tenant signal leakage.

**Safety accountability and audit (Accountability Loop)**

- **Audited status lifecycle:** all transitions (`submitted -> acknowledged -> in_progress -> resolved -> follow_up_pending -> outcome_verified`) enforce mandatory explanatory notes and audit event records.
- **Verification authority & separation of duties:** detects and flags when the resolver self-verifies their own corrective action versus independent third-party auditor sign-off (`verified_by`, `verification_note`, `verified_at`). When `requireIndependentVerification` policy is active, self-verification is strictly rejected.
- **Worker outcome transparency:** workers can view exact corrective actions and verification results without exposing administrator identity or internal notes.

**Production Storage Durability & Disaster Recovery**

- **Persistent storage default:** runtime container specifies `/data/fairshift.db` with non-root ownership (`node:node`) designed for Google Cloud Run volume mounts (Cloud Storage FUSE or Filestore).
- **Atomic non-blocking backups:** `backupDb` utilizes SQLite native `VACUUM INTO` for point-in-time snapshot creation without table locks.
- **Automated integrity verification:** `verifyDbIntegrity` confirms structural page integrity (`PRAGMA integrity_check`) before and after recovery operations.

**Privacy**

- **Confidential safety reports:** stored with no reporter ID. A keyed hash (`HMAC(SESSION_SECRET, userId)`) lets only the reporter list and open their report. Admin views, the dashboard, report history ("Reporter (confidential)") and the audit log never contain the reporter's identity.
- **Feedback:** stored with no user reference and only a date (no time). Averages are suppressed below 3 ratings per topic.
- **Minimal payslip audit:** the audit log records that a payslip was issued, not the amounts.
- **Synthetic data:** all seeded data is flagged synthetic and labelled in the UI. No real personal information is included.
- **Secrets:** no secrets in the repository. `.env` files, keys and credentials are git-ignored, and `.env.example` contains placeholders only.

## Known limitations

- **Authentication strength:** PIN-only. There is no MFA, account lockout beyond the in-memory throttle, PIN reset or administrator account management. The throttle resets on restart and is per instance.
- **Demo credentials:** all demo accounts share the published PIN `1234`. Never enable `DEMO_MODE` with real data.
- **Linkable confidential reports:** two confidential reports from the same worker share the same keyed reference. Someone with database access can tell they came from the same person, though not who. Anyone holding both the database and `SESSION_SECRET` could recompute every worker's reference and identify reporters.
- **Secret rotation:** rotating `SESSION_SECRET` signs everyone out and breaks the link between workers and their earlier confidential reports.
- **Metadata:** feedback and confidential reports can still be correlated with infrastructure logs (Cloud Run request logs record IP and time) or with the writing itself. The UI tells workers this instead of promising absolute anonymity.
- **Activity timing:** the admin dashboard lists check-in/out events by worker name next to report events; timing could hint at who filed a non-confidential report.
- **Single admin role:** any admin in an organisation can see that organisation's payslips and non-confidential reporter names.
- **Shared rate limiting:** no WAF or distributed rate limiting; rely on Cloud Run / Cloud Armor for that.
- **No uploads:** file uploads are not implemented, so there is no upload attack surface.
