# FairShift V4.1 — Worker Earnings Experience & Money Jar Documentation

**Document Version:** 4.1.0  
**Feature:** FairShift Money Jar & Agreed vs Worked vs Paid Comparison  
**Primary Users:** Frontline construction workers and campus support staff  
**Component Paths:**

- [`src/domain/moneyJar.ts`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/domain/moneyJar.ts)
- [`src/client/components/MoneyJar.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/MoneyJar.tsx)
- [`src/client/pages/worker/Payslips.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/pages/worker/Payslips.tsx)

---

## 1. Product Objective & Frontline Literacy

In frontline employment sectors (construction sites, maintenance, security, housekeeping), pay discrepancies and complex payslip tables create distrust. Many workers have limited numerical or financial literacy and find standard deduction tables incomprehensible.

The **FairShift Money Jar** replaces abstract ledger columns with a visual, physical metaphor:

1. **Base Wages**: The foundational liquid layer (Emerald) representing regular hours worked multiplied by contracted hourly rate.
2. **Overtime Earnings**: The top earnings layer (Amber / Marigold) showing hours worked beyond the daily schedule multiplied by the statutory 1.5× overtime multiplier.
3. **Authorized Deductions**: A clearly distinguished reduction indicator (Rose) showing statutory deductions (e.g., canteen, equipment) subtracted from gross earnings.
4. **Net Payable**: The prominent final take-home amount at the baseplate with status badge (`Approved for Payment` vs `Estimated — Pending Final Approval`).

---

## 2. Mathematical Integrity & Paise Precision

The Money Jar strictly consumes verified domain calculations from `src/domain/payroll.ts` and `src/shared/money.ts`. It introduces zero duplicate accounting math on the client.

### Invariants Maintained

- **Integer Paise Representation**: All currency amounts remain integer minor units (paise) throughout calculation and formatting.
- **Reconciliation Invariant**:
  $$\text{Base Pay} + \text{Overtime Pay} = \text{Gross Pay}$$
  $$\text{Gross Pay} - \text{Total Deductions} = \text{Net Pay}$$
- **Zero-Earnings Handling**: When regular and overtime minutes equal zero, the jar displays a clean empty state with an informational notice rather than throwing or showing broken geometry.
- **Deduction Capping**: If deductions exceed gross pay, domain capping rules prevent negative net pay, and the capped status is visibly flagged.

---

## 3. Agreed vs Worked vs Paid Three-Part Comparison

To give workers complete transparency into what was promised versus what was recorded and paid, the Money Jar provides a side-by-side reconciliation:

| Pillar                | Underlying Data Source                            | Calculation / Definition                                                                                 |
| :-------------------- | :------------------------------------------------ | :------------------------------------------------------------------------------------------------------- |
| **1. Agreed**         | Worker contract rate and scheduled daily hours    | $\text{Contracted Hourly Rate} \times \text{Daily Scheduled Hours} \times \text{Working Days in Period}$ |
| **2. Worked**         | Immutable shift attendance timestamps             | $\text{Regular Hours} + \text{Overtime Hours}$ mapped to gross earnings                                  |
| **3. Paid / Payable** | Employer payslip issuance and disbursement status | Net approved amount with explicit distinction between **Earned**, **Approved**, and **Disbursed**        |

> [!IMPORTANT]
> The system never implies money has been paid into a worker's hands or bank account when it is merely approved. Unpaid approved wages are explicitly labeled **Outstanding** with zero false disbursement claims.

---

## 4. Accessibility & Multimodal Design

1. **Non-Reliance on Color Alone**:
   - Each layer features unique SVG texture patterns (dots for base, diagonal 45° stripes for overtime, cross-hatching for deductions).
   - High-contrast text labels with icons (`Wallet`, `Clock`, `MinusCircle`, `CheckCircle2`).
2. **Speech Synthesis (Voice Read-Aloud)**:
   - Includes a one-touch `ReadAloudButton` that reads the full earnings explanation in the worker's selected language using native Web Speech Synthesis (`SpeechSynthesisUtterance`).
3. **Screen Reader Semantics**:
   - The visual jar container features `role="img"` with a dynamically generated `aria-label` describing exact rupee figures.
   - The ledger and comparison sections use semantic lists (`<ul>`, `<dl>`) and headings (`<h3>`, `<h4>`).
4. **Reduced Motion**:
   - `@media (prefers-reduced-motion: reduce)` disables fluid CSS transitions for layer height adjustments.

---

## 5. Verification Test Coverage

Automated unit tests in [`tests/unit/money-jar.test.ts`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/tests/unit/money-jar.test.ts) verify:

- Accurate mapping of base, overtime, deductions, and net payable.
- Normalization of visual layer percentages (summing to 100%).
- Graceful handling of zero-earnings pay periods.
- Mathematical consistency of the Agreed vs Worked vs Paid comparison.
- Clear distinction of unfinalized preview payslips vs issued payslips.
- Preservation of capped deduction flags.
