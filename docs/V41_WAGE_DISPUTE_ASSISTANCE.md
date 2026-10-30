# FairShift V4.1 — Worker Labour Dispute Notice Assistance

**Document Version:** 4.1.0  
**Feature:** Worker Wage Discrepancy Notice Generator  
**Primary Users:** Frontline construction workers and campus support staff  
**Component Paths:**

- [`src/domain/dispute.ts`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/domain/dispute.ts)
- [`src/client/components/DisputeNoticeModal.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/DisputeNoticeModal.tsx)
- [`src/client/pages/worker/Payslips.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/pages/worker/Payslips.tsx)

---

## 1. Product Context & Real-World Utility

When frontline workers face wage underpayment, missing overtime compensation, or arbitrary deductions, they rarely have access to legal counsel, and handwritten complaints are often ignored by contractors or supervisors.

The **Worker Labour Dispute Notice Generator** empowers workers to generate a structured, factual wage discrepancy notice backed by:

1. Verifiable timecard attendance records (regular, overtime, and total hours).
2. Agreed wage terms (contracted hourly rate and scheduled shift duration).
3. Employer details and formal pay periods.
4. Record references: the payslip ID and status (and a sealed shift receipt only when one is genuinely supplied).
5. The worker's own editable statement of the factual discrepancy.

---

## 2. Statutory Grounding & Legal Safeguards

### Mandatory Non-Representation Disclaimer

The generator strictly avoids claiming legal authority or statutory certification:

> _"IMPORTANT NOTICE: This document is a worker-generated factual wage discrepancy statement derived from recorded timecard entries and FairShift cryptographic work receipts. It does not constitute formal legal representation, statutory certification, or legal advice. In the event of unresolved wage disputes, workers are advised to approach relevant labor conciliation authorities or legal aid institutions."_

### Statutory Context (corrected in the final engineering audit)

The previous text presented the Payment of Wages Act, 1936, the Minimum Wages Act, 1948 and the Code on Wages, 2019 as if all three currently applied side by side, and asserted that overtime is "commonly 1.5× to 2×". Both claims were removed.

What the generated notice now says, and the source for each statement:

| Statement in notice                                                                                                                    | Source                                                                                        | Verification status                                                                       |
| :------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| Principal provisions of the Code on Wages, 2019 in force from 21 November 2025                                                         | Ministry of Labour and Employment notification S.O. 5322(E) (labour.gov.in, gazette reprints) | Confirmed via the notification text cited by multiple sources                             |
| Section 69 of the Code repeals the Payment of Wages Act, 1936 and the Minimum Wages Act, 1948, subject to savings                      | Code on Wages, 2019, s. 69 (India Code)                                                       | Confirmed via secondary sources; the India Code PDF could not be fetched during the audit |
| Earlier matters may still fall under the old Acts; applicability depends on employment, establishment and appropriate-Government rules | Savings clause and structure of the Code                                                      | General statement, deliberately non-specific                                              |

Deliberately **not** stated in the notice: overtime multipliers (s. 14 reportedly sets not less than twice the normal rate for covered employees), the deduction ceiling (s. 18 reportedly caps total deductions at 50% of wages), limitation periods, or claim authorities' jurisdiction. These depend on facts the tool does not collect, and their exact enacted wording was only checked against secondary summaries. Workers are directed to the Labour Department (Inspector-cum-Facilitator) or a District Legal Services Authority.

The notice also no longer:

- pre-fills a worker statement asserting non-payment (the field starts empty);
- claims the full net pay as the "outstanding" amount (shown as "Not specified (see worker statement)" unless an amount is supplied);
- prints a fabricated receipt ID (`rcpt_` + payslip ID) or the placeholder `AUTHENTICATED_BY_FAIRSHIFT_LEDGER` — it references the payslip and its issued/estimate status instead;
- labels unknown contact details as "On Record (Verified)" or deductions under dispute as "Authorized";
- encodes the net pay (in hex) in the notice reference.

---

## 3. Worker Privacy & Data Boundary Guarantees

1. **Zero Deanonymization of Confidential Safety Reports**:
   - The notice generator strictly queries employment attendance and payroll receipts.
   - It **never** queries or exposes the worker's confidential hazard reports (`safety_reports` where `confidential: true` or `reporter_ref`), preventing adverse employer retaliation.
2. **Minimal Data Scope**:
   - Only data necessary to identify the employment relationship and the specific wage discrepancy is included (Worker Name, Phone, Job Title, Organization, Dates, Hours, Amounts).
   - Internal authentication metadata (`pin_hash`, session secrets) is excluded.

---

## 4. Multi-Format Output: Print, PDF & Plain Text

Workers can:

1. **Review & Edit Statement**: Workers select a categorized issue (Unpaid Net Wages, Underpaid Overtime, Unauthorized Deductions, Rate Mismatch, Hours Discrepancy) and edit their factual explanation.
2. **Print / Save as PDF**: Formatted via `@media print` with an official letterhead layout, clean typography, signature space, and cryptographic hashes.
3. **Download Text File (`.txt`)**: A clean UTF-8 text notice formatted for sharing via SMS, WhatsApp, or trade union representatives.

---

## 5. Verification Evidence

Automated domain tests in [`tests/unit/dispute-notice.test.ts`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/tests/unit/dispute-notice.test.ts) verify:

- Complete notice generation with accurate INR figures and time summaries.
- Inclusion of mandatory non-representation disclaimer and statutory context.
- Minimum statement length validation (minimum 10 characters).
- Required field validation (worker and employer name).
- Strict data privacy and zero leakage of confidential safety metadata.
