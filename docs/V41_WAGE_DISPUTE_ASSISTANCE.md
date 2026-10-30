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
4. Cryptographic Proof hashes (HMAC-SHA256 canonical digest and receipt reference).
5. The worker's own editable statement of the factual discrepancy.

---

## 2. Statutory Grounding & Legal Safeguards

### Mandatory Non-Representation Disclaimer

The generator strictly avoids claiming legal authority or statutory certification:

> _"IMPORTANT NOTICE: This document is a worker-generated factual wage discrepancy statement derived from recorded timecard entries and FairShift cryptographic work receipts. It does not constitute formal legal representation, statutory certification, or legal advice. In the event of unresolved wage disputes, workers are advised to approach relevant labor conciliation authorities or legal aid institutions."_

### Authoritative Statutory Frameworks Referenced

- **Payment of Wages Act, 1936 (Section 7 & 15)**: Mandates timely wage payment and restricts deductions to authorized statutory deductions (e.g., house accommodation, authorized amenities) with statutory recovery claims.
- **Minimum Wages Act, 1948 (Section 14)**: Governs statutory overtime rates for hours worked in excess of normal working days.
- **Code on Wages, 2019 (Sections 13, 14, 18)**: Sets national and state standards for wage periods, overtime multipliers (not less than twice the normal rate of wages for eligible industrial/construction workers), and maximum deduction ceilings (capped at 50% of total wages).

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
