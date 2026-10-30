# Safe Signal: Advanced Privacy Engineering & Inference Defense

## 1. Executive Summary & Privacy Threat Model

FairShift provides **Confidential Safety Reporting** and **Safe Signal** automated hazard pattern detection. The fundamental privacy guarantee of Safe Signal is:

> Supervisors and employers must be able to identify systemic hazard trends without being able to deduce or infer which individual worker submitted a confidential report.

In V3.1, while confidential reports omitted `reporter_id` from the database table, an adversarial investigation revealed three privacy weaknesses:

1. **Secret Coupling:** `reporter_ref` used the HTTP `SESSION_SECRET`. When session cookies were rotated, workers lost lookup access to their past confidential reports.
2. **Lack of Tenant Scoping:** Pseudonyms were derived as `HMAC(secret, "confidential-report:" + userId)`. An adversary observing database dumps across multiple tenant instances could correlate reports from the same worker.
3. **In-Memory Identifiers & Temporal Differencing:** Non-confidential reports passed raw `reporter_id` into internal aggregation memory. Furthermore, an employer querying signals right before and after a shift ended could observe a cohort count increment from 2 to 3, deducing that the worker who just checked out was the reporter.

FairShift V3.2 implements cryptographic and statistical defenses to mitigate these vectors.

---

## 2. Pseudonymization Architecture

```
               +-------------------------------------------------------+
               |                     Report Source                     |
               +-------------------------------------------------------+
                                    │
                                    ├─── Confidential Report
                                    │         │
                                    │         ▼
                                    │    scopedReporterRef(SIGNAL_PSEUDONYM_SECRET, orgId, userId)
                                    │    HMAC-SHA256(secret, "fairshift:confidential-report:" + orgId + ":" + userId)
                                    │         │
                                    │         ▼
                                    │    Stored in database as `reporter_ref` (reporter_id is NULL)
                                    │
                                    └─── Non-Confidential Report
                                              │
                                              ▼
                                         Stored as `reporter_id`
                                              │
                                              ▼
                             ┌───────────────────────────────────┐
                             │    Signal Ingestion Pipeline      │
                             └───────────────────────────────────┘
                                              │
                                              ▼
                        signalAggregationKey(secret, orgId, rawKey)
                        HMAC-SHA256(secret, "fairshift:signal-aggregation:" + orgId + ":" + rawKey)
                                              │
                                              ▼
                                    Opaque In-Memory Token
                             (Zero raw user IDs in domain memory)
```

### Key Protections:

- **Dedicated Secret:** `SIGNAL_PSEUDONYM_SECRET` is independent of `SESSION_SECRET`. Session cookie invalidation or rotation has zero impact on worker report retrieval.
- **Tenant Isolation:** The organization ID (`orgId`) is salted into the pseudonym HMAC. The same worker in two different organizations generates completely distinct pseudonyms.
- **Dual-Mode Backward Compatibility:** The retrieval engine (`listMyReports` and `isMine`) supports both the new scoped pseudonyms and legacy unscoped pseudonyms, ensuring uninterrupted historical access.

---

## 3. Differencing and Inference Attack Defenses

### 3.1 Minimum Cohort Threshold ($k \ge 3$)

No hazard pattern or cluster is surfaced unless at least **3 reports** match the category. Categories with 1 or 2 reports are unconditionally suppressed.

### 3.2 Reporter Diversity Guard ($d \ge 2$)

To defeat Sybil cluster inflation (where one disgruntled worker submits 3 duplicate reports) and single-worker self-exposure, a pattern must contain at least **2 distinct reporter pseudonyms** before surfacing.

### 3.3 Coarse Calendar-Day Time Grouping

Sub-day timestamps (hours, minutes, seconds) are never exposed or grouped in Safe Signal aggregation queries. Time windows operate strictly on local calendar days (`YYYY-MM-DD`), preventing timestamp correlation with shift check-out times.

### 3.4 Stable Snapshot Caching

To prevent supervisors from querying the dashboard continuously before and after a specific shift ends, aggregation responses are cached in a **15-second sliding snapshot buffer**. Rapid micro-queries return identical cached data, defeating real-time delta diffing.

### 3.5 Duplicate Report Suppression

Immediate duplicate submissions by the same pseudonym in the same category within a 15-minute window are deduplicated, preventing accidental cohort inflation.

---

## 4. Privacy Boundaries Across Application Layers

| Layer                  | Worker Identifier Handling                                                              | Privacy Guarantee                                      |
| :--------------------- | :-------------------------------------------------------------------------------------- | :----------------------------------------------------- |
| **Worker Submission**  | Client sends report payload. If `confidential: true`, `reporter_id` is set to `NULL`.   | Raw ID never written to DB for confidential reports.   |
| **Database Storage**   | Only `reporter_ref` (HMAC hash) is stored. Index `idx_reports_ref` is on hashed string. | DB compromise does not reveal reporter identities.     |
| **Domain Aggregation** | All keys hashed with `signalAggregationKey` before domain analysis.                     | Zero `usr_` IDs in heap or stack traces.               |
| **API Response**       | DTO contains aggregated counts, dominant severity, and recommendations.                 | `reporter_ref` and `reporterKey` are strictly omitted. |
| **Audit Trails**       | Confidential report audit events record `actor_id: NULL`.                               | System audit log does not leak confidential reporters. |

---

## 5. Residual Privacy Risks

While cryptographic and architectural defenses protect against digital re-identification, the following physical/contextual limitations remain:

1. **Physical Workplace Observability:** If only one worker was physically present in an isolated area (e.g., sole night shift technician) when a rare localized hazard occurred, an employer might deduce the reporter from real-world context rather than the platform.
2. **Stylometric Identification:** If a worker uses unique phrasing, terminology, or formatting in the free-text description, human readers might recognize the author. FairShift advises workers to keep descriptions factual and concise.
