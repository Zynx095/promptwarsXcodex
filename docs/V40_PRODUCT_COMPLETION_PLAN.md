# FairShift V4.0 Product Completion Plan & Feature Inventory Matrix

## Executive Summary

FairShift is a workforce transparency and workplace safety platform designed for frontline organizations. Across versions V1.0 to V3.2, FairShift established foundational pillars:

1. **FairShift Proof**: Cryptographically sealed, version-chained work and earnings receipts anchored into binary Merkle trees.
2. **Safe Signal**: Privacy-conscious recurring workplace hazard detection with k-anonymity cohort suppression and temporal differencing protection.
3. **Accountability Loop**: Transparent multi-stage safety resolution lifecycle with independent verification and separation of duties.

**FairShift V4.0** transforms these technical innovations from isolated capabilities into a **unified, cohesive, production-ready Release Candidate (RC)**. This document establishes the complete feature inventory, identifies all workflow discontinuities, and charts the engineering path to release readiness.

---

## 1. Feature Inventory Matrix

| Feature / Subsystem            | Status                     | Description & Current Gap                                                                           | Target Action in V4.0                                                                             |
| :----------------------------- | :------------------------- | :-------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ |
| **Authentication & Sessions**  | Complete & Verified        | Passwordless phone OTP, Google OAuth 2.0 PKCE, session rotation, brute-force lockouts.              | Maintain existing security invariants; expose user status guards.                                 |
| **Worker Dashboard**           | Implemented but Incomplete | Quick check-in/out, hours summary, fatigue alert widgets.                                           | Connect real-time receipts, unread in-app notifications, and safety status.                       |
| **Shift Check-in / Check-out** | Complete & Verified        | Geofence validation, site codes, open shift locking, automatic canonical receipt issuance.          | Add live status indicators and check-in confirmation toast.                                       |
| **FairShift Proof Receipts**   | Complete & Verified        | HMAC-SHA256 sealing, version diffs, Merkle inclusion proofs, finalized locking.                     | Add plain-language receipt summary, proof bundle export, and auditor verification page.           |
| **Attendance History**         | Implemented but Incomplete | Basic shift table and earnings summary.                                                             | Add date range filtering, shift pagination, status badges (Estimated vs Finalized).               |
| **Worker Payslips**            | Implemented but Incomplete | Interactive breakdown of regular/overtime wages and deductions.                                     | Add print-friendly `@media print` layout and PDF-ready styling.                                   |
| **Workforce Administration**   | Partially Implemented      | List workers, edit hourly rates. Missing worker onboarding and deactivation.                        | Implement `POST /api/admin/workers` and `PATCH /api/admin/workers/:id/status` with UI controls.   |
| **Site Administration**        | Missing                    | Sites are referenced in shifts and hazard reports, but no admin UI or API exists to manage sites.   | Implement `GET /api/admin/sites`, `POST /api/admin/sites`, site codes, and campus mode switches.  |
| **Shift Correction Workflow**  | Complete & Verified        | Admin shift adjustment with mandatory audit reasons, v1->v2 receipt chaining.                       | Connect to in-app worker notifications on correction issuance.                                    |
| **Admin Payroll Management**   | Partially Implemented      | Pay period calculation, payslip issuance. Missing bulk CSV export.                                  | Implement `GET /api/admin/payslips/export.csv` with tenant isolation and audit logging.           |
| **Hazard Reporting**           | Complete & Verified        | Worker hazard reporting (public/confidential), media attachment placeholders.                       | Link report lifecycle status changes to in-app notifications for the worker.                      |
| **Safe Signal Engine**         | Complete & Verified        | In-memory pseudonym hashing, cohort threshold ($\ge 3$), temporal cache differencing defense.       | Ensure dashboard integration surfaces active signals with site filtering.                         |
| **Accountability Loop**        | Complete & Verified        | Acknowledged -> Resolved -> Follow-up -> Verified lifecycle with separation of duties.              | Surface overdue follow-up tags, verification badges, and next-step actions in admin queue.        |
| **In-App Notification Center** | Missing                    | Fatigue alerts exist, but no centralized notification hub for pay, corrections, and safety updates. | Create `notifications` schema, worker/admin notification bell UI, and automated triggers.         |
| **Kannada Localization**       | Partially Implemented      | High coverage in worker check-in and dashboard; missing keys in newer V3.2 views.                   | Complete translation dictionary in `i18n.tsx`, prevent text clipping, support bilingual toggling. |
| **Production Durability**      | Complete & Verified        | Hardened Dockerfile, non-root user, SQLite atomic backups (`VACUUM INTO`), WAL mode.                | Provide deployment runbooks, volume mount guides, and backup restoration procedures.              |

---

## 2. End-to-End Workflow Integration Architecture

### A. The Work-to-Earnings Workflow

```
[Worker Check-In]
       │ (Site Code Verified)
       ▼
[Shift In-Progress] ──► [Worker Check-Out]
                               │
                               ▼
                   [Canonical Shift Record Created]
                               │
                               ▼
               [FairShift Proof Receipt Generated (v1)]
               • Canonical HMAC-SHA256 signature
               • Added to Merkle tree leaf batch
               • "Estimated Pay" status badge
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
[Shift Correction (Optional)]           [Payroll Finalization]
• Admin submits reason                  • Admin issues payslip
• Shift version bumps (v2)              • Shift mutations locked
• Chained receipt created               • Receipt status: "Finalized"
• Worker notified via In-App Bell       • Worker views print-ready slip
                                        • Admin exports payroll CSV
```

### B. The Safety & Accountability Workflow

```
[Worker Reports Hazard]
       │ (Confidential or Identified)
       ▼
[Safe Signal Engine Evaluates]
       │ • Anonymized pseudonym hashing
       │ • Min-cohort check (k >= 3)
       │ • Cache snapshot differencing defense
       ▼
[Safety Admin Dashboard Alert]
       │
       ▼
[Accountability Loop Stage Transitions]
 1. Acknowledged (SLA timer starts)
 2. In Progress (Corrective action planned)
 3. Resolved (Action notes logged)
 4. Follow-up Scheduled (Verification target set)
 5. Outcome Verified (Independent auditor or safety lead sign-off)
       │
       ▼
[Worker In-App Notification]
Worker tracks transparent resolution notes; can reopen if hazard recurs.
```

---

## 3. Engineering Implementation Phases

### Phase 1: Planning & Baseline Verification (Completed)

- Feature inventory, gap identification, baseline test verification (28 test files, 240 tests passing).

### Phase 2: In-App Notification System

- Database schema migration: `notifications` table (`id`, `org_id`, `user_id`, `title`, `body`, `link`, `read`, `created_at`).
- Repository and service implementation with tenant isolation.
- API endpoints: `GET /api/notifications/mine`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`.
- Event hooks: Shift corrections, payslip generation, hazard report state changes.
- UI: Notification bell icon with unread badge in worker and admin navigation bars.

### Phase 3: Complete Workforce & Site Management

- Admin worker creation: `POST /api/admin/workers` (name, phone/email, role, hourly rate).
- Admin worker status management: `PATCH /api/admin/workers/:id/status` (active / inactive toggle).
- Organization site administration: `GET /api/admin/sites`, `POST /api/admin/sites` (name, code, address, active status).
- Worker roster UI with status filters and site assignment.

### Phase 4: Administrative Payroll Export & Print-Friendly Payslips

- Administrative CSV export: `GET /api/admin/payslips/export.csv` with tenant isolation.
- Worker payslip print view: `@media print` clean layout removing navigation, sidebars, and interactive buttons.

### Phase 5: Receipt Polish & Independent Verification Architecture

- Enhance `ReceiptView.tsx`: Plain-language explanation for workers alongside technical cryptographic proofs.
- Verify checkpoint signature isolation: Document HMAC-SHA256 checkpoint verification and ensure no private secrets enter client bundles.
- Provide self-contained bundle export for external auditor verification.

### Phase 6: Bilingual & Multi-Industry Polish

- 100% Kannada dictionary coverage across all screens and notification templates.
- Industry toggles: Campus Support Services vs Industrial Construction phrasing.
- Touch target sizing ($\ge 44\text{px}$) and WCAG AA contrast validation.

### Phase 7: Verification, Documentation & Release Candidate Packaging

- Integration tests covering all new workflows (notifications, worker provisioning, site management, payroll export).
- End-to-end demonstration script (`docs/DEMO_SCRIPT.md`).
- Release checklist, deployment runbook, and production configuration guide.
- Complete quality gate audit (`format`, `lint`, `typecheck`, `test`, `build`).

---

## 4. Non-Negotiable Operational Rules

1. **Never touch or delete `pitch-preparation/`**: This untracked user directory must remain untouched.
2. **Never push to remote or rewrite Git history**: All work must be recorded as atomic, granular conventional commits on local `main`.
3. **No Mock Metrics or Faked Business Logic**: All counts, signals, Merkle proofs, and receipts must be genuinely computed from real application state.
4. **Glassmorphism V2 Consistency**: Strict adherence to Ice Silver (`#DDE3E8`), Deep Aubergine (`#3A0F34`), and Marigold (`#EAAA00`).
