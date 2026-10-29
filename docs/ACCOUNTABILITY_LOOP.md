# FairShift Accountability Loop — Transparent Safety Resolution & Follow-Up

## 1. Executive Summary

In traditional workplace incident and ticketing systems, "resolved" is an opaque, one-way dead end. A supervisor clicks "resolved", enters a perfunctory note, and the issue is archived. Frontline workers who raised the hazard have no visibility into what physical action was actually taken, whether the fix was verified, or if anyone followed up. When hazards recur, workers become cynical and stop reporting.

The **FairShift Accountability Loop** replaces this black box with a verifiable, closed-loop resolution workflow:

1. **Explicit Multi-Stage Lifecycle**: Moves beyond binary open/closed states to include scheduled follow-ups (`follow_up_pending`) and independent outcome confirmation (`outcome_verified`).
2. **Mandatory Action Documentation**: Requires recording the specific physical, procedural, or engineering controls implemented.
3. **Audited Verification Records**: Tracks who verified the outcome, when the verification occurred, and what tests or inspections were performed.
4. **Deterministic Accountability Metrics**: Real-time MTTA (Mean Time to Acknowledge), MTTR (Mean Time to Resolve), Verification Rate, Reopen Rate, and Overdue Follow-Up tracking.
5. **Worker Transparency**: Workers see verified outcomes and corrective action details directly on their report status timeline.

---

## 2. Extended Lifecycle State Machine

FairShift models hazard lifecycle transitions using deterministic state machines defined in `src/domain/safety.ts`.

```
                  ┌─────────────┐
                  │  submitted  │
                  └──────┬──────┘
                         │
                         ▼
                  ┌──────────────┐
                  │ acknowledged │
                  └──────┬───────┘
                         │
           ┌─────────────┴─────────────┐
           ▼                           ▼
   ┌─────────────┐              ┌────────────┐
   │ in_progress │─────────────▶│  resolved  │◀──────────────┐
   └──────┬──────┘              └─────┬──────┘               │
          │                           │                      │
          │              ┌────────────┴───────────┐          │
          │              ▼                        ▼          │
          │     ┌─────────────────┐      ┌─────────────────┐ │
          └────▶│follow_up_pending│─────▶│outcome_verified│ │
                └────────┬────────┘      └────────┬────────┘ │
                         │                        │          │
                         ▼                        ▼          │
                  ┌────────────────────────────────────────┐ │
                  │                reopened                │─┘
                  └────────────────────────────────────────┘
```

### 2.1 State Definitions

| State               | Purpose                                                                   | Required Fields on Transition                                                                            |
| ------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `submitted`         | Initial report by worker (confidential or identified).                    | Title, category, severity, location, description.                                                        |
| `acknowledged`      | Administrative triage; safety team or supervisor has reviewed the report. | Assignee (recommended), transition event note.                                                           |
| `in_progress`       | Active repair, procurement, or mitigation underway on site.               | Transition event note.                                                                                   |
| `resolved`          | Immediate physical corrective action has been completed.                  | Mandatory explanatory note (min 3 chars), optional `actionTaken` description.                            |
| `follow_up_pending` | Fix is in place, but scheduled post-repair inspection is pending.         | Mandatory explanatory note, `followUpDate` (target inspection date).                                     |
| `outcome_verified`  | Physical inspection confirmed the hazard is eliminated or controlled.     | Mandatory explanatory note, `verifiedBy` (auditor name), `verificationNote`.                             |
| `reopened`          | Hazard recurred or post-repair inspection failed.                         | Mandatory explanatory note explaining why the fix failed. Clears previous `resolvedAt` and `verifiedAt`. |

---

## 3. Concrete Resolution & Verification Records

When a safety report progresses through the Accountability Loop, the platform captures structured verification metadata stored in the `safety_reports` table:

```sql
ALTER TABLE safety_reports ADD COLUMN action_taken TEXT;
ALTER TABLE safety_reports ADD COLUMN follow_up_date TEXT;
ALTER TABLE safety_reports ADD COLUMN verified_at TEXT;
ALTER TABLE safety_reports ADD COLUMN verified_by TEXT;
ALTER TABLE safety_reports ADD COLUMN verification_note TEXT;
```

### 3.1 Corrective Action Tracking (`action_taken`)

Admins record the physical intervention:

- _Example_: `"Replaced flexible tie wire with 48mm steel scaffold column clamps and installed toe boards on Level 3."`

### 3.2 Scheduled Follow-Up (`follow_up_date`)

Sets a target calendar date for physical re-inspection:

- _Example_: `"2026-10-31"` (48 hours after concrete pour or anchor installation).
- Automatically tracked for overdue status against current local date.

### 3.3 Formal Outcome Verification (`verified_at`, `verified_by`, `verification_note`)

Formal sign-off by a qualified inspector or safety auditor:

- _Example_:
  - `verifiedBy`: `"Suresh Rao (Third-party Safety Auditor)"`
  - `verificationNote`: `"Torque test passed at 50 Nm. Zero deflection under gust wind conditions. Complies with IS 4014."`

---

## 4. Deterministic Accountability Metrics

The pure domain function `calculateAccountabilityMetrics` (`src/domain/accountability.ts`) processes all organization safety reports and audit events into real-time metrics:

| Metric                              | Formula                                                                                                               | Significance                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **MTTA (Mean Time to Acknowledge)** | $\frac{1}{N} \sum (\text{acknowledged\_at} - \text{created\_at})$                                                     | Measures management responsiveness to worker safety alerts.                        |
| **MTTR (Mean Time to Resolve)**     | $\frac{1}{N} \sum (\text{resolved\_at} - \text{created\_at})$                                                         | Measures operational turnaround speed for hazard mitigation.                       |
| **Verification Rate**               | $\frac{\text{outcome\_verified}}{\text{resolved} + \text{follow\_up\_pending} + \text{outcome\_verified}} \times 100$ | Quantifies the rigor of post-repair validation. Prevents "paper-only" resolutions. |
| **Reopen Rate**                     | $\frac{\text{reopened\_reports}}{\text{resolutions} + \text{reopened\_reports}} \times 100$                           | Measures fix durability. A high reopen rate signals rushed, superficial repairs.   |
| **Overdue Follow-Ups**              | $\text{count}(\text{follow\_up\_pending} \land \text{follow\_up\_date} < \text{today})$                               | Identifies scheduled safety checks that have lapsed.                               |

Admins view these metrics directly on the **Workforce Dashboard** (`/admin/dashboard`) under the **Safety & Accountability Loop** section.

---

## 5. Frontline Worker Transparency

Frontline workers retain complete visibility into the resolution lifecycle for their submitted reports (`/reports/:id`):

- **Full History Timeline**: Displays every status change, timestamps, and actor role without exposing administrative internal notes.
- **Action Taken Box**: Workers can read the exact physical fix executed by site maintenance.
- **Verification Seal**: A green **Outcome Verified** badge confirms that an auditor or supervisor confirmed the fix before the issue was closed.
- **Confidentiality Preserved**: When workers submit confidentially, their identity remains hidden from administrators, but the worker still receives full resolution transparency.

---

## 6. Verification and Automated Test Coverage

The FairShift Accountability Loop is rigorously tested across unit and integration test suites:

- **Unit Tests (`tests/unit/accountability.test.ts`)**:
  - Full path validation: `submitted -> acknowledged -> in_progress -> resolved -> follow_up_pending -> outcome_verified`.
  - Reopening from `follow_up_pending` and `outcome_verified`.
  - Rejection of invalid shortcuts and state skipping.
  - Note requirement enforcement for all consequential lifecycle transitions.
  - Zero/null edge-case handling for organizations with no prior reports.
  - Mathematical precision of MTTA, MTTR, Verification Rate, Reopen Rate, and Overdue calculations.
- **Integration Tests (`tests/integration/accountability.test.ts`)**:
  - End-to-end API execution of the multi-stage lifecycle across worker and admin sessions.
  - Resolution action and outcome verification persistence in SQLite.
  - Transparent worker report retrieval verifying all corrective action and verification fields.
  - Reopen workflow clearing `resolvedAt` and `verifiedAt` and updating metrics.
  - Multi-tenant data isolation and non-admin authorization enforcement (HTTP 403).
