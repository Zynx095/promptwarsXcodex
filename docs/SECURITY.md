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
- **Instant Session Revocation:** Deactivating a worker (`active: false`) immediately invalidates their active session cookie across all endpoints on their next request via per-request user state reload. Deactivated accounts are rejected with `401 UNAUTHORIZED` or `INACTIVE_ACCOUNT` check-in guards.
- **Server-Side Sign-Out:** Session cookies carry a `ver` claim that must equal `users.session_version`. Signing out and deactivating a worker increment that version, so a copied or stolen cookie stops working immediately and reactivation does not revive old sessions. Sign-out ends the user's sessions on all devices. Cookies issued before this change are treated as version 0.
- **Workforce Provisioning Controls:** Administrators can provision workers (`POST /api/admin/workers`) with uniqueness checks on phone numbers within the organisation. Worker initial PINs are salted and scrypt-hashed immediately.
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
- **Symmetric vs Asymmetric Checkpoint Trust & Offline Bundles:** Checkpoints are signed using server secrets while public/regulator verification is facilitated via exported proof bundles (`GET /api/receipts/:id/bundle`) containing canonical receipt data, Merkle leaf hashes, and inclusion sibling paths verified against published checkpoint roots without exposing symmetric keys.
- **Constant-time verification:** digest verification uses `crypto.timingSafeEqual` with strict 64-char hex format validation to eliminate timing side-channel attacks and malformed signature exceptions.
- **Append-only version chaining:** administrator shift corrections do not overwrite historical receipts; they insert an incremented receipt version referencing `previous_version_id` with mandatory reason audit trails.
- **Lifecycle status transition:** receipts transition from `estimated` to `finalized` when the employer issues the period payslip, cementing immutable payroll records.
- **Worker Plain-Language Guarantee:** Workers can access an inline plain-language explanation of their cryptographic guarantee directly on the receipt modal, explaining what HMAC seals and tamper-evidence mean without cryptographic jargon.

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

**In-App Notification Hub & System Alerts**

- **Tenant and user scoping:** All notifications are stored in `notifications` with compound indexing on `(org_id, user_id, read, created_at)`. Querying `/api/notifications/mine` strictly restricts results to the authenticated user's ID within their organization.
- **Automated Event Triggers:** Shift corrections, payslip issuance, and hazard resolution transitions trigger targeted worker notifications. High-severity hazard reports trigger real-time administrator alerts without exposing confidential reporter identifiers.
- **State mutation guard:** Marking notifications as read (`POST /api/notifications/:id/read`) enforces ownership checks, preventing cross-user status tampering.

**Payroll Data Export Security & Auditing**

- **Administrative isolation:** Payroll CSV export (`GET /api/admin/payslips/export.csv`) is strictly restricted to administrator sessions within the caller's organization.
- **Immutable audit log:** Every export operation writes an audit event (`event: 'payslip.exported'`) with timestamp, administrator ID, and record count.
- **Client-side print styling:** Print stylesheet (`@media print`) safely removes UI controls, session headers, navigation, and background fills, preventing accidental print leaks of administrative controls.

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

### Passkeys for attendance (V5)

- **What is stored:** the WebAuthn credential ID, public key, signature counter, transports, device type and a label. Fingerprints, faces, PINs and biometric templates never leave the worker's phone; the browser and operating system run that check.
- **Challenges:** random, server-generated, bound to one user and one purpose (`register`, `check-in`, `check-out`), valid for five minutes and deleted on first use. An assertion therefore cannot be replayed or used for another action.
- **Verification:** SimpleWebAuthn checks the signature, the origin and RP ID (from `WEBAUTHN_ORIGINS` / `WEBAUTHN_RP_ID`, never from request headers), user verification (required) and the signature counter. The credential must belong to the signed-in worker and not be revoked. Nothing is recorded unless verification succeeds.
- **When it applies:** once a worker has a passkey, check-in and check-out require a fresh assertion. Shifts record `check_in_auth` / `check_out_auth` (`passkey` or `session`) and the audit log names the passkey label. The record says "passkey with user verification", never "fingerprint", because WebAuthn does not reveal which method the phone used.
- **Recovery:** workers revoke a lost phone themselves; administrators can reset a worker's passkeys (audited); supervisors can still record attendance through shift corrections. Attempts are rate limited per worker.

### Safety photos (V5)

- **Intake:** the format is identified from the bytes (JPEG, PNG, WebP) and must match the declared type; dimensions are parsed; files over 1.5 MB or 8000 px are refused; at most six photos per stage per report and 30 uploads an hour per person. The request size limit is raised for the photo route only.
- **Metadata:** EXIF (including GPS), XMP, IPTC, comments and PNG/WebP text chunks are removed on the server before hashing; the client also re-encodes photos, which drops metadata before upload. No original file name is kept.
- **Integrity:** each stored photo has a SHA-256 of its stored bytes and an HMAC-SHA256 seal over the evidence record using the receipt signing key (with its key ID for rotation). A trigger refuses changes to stored photos, hashes and seals. The seal shows the photo has not changed since upload; it does not show what the photo depicts.
- **Access:** photos are served only to people who may see the report (the reporter, or administrators of the same organisation), with `Cache-Control: private, no-store`. A confidential reporter's upload stores no user ID and is shown as "Reporter".
- **Retention:** photos of reports verified more than 365 days ago are deleted at start-up and daily.
- **Analysis:** optional (Google Cloud Vision). Only the cleaned image is sent: no report text, names or metadata. Results are advisory and must be confirmed or dismissed by a person; failures are recorded as failures. Provider retention follows Google Cloud's terms for the Vision API.

### Server voice (V5)

- Optional Google Cloud Text-to-Speech, used only when a device has no voice for the worker's language. The key is sent in a header from the server; text is limited to 2000 characters, never logged or stored; audio is not cached; 12 requests a minute and 300 a day per person.

## Known limitations

- **Authentication strength:** PIN-only for phone accounts. There is no automated self-service password reset or MFA (though OAuth and SMS OTP flows are supported). The throttle resets on restart and is per instance.
- **Demo credentials:** all demo accounts share the published PIN `1234`. Never enable `DEMO_MODE` with real data.
- **Linkable confidential reports:** two confidential reports from the same worker share the same keyed reference. Someone with database access can tell they came from the same person, though not who. Anyone holding both the database and `SESSION_SECRET` could recompute every worker's reference and identify reporters.
- **Secret rotation:** rotating `SESSION_SECRET` signs everyone out and breaks the link between workers and their earlier confidential reports.
- **Metadata:** feedback and confidential reports can still be correlated with infrastructure logs (Cloud Run request logs record IP and time) or with the writing itself. The UI tells workers this instead of promising absolute anonymity.
- **Activity timing:** the admin dashboard lists check-in/out events by worker name next to report events; timing could hint at who filed a non-confidential report.
- **Single admin role:** any admin in an organisation can see that organisation's payslips and non-confidential reporter names.
- **Shared rate limiting:** no WAF or distributed rate limiting; rely on Cloud Run / Cloud Armor for that.
- **Photo uploads:** images are parsed for structure and metadata but not re-encoded on the server, so a crafted image that decodes badly in a browser is possible; browsers isolate image decoding, and photos are only shown to people with access to the report.
- **Rate limits are per instance:** the photo, passkey and voice limits are in memory, like the login throttle.
