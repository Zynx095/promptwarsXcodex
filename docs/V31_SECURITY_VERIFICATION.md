# FairShift V3.1 — Security Verification Report

## Scope & Objective

This document provides technical evidence and cryptographic verification details for the security controls evaluated during the FairShift V3.1 Adversarial Audit.

---

## 1. Cryptographic Receipts (FairShift Proof)

### 1.1 HMAC-SHA256 Integrity

Work receipts are sealed using keyed-hash message authentication codes (HMAC-SHA256) over canonical JSON representations:

- **Canonicalization:** Deterministic recursive key sorting (`canonicalizeJson`) ensures identical JSON text regardless of object key insertion order.
- **Timing-Safe Comparison:** `crypto.timingSafeEqual` prevents side-channel timing attacks.
- **Input Validation:** Non-empty secret enforcement and strict 64-character hexadecimal regex checking (`/^[0-9a-fA-F]{64}$/`) prevent unkeyed hashing or parser crashes.

### 1.2 Important Security Distinction (Trust Boundary)

HMAC provides integrity verification while the signing secret remains protected on the server:

- HMAC verifies that a receipt record matches the exact payload sealed at shift completion or correction.
- **Boundaries:** HMAC does not prove that the initial physical clock-in/out times recorded by the user were truthful. It does not prevent an administrator with full signing-key access from generating valid signatures. FairShift receipts are tamper-evident audit receipts, not decentralized immutable ledgers.

### 1.3 Key Management & Rotation

- **Configuration:** Receipt signing is decoupled from session authentication via `RECEIPT_SIGNING_SECRET`, `RECEIPT_SIGNING_KEYS`, and `ACTIVE_RECEIPT_KEY_ID`.
- **Zero-Downtime Rotation:**
  - When a new key is introduced (e.g. `v2`), new receipts receive `key_id: 'v2'`.
  - Historical receipts retain `key_id: 'v1'` and are verified using `receiptSigningKeys['v1']`.
  - Fallback to primary secret ensures backwards compatibility.

---

## 2. Safe Signal Privacy Protection

### 2.1 Minimum Cohort Suppression ($k \ge 3$)

- Single reports ($k=1$) and paired reports ($k=2$) in any category are strictly suppressed.
- Signal candidate structures never expose report IDs, worker IDs, worker names, phone numbers, or exact timestamps.

### 2.2 Sybil & Self-Identification Protection

- **Distinct Reporter Tracking:** Safe Signal queries `COALESCE(reporter_ref, reporter_id) AS reporterKey`.
  - Confidential reports use a keyed HMAC hash (`reporter_ref`), preserving anonymity while providing a stable pseudonym.
  - Non-confidential reports use the internal `reporter_id`.
  - The pseudonym is consumed strictly within the domain layer and is never serialized to API responses.
- **Deduplication:** Immediate resubmissions (same reporter, same category, same title within 15 minutes) are deduplicated, preventing an individual from fabricating a pattern or exposing themselves through duplicate submissions.

---

## 3. Accountability Loop State Machine & Separation of Duties

### 3.1 State Transitions

The safety report lifecycle is governed by an explicit state transition matrix:

- `submitted` $\rightarrow$ `acknowledged`
- `acknowledged` $\rightarrow$ `in_progress` | `resolved`
- `in_progress` $\rightarrow$ `resolved` | `follow_up_pending`
- `resolved` $\rightarrow$ `follow_up_pending` | `outcome_verified` | `reopened`
- `follow_up_pending` $\rightarrow$ `outcome_verified` | `reopened` | `in_progress` | `resolved`
- `outcome_verified` $\rightarrow$ `reopened`
- `reopened` $\rightarrow$ `acknowledged` | `in_progress` | `resolved`

All illegal jumps (e.g. `submitted` $\rightarrow$ `resolved`, `acknowledged` $\rightarrow$ `outcome_verified`, `outcome_verified` $\rightarrow$ `resolved`) are rejected with `INVALID_TRANSITION`.

### 3.2 Verification Authority & Separation of Duties

- **Self-Verification Flagging:** When an administrator who recorded a resolution subsequently marks the report as `outcome_verified` without specifying an independent third-party auditor, the system flags the audit log as `Admin (Self-verification)`.
- **Independent Auditor Recording:** When an external verifier or licensed inspector conducts the physical reinspection, their name, credentials, and verification note are recorded in `verifiedBy`, `verifiedAt`, and `verificationNote`.
- **Note Enforcement:** Outcome verification requires an explanatory note of at least 5 characters detailing physical inspection.

---

## 4. Authentication, Session & Authorization Controls

### 4.1 Google OIDC Verification

- **Cryptographic Token Verification:** Google ID tokens are verified against Google's tokeninfo service and public keys.
- **Claim Validation:**
  - `aud`: Exact match against `GOOGLE_CLIENT_ID`.
  - `iss`: Restricted to `https://accounts.google.com` or `accounts.google.com`.
  - `exp`: Enforces current validity; rejects expired tokens.
  - `nonce`: Verified against the cryptographic nonce stored in the signed HTTP-only state cookie.
  - `email_verified`: Rejects accounts with unverified emails.
- **Account Provisioning:** Pre-provisioning is required. An unmapped OAuth identity cannot register or escalate to an administrator role.

### 4.2 Phone OTP Security

- **Lockout:** 5 consecutive incorrect attempts lock the verification challenge.
- **Replay Prevention:** Challenges are marked consumed upon successful verification; reuse attempts fail immediately.
- **Cooldown:** 60-second minimum cooldown between dispatch requests; 4 requests max per 15-minute window.
- **Production Guard:** Enabling `mock` SMS provider in `production: true` mode triggers a 500 `SECURITY_VIOLATION` exception.

### 4.3 Session Security

- **Session Rotation:** Each session token carries a random 128-bit session identifier (`sid`). Consecutive logins or auth transitions generate distinct tokens, preventing session fixation.
- **Cookie Flags:** `httpOnly: true`, `sameSite: 'lax'`, `secure: production`, `path: '/'`.
- **CSRF Protection:** State-changing requests enforce `application/json` Content-Type and same-origin validation.

### 4.4 Multi-Tenant Authorization

- All tenant tables include `org_id`.
- Every query filters on `org_id` bound from the verified session actor.
- Workers are restricted to their own reports (`isMine`) and payslips; cross-worker and cross-organization queries return 404/403.
