# FairShift Proof — Verifiable Work & Earnings Receipts

## 1. Overview & Objective

**FairShift Proof** introduces versioned, tamper-evident work receipts that connect recorded attendance timestamps, applicable organization pay rules, and explainable earnings calculations.

For daily wage and shift workers in employee-intensive environments, dispute over hours worked or overtime calculation is a primary driver of distrust and attrition. FairShift Proof addresses this by issuing an immediate, immutable cryptographic receipt upon shift completion and versioning any subsequent administrative adjustments.

---

## 2. Core Principles & Workflow

1. **Automatic Receipt Generation**:
   - When a worker checks out (`POST /api/attendance/check-out`), a version 1 (`v1`) receipt is immediately generated with status `'estimated'`.
   - The recognized duration, regular minutes, overtime minutes, applicable base rate, and overtime multiplier are calculated via the pure domain logic in [`src/domain/proof.ts`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/domain/proof.ts) using [`src/shared/money.ts`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/shared/money.ts).
   - A cryptographic SHA-256 HMAC digest is computed over the canonical representation of the receipt data.

2. **Transparent Calculation Breakdown**:
   - The receipt displays how every rupee was calculated:
     - Regular hours: `regularMinutes × hourlyRateMinor`
     - Overtime hours: `overtimeMinutes × hourlyRateMinor × (multiplierBp / 10000)`
     - Total shift gross earnings: `basePayMinor + overtimePayMinor`
   - Formulas are never duplicated on the frontend; the receipt JSON payload serves as the canonical record.

3. **Versioned Corrections**:
   - When an administrator corrects a shift (`PATCH /api/admin/shifts/:id`), the system **never** overwrites the historical receipt.
   - Instead, the previous version (`vN`) is preserved intact, and an incremented version (`v(N+1)`) is created.
   - The new version records:
     - `previous_version_id`: foreign key to the predecessor receipt.
     - `correctionReason`: mandatory justification provided by the administrator.
     - `correctionDiff`: structured before/after comparison of check-in, check-out, duration, overtime, and gross earnings delta.
   - Workers can inspect any historical version and see exactly who corrected the shift, when, why, and what financial delta resulted.

4. **Estimated vs. Finalized Lifecycle**:
   - Newly completed shifts bear the status `'estimated'`.
   - When an employer issues an immutable payslip covering the pay period (`POST /api/admin/payslips`), all shift receipts within that window are marked `'finalized'`.

---

## 3. Cryptographic Integrity & Canonicalization

### Canonical JSON Serialization

To ensure that the cryptographic digest is deterministic and unaffected by key ordering differences in JavaScript runtimes or database drivers, [`canonicalizeJson`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/domain/proof.ts#L47-L59) performs recursive alphabetical key sorting:

```typescript
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map((k) => JSON.stringify(k) + ':' + canonicalizeJson((obj as Record<string, unknown>)[k]));
  return '{' + entries.join(',') + '}';
}
```

### Digest Computation

```typescript
export function computeReceiptDigest(secret: string, data: CanonicalReceiptData): string {
  const canonicalString = canonicalizeJson(data);
  return createHmac('sha256', secret).update(canonicalString).digest('hex');
}
```

### Threat Model & Verification Limits

- **What the Digest Guarantees**:
  - **Tamper Evidence**: Any modification to timestamps, durations, rates, overtime multipliers, or earnings in the database invalidates the digest.
  - **Client-Side Verification**: Workers and administrators can click "Verify integrity" to test that `verifyReceiptDigest(secret, data, canonical_digest)` returns true.
- **What the Digest Does NOT Guarantee**:
  - A plain HMAC digest relies on the server's `SESSION_SECRET`. An operator with direct read/write access to both the SQLite database file and the `SESSION_SECRET` environment variable could theoretically alter a record and recompute its HMAC.
  - As noted in FairShift's security documentation, absolute non-repudiation against an adversarial infrastructure operator would require asymmetric hardware signing keys (e.g. Cloud KMS asymmetric keys or WebAuthn hardware attestations).

---

## 4. API Endpoints

| Method | Endpoint                       | Authorization              | Description                                                          |
| ------ | ------------------------------ | -------------------------- | -------------------------------------------------------------------- |
| `GET`  | `/api/receipts/shift/:shiftId` | Worker (own) / Admin (org) | Returns current latest receipt and complete historical version list. |
| `GET`  | `/api/receipts/:id`            | Worker (own) / Admin (org) | Retrieves specific receipt version with computed verification flag.  |
| `GET`  | `/api/receipts/:id/verify`     | Worker (own) / Admin (org) | Verifies cryptographic integrity of the receipt against its digest.  |

---

## 5. Automated Test Coverage

The feature is comprehensively verified by automated tests:

- [`tests/unit/proof.test.ts`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/tests/unit/proof.test.ts):
  - Deterministic key canonicalization.
  - Cryptographic HMAC-SHA256 digest calculation.
  - Tamper detection on modified gross pay, durations, and timestamps.
  - Regular shift earnings calculations.
  - Overtime calculations exceeding daily scheduled quotas.
  - Accumulation of prior shifts on the same calendar day.
  - Structured version diff generation.
- [`tests/integration/proof.test.ts`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/tests/integration/proof.test.ts):
  - End-to-end receipt generation on worker check-out.
  - Version increment (`v1 -> v2`) and diff recording on administrative shift correction.
  - Historical version preservation.
  - Database tamper detection causing `verified: false`.
  - Worker privacy and tenant isolation (Worker A cannot read Worker B's receipt; Admin cannot read other org's receipts).
  - Receipt lifecycle transition from `'estimated'` to `'finalized'` upon payslip issuance.
