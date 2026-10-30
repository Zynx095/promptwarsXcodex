# FairShift Accountability Loop: Trustworthy Verification & Authority Model

## 1. Executive Summary & Verification Challenge

The FairShift **Accountability Loop** tracks workplace hazards across six explicit lifecycle states:

```
submitted ──> acknowledged ──> in_progress ──> resolved ──> follow_up_pending ──> outcome_verified
     ▲                                            │                   │                  │
     │                                            ▼                   ▼                  │
     └──────────────────────────────────────── reopened ◄─────────────┴──────────────────┘
```

The fundamental trust question addressed in V3.2 is:

> **Can an employer or site supervisor claim that a safety issue was resolved without providing verifiable evidence or obtaining required third-party verification?**

In V3.1, self-verification was tagged with a string label `(Self-verification)`, but was not strictly barred when organizational or legal policy mandated independent safety inspection. V3.2 implements policy-driven separation of duties, mandatory explanatory evidence, and immutable audit history.

---

## 2. Verification Authority & Separation of Duties

### 2.1 Organizational Verification Policy (`requireIndependentVerification`)

Organizations can configure their safety governance policies via `org.settings.safety`:

```json
{
  "safety": {
    "requireIndependentVerification": true
  }
}
```

When `requireIndependentVerification` is enabled:

1. **Self-Verification Disallowed:** The administrator account that recorded the repair (`resolved`) cannot transition the ticket to `outcome_verified`, even if it types a third-party name into `verifiedBy`. A different administrator account must perform the verification; otherwise a `SELF_VERIFICATION_DISALLOWED` domain error is raised. (Before this fix, supplying any `verifiedBy` text bypassed the policy.)
2. **Third-Party Auditor Attestation:** `verifiedBy` records the name of the person or body who inspected the outcome. It is an attestation entered by an administrator, not an authenticated identity.
3. **Transparent Limitation Disclosure:** In organizations without the strict policy enabled, the platform appends `(Self-verification)` when the resolver verifies without naming anyone, and `(recorded by resolving administrator <name>)` when the resolver enters a third-party name, rather than implying independent oversight.

---

## 3. Evidence Integrity & Transition Requirements

Every state transition enforces minimum evidentiary requirements:

| Target Status       | Permitted Source Statuses                                      | Required Evidence / Note                                       | Authority Constraint                        |
| :------------------ | :------------------------------------------------------------- | :------------------------------------------------------------- | :------------------------------------------ |
| `acknowledged`      | `submitted`, `reopened`                                        | Optional note                                                  | Organization Administrator                  |
| `in_progress`       | `acknowledged`, `follow_up_pending`, `reopened`                | Optional note, optional `assignee`                             | Organization Administrator                  |
| `resolved`          | `acknowledged`, `in_progress`, `follow_up_pending`, `reopened` | **Mandatory note** ($\ge 3$ chars) & `actionTaken` description | Repairing Supervisor / Administrator        |
| `follow_up_pending` | `in_progress`, `resolved`                                      | **Mandatory note** ($\ge 3$ chars) & `followUpDate`            | Organization Administrator                  |
| `outcome_verified`  | `resolved`, `follow_up_pending`                                | **Mandatory inspection note** ($\ge 5$ chars)                  | Independent Auditor / Third-Party Inspector |
| `reopened`          | `resolved`, `follow_up_pending`, `outcome_verified`            | **Mandatory note** ($\ge 3$ chars) explaining recurrence       | Worker or Administrator                     |

---

## 4. Reopening & Recurrence Integrity

A common failure mode in enterprise safety software is overwriting historical resolution records when a hazard recurs. FairShift guarantees:

1. **Append-Only Event Ledger:** Every resolution, follow-up, and verification is stored permanently in `report_events` with an immutable server timestamp (`created_at`).
2. **No Data Loss on Reopening:** Transitioning to `reopened` resets `status = 'reopened'` and clears active `resolved_at`/`verified_at` for current metrics, but preserves the complete historical timeline for audits.
3. **Recurrence Metrics:** If a report is resolved and reopened multiple times, `calculateAccountabilityMetrics` tracks the unique reopened report count and factors it into the organization's **Reopen Rate**.

---

## 5. Explicit Accountability Metric Definitions

All metrics presented on admin dashboards and worker views are mathematically grounded:

### 1. Mean Time to Acknowledge (MTTA)

$$\text{MTTA} = \frac{1}{N_{ack}} \sum_{i=1}^{N_{ack}} (\text{acknowledged\_at}_i - \text{created\_at}_i)$$
_Measures average minutes from worker submission until formal administrative intake._

### 2. Mean Time to Recorded Resolution (MTTR)

$$\text{MTTR} = \frac{1}{N_{res}} \sum_{i=1}^{N_{res}} (\text{resolved\_at}_i - \text{created\_at}_i)$$
_Measures average minutes from report creation until the physical repair was recorded._

### 3. Mean Time to Verify Outcome (MTTV)

$$\text{MTTV} = \frac{1}{N_{ver}} \sum_{i=1}^{N_{ver}} (\text{verified\_at}_i - \text{created\_at}_i)$$
_Measures average minutes from report creation until independent physical verification was signed off._

### 4. Outcome Verification Rate

$$\text{Verification Rate} = \frac{N_{verified}}{N_{resolved} + N_{follow\_up\_pending} + N_{verified}} \times 100\%$$
_Measures the proportion of resolved hazards that underwent formal physical outcome verification._

### 5. Reopen Rate

$$\text{Reopen Rate} = \frac{N_{reopened}}{N_{completed\_actions} + N_{reopened}} \times 100\%$$
_Measures recurrence frequency: the proportion of resolved hazards that failed and had to be reopened._

### 6. Overdue Follow-ups

$$N_{overdue} = \left| \{ r \mid r.\text{status} = \text{'follow\_up\_pending'} \land r.\text{follow\_up\_date} < \text{today} \} \right|$$
_Counts scheduled post-repair inspections that have passed their target inspection date._
