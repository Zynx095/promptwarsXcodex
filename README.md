# FairShift

**Fair hours. Fair pay. Safe work.**

FairShift is a workforce platform for frontline workers on construction sites and in campus support services (housekeeping, security, sanitation, maintenance). Workers check in and out, see exactly what they earned and why, report hazards (openly or confidentially, with photos) and follow each report until the fix is confirmed. Employers get a console for the workforce, shifts, pay, safety reports, fatigue alerts and an audit log.

It is built around UN Sustainable Development Goal 8 (Decent Work and Economic Growth): provable working hours, transparent wages and accountable safety fixes.

**Live demo:** <https://fairshift-nine-red.vercel.app>. It runs on synthetic data that resets (see [Deployment](#9-deployment)).

---

## Contents

1. [The problems FairShift addresses](#1-the-problems-fairshift-addresses)
2. [Try the demo](#2-try-the-demo)
3. [Features for workers](#3-features-for-workers)
4. [Features for employers](#4-features-for-employers)
5. [Trust and integrity: FairShift Proof, Safe Signal, the Accountability Loop](#5-trust-and-integrity)
6. [Architecture](#6-architecture)
7. [Project structure](#7-project-structure)
8. [Running locally](#8-running-locally)
9. [Deployment](#9-deployment)
10. [Configuration reference](#10-configuration-reference)
11. [Security and privacy](#11-security-and-privacy)
12. [Testing and quality checks](#12-testing-and-quality-checks)
13. [Known limitations](#13-known-limitations)
14. [Further documentation](#14-further-documentation)
15. [License](#15-license)

---

## 1. The problems FairShift addresses

| Problem on the ground                                           | What FairShift does                                                                                                                                                                    |
| :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hours are disputed and timecards can be edited after the fact   | Every completed shift produces a signed work receipt (HMAC-SHA256) that can be checked later; receipts are anchored in Merkle-tree checkpoints. Corrections are audited.               |
| Pay slips are hard to read, so underpayment goes unnoticed      | The **Money Jar** shows base pay, overtime, deductions and net pay as layers, next to an **agreed vs worked vs paid** comparison. All money is integer paise, no rounding drift.       |
| Workers who notice a pay gap have no structured way to raise it | The **wage discrepancy notice generator** produces a factual, printable notice that cites the work receipt and the relevant Indian wage laws, and says clearly it is not legal advice. |
| Hazard reports are ignored, or "fixed" on paper only            | The **Accountability Loop** tracks every report through a fixed lifecycle; reports with photos need a photo of the fix and the reporter's confirmation (**two-key closure**).          |
| Workers fear retaliation for reporting                          | **Confidential reports** store no reporter identity; **Safe Signal** shows recurring hazard patterns only when at least three reports agree, so no single reporter stands out.         |
| Extreme heat on outdoor sites                                   | A **heat-stress check** computes the heat index (NOAA Rothfusz) and maps it to NDMA-style guidance on water, rest and shade, with a one-tap link to report heat as a hazard.           |
| Many workers read little English, or read little at all         | The interface is fully translated into **six languages** (English, Hindi, Kannada, Tamil, Telugu, Bengali), with **read-aloud** and **voice dictation**.                               |
| Buddy punching (one worker checking in for another)             | Optional **passkey check-in** (WebAuthn): the worker's own phone confirms check-in and check-out with its screen lock. No fingerprint or face data ever leaves the phone.              |

---

## 2. Try the demo

Open <https://fairshift-nine-red.vercel.app> and sign in with any of the synthetic accounts below. **Every account uses PIN `1234`.** The sign-in page also lists the demo accounts, and a "Mobile demo" button shows a QR code to open the site on a phone.

| Role             | Organisation (synthetic)                       | Name           | Job                    | Phone        |
| :--------------- | :--------------------------------------------- | :------------- | :--------------------- | :----------- |
| Employer (admin) | Sunrise Infra Builders, Site 14 (construction) | Priya Raman    | Site manager           | `9000000100` |
| Worker           | Sunrise Infra Builders, Site 14                | Ravi Kumar     | Mason                  | `9000000001` |
| Worker           | Sunrise Infra Builders, Site 14                | Lakshmi Devi   | Helper                 | `9000000002` |
| Worker           | Sunrise Infra Builders, Site 14                | Mohammed Irfan | Electrician            | `9000000003` |
| Worker           | Sunrise Infra Builders, Site 14                | Suresh Naik    | Scaffolder             | `9000000004` |
| Employer (admin) | Greenfield Institute of Technology (campus)    | Anita Desai    | Facilities officer     | `9100000100` |
| Worker           | Greenfield Institute of Technology             | Manjula S      | Housekeeping staff     | `9100000001` |
| Worker           | Greenfield Institute of Technology             | Ramesh Gowda   | Security guard         | `9100000002` |
| Worker           | Greenfield Institute of Technology             | Fatima Begum   | Sanitation worker      | `9100000003` |
| Worker           | Greenfield Institute of Technology             | Venkatesh R    | Maintenance technician | `9100000004` |

A suggested five-minute tour:

1. **As Ravi (worker, `9000000001`):** look at the time card on the home screen, open **Pay** to see the Money Jar and the agreed vs worked vs paid comparison, open a payslip and generate a discrepancy notice, then open **Safety** and report a hazard with a photo. Switch the language to Tamil or Hindi and press **Read aloud**.
2. **As Priya (admin, `9000000100`):** open the dashboard, the safety report queue and the report Ravi just filed; acknowledge it, add a photo of the fix and mark it resolved. Look at **Photo inspections**, **Excessive-hours alerts** and the **Audit log**.
3. **Back as Ravi:** confirm or dispute the fix. The report can only be verified after that.

The two organisations are fully separated: an admin of one never sees the other's workers, reports or photos.

---

## 3. Features for workers

### Time card and attendance

- Check in and check out from the home screen. Timestamps always come from the server, never the phone.
- Check-in can require the 6-digit **site code** shown on the employer's console. It rotates every five minutes, so a worker must have seen the current code (it proves presence at the gate display, not GPS location).
- Shift history with each shift's hours and its signed **work receipt**, which can be opened and verified.
- **Passkey check-in (optional):** once a worker adds a passkey under _More → Passkey for check-in_, check-in and check-out each ask the phone to confirm with its own screen lock (fingerprint, face or PIN). A worker can hold up to five passkeys and remove a lost phone; an employer can reset them. Workers without a passkey simply use their sign-in.

### Pay and the Money Jar

- **Money Jar:** a layered visual of base pay, overtime, deductions and net pay. Layers use patterns as well as colour, so the chart never relies on colour alone.
- **Agreed vs worked vs paid:** contracted rate and schedule, recorded hours, and what was paid, side by side, with any gap stated in rupees.
- Payslips with a full line-by-line breakdown and a preview of the current period.
- All money is stored and computed in integer paise.

### Wage discrepancy notice

- Generates a structured notice from the worker's own records: dates, hours, rate, overtime and the unpaid amount.
- Embeds the work receipt ID and digest so the employer can check the hours against the original record.
- Cites the Payment of Wages Act 1936, the Minimum Wages Act 1948 and the Code on Wages 2019, and states that it is a factual summary, not legal advice.
- Print-ready (`@media print`) and downloadable as text.

### Safety reporting

- Report a hazard with a category, severity, location, description and per-industry inspection points (helmet, vest, footwear, electrical, fire or smoke, machinery, chemicals, heat and others).
- **Photos:** "Take a photo" uses the phone's own camera app; "Choose a photo" opens the gallery. Up to six photos per report, each with a note; preview, retake and remove before sending. Photos are optional, so a missing camera never blocks a report.
- Photos are turned upright, resized to 1600 px and re-encoded on the phone, which removes location and device metadata before upload. The server strips any remaining metadata again.
- **Confidential reports:** the reporter's identity is not stored at all.
- Each report has a case page with its lifecycle, before and after photos side by side, and a "Check the seal" button for every photo.
- **"Is it fixed?":** when an employer marks a photo-backed report resolved, the reporter confirms the fix or says what is still wrong, which reopens the report.

### Heat-stress check

- Enter temperature and humidity, or pick a regional preset (Delhi dry heat, Chennai coastal, Kolkata monsoon, Bengaluru moderate).
- The NOAA/NWS Rothfusz heat index maps to five tiers (normal to extreme danger) with water, rest and shade guidance.
- One tap pre-fills a heat hazard report when conditions are dangerous.

### Language, read-aloud and dictation

- Six languages: English, Hindi (हिन्दी), Kannada (ಕನ್ನಡ), Tamil (தமிழ்), Telugu (తెలుగు) and Bengali (বাংলা). English is bundled; the others load on demand.
- **Read aloud:** chooses a voice for the selected language only (never reads Tamil with an English voice), reads sentence by sentence, and offers pause, resume, stop, replay, speed (0.75×, 1×, 1.25×) and voice choice.
- If the device has no voice for a language, it says so plainly and explains how to add one. If `GOOGLE_TTS_API_KEY` is configured, the server provides the voice instead.
- **Dictation:** speak into report and feedback fields where the browser supports speech recognition.

### More

- Notifications (shift, pay and report updates), a skills passport with employer-verified skills, and ratings or comments as feedback to the employer.

---

## 4. Features for employers

The console loads only when an administrator signs in, so the worker app stays small.

- **Dashboard:** workforce on shift, hours this week, open safety reports, alerts and accountability metrics (time to acknowledge, time to resolve).
- **Workforce:** add workers, set rates, activate or deactivate (deactivation signs the worker out everywhere immediately), verify skills, reset a worker's passkeys.
- **Sites:** sites and locations, and the organisation's rotating check-in code to show at the gate.
- **Shifts:** all attendance records, with audited corrections.
- **Safety report queue and case view:** move reports through the lifecycle, add fix photos, review the advisory photo analysis, see Safe Signal patterns.
- **Photo inspections:** every report with photos, with before/after thumbnails, advisory outcomes, pending reviews and the state of each two-key closure.
- **Excessive-hours alerts:** fatigue and rest-period warnings computed from shift data.
- **Payslips and pay rules:** issue payslips, export the wage register as CSV (protected against spreadsheet formula injection), set overtime and working-hour rules.
- **Feedback** from workers, and an append-only **audit log** of every significant action.

---

## 5. Trust and integrity

### FairShift Proof

- Every completed shift produces a **work receipt**: canonical JSON of the shift, signed with HMAC-SHA256 under a key ID, so signing keys can be rotated without breaking older receipts.
- Receipts are grouped into **Merkle-tree checkpoints**; a receipt's inclusion proof can be checked against a checkpoint.
- Safety photos get the same treatment: a SHA-256 of the stored bytes plus an HMAC seal over the evidence record. A database trigger refuses any change to a stored photo, its hash or its seal.
- What a seal means is stated plainly in the interface: the photo has not changed since upload. It does not prove the photo shows a true event.

### Safe Signal

- Surfaces recurring hazard patterns across reports while suppressing any group smaller than three (k ≥ 3), so a pattern can never be traced back to one person.
- Uses a dedicated pseudonym secret, separate from session signing.

### Accountability Loop

- Reports follow a fixed state machine: `submitted → acknowledged → in_progress → resolved → follow_up_pending → outcome_verified`, with `reopened` when a fix fails.
- **Two-key closure** for reports with photos: resolving needs a photo of the fix; the reporter then confirms or disputes. If the reporter does not answer within 24 h (critical), 48 h (high) or 72 h (other), only a _different_ administrator from the one who resolved it can close the report (separation of duties), and the closure is recorded as escalated.
- Optional **advisory photo analysis** (Google Cloud Vision, when `GOOGLE_VISION_API_KEY` is set) flags possible fire or smoke, machinery or missing protective gear for a person to confirm or dismiss. Results are always labelled advisory, and "no visible issue" never means "safe". Without a key, every photo simply goes to manual review.

---

## 6. Architecture

```mermaid
flowchart LR
    subgraph Client [Browser: React 19 + Vite 8]
        Worker[Worker app]
        Console[Employer console, loaded on demand]
        I18n[6 languages, lazy loaded]
        Speech[Read-aloud and dictation]
        Passkey[WebAuthn client]
    end

    subgraph Server [Node.js: Express 5]
        Routes[REST API under /api]
        Auth[Signed cookie sessions, CSRF guard, rate limits]
        Services[Services: attendance, payslips, reports, evidence, passkeys, checkpoints]
        Domain[Pure domain logic: payroll, heat, fatigue, Merkle, Safe Signal, accountability]
    end

    subgraph Storage [Data]
        SQLite[(SQLite via node:sqlite)]
    end

    subgraph Optional [Optional providers]
        TTS[Google Cloud Text-to-Speech]
        Vision[Google Cloud Vision]
    end

    Client <-->|JSON over HTTPS, HttpOnly cookie| Routes
    Routes --> Auth --> Services --> Domain
    Services <--> SQLite
    Services -.-> TTS
    Services -.-> Vision
```

| Layer    | Technology                                                                                                         |
| :------- | :----------------------------------------------------------------------------------------------------------------- |
| Runtime  | Node.js 22.13 or later (uses the built-in `node:sqlite` driver; no native modules)                                 |
| Server   | Express 5, Zod 4 validation, esbuild bundle                                                                        |
| Client   | React 19, TypeScript (strict), Vite 8, Lucide icons, self-hosted variable fonts                                    |
| Data     | SQLite in WAL mode; schema applied at start-up with additive, non-destructive migrations                           |
| Auth     | Phone + PIN (scrypt, random salt), signed HttpOnly session cookies with versioned revocation; optional OAuth / OTP |
| Passkeys | SimpleWebAuthn 14 (server and browser)                                                                             |
| Hosting  | Vercel (static client + one Node.js function via the Build Output API); a Dockerfile is kept for container hosts   |
| Tests    | Vitest 5, Supertest, happy-dom                                                                                     |

Design choices worth knowing:

- **Business rules are pure functions** in `src/domain` (payroll, heat index, fatigue, Merkle trees, Safe Signal, the accountability state machine), so they are tested without a server or database.
- **All SQL uses named parameters** through a thin wrapper (`src/server/db/db.ts`); no SQL is built from strings.
- **Tenant isolation:** every query is scoped to the signed-in user's organisation; cross-organisation access returns 404.
- **Server time only:** attendance and evidence timestamps come from the server clock.

---

## 7. Project structure

```text
.
├── src/
│   ├── client/            React app
│   │   ├── pages/worker/  Home, Attendance, Payslips, Reports, Feedback, Skills, Security (passkeys)
│   │   ├── pages/admin/   Dashboard, Workers, Sites, Shifts, Reports, Inspections, Alerts, Payslips, PayRules, Feedback, Audit
│   │   ├── components/    MoneyJar, DisputeNoticeModal, HeatSafetyWidget, PhotoCapture, Evidence, Voice, ReceiptView, ...
│   │   ├── lib/           API client, i18n, speech, passkeys, image processing
│   │   ├── locales/       en, hi, kn, ta, te, bn
│   │   └── styles/        design tokens, primitives, glass materials
│   ├── server/
│   │   ├── main.ts        long-running server (local and containers)
│   │   ├── vercel.ts      the same app as a Vercel function
│   │   ├── app.ts         Express app, security headers, route wiring
│   │   ├── auth/          sessions, CSRF, crypto, OAuth, OTP, site codes
│   │   ├── db/            driver wrapper, schema, synthetic seed
│   │   ├── repositories/  data access
│   │   ├── services/      attendance, payslips, receipts, checkpoints, reports, evidence, vision, passkeys, ...
│   │   ├── evidence/      image validation and metadata removal
│   │   └── routes/        auth, worker, admin, notifications, speech
│   ├── domain/            pure business logic
│   └── shared/            types, Zod schemas, money and time helpers shared by client and server
├── tests/
│   ├── unit/              domain, client and component tests
│   └── integration/       API workflows, security, tenancy, passkeys, evidence, sessions
├── scripts/build-vercel.mjs   writes .vercel/output (Build Output API v3)
├── docs/                  design, security, deployment and release documents
├── vercel.json            build settings for Vercel
└── Dockerfile             container image for other hosts
```

---

## 8. Running locally

### Prerequisites

- Node.js **22.13 or later** (24 recommended).
- npm 10 or later.

### Install and start

```bash
git clone https://github.com/Zynx095/promptwarsXACM.git
cd promptwarsXACM
npm ci
cp .env.example .env      # optional; sets DEMO_MODE=true for the synthetic data
npm run dev
```

Open <http://localhost:8080>. `npm run dev` runs the API and the Vite dev server in one process with live reload. With `DEMO_MODE=true` the synthetic organisations, workers, shifts, payslips and reports are created on first start.

### Useful scripts

| Command                | What it does                                                                     |
| :--------------------- | :------------------------------------------------------------------------------- |
| `npm run dev`          | Development server on port 8080 (API + client with hot reload)                   |
| `npm run seed`         | Deletes and re-creates the local demo database                                   |
| `npm test`             | Runs all unit and integration tests once                                         |
| `npm run test:watch`   | Tests in watch mode                                                              |
| `npm run typecheck`    | TypeScript check with no output                                                  |
| `npm run lint`         | ESLint, including React hooks and jsx-a11y accessibility rules                   |
| `npm run format:check` | Prettier check (`npm run format` fixes)                                          |
| `npm run check`        | Format, lint, typecheck and tests in one go                                      |
| `npm run build`        | Typecheck, then client (`dist/client`) and server (`dist/server/main.js`) builds |
| `npm start`            | Runs the production server from `dist/`                                          |
| `npm run build:vercel` | `build`, then writes the Vercel Build Output API directory `.vercel/output`      |

### Local production check

```bash
npm run build
NODE_ENV=production DEMO_MODE=true SESSION_SECRET=<at least 32 random characters> npm start
```

In production mode cookies are `Secure`, so sign-in only works over HTTPS. Use `npm run dev` for local work.

---

## 9. Deployment

### Vercel (current hosting)

The repository is connected to a Vercel project. Every push to `main` deploys to production; pull requests get preview deployments.

- `vercel.json` sets the install command (`npm ci`) and the build command (`npm run build:vercel`).
- `scripts/build-vercel.mjs` writes a [Build Output API v3](https://vercel.com/docs/build-output-api/v3) directory: the Vite client as static files, and one bundled Node.js function (`src/server/vercel.ts`, the same Express app) that serves `/api/*` and `/healthz`. Every other path falls back to `index.html`.
- Health check: `GET /healthz` returns `{"status":"ok"}`.

Environment variables set in the Vercel project:

| Variable                             | Environments        | Purpose                                                                     |
| :----------------------------------- | :------------------ | :-------------------------------------------------------------------------- |
| `SESSION_SECRET`                     | Production, Preview | Signs session cookies (48 random bytes). Stored as a sensitive variable.    |
| `DEMO_MODE`                          | Production, Preview | `true`: seed synthetic data and list the demo accounts on the sign-in page. |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS` | Production          | Passkeys for `fairshift-nine-red.vercel.app`. Off on preview URLs.          |

`NODE_ENV` is not set in the project, because it would also apply to the build and skip the development dependencies the build needs; the function sets it to `production` itself.

Manual deploy from a checkout:

```bash
npx vercel deploy --prod            # remote build using vercel.json
# or build locally and upload the result
npm ci && npm run build:vercel && npx vercel deploy --prebuilt --prod
```

### Data on Vercel: read this before relying on the demo

FairShift stores everything in SQLite. Vercel functions have no durable disk, so the database lives in the function's `/tmp`:

- **Data is temporary.** Each function instance creates its own database and seeds the same synthetic data when it starts. Anything you add (check-ins, reports, photos, passkeys) is lost when the instance is recycled, which happens after idle time and on every deployment.
- **Instances do not share data.** When Vercel runs more than one instance, consecutive requests can reach different databases, so something you just created may briefly be missing. Sign-in still works across instances, because the demo users are identical everywhere and sessions are signed cookies.
- Rate limits and sign-out revocation are per instance.

This is fine for a demonstration with synthetic data and is not suitable for real workers' records. A production deployment needs a managed database; the data access code is confined to `src/server/repositories` and `src/server/services` and uses plain SQL with named parameters. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Containers

The `Dockerfile` builds a two-stage image (Node 24, non-root user) that runs `node dist/server/main.js` on `$PORT`. The same persistence caveat applies to any host without a persistent volume. Instructions are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/DEPLOYMENT_RUNBOOK.md](docs/DEPLOYMENT_RUNBOOK.md).

---

## 10. Configuration reference

All variables are optional in development. See [`.env.example`](.env.example) and [docs/PRODUCTION_CONFIGURATION.md](docs/PRODUCTION_CONFIGURATION.md).

| Variable                                                                        | Default                  | Description                                                                                                             |
| :------------------------------------------------------------------------------ | :----------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                                          | `8080`                   | HTTP port for `main.ts`.                                                                                                |
| `NODE_ENV`                                                                      | unset                    | `production` enables Secure cookies, CSP/HSTS and static file serving.                                                  |
| `SESSION_SECRET`                                                                | ephemeral in demo mode   | At least 32 characters. Required in production unless `DEMO_MODE=true`.                                                 |
| `DEMO_MODE`                                                                     | `false`                  | Seeds synthetic data into an empty database and shows demo accounts.                                                    |
| `DATABASE_PATH`                                                                 | `./data/fairshift.db`    | SQLite file (`/tmp/fairshift.db` on Vercel).                                                                            |
| `RECEIPT_SIGNING_SECRET`, `ACTIVE_RECEIPT_KEY_ID`, `RECEIPT_KEYS_JSON`          | session secret, `v1`     | Work receipt signing key, its ID, and older keys kept for verification after rotation.                                  |
| `CHECKPOINT_SIGNING_SECRET`, `ACTIVE_CHECKPOINT_KEY_ID`, `CHECKPOINT_KEYS_JSON` | session secret, `chk_v1` | The same for Merkle checkpoints.                                                                                        |
| `SIGNAL_PSEUDONYM_SECRET`                                                       | session secret           | Pseudonyms for Safe Signal, independent of session rotation.                                                            |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS`                                            | localhost in dev         | Passkey relying party (domain) and allowed origins, comma-separated. Passkeys are off in production until both are set. |
| `GOOGLE_TTS_API_KEY`                                                            | unset                    | Server voice for read-aloud when a device lacks a language. Restrict the key to the Text-to-Speech API.                 |
| `GOOGLE_VISION_API_KEY`                                                         | unset                    | Advisory photo analysis. Without it, photos go to manual review. Restrict the key to the Vision API.                    |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_CALLBACK_URL`                                | unset                    | Optional Google sign-in.                                                                                                |
| `GITHUB_CLIENT_ID` / `_SECRET` / `_CALLBACK_URL`                                | unset                    | Optional GitHub sign-in.                                                                                                |
| `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_PHONE`  | `none`                   | Optional phone OTP sign-in (`twilio` or `mock`).                                                                        |

Never commit real values: `.env` and `.env.*` (except `.env.example`) are git-ignored. On Vercel, use project environment variables.

---

## 11. Security and privacy

- **Sessions:** HttpOnly, SameSite=Lax, Secure in production, signed with HMAC; 12-hour lifetime. Each user has a session version, so signing out or deactivating a worker revokes every cookie issued before.
- **CSRF:** state-changing requests must be JSON and, when an `Origin` header is present, same-origin.
- **Headers:** Content-Security-Policy, HSTS (production), `Referrer-Policy: same-origin`, a Permissions-Policy that allows the camera and microphone only for this site, no `X-Powered-By`.
- **PINs:** scrypt with a 16-byte random salt and 64-byte key; sign-in attempts are rate limited.
- **Input validation:** every request body and query goes through a Zod schema; request bodies are capped at 32 KB except the photo route (2.2 MB).
- **Photos:** type detected from the bytes (JPEG, PNG, WebP only), size and dimension limits, metadata (EXIF including GPS, XMP, IPTC, text chunks) removed on the server, no file names kept, served only to the reporter and the same organisation's administrators with `no-store` caching. Photos of reports verified more than a year ago are deleted automatically.
- **Confidential reports:** no reporter ID in the report, its photos or its audit entries.
- **Passkeys:** challenges bound to the user and the action (check-in or check-out), valid for five minutes and deleted on first use; origin and RP ID taken from configuration, never from the `Host` header; user verification required; signature, counter, ownership and revocation checked. Only the public key is stored.
- **CSV exports** neutralise spreadsheet formulas.
- **Audit log:** append-only record of corrections, status changes, passkey changes and administrative actions.

Details: [docs/SECURITY.md](docs/SECURITY.md), [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md).

---

## 12. Testing and quality checks

```bash
npm run check     # format, lint, typecheck, tests
npm run build     # production builds
```

The suite has **44 test files and 381 tests**, covering:

- **Domain logic:** payroll and overtime, the Money Jar, heat index tiers, fatigue rules, Merkle proofs, receipt canonicalisation, Safe Signal suppression, the accountability state machine.
- **API workflows:** sign-in, attendance, payslips, reports from submission to verified outcome, two-key closure and escalation, feedback, skills, CSV export.
- **Security:** tenant isolation, session revocation, CSRF, rate limits, CSV injection, photo validation and metadata removal, tampered evidence detection, confidential reporter anonymity.
- **Passkeys:** replayed assertions, expired challenges, wrong action, wrong origin or RP ID, tampered signatures, counter rollback, revoked or foreign passkeys.
- **Client:** read-aloud voice selection, sentence splitting and failure states, translation coverage across all six locales, design tokens, components.

CI (`.github/workflows/ci.yml`) runs `npm ci`, the format check, lint, typecheck, tests, the production build and `npm audit --omit=dev` on every push to `main` and every pull request.

---

## 13. Known limitations

- **No durable database on the hosted demo** (see [Deployment](#data-on-vercel-read-this-before-relying-on-the-demo)). The demo uses synthetic data only.
- **Optional providers are not configured on the demo:** server read-aloud voice (Google Cloud Text-to-Speech) and advisory photo analysis (Google Cloud Vision). Both were tested against recorded or mocked provider responses, not the live services. Without them, read-aloud uses the device's own voices and photos go to manual review.
- **Passkeys** were tested with software and browser virtual authenticators, not on physical phones, and only work on the production domain they are configured for.
- **Read-aloud** depends on the voices installed on the device; it was tested in Microsoft Edge on Windows.
- **Photo analysis** is label-based and advisory; before/after comparison is for a person to judge. Photos are not yet included in Merkle checkpoints.
- Rate limits are per server instance.

---

## 14. Further documentation

| Topic                               | Document                                                                                                                                                                               |
| :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Latest release (V5)                 | [docs/V5_FINAL_RELEASE_REPORT.md](docs/V5_FINAL_RELEASE_REPORT.md)                                                                                                                     |
| Deployment and persistence          | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/DEPLOYMENT_RUNBOOK.md](docs/DEPLOYMENT_RUNBOOK.md), [docs/PRODUCTION_CONFIGURATION.md](docs/PRODUCTION_CONFIGURATION.md)               |
| Security and authentication         | [docs/SECURITY.md](docs/SECURITY.md), [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md)                                                                                                 |
| FairShift Proof                     | [docs/FAIRSHIFT_PROOF.md](docs/FAIRSHIFT_PROOF.md), [docs/V32_INDEPENDENT_PROOF_ARCHITECTURE.md](docs/V32_INDEPENDENT_PROOF_ARCHITECTURE.md)                                           |
| Safe Signal                         | [docs/SAFE_SIGNAL.md](docs/SAFE_SIGNAL.md)                                                                                                                                             |
| Accountability Loop                 | [docs/ACCOUNTABILITY_LOOP.md](docs/ACCOUNTABILITY_LOOP.md), [docs/V32_ACCOUNTABILITY_TRUST_MODEL.md](docs/V32_ACCOUNTABILITY_TRUST_MODEL.md)                                           |
| Earnings, Money Jar, dispute notice | [docs/V41_WORKER_EARNINGS_EXPERIENCE.md](docs/V41_WORKER_EARNINGS_EXPERIENCE.md), [docs/V41_WAGE_DISPUTE_ASSISTANCE.md](docs/V41_WAGE_DISPUTE_ASSISTANCE.md)                           |
| Heat safety                         | [docs/V41_ENVIRONMENTAL_SAFETY.md](docs/V41_ENVIRONMENTAL_SAFETY.md)                                                                                                                   |
| Localisation                        | [docs/V41_LOCALIZATION.md](docs/V41_LOCALIZATION.md)                                                                                                                                   |
| Design system and UI                | [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md), [docs/UI_UX_REPORT_V4.2.md](docs/UI_UX_REPORT_V4.2.md), [docs/GLASSMORPHISM_V2_FINAL_REPORT.md](docs/GLASSMORPHISM_V2_FINAL_REPORT.md) |
| Engineering audit (V4.1)            | [docs/V41_ENGINEERING_AUDIT.md](docs/V41_ENGINEERING_AUDIT.md)                                                                                                                         |
| Demo script                         | [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)                                                                                                                                             |
| Roadmap                             | [docs/FAIRSHIFT_FEATURE_GAP_ROADMAP.md](docs/FAIRSHIFT_FEATURE_GAP_ROADMAP.md), [docs/CONTRACTOR_SUBCONTRACTOR_PROPOSAL.md](docs/CONTRACTOR_SUBCONTRACTOR_PROPOSAL.md)                 |

---

## 15. License

[MIT](LICENSE).
