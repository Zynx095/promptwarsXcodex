# FairShift

**Fair hours. Fair pay. Safe work.** FairShift is a workforce transparency and safety platform for employee-intensive organisations, built for UN Sustainable Development Goal 8 (Decent Work and Economic Growth).

It addresses four problems:

| Problem                                             | What FairShift does                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workers cannot verify attendance, overtime or wages | Server-recorded check-in/check-out, overtime derived from timestamps, payslips with a line-by-line plain-language explanation                         |
| Hazards are ignored or risky to report              | Hazard reports with severity, confidential mode, a controlled status lifecycle and a visible history                                                  |
| Workers fear retaliation for honest feedback        | Feedback stored without any user reference, date-only, with small-group suppression of averages                                                       |
| Employers lack visibility                           | Dashboard computed from stored records with daily attendance and overtime trends, excessive-hours (fatigue-risk) warnings, audit log                  |
| Low literacy, regional languages, basic phones      | English and Kannada worker screens, optional voice dictation and read-aloud, large touch targets, a 6-digit site check-in code instead of QR scanning |

### Features

1. **Shift tracking:** check-in and check-out with automatic overtime, attendance history, administrator corrections with an audit trail, and an optional rotating site check-in code.
2. **Clear payslips:** a line-by-line explanation in the worker's language, which can also be read aloud, with print-ready formatting.
3. **FairShift Proof:** versioned, verifiable work and earnings receipts with canonical JSON serialization, HMAC-SHA256 cryptographic digests, binary Merkle tree proofs, signed checkpoints, and a plain-language guarantee.
4. **Safety reporting:** voice or text hazard reports, optional confidentiality, and an extended status lifecycle with audit history.
5. **Safe Signal:** privacy-conscious detection of recurring hazard patterns using deterministic rules and strict $k \ge 3$ cohort suppression to prevent worker re-identification.
6. **Accountability Loop:** transparent multi-stage safety resolution, post-fix follow-up scheduling (`follow_up_pending`), outcome verification sign-off (`outcome_verified`), and real-time MTTA/MTTR accountability metrics.
7. **In-App Notification Hub:** notification bell with real-time badges for shift corrections, payslip issuance, safety outcome updates, and high-severity hazard alerts.
8. **Workforce and Multi-Site Management:** administrative worker provisioning, instant session revocation upon deactivation, and multi-site configuration with check-in code enforcement.
9. **Administrative Payroll Export:** one-click CSV export of finalized payslip registers with full audit logging.
10. **Honest feedback:** anonymous, with averages hidden below 3 responses.
11. **Skill passport:** self-reported entries, plus entries checked by the employer, with expiry dates.
12. **Fatigue-risk alerts:** warnings for long days, long weeks, short rest and repeated overtime, against thresholds the organisation sets.
13. **Admin dashboard:** attendance and overtime trends, Safe Signal alerts, accountability loop KPIs, open hazards, alerts, recent activity and feedback summaries.
14. **Voice and local language:** browser speech dictation and read-aloud in English and Kannada (100% dictionary coverage), with nothing to install.

FairShift deliberately does **not** predict which individual workers will quit. Instead, it shows employers the measurable causes of attrition: excessive hours, unresolved hazards and feedback trends.

Two industry configurations run on the same code: **construction sites** (site workers, crews, site hazards) and **educational institutions** (housekeeping, sanitation, security and maintenance staff on a campus). An organisation references an industry; only terminology and category lists differ.

> All people, phone numbers, shifts, payslips, reports and feedback in demo mode are **synthetic**. FairShift is not connected to any payroll, banking or certification system.

## Quick start

Requires Node.js 22.13 or later (uses the built-in `node:sqlite` module).

```bash
npm ci
cp .env.example .env        # optional; set SESSION_SECRET to keep sessions across restarts
npm run dev                 # http://localhost:8080 (API + Vite dev server in one process)
```

With `DEMO_MODE=true` (the default in `.env.example`), an empty database is seeded with synthetic data and the sign-in page lists the demo accounts. Every demo account uses PIN `1234`.

| Role                                           | Organisation                                                    | Phone      |
| ---------------------------------------------- | --------------------------------------------------------------- | ---------- |
| Employer admin (site manager)                  | Sunrise Infra Builders, Site 14 (construction)                  | 9000000100 |
| Worker (mason, currently on shift)             | construction                                                    | 9000000001 |
| Worker (helper)                                | construction                                                    | 9000000002 |
| Worker (electrician, long days → alerts)       | construction                                                    | 9000000003 |
| Employer admin (facilities officer)            | Greenfield Institute of Technology, Campus Services (education) | 9100000100 |
| Worker (housekeeping)                          | education                                                       | 9100000001 |
| Worker (security guard, night shifts → alerts) | education                                                       | 9100000002 |

`npm run seed` deletes the local database and re-seeds it.

## Scripts

| Command         | What it does                                                                         |
| --------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`   | Development server with Vite middleware                                              |
| `npm test`      | Unit, API integration and UI tests (Vitest)                                          |
| `npm run build` | Type-check, build client (`dist/client`) and server bundle (`dist/server/main.js`)   |
| `npm start`     | Run the production build (`NODE_ENV=production` sets `Secure` cookies, so use HTTPS) |
| `npm run seed`  | Reset and re-seed the local demo database                                            |

## Architecture

A single TypeScript service: an Express 5 API that also serves the built React client. It deploys as one Cloud Run container.

```
src/
  shared/      Typed data contracts, zod input schemas, timezone and integer-money helpers, industry configs
  domain/      Pure business rules (no I/O): attendance, payroll, safety lifecycle, fatigue rules,
               feedback aggregation, dashboard aggregation, access policy
  server/
    db/        SQLite schema, thin driver wrapper (named parameters only), deterministic seed
    auth/      PIN hashing (scrypt), signed HttpOnly session cookies, CSRF guard, role checks
    repositories/  Organisation-scoped data access
    services/  Orchestration: domain rules + data access inside transactions, audit events
    routes/    HTTP endpoints: auth, worker (/api/...), admin (/api/admin/...)
  client/      React UI: lib/ (router, API client, i18n, session), components/, pages/worker, pages/admin
tests/
  unit/        Domain rules, money and time, validation
  integration/ API workflows against an in-memory database
  client/      UI smoke test: real React client against the real API in happy-dom
```

Business rules live in `src/domain` and are shared by server and client. UI components only render data and call the API, so the presentation layer can be redesigned without touching the rules, data access or tests. Design tokens are centralised in `src/client/styles.css`.

### Key rules

- **Time:** every timestamp is stored as UTC ISO-8601. Days, weeks and pay periods are computed in the organisation's IANA timezone (`Asia/Kolkata` for the demo organisations).
- **Attendance states:** `not_started`, `on_shift`, `completed`. A worker can have at most one open shift. This is enforced in the domain layer and by a partial unique index in the database. Self check-out is refused after 16 hours; an administrator must correct the shift instead. The client never sends durations or overtime; the server derives them from timestamps.
- **Overtime:** minutes worked beyond the organisation's scheduled daily minutes on one local calendar day (the day of check-in), summed across that day's shifts.
- **Pay:** money is integer paise, multipliers and percentages are integer basis points, and each component is rounded half-up. Base pay is regular minutes × rate. Overtime pay is overtime minutes × rate × multiplier. Deductions (percent of base, percent of gross, or fixed) are applied in order and capped so net pay is never negative; a capped deduction is flagged on the payslip. The result must reconcile or it is rejected. Rates, multipliers (1×–3×) and deductions (≤100% in total) are validated.
- **Payslips:** workers see a live estimate for the current week. Issued payslips are immutable snapshots, one per worker and period, and cannot be issued while a shift in the period is still open.
- **Safety reports:**
  - **Lifecycle:** `submitted → acknowledged → (in_progress) → resolved → reopened → …`
  - **Transitions:** invalid transitions are rejected, and resolving or reopening requires a note.
  - **History:** every change is a timestamped event with the acting administrator.
  - **Confidential reports:** no reporter ID is stored. A keyed hash lets only the reporter find their own report.
- **Fatigue-risk warnings:** rules cover a long day (> max daily), a long ISO week (> max weekly), short rest between consecutive shifts (< minimum) and repeated overtime (≥ N overtime days in an ISO week). They are evaluated on every check-out and correction. A unique key (worker, rule, window) prevents duplicate alerts. They are scheduling warnings, not medical judgements.
- **Feedback:** no user reference is stored and only the submission date is kept. Average ratings are hidden for topics with fewer than 3 ratings.

## Routes

**Worker UI:**

- `/worker` (home: today's state, check in/out, alerts)
- `/worker/attendance`
- `/worker/payslips` and `/worker/payslips/:id`
- `/worker/reports`, `/worker/reports/new` and `/worker/reports/:id`
- `/worker/feedback`
- `/worker/skills`

**Admin UI:**

- `/admin` (dashboard with a date filter and drill-down links)
- `/admin/workers` (workforce provisioning, search, status deactivation) and `/admin/workers/:id/skills`
- `/admin/sites` (multi-site management, location codes, status toggles)
- `/admin/shifts` (filters and corrections)
- `/admin/reports` and `/admin/reports/:id`
- `/admin/alerts`
- `/admin/payslips` (issue payslips, payroll CSV export, print layout) and `/admin/payslips/:id`
- `/admin/pay-rules`
- `/admin/feedback`
- `/admin/audit`

**API (JSON; state-changing requests must be `application/json`):**

| Area          | Endpoints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth          | `GET /api/auth/config`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/google/start`, `GET /api/auth/google/callback`, `POST /api/auth/phone/otp/request`, `POST /api/auth/phone/otp/verify`, `GET /api/auth/github/start`, `GET /api/auth/github/callback`, `GET /api/demo/accounts` (demo mode only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Worker        | `GET /api/attendance/status`, `POST /api/attendance/check-in`, `POST /api/attendance/check-out`, `GET /api/attendance/shifts`, `GET /api/receipts/shift/:shiftId`, `GET /api/receipts/:id`, `GET /api/receipts/:id/verify`, `GET /api/receipts/:id/bundle`, `GET /api/payslips`, `GET /api/payslips/preview`, `GET /api/payslips/:id`, `POST /api/reports`, `GET /api/reports/mine`, `GET /api/reports/:id`, `POST /api/feedback`, `GET /api/alerts/mine`, `GET /api/skills/mine`, `POST /api/skills`                                                                                                                                                                                                                                                                                                                                                                                           |
| Notifications | `GET /api/notifications/mine`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Admin         | `GET /api/admin/dashboard`, `GET /api/admin/signals`, `GET /api/admin/reports/accountability`, `GET /api/admin/site-code`, `GET/POST /api/admin/workers`, `PATCH /api/admin/workers/:id`, `GET/POST /api/admin/sites`, `PATCH /api/admin/sites/:id/status`, `GET /api/admin/shifts`, `PATCH /api/admin/shifts/:id`, `GET /api/admin/receipts/shift/:shiftId`, `GET /api/admin/receipts/:id[/verify]`, `GET /api/admin/audit`, `GET/PUT /api/admin/settings`, `GET/POST /api/admin/payslips`, `GET /api/admin/payslips/preview`, `GET /api/admin/payslips/:id`, `GET /api/admin/payslips/export.csv`, `GET /api/admin/reports[/:id]`, `POST /api/admin/reports/:id/transition`, `GET /api/admin/feedback[/summary]`, `PATCH /api/admin/feedback/:id`, `GET /api/admin/alerts`, `POST /api/admin/alerts/:id/acknowledge`, `GET/POST /api/admin/workers/:id/skills`, `PATCH /api/admin/skills/:id` |
| Ops           | `GET /healthz`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Accessibility and language

- **Layout and controls:**
  - mobile-first layout
  - semantic landmarks and a skip link
  - labelled fields with hints and linked error messages
  - visible focus outlines
  - touch targets of at least 44 px
  - status shown as text badges, not colour alone
- **Feedback states:** loading, empty and error states on every data view.
- **Language:** worker screens are available in English and Kannada (ಕನ್ನಡ). The language choice is stored on the device. Admin screens are English. The Kannada text is an initial translation and should be reviewed by a native speaker. New languages are added as dictionaries in `src/client/lib/i18n.tsx`.
- **Voice:**
  - "Speak instead of typing" adds dictated words to hazard descriptions and feedback comments.
  - "Read aloud" reads the shift status and the payslip explanation.
  - Both use only the browser's built-in speech APIs (no external service or keys), follow the selected language, and are hidden on browsers without support. Typing and reading always work.
- **Site check-in code:**
  - The Shifts page shows a 6-digit code derived from the server secret, the organisation and a 5-minute window.
  - Workers can type it when checking in, and an organisation can make it mandatory.
  - It works on basic phones without a camera. It proves the worker saw the current code, not their location.
- **Not implemented:** camera QR scanning, geolocation and photo attachments. The core flows don't depend on any of them.

## How FairShift addresses the evaluation criteria

| Criterion         | Evidence in this repository                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code quality      | Layered TypeScript: pure domain rules in `src/domain`, data access in `src/server/repositories`, orchestration in `src/server/services`, thin routes, shared zod schemas and DTOs. Strict compiler settings, no `any`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Security          | Server-side authorisation on every route, organisation scoping, signed HttpOnly cookies, scrypt PINs, CSRF guard, CSP and security headers, parameterised SQL, no secrets in the repository (`.env.example` only). See `docs/SECURITY.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Efficiency        | Two runtime dependencies on the server (Express, zod), the built-in `node:sqlite` driver, bounded and paginated queries, a single container, and about 100 KB gzipped of client JavaScript.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Testing           | 246 automated tests across 29 test suites (100% green): domain unit tests (time, money, overtime, pay, receipts & cryptographic digests, Merkle trees & inclusion proofs, signed checkpoints & hash chains, hazard cluster detection, accountability metrics, fatigue, site codes, PKCE OAuth, SMS OTP rate-limiting and replay resistance), adversarial test suites (cryptographic tampering, key rotation, sybil hazard suppression, privacy differencing defenses, state machine transition guards, session fixation resistance, OIDC nonce replay), API integration tests (work receipts & versioning, independent verification bundles, safe signals & privacy isolation, accountability loop, V4 cross-module workflows & notifications, workforce provisioning & deactivation locks, multi-site management, payroll CSV export, IDOR, cross-organisation isolation, CSRF, confidentiality, additive schema migrations, atomic SQLite backups, and 1,000+ record performance benchmarks), and a UI test that renders the real client against the real API. |
| Accessibility     | WCAG AA colour contrast, keyboard navigation, visible focus, labelled fields with linked errors, skip link, text plus colour for status, 44 px targets, screen-reader tables for charts, Kannada, voice options.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Problem alignment | Covers every example feature in the problem statement across two industries (construction and campus support staff), with separate worker and employer interfaces.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Further documentation

- [docs/V40_FINAL_VERIFICATION.md](docs/V40_FINAL_VERIFICATION.md): V4.0 Release Candidate final verification evidence and metrics
- [docs/V40_PRODUCT_COMPLETION_PLAN.md](docs/V40_PRODUCT_COMPLETION_PLAN.md): V4.0 product completion inventory matrix and gap analysis
- [docs/V40_WORKFLOW_VERIFICATION.md](docs/V40_WORKFLOW_VERIFICATION.md): Cross-module workflow integration and verification evidence
- [docs/V40_SECURITY_REVIEW.md](docs/V40_SECURITY_REVIEW.md): V4.0 threat modeling, symmetric vs asymmetric checkpoint trust, and session revocation
- [docs/V40_UX_ACCESSIBILITY_AUDIT.md](docs/V40_UX_ACCESSIBILITY_AUDIT.md): WCAG AA accessibility audit, touch targets, focus rings, and Kannada localization
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md): Step-by-step end-to-end demonstration script across Worker, Admin, and Auditor personas
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md): Production release readiness criteria, gates, and sign-offs
- [docs/DEPLOYMENT_RUNBOOK.md](docs/DEPLOYMENT_RUNBOOK.md): Cloud Run deployment runbook, volume mounting, WAL constraints, and disaster recovery
- [docs/PRODUCTION_CONFIGURATION.md](docs/PRODUCTION_CONFIGURATION.md): Production configuration matrix, environment variables, and secret handling
- [docs/V32_INITIAL_ASSESSMENT.md](docs/V32_INITIAL_ASSESSMENT.md): V3.2 evidence-driven investigation and findings matrix
- [docs/V32_INDEPENDENT_PROOF_ARCHITECTURE.md](docs/V32_INDEPENDENT_PROOF_ARCHITECTURE.md): Independent receipt verification, binary Merkle tree proofs, and signed checkpoints
- [docs/V32_PRIVACY_ENGINEERING.md](docs/V32_PRIVACY_ENGINEERING.md): Safe Signal advanced privacy engineering, pseudonymization, and inference defenses
- [docs/V32_ACCOUNTABILITY_TRUST_MODEL.md](docs/V32_ACCOUNTABILITY_TRUST_MODEL.md): Accountability Loop verification authority, separation of duties, and recurrence handling
- [docs/V32_PRODUCTION_READINESS.md](docs/V32_PRODUCTION_READINESS.md): Production deployment, persistent volume mounting, backup runbooks, and disaster recovery
- [docs/V32_VERIFICATION_EVIDENCE.md](docs/V32_VERIFICATION_EVIDENCE.md): Complete test suite results, quality gates, and performance benchmarks
- [docs/V31_ADVERSARIAL_AUDIT.md](docs/V31_ADVERSARIAL_AUDIT.md): V3.1 adversarial security, reliability, and product integrity audit report
- [docs/V31_SECURITY_VERIFICATION.md](docs/V31_SECURITY_VERIFICATION.md): Cryptographic digest verification, multi-key rotation, and authentication security evidence
- [docs/V31_RELIABILITY_REPORT.md](docs/V31_RELIABILITY_REPORT.md): Database reliability, schema migrations, and concurrency assessment
- [docs/V31_TEST_EVIDENCE.md](docs/V31_TEST_EVIDENCE.md): Full test suite results, adversarial test cases, and quality gate evidence
- [docs/FAIRSHIFT_PROOF.md](docs/FAIRSHIFT_PROOF.md): FairShift Proof architecture, HMAC-SHA256 canonical receipt hashing, version audit diffs, and tamper detection
- [docs/SAFE_SIGNAL.md](docs/SAFE_SIGNAL.md): Safe Signal recurring hazard pattern detection, deterministic rules, and minimum cohort suppression ($k \ge 3$)
- [docs/ACCOUNTABILITY_LOOP.md](docs/ACCOUNTABILITY_LOOP.md): FairShift Accountability Loop multi-stage lifecycle, verification sign-offs, and MTTA/MTTR metrics
- [docs/V3_ENGINEERING_AUDIT.md](docs/V3_ENGINEERING_AUDIT.md): Comprehensive repository engineering and security audit report
- [docs/V3_VERIFICATION_REPORT.md](docs/V3_VERIFICATION_REPORT.md): Evidence-based quality verification report across all test suites and quality gates
- [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md): multi-provider authentication (Google OAuth with PKCE, SMS Phone OTP, GitHub SSO), identity mapping, rate limiting and demo mode
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Google Cloud Run and Vercel deployment, environment variables and persistence
- [docs/SECURITY.md](docs/SECURITY.md): security and privacy controls and known limitations
- [docs/GLASSMORPHISM_V2_HANDOFF.md](docs/GLASSMORPHISM_V2_HANDOFF.md): Glassmorphism V2 engineering specifications, design tokens and UI polish guidelines

## Known limitations

- **Persistence:** SQLite on the container filesystem. On Cloud Run without a mounted volume, the data is ephemeral when an instance stops (see docs/DEPLOYMENT_RUNBOOK.md for Cloud Storage FUSE / Filestore persistent mount runbooks).
- **Authentication:** phone number + PIN accounts, Google OAuth with PKCE, and SMS OTP. There is no automated self-service PIN reset without administrator assistance.
- **Organisations:** one admin role per organisation. Worker accounts and multi-site locations can be provisioned and managed directly in the Admin console; organization onboarding remains handled via tenant setup scripts or seeding.
- **Payroll:** employers issue payslips directly in-app with one-click CSV export for external payroll software; automatic statutory tax deduction withholding (e.g. PF/ESI) is handled via configured percentage or fixed deduction rules rather than direct government gateway integration.
- **Alerts:** existing alerts are not withdrawn when a later correction removes the breach. Threshold changes apply from the next evaluation.
- **Kannada:** the translation has not been reviewed by a native speaker.
