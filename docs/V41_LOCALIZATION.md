# FairShift V4.1 — Multilingual Architecture & Localization System

**Document Version:** 4.1.0  
**Feature:** Modular Asynchronous Localization & 6-Language Indian Interface  
**Primary Directory:** [`src/client/locales/`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/locales/)  
**Engine Implementation:** [`src/client/lib/i18n.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/lib/i18n.tsx)

---

## 1. Architectural Transformation

In FairShift V4.0, internationalization was constrained to a single monolithic TypeScript dictionary (`en` and `kn` hardcoded inside `i18n.tsx`). This pattern bloated the client bundle and did not scale to multiple regional languages.

In **FairShift V4.1**, the localization architecture has been decoupled into an **asynchronous modular loading system**:

1. **Bundled English Source of Truth**:
   - `src/client/locales/en.json` is bundled directly into the base client payload, ensuring zero network latency, immediate initial page rendering, and compile-time type safety via `export type MessageKey = keyof typeof en`.
2. **Lazy-Loaded Regional Dictionaries**:
   - Additional languages are placed in separate JSON modules in `src/client/locales/`:
     - `kn.json` (Kannada — ಕನ್ನಡ)
     - `hi.json` (Hindi — हिन्दी)
     - `ta.json` (Tamil — தமிழ்)
     - `te.json` (Telugu — తెలుగు)
     - `bn.json` (Bengali — বাংলা)
   - Vite splits each locale into an independent chunk, fetched only when the user selects that language.
3. **In-Memory & Persistent Caching**:
   - Loaded dictionaries are cached in memory (`Map<Lang, Dictionary>`).
   - The user's language selection is persisted in `localStorage` under key `fairshift.lang`.
4. **Resilient Safe Fallback**:
   - If a translation key is missing or pending network resolution in a regional language, the system falls back instantly to the English string. The application never crashes or displays blank text.

---

## 2. Supported Languages Matrix

| Code |      Language       |   Script   | Locale Tag | Primary Demographic in Indian Frontline Workforce          |
| :--: | :-----------------: | :--------: | :--------: | :--------------------------------------------------------- |
| `en` |     **English**     |   Latin    |  `en-IN`   | Standard pan-India administrative and default interface    |
| `kn` | **ಕನ್ನಡ (Kannada)** |  Kannada   |  `kn-IN`   | Karnataka construction, logistics, and campus operations   |
| `hi` | **हिन्दी (Hindi)**  | Devanagari |  `hi-IN`   | Northern/Central India interstate migrant workforce        |
| `ta` |  **தமிழ் (Tamil)**  |   Tamil    |  `ta-IN`   | Tamil Nadu industrial, manufacturing, and facilities staff |
| `te` | **తెలుగు (Telugu)** |   Telugu   |  `te-IN`   | Andhra Pradesh and Telangana infrastructure labor          |
| `bn` | **বাংলা (Bengali)** |  Bengali   |  `bn-IN`   | West Bengal and interstate eastern construction labor      |

---

## 3. Translation Scope & Terminology Alignment

Translations provide 100% coverage across all user-facing worker journeys:

- **Authentication**: Phone, PIN, SMS OTP, OAuth notices, security disclaimers.
- **Attendance & Shifts**: Check-in, check-out, duration, overtime thresholds, rotating 6-digit site codes.
- **Wages & Payslips**: Regular pay, overtime multipliers, statutory deductions, net payable.
- **FairShift Money Jar**: Liquid layers, Agreed vs Worked vs Paid three-part reconciliation, outstanding amounts.
- **Labour Dispute Notices**: Formal discrepancy categories, factual worker statements, statutory disclaimers.
- **Safety Reporting**: Hazard categories (fall, electrical, machinery, chemical, heat stress), severity tiers, confidential reporting.
- **Safe Signal**: Aggregated hazard clusters, cohort threshold suppression ($k \ge 3$), differencing protections.
- **Accountability Loop**: Lifecycle transitions (`submitted`, `acknowledged`, `in_progress`, `resolved`, `outcome_verified`).
- **Environmental Heat Safety**: Wet bulb/heat index calculation, hydration cycles, rest and shade guidelines.

---

## 4. Regional Formatting

The localization engine leverages native standard `Intl` APIs bound to the active locale:

- **Currency (`formatMoney`)**: Bounded to `INR` (`₹`) with locale-specific number grouping (e.g. Western grouping `25,400.50` vs Bengali numerals `২৫,৪০০.৫০`).
- **Dates (`formatDate`, `formatDateTime`)**: Formats dates in standard Indian chronological order (Day Month Year).

---

## 5. Verification Test Evidence

Automated tests in [`tests/unit/i18n.test.ts`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/tests/unit/i18n.test.ts) verify:

- BCP-47 tag conformance for all 6 target languages.
- JSON structure and dictionary size ($>250$ keys per language).
- Strict placeholder parameter matching (`{name}`, `{hours}`, `{rate}`, `{date}`, etc.).
- Coverage of core product differentiators (`jar.*`, `dispute.*`, `heat.*`, `proof.*`).
- Regional currency and date formatting consistency across all locales.
