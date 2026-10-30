# FairShift V4.0 — Product Demonstration Script

This document provides a guided walkthrough for demonstrating FairShift to stakeholders, investors, enterprise customers, frontline labor unions, and compliance auditors.

---

## Demonstration Overview

FairShift is a workforce transparency and safety platform built for frontline organizations (construction, facilities, manufacturing, campus operations).

**Key Product Differentiators Covered in Demonstration:**

1. **FairShift Proof**: Cryptographically sealed work receipts with HMAC-SHA256 canonical serialization, version-chained shift corrections, and Merkle tree inclusion proofs.
2. **Safe Signal**: Privacy-conscious recurring workplace hazard detection with $k$-anonymity cohort suppression ($k \ge 3$) and temporal differencing defenses.
3. **Accountability Loop**: Transparent safety resolution lifecycle with mandatory outcome verification and separation of duties.
4. **Workforce & Site Operations**: Real-time attendance, in-app notifications, rotating site check-in codes, and payroll CSV exports.
5. **Frontline Usability**: Bilingual English/Kannada interface, Glassmorphism V2 UI, and print-ready payslips.

---

## Persona 1: The Frontline Worker Journey

### Scene 1: Passwordless Sign-In & Dashboard

- **Account**: Lakshmi Bai (`9000000002` / PIN `1234`)
- **Action**:
  1. Open `http://localhost:3000/login`.
  2. Select **Phone + PIN** tab (or **Phone OTP** in staged SMS environments).
  3. Enter phone `9000000002` and PIN `1234`. Click **Sign In**.
- **Talking Points**:
  - _"Notice the Glassmorphism V2 interface: calm Ice Silver (`#DDE3E8`) background with Deep Aubergine (`#3A0F34`) typography and Marigold (`#EAAA00`) action accents."_
  - _"No passwords to remember. Frontline workers authenticate via OTP or short PIN."_
  - _"At the top right, observe the Notification Bell. Workers immediately see notifications about past shift adjustments or issued payslips."_

### Scene 2: Bilingual Kannada Toggle

- **Action**:
  1. Click the Language dropdown in the header and select **ಕನ್ನಡ (Kannada)**.
  2. The entire interface immediately transitions to Kannada:
     - Navigation: `ಮುಖಪುಟ` (Home), `ಹಾಜರಾತಿ` (Attendance), `ವೇತನ ಚೀಟಿ` (Payslips), `ಸುರಕ್ಷತಾ ವರದಿಗಳು` (Reports).
     - Status: `ಪಾಳಿಯಲ್ಲಿದ್ದಾರೆ` (On Shift), `ಮುಕ್ತಾಯಗೊಂಡಿದೆ` (Completed).
  3. Switch back to **English** for the remainder of the presentation.
- **Talking Points**:
  - _"Language inclusivity is a first-class feature. All labels, alerts, receipt explanations, and confirmation dialogs are 100% translated into regional language without layout clipping."_

### Scene 3: Shift Check-In with Rotating Site Code

- **Action**:
  1. Navigate to **Attendance**.
  2. The Worker Shift Card prompts for the workplace site code.
  3. Enter the 6-digit site code (or check in directly if optional). Click **Check in now**.
- **Talking Points**:
  - _"To prevent remote check-ins or 'buddy punching', the employer can enforce rotating workplace site codes derived from HMAC time-windows."_
  - _"The moment a worker checks in, the database enforces a partial unique index: a worker cannot have overlapping open shifts."_

### Scene 4: Check-Out & FairShift Proof Work Receipt

- **Action**:
  1. Click **Check out**.
  2. In the Attendance History table, click **Receipt** on the completed shift.
- **Talking Points**:
  - _"Here is the FairShift Proof Work Receipt."_
  - _"Notice the Plain-Language Worker Guarantee at the top: 'This receipt is sealed with cryptographic math. Once issued, your employer cannot alter your hours, overtime, or pay calculation without creating a visible versioned trail.' "_
  - _"Beneath the plain language summary is the mathematical proof: a SHA-256 canonical digest and Merkle Anchored status badge."_
  - _"Click 'Verify integrity': the client validates the digital signature against the organization's public key."_
  - _"Click 'Export Proof Bundle': workers can download a self-contained JSON proof containing the Merkle inclusion path, allowing any labor tribunal or union representative to verify their work history offline."_

### Scene 5: Payslip Review & Print Layout

- **Action**:
  1. Navigate to **Payslips**.
  2. Click on the latest issued payslip.
  3. Review the breakdown: Scheduled hours, regular wages, overtime multiplier (2.0x), statutory provident fund (PF 12%), and welfare fund deductions.
  4. Click **Print**.
- **Talking Points**:
  - _"Workers have complete transparency into how their pay was derived. No mystery deductions."_
  - _"The Print layout automatically strips away navigation bars, action buttons, and background colors, producing a crisp, clean physical payslip for banking or loan verification."_

---

## Persona 2: The Operational Administrator & Safety Lead

### Scene 6: Workforce Dashboard & Real-Time Monitoring

- **Account**: Construction Admin (`9000000100` / PIN `1234`)
- **Action**:
  1. Sign in as Admin.
  2. Navigate to `/admin`.
- **Talking Points**:
  - _"The executive dashboard displays live attendance metrics, fatigue-risk hour warnings, open hazard reports, and weekly trend graphs."_
  - _"All numbers are calculated live from real SQLite state—zero mock metrics."_

### Scene 7: Shift Corrections with Immutable Version Chaining

- **Action**:
  1. Navigate to `/admin/shifts`.
  2. Click **Correct** on a completed shift.
  3. Adjust the check-out time and enter a mandatory reason: _'Supervisor confirmed crane operation overtime extension'_.
  4. Submit correction.
- **Talking Points**:
  - _"Employers occasionally need to correct times due to operational anomalies."_
  - _"FairShift does not silently overwrite history. A correction creates Version 2 (`v2`) chained to Version 1 (`v1`)."_
  - _"The audit trail records who made the change, the before-and-after timestamps, and the mandatory reason."_
  - _"The worker instantly receives an in-app notification alerting them that their shift record was adjusted."_

### Scene 8: Safe Signal — Recurring Hazard Pattern Detection

- **Action**:
  1. Navigate to `/admin/reports`.
  2. Observe the **Safe Signal Detection** panel at the top of the queue.
- **Talking Points**:
  - _"Safe Signal solves a fundamental dilemma in frontline safety: workers fear retaliation when reporting recurring hazards, yet anonymous reports lack credibility."_
  - _"Safe Signal uses domain-separated cryptographic pseudonymization (`scopedReporterRef`)."_
  - _"When multiple distinct workers report hazards in the same category (e.g. 'Fall from height' or 'Missing PPE'), Safe Signal clusters them into high-confidence recurring pattern signals."_
  - _"Notice the privacy protections: if fewer than 3 workers have reported, the pattern is suppressed to satisfy $k$-anonymity. Administrator temporal differencing attacks are defeated via a 15-second snapshot cache."_

### Scene 9: Accountability Loop Lifecycle & Outcome Verification

- **Action**:
  1. Click on an active safety report in the queue.
  2. Transition status: `submitted` -> `acknowledged` -> `in_progress` -> `resolved`.
  3. Enter resolution notes: _'Safety barrier and toe boards installed on 3rd floor slab edge'_.
  4. In the final stage: **Outcome Verified**.
- **Talking Points**:
  - _"Most safety systems stop at 'Resolved'—an administrator simply marks a ticket closed."_
  - _"FairShift implements the full Accountability Loop. A resolved ticket requires Outcome Verification."_
  - _"Under organization policy, self-verification can be prohibited: the supervisor who performed the repair cannot sign off as their own auditor. An independent safety officer or third-party auditor must verify the physical site."_
  - _"The worker who reported the hazard receives real-time in-app notifications at each stage and has the unilateral power to click 'Reopen' if the hazard recurs."_

### Scene 10: Site Administration & Payroll CSV Export

- **Action**:
  1. Navigate to `/admin/sites`. Show existing sites (_Pier 42 Casting Yard_, _South Station Excavation_). Click **Add Site** to demonstrate adding a new site code.
  2. Navigate to `/admin/payslips`.
  3. Click **Export Payroll CSV**.
  4. Open the downloaded CSV to show column headers, hourly wage minor-to-major conversion, and tenant scoping.
- **Talking Points**:
  - _"Multi-site operations allow managing codes and attendance across geographically dispersed facilities."_
  - _"The payroll export provides a structured, audit-logged CSV that directly feeds enterprise ERP or payroll disbursements."_

---

## Persona 3: The Independent Regulator / Compliance Auditor

### Scene 11: Cryptographic Bundle Verification

- **Action**:
  1. Open a terminal or verification tool.
  2. Demonstrate offline verification of a FairShift proof bundle using the binary Merkle root and HMAC checkpoint signature.
- **Talking Points**:
  - _"FairShift does not ask regulators to trust its database."_
  - _"Every receipt is a leaf in a cryptographic Merkle tree. Every checkpoint seals that tree with a signed root."_
  - _"Even if an adversary modifies the live SQLite database, the independent proof verification script detects the alteration instantly and flags the record as tampered."_

---

## Conclusion

FairShift delivers:

- **Trust for Workers**: Cryptographic proof of work, transparent payslips, confidential reporting.
- **Accountability for Employers**: Real-time workforce management, multi-site oversight, proactive hazard clustering.
- **Verification for Regulators**: Mathematically defensible, independently verifiable audit records.
