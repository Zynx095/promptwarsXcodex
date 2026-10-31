# FairShift V4.1 — Final Engineering Audit

Audit date: 30–31 October 2026. Branch `main`. Original HEAD `8924fd6`. Nothing was pushed or deployed.

This document records what was independently inspected, what was found, what was fixed, and what remains. Claims from earlier release reports were treated as unverified until checked against the code.

---

## 1. Baseline (before any change, HEAD `8924fd6`)

| Gate                   | Result                                 |
| :--------------------- | :------------------------------------- |
| `npm run format:check` | Pass                                   |
| `npm run lint`         | Pass                                   |
| `npm run typecheck`    | Pass                                   |
| `npm test`             | 35 files, 277 tests passed             |
| `npm run build:client` | Pass (main JS 430.9 kB, 125.4 kB gzip) |
| `npm run build:server` | Pass                                   |

The reported quality gates were reproduced. Passing gates did not mean the features behaved correctly: several of the defects below were covered by tests that asserted the defective behaviour.

Later in the audit the machine was under heavy unrelated CPU load. The **unchanged baseline** suite then also failed one test on the 5 s default timeout, which is why `testTimeout` was raised to 20 s (`db92d1c`); no assertion was relaxed.

---

## 2. Defects found and fixed

Each fix has a regression test that fails on the old code (verified by reverting for the login-throttle and bundle cases).

| #   | Area           | Severity | Defect                                                                                                                                                                                                                                                                                                                                                        | Fix commit           |
| :-- | :------------- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------- |
| 1   | Proof          | High     | `verify-bundle` never bound the receipt body to its digest: an exported bundle with an edited gross pay verified as valid. Malformed bundles caused 500s; unknown key IDs fell back to the active key; any org's admin could use it as an oracle.                                                                                                             | `f67c38a`            |
| 2   | Proof          | Medium   | Keyless verification returned `valid_and_anchored`, and the UI said receipts "can be independently verified without server access". HMAC seals cannot be authenticated without the secret.                                                                                                                                                                    | `f67c38a`, `8454afc` |
| 3   | Safe Signal    | High     | `SAFE_SIGNAL_MIN_DISTINCT_REPORTERS = 2` was documented but never applied; one worker filing three reports produced a signal. The existing test called the rule function directly with the argument.                                                                                                                                                          | `f547b90`            |
| 4   | Accountability | High     | With `requireIndependentVerification`, the resolving admin bypassed separation of duties by typing any name into `verifiedBy`. Tests asserted the bypass worked.                                                                                                                                                                                              | `be05fba`            |
| 5   | Audit          | Medium   | `audit_events`, `report_events` and signed checkpoints could be updated or deleted with ordinary SQL.                                                                                                                                                                                                                                                         | `dd26097`            |
| 6   | Auth           | High     | Logout only cleared the browser cookie; a copied cookie stayed valid for 12 h. Reactivating a worker revived pre-deactivation cookies.                                                                                                                                                                                                                        | `d300f73`, `7f30815` |
| 7   | Auth           | High     | PIN throttle keyed on IP+phone only: rotating IPs gave unlimited guesses at a 4-digit PIN.                                                                                                                                                                                                                                                                    | `f2528df`            |
| 8   | Auth           | Medium   | Google ID tokens without a `nonce` (or without `exp`) were accepted.                                                                                                                                                                                                                                                                                          | `f1b8a1e`            |
| 9   | Payroll CSV    | Medium   | Only the name column was escaped; the formula check missed leading whitespace/newlines and full-width `＝＋－＠`; unvalidated `from`/`to` were echoed into `Content-Disposition`; money used float division and dropped trailing zeros.                                                                                                                       | `26722b7`            |
| 10  | Money Jar      | Medium   | Showed "Disbursed ₹0.00" and the full net pay as "Outstanding" for every payslip, although FairShift stores no payment records.                                                                                                                                                                                                                               | `b08631b`            |
| 11  | Dispute notice | High     | Presented the Payment of Wages Act and Minimum Wages Act as current alongside the Code on Wages; asserted overtime is "commonly 1.5× to 2×"; invented a receipt ID; printed `AUTHENTICATED_BY_FAIRSHIFT_LEDGER`; claimed full net pay as outstanding; pre-filled a non-payment statement; marked unknown phones "Verified"; encoded net pay in the reference. | `cb8bcfe`            |
| 12  | Heat           | Medium   | Simple formula not averaged with temperature (NWS procedure); tiers used rounded °C cut-offs; `NaN` accepted; advice labelled "MANDATORY" and attributed to the Factories Act, 1948.                                                                                                                                                                          | `b9d7aae`, `bb9e6a8` |
| 13  | QR             | High     | The QR generator computed no Reed-Solomon ECC and wrote no format information: the codes were not scannable. Tests only checked SVG markup.                                                                                                                                                                                                                   | `e7a47a3`            |
| 14  | QR             | Low      | On a local run the QR encoded `http://localhost:…` with no warning; footer claimed "zero demo credentials exposed".                                                                                                                                                                                                                                           | `9afb1b3`            |
| 15  | Deployment     | High     | Runbook placed the live SQLite database on a Cloud Storage FUSE volume (no locking; overlapping instances during rollout).                                                                                                                                                                                                                                    | `9b9e09b`            |

---

## 3. Security review

### 3.1 Authentication and sessions

- **PIN storage:** scrypt with 16-byte random salt, constant-time compare, dummy-hash verification for unknown phones (timing). No plaintext credentials stored. Verified.
- **Throttling:** per IP+phone (10/15 min) and now per phone across IPs (30/15 min). In-memory, so per instance and reset on restart. The per-phone limit allows an attacker to lock an account for 15 minutes (accepted trade-off).
- **Sessions:** HMAC-signed cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production — confirmed on the production build), 12 h TTL, role/org/active status re-read per request, and now a `ver` claim checked against `users.session_version`. Sign-out revokes **all** of the user's sessions (no per-device revocation). Login issues a fresh token; there is no separate rotation on privilege change because roles cannot change through the app.
- **Role escalation:** role comes only from the database; no endpoint accepts a role from the client. Admin routes are behind `requireRole('admin')` at router level; worker routes per handler.
- **CSRF:** JSON-only state changes plus Origin/Host check. A cross-site POST was rejected (403) against the production build.
- **OTP:** 6 digits from `randomInt`, HMAC-stored, 5 min TTL, 5 attempts per challenge, 60 s cooldown and 4 requests per 15 min per phone, single use. The mock provider refuses to run in production. Not exercised against a real SMS gateway.
- **Google OIDC:** PKCE S256, signed state cookie, `aud`, `iss`, `exp`, `nonce` (now mandatory) and `email_verified` checked, but via Google's `tokeninfo` endpoint rather than local JWKS verification. Unprovisioned identities are rejected. Errors thrown after the token exchange return JSON rather than redirecting to the login page (UX issue, not fixed).
- **Default credentials:** the synthetic accounts (PIN 1234) exist only when `DEMO_MODE=true` seeds an empty database, and the PIN hint endpoint returns 404 otherwise. **Running production with `DEMO_MODE=true` publishes those accounts by design.**

### 3.2 FairShift Proof

- Canonical JSON (recursively sorted keys), HMAC-SHA256 receipt digests with `key_id`, key maps for rotation, version chains with `previous_version_id` — implemented and tested.
- Merkle tree: domain-separated leaf (`fairshift:leaf:v1:`) and node prefixes; odd levels duplicate the last node (the Bitcoin-style CVE-2012-2459 ambiguity applies in principle; leaves come from the server's own table, so it is low risk).
- **Independent verification is not available today.** Checkpoints and receipts are HMAC; a verifier without the organisation's keys can only confirm Merkle consistency (`unauthenticated_inclusion`). The documentation and UI now say so.
- **Recommended architecture (deferred, needs a migration):**
  1. Add an Ed25519 key pair (`node:crypto`, no dependency) and sign the checkpoint header; publish the public key out of band (README, organisation notice board).
  2. Introduce leaf v2 = `SHA-256("fairshift:leaf:v2:" + SHA-256(canonical receipt JSON))` so a keyless verifier can recompute it from the receipt body.
  3. Keep HMAC fields and leaf v1 for existing checkpoints; new checkpoints carry `leafVersion: 2` and `publicSignature`; bundle version `1.1` includes both. Verifiers accept v1 bundles only as `unauthenticated_inclusion` unless they hold the HMAC key.
- A valid seal shows a receipt has not changed since issue. It does not prove the original attendance entry was truthful; the UI now states this.
- The `work_receipts.status` column is updated to `finalized` after issue while the signed JSON keeps `estimated`; the DTO therefore shows a status that is not covered by the seal (documented, not changed).

### 3.3 Safe Signal

- Reporter identity: confidential reports store no `reporter_id`, only an org-scoped HMAC reference used solely so the reporter can list their own reports. Signal inputs are re-pseudonymised per org and never returned.
- Cohort rule now enforced in every rule: ≥ 3 reports after 15-minute de-duplication **and** ≥ 2 distinct reporters.
- **k ≥ 3 is not an anonymity guarantee.** Signals aggregate only reports that admins can already open individually, so a signal adds no identity information; the real protection is that confidential reports carry no identifier. Temporal differencing (comparing the report list before and after a submission) combined with knowledge of who was on site can still narrow down a reporter. This is inherent to showing admins individual reports and is not solved by suppression.
- Residual leaks reviewed: admin notifications for high/critical reports contain title and location, not identity; audit events for confidential creation have no actor (shown as "System"); report history shows "Reporter (confidential)". The precise creation timestamp remains visible to admins.
- Cache: 15 s per org/category, invalidated on report create and transition.

### 3.4 Accountability Loop

- Transitions are a fixed state machine with required notes; invalid transitions return 409; concurrent updates use a `WHERE status = @from` compare-and-set (tested).
- Separation of duties fixed as above. `verifiedBy` remains free text: it is an attestation recorded by an admin, not an authenticated third party.
- The `requireIndependentVerification` setting exists only in stored settings; there is no UI to enable it.
- History tables are now append-only at the database level.

### 3.5 Payroll and CSV

- Org isolation and admin-only access verified (unit, integration and production-build checks).
- Integer paise throughout payroll; CSV now formats with `minorToMajorString`.
- Formula neutralisation: every text cell is quoted; cells whose first non-whitespace character is `= + - @` (or full-width forms), or that start with tab/CR/LF, get a leading apostrophe. In Excel and LibreOffice a quoted CSV cell beginning with `'` is imported as text and shows the apostrophe — safe, slightly visible. Not tested in a real spreadsheet application during this audit.
- The CSV contains worker phone numbers; exports are audit-logged with range and record count.

---

## 4. Feature verification

| Feature                        | Implemented                    | Unit tested                | Integration tested | Browser verified             | Production configured          |
| :----------------------------- | :----------------------------- | :------------------------- | :----------------- | :--------------------------- | :----------------------------- |
| Attendance / multi-site        | Yes                            | Yes                        | Yes                | No                           | Build verified, not deployed   |
| Workforce management           | Yes                            | Yes                        | Yes                | No                           | Build verified, not deployed   |
| Payroll & payslips             | Yes                            | Yes                        | Yes                | No                           | Build verified, not deployed   |
| Payroll CSV export             | Yes (hardened)                 | Yes                        | Yes                | No                           | Build verified, not deployed   |
| Money Jar / Agreed-Worked-Paid | Yes; "Paid" = payable only     | Yes                        | Via payslip API    | No                           | Build verified, not deployed   |
| Dispute notice                 | Yes (client-side, TXT + print) | Yes                        | No                 | No                           | Client only                    |
| FairShift Proof                | Yes; HMAC trust model          | Yes                        | Yes                | No                           | Needs explicit signing secrets |
| Safe Signal                    | Yes                            | Yes                        | Yes                | No                           | Build verified, not deployed   |
| Accountability Loop            | Yes                            | Yes                        | Yes                | No                           | Build verified, not deployed   |
| Notifications                  | Yes (in-app only)              | Partial                    | Yes                | No                           | Build verified, not deployed   |
| Heat safety                    | Yes; manual input only         | Yes                        | No (client-only)   | No                           | Client only                    |
| Six-language UI                | Partial (see §6)               | Yes                        | No                 | No                           | Client only                    |
| Mobile QR                      | Yes; encodes current origin    | Yes (vs reference encoder) | No                 | No; not scanned with a phone | Depends on deployed URL        |
| Phone OTP                      | Yes                            | Yes                        | Yes (mock)         | No                           | Requires Twilio credentials    |
| Google / GitHub sign-in        | Yes                            | Yes (mocked)               | No                 | No                           | Requires OAuth credentials     |

"Browser verified" is **No** throughout: no browser automation was available in this environment, and no screenshot or click-through was performed. "Integration tested" means supertest against the Express app with an in-memory database, plus the HTTP walk-through in §7.

---

## 5. Legal-source validation (dispute notice)

| Claim now in the notice                                                                     | Source                                        | Status                                                       |
| :------------------------------------------------------------------------------------------ | :-------------------------------------------- | :----------------------------------------------------------- |
| Principal provisions of the Code on Wages, 2019 in force from 21 Nov 2025                   | MoLE notification S.O. 5322(E), labour.gov.in | Confirmed via the notification as cited in multiple sources  |
| Section 69 repeals the Payment of Wages Act, 1936 and Minimum Wages Act, 1948, with savings | Code on Wages, 2019, s. 69                    | Confirmed via secondary sources; India Code PDF returned 403 |
| Applicability depends on employment, establishment and appropriate-Government rules         | Structure of the Code                         | General statement                                            |

Removed: the overtime multiplier claim, and any implication that all three laws apply together. Not stated (deliberately): s. 14 overtime rate (reportedly "not less than twice"), s. 18 deduction ceiling (reportedly 50%), limitation periods, claim authorities. These were only checked against secondary summaries and depend on facts the tool does not collect. **A qualified Indian labour lawyer has not reviewed the notice.** The non-representation disclaimer is retained.

The notice is built only from the worker's own payslip, profile and organisation name; no safety-report data is passed in (asserted in tests). Unicode names and statements in Kannada, Hindi, Tamil, Telugu and Bengali round-trip intact in the domain model; the printed/PDF output (browser print) was not visually checked.

---

## 6. Localization coverage

- Six dictionaries: English has 336 keys; Hindi, Tamil, Telugu and Bengali have all 336; Kannada lacks only `app.name` (the brand name, which falls back to English). No placeholder mismatches. Lazy-loaded per language with English fallback; choice persisted in `localStorage`; `<html lang>` updated.
- **Correction (2026-10-31, UI phase):** the key counts above were right, but this audit did not check what script the values were in. In Tamil, Telugu and Bengali most values were Hindi (Devanagari), so those three languages largely showed Hindi. This was found during the UI redesign and fixed in commit `675c9ab`, which translates the affected strings and adds a test that fails if Kannada, Tamil, Telugu or Bengali text contains Devanagari letters or if less than 95% of a language's strings are in its own script.
- **Not localized (English only):** the admin console (Dashboard, Workers, Pay rules and most other admin pages have few or no `t()` calls), server-generated notifications and error messages, the dispute notice document body, heat-safety advice text and symptom list, receipt explanatory text, the QR modal.
- Currency is formatted with `en-IN` in most components regardless of language (Latin digits). Dates use `Intl` with the active locale where the component passes it.
- Translations have **not** been validated by native speakers. The one string added in this audit (`jar.paymentNotRecorded`) was written without native review.
- Long-text overflow and mobile layout in Indic scripts were not checked in a browser.

---

## 7. End-to-end workflow results

A scripted HTTP walk-through ran against the **production build** (`NODE_ENV=production DEMO_MODE=true node dist/server/main.js`, fresh database): **57/57 checks passed.** It covered:

- Static SPA, JS bundle, CSP/HSTS headers, health endpoint.
- Worker: sign-in (cookie flags), dashboard identity, check-in, check-out, attendance history, payslips and preview, shift receipt, verification before and after checkpointing, proof-bundle download, confidential report submission and tracking, notifications, sign-out with replayed-cookie rejection.
- Admin: dashboard, workforce list, provisioning a worker who can then sign in, deactivation (session revoked, sign-in refused), sites list and creation, shift review, correction with reason (and rejection without one) creating a new receipt version, payslip issue, CSV export and bad-date rejection, Safe Signal without reporter fields, confidential report shown without identity, report transitions (and an invalid one rejected), accountability metrics, audit log, checkpoint generation, bundle verification and tamper detection.
- Cross-organisation: campus admin denied the construction report, receipt and worker; bundle check reports `wrong_organization`. Worker denied admin API and CSV export. Cross-site POST blocked.

Not performed: browser UI, language switching in a browser, mobile devices, printing, Google/GitHub/Twilio flows against real providers.

---

## 8. Final quality gates (HEAD after the audit)

| Gate                   | Result                                                            |
| :--------------------- | :---------------------------------------------------------------- |
| `npm run format:check` | Pass                                                              |
| `npm run lint`         | Pass                                                              |
| `npm run typecheck`    | Pass                                                              |
| `npm test`             | 39 files, 326 tests passed                                        |
| `npm run build:client` | Pass (main JS ~435 kB, ~127 kB gzip; locale chunks 29–33 kB each) |
| `npm run build:server` | Pass                                                              |

`tests/integration/performance.test.ts` asserts wall-clock times (< 10 ms) and failed once under CPU load (10.15 ms); it passed on rerun. It is environment-sensitive.

Dependencies: all six runtime dependencies are used. No dependency was added. Font files (Inter, ~200 kB across subsets) are the largest static assets.

---

## 9. Deployment readiness and limitations

- Container: multi-stage `node:24-slim`, non-root, `PORT`/`DATABASE_PATH` env, `/healthz`. Docker and `gcloud` were not available, so **the image was never built and nothing was deployed**.
- `trust proxy` is 1 in production (correct for Cloud Run's single proxy hop); cookies are `Secure` in production; CORS is not enabled (same-origin only).
- **SQLite is single-writer.** Run exactly one instance (`--max-instances=1`). Even then, rollouts overlap instances briefly. It is not safe for multi-instance deployment.
- **Persistence:** for the hackathon demo, run without a volume and let `DEMO_MODE` reseed on cold start. Do not put the live database on Cloud Storage FUSE. For a real pilot, use local disk plus scheduled `VACUUM INTO` snapshots, a Filestore volume, or migrate to Cloud SQL for PostgreSQL (separate project, not started).
- **Secrets:** set `SESSION_SECRET`, `RECEIPT_SIGNING_SECRET`, `CHECKPOINT_SIGNING_SECRET` and `SIGNAL_PSEUDONYM_SECRET` explicitly. With demo mode and no `SESSION_SECRET`, all four fall back to an ephemeral value; any persisted receipts then fail verification after restart.
- Graceful shutdown closes the HTTP server and database on SIGTERM; there is no forced-exit timeout if a request hangs.
- Logging is `console` only (Cloud Run captures stdout); there is no error-reporting integration. Request bodies are not logged.
- Rate limits are in memory per instance.
- The repository also contains Vercel build tooling (`build:vercel`, `src/server/vercel.ts`). The hackathon requires Cloud Run; it was left in place.

---

## 10. Submission packaging (recommendation, not applied)

No `students/` directory exists in this repository, and the register number and name are not known, so nothing was created. Recommended layout once approved:

```
students/<RegisterNumber>-<Name>/
  README.md        problem statement, 3–5 line solution, tools, run steps, demo link, key prompts
  prompts.md       the prompts actually used
  screenshots/     real screenshots captured from the running app
  src/             copy of: src/, tests/, scripts/, package.json, package-lock.json,
                   tsconfig.json, vite.config.ts, eslint.config.js, .prettierrc.json,
                   .prettierignore, .editorconfig, .gitattributes, .env.example, Dockerfile, .dockerignore
```

Exclude: `node_modules/`, `dist/`, `data/` (contains a local SQLite database), `.env`, `.env.local`, `.vercel/`, `pitch-preparation/`, internal audit reports not needed by judges. Verified in this repo: `.env`, `.env.local`, `data/` and `.vercel/` are git-ignored and not tracked; no API keys or passwords are committed (the only credential-like value is the documented synthetic demo PIN). The demo link must be the real Cloud Run URL once deployed; none exists yet.

---

## 11. Unresolved risks and deferred work

1. Public-key checkpoint signatures and leaf v2 (§3.2) — needed before claiming third-party verifiability.
2. Browser verification of every workflow, mobile layouts and Indic-script overflow; real-device QR scan.
3. Localization of the admin console, notifications, errors, dispute document and heat advice; native-speaker review.
4. Legal review of the dispute notice by a qualified practitioner.
5. A payments record (amount, date, method) if the Money Jar should ever show "paid" or "outstanding".
6. Live weather input for heat safety, with stale-data handling; WBGT for real occupational use.
7. Persistent, shared rate limiting; JWKS-based ID token verification; redirecting OAuth errors to the login page.
8. Per-device session revocation and a forced-exit timeout on shutdown.
9. UI for `requireIndependentVerification`; authenticated third-party verifier accounts.
10. Reconcile `work_receipts.status` with the signed receipt status.
11. Incident during the audit: removing a temporary git worktree that contained a junction to `node_modules` emptied the project's `node_modules`. It was restored with `npm ci` from the lockfile (esbuild's postinstall was skipped by npm's install-script policy; `esbuild --version` and both builds work).
