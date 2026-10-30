# Safe Signal — Privacy-Conscious Recurring Hazard Detection

## 1. Executive Summary

**Safe Signal** is FairShift's privacy-preserving hazard pattern detection engine. It enables site supervisors, facility managers, and enterprise safety officers to identify systemic safety risks, persistent unresolved hazards, and escalating severity trends without compromising the confidentiality of reporting workers.

By coupling deterministic pattern detection with k-anonymity cohort suppression, Safe Signal transforms isolated frontline worker observations into prioritized, actionable safety interventions.

---

## 2. The Core Tension: Collective Safety vs. Individual Privacy

In high-risk industries (construction, manufacturing, heavy facilities, sanitation), safety reporting is vulnerable to two opposing failure modes:

1. **Silence from Fear of Retaliation**: If workers believe reporting a hazard will expose their identity to immediate supervisors, they withhold reports, leading to preventable accidents.
2. **Action Paralysis from Fragmented Reports**: When reports are anonymous or confidential, supervisors may treat each report as an isolated fluke rather than recognizing a systemic equipment defect, improper procedure, or compromised structural element.

Safe Signal resolves this tension by providing **cohort-level pattern visibility** with cryptographic and architectural privacy guarantees.

---

## 3. Privacy Architecture & Guarantees

### 3.1 Minimum Cohort Suppression ($k \ge 3$)

- Safe Signal enforces a strict cohort threshold: `SAFE_SIGNAL_MIN_COHORT = 3`.
- Any category, cluster, or potential pattern with fewer than 3 reports (after 15-minute duplicate removal) **or** fewer than 2 distinct reporter pseudonyms (`SAFE_SIGNAL_MIN_DISTINCT_REPORTERS`) is suppressed. Both thresholds are applied by every rule in `analyzeSafeSignals`.
- This reduces, but does not eliminate, "singling-out" risk. k ≥ 3 is a suppression threshold, not an anonymity guarantee: a supervisor who already knows who works in an area, or who compares the signal list before and after a single new report, can still narrow down a reporter using context outside FairShift.
- Signals only aggregate reports that administrators can already open individually in the report list; they never add reporter identity. The privacy protection for confidential reporters is that no reporter identifier is stored for them at all (see 3.2), not the cohort threshold.

### 3.2 Identifier Isolation

- Database queries executed by the Safe Signal aggregation service (`src/server/services/signal.ts`) explicitly exclude:
  - `reporter_id` (foreign key to users table)
  - `reporter_ref` (pseudonymous session reference)
  - Worker names, phone numbers, or job titles
  - Granular submission seconds/milliseconds (dates are evaluated within macro-windows)
- The resulting `SafeSignalDTO` objects contain only aggregated counts, severity distributions, and macro status summaries.

### 3.3 Strict Multi-Tenant Partitioning

- All pattern aggregation queries enforce an unconditional `org_id = @orgId` clause.
- Integration tests verify that hazard clusters in one organization (e.g., Construction Site Alpha) are completely invisible to other tenant organizations (e.g., Campus Support Beta).

---

## 4. Detection Rules & Algorithms

Safe Signal uses pure deterministic evaluation functions (`src/domain/signal.ts`) rather than opaque heuristic models. This ensures transparency, reproducibility, and auditability.

### 4.1 Rule 1: Category Cluster (`category_cluster`)

- **Trigger**: $\ge 3$ reports in the same hazard category within a rolling 30-day window.
- **Severity Level**: Assigned as the maximum severity observed across the cluster.
- **Confidence**:
  - `recurrent_hazard`: 4 or more reports, or 3 reports containing critical/high severities.
  - `possible_pattern`: 3 reports of low/medium severity.
- **Recommended Actions**:
  - Perform immediate inspection of equipment or work areas associated with the category.
  - Convene a 10-minute toolbox talk with relevant shift crews.
  - Review preventative maintenance and inspection logs.

### 4.2 Rule 2: Persistent Unresolved Hazards (`persistent_unresolved`)

- **Trigger**: $\ge 3$ reports in a category that remain in `submitted`, `acknowledged`, or `in_progress` status for more than 14 days without reaching resolution.
- **Severity Level**: High or Critical.
- **Confidence**: `recurrent_hazard`.
- **Recommended Actions**:
  - Review open reports in this category with the site safety director.
  - Allocate maintenance budget or engage third-party contractors if parts are pending.
  - Establish temporary safety barriers or exclusion zones until permanently addressed.

### 4.3 Rule 3: Severity Escalation (`severity_escalation`)

- **Trigger**: A hazard category where early reports (within 30 days) were low or medium severity, but the most recent reports (within the last 7 days) escalated to high or critical severity.
- **Severity Level**: Critical.
- **Confidence**: `recurrent_hazard`.
- **Recommended Actions**:
  - Halt operations in affected work areas until verified safe.
  - Investigate why earlier low-severity warnings did not prevent escalation.
  - Inspect physical equipment or structural elements for compounding failure.

---

## 5. User Interface Integration

Safe Signal is integrated directly into the employer's operational workflow:

1. **Safety Report Queue (`/admin/reports`)**:
   - A collapsible **Safe Signal Banner** sits at the top of the queue.
   - Displays all active patterns with visual severity badges, cohort threshold indicators, and status breakdowns.
   - Includes a **"Filter Queue"** action button that instantly filters the underlying report table to the affected category, allowing the administrator to triage individual reports without losing context.
2. **Workforce Dashboard (`/admin/dashboard`)**:
   - High-level safety metrics link directly to filtered queue views.
   - Unresolved critical counts alert management to active risks.

---

## 6. Threat Model & Operational Limitations

| Threat / Risk                          | Safe Signal Mitigation                                                                             | Honest Limitation                                                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Re-identification via timing**       | Cohort threshold $\ge 3$; only rolling day windows are analyzed.                                   | If an entire department consists of only 3 workers, all 3 workers must have reported for the pattern to appear. In tiny teams ($< 5$ people), additional administrative caution is advised. |
| **Spam / Report flooding**             | Signals aggregate reports; duplicate flooding does not alter individual shift wages or audit logs. | Malicious actors could theoretically submit synthetic reports to trigger false cluster alerts. Administrators must verify physical site conditions.                                         |
| **Silent hazards**                     | Safe Signal alerts proactively when reports exist.                                                 | Safe Signal cannot detect hazards that no worker has reported. It is a complement to, not a replacement for, scheduled physical safety audits.                                              |
| **Data leakage to unauthorized users** | Enforced role check (`role === 'admin'`) and organization isolation (`org_id`).                    | Non-admin workers are blocked with HTTP 403. Workers only view their own submitted reports.                                                                                                 |

---

## 7. Verification & Test Coverage

Safe Signal is verified through dedicated automated test suites:

- **Unit Tests (`tests/unit/signal.test.ts`)**:
  - Enforces cohort threshold suppression ($< 3$ reports).
  - Validates `category_cluster` detection on $\ge 3$ reports.
  - Tests `persistent_unresolved` detection for aging reports.
  - Verifies severity distribution calculations.
  - Validates deterministic recommended action generation.
- **Integration Tests (`tests/integration/signal.test.ts`)**:
  - End-to-end `GET /api/admin/signals` with database persistence.
  - Strict absence of worker phone numbers, names, or reporter IDs in serialized JSON responses.
  - Multi-tenant boundary isolation between construction and campus organizations.
  - Access control rejection for non-admin sessions (HTTP 403).
