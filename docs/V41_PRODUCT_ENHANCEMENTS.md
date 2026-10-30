# FairShift V4.1 — Product Enhancement, Worker Empowerment & Accessibility Upgrade

**Document Version:** 4.1.0-RC  
**Date:** October 30, 2026  
**Status:** In Progress / Implementation Phase  
**Target:** FairShift V4.1 Release  
**Preserved Directory:** `pitch-preparation/` (Untouched, strictly isolated)

---

## 1. Baseline Quality Gate Reproduction Evidence

Before introducing modifications, the existing repository baseline was independently reproduced and audited against the target branch (`main`):

| Quality Gate                 | Tool / Command                                | Baseline Output                                     |  Status  |
| :--------------------------- | :-------------------------------------------- | :-------------------------------------------------- | :------: |
| **Unit & Integration Tests** | `npx vitest run`                              | **30 test files passed, 254 tests passed** (36.47s) | **PASS** |
| **Static Type Analysis**     | `npm run typecheck` (`tsc --noEmit`)          | 0 type errors across whole codebase                 | **PASS** |
| **Code Quality & Lint**      | `npm run lint` (`eslint .`)                   | 0 errors, 0 warnings under ESLint 9 flat config     | **PASS** |
| **Code Formatting**          | `npm run format:check` (`prettier --check .`) | 100% compliant across all 99 repository files       | **PASS** |
| **Client Production Build**  | `npm run build:client` (`vite build`)         | `401.74 kB` JS (`115.23 kB` gzip), `38.17 kB` CSS   | **PASS** |
| **Server Production Build**  | `npm run build:server` (`esbuild`)            | `209.4 kB` Node 22 ESM standalone bundle            | **PASS** |
| **Git Working Tree State**   | `git status`                                  | Clean working tree; `pitch-preparation/` untouched  | **PASS** |

---

## 2. Feature Dependency Map & Architecture Matrix

FairShift V4.1 introduces major worker-centric enhancements while maintaining existing core strengths (relational SQLite schema, HMAC-SHA256 receipts, Merkle checkpoints, differential privacy Safe Signal, and Accountability Loop).

```mermaid
flowchart TD
    subgraph Data Layer
        DB[(SQLite WAL Mode)]
        PayrollDomain[Payroll Domain & Money Math]
        HeatDomain[Heat Stress Domain & NDMA Rules]
        DisputeDomain[Dispute Model & Factual Notice]
    end

    subgraph Core Services & API
        WorkerRoutes[/api/worker & /api/payslips]
        SafetyRoutes[/api/reports & /api/safety]
        AdminRoutes[/api/admin & sites]
    end

    subgraph Client Infrastructure
        I18nEngine[Modular Asynchronous I18n]
        LocaleStorage[Locale Cache: en, kn, hi, ta, te, bn]
        FormatEngine[Regional Currency & Date Formatters]
    end

    subgraph Worker Experience V4.1
        MoneyJar[FairShift Money Jar Visualization]
        AgreedWorkedPaid[Agreed vs Worked vs Paid Comparison]
        DisputeNotice[Labour Dispute Notice PDF Generator]
        HeatSafetyWidget[Environmental Heat Safety Assessment]
        ProofExplainer[Human-Readable Cryptographic Proof]
        AccountabilityStepper[Accountability Loop Stepper]
        MobileDemoQR[Mobile Demonstration QR Code Modal]
    end

    PayrollDomain --> WorkerRoutes
    HeatDomain --> SafetyRoutes
    DisputeDomain --> WorkerRoutes

    WorkerRoutes --> MoneyJar
    WorkerRoutes --> AgreedWorkedPaid
    WorkerRoutes --> DisputeNotice
    SafetyRoutes --> HeatSafetyWidget

    I18nEngine --> LocaleStorage
    I18nEngine --> FormatEngine
    FormatEngine --> MoneyJar
    FormatEngine --> DisputeNotice
    FormatEngine --> HeatSafetyWidget
```

---

## 3. Product Workstreams

### Priority 0 — Deployment Readiness and Demonstration

- **Cloud Run Deployment Runbook & Readiness**: Single-writer persistent volume configuration via Cloud Storage FUSE / Filestore, health checks, secrets management.
- **Mobile Demonstration QR Code Access**: Clean, accessible QR code modal on login and demonstration views pointing to active deployment or LAN mobile test address.
- **Enhanced README**: Authentic screenshots, architecture diagrams, live demo workflows, and transparent technical disclosure.

### Priority 1 — FairShift Money Jar & Earnings Transparency

- **Visual Money Jar Component**: Transparent layered container displaying Base Pay (primary emerald), Overtime Pay (amber), Deductions (reduction indicator), Net Payable (prominent), and Paid vs Outstanding status.
- **Agreed vs Worked vs Paid Comparison**: Three-way structured breakdown deriving from worker contracted hourly rate, scheduled daily hours, actual recorded attendance, and payslip issuance.
- **Accessibility & Numerical Rigor**: Integer paise calculations, screen-reader markup (`aria-label`, semantic `<meter>`/`<progress>` equivalents), high-contrast tokens, reduced motion support.

### Priority 1 — Worker Labour Dispute Notice Generator

- **Factual Wage Discrepancy Notice**: Structured, print-ready document allowing workers to review and edit factual discrepancies with employer details, pay periods, recorded hours, earnings, and cryptographic receipt hashes.
- **Legal Accuracy & Non-Representation Disclaimer**: Explicit disclaimer that the notice is a worker-generated factual summary and not a substitute for legal advice. Factual references to Indian wage frameworks (Code on Wages 2019 / Payment of Wages Act 1936) without false assertions.
- **Strict Privacy**: Zero exposure of confidential safety reports or reporter references.

### Priority 2 — Multilingual Architecture & Language Expansion

- **Modular Asynchronous I18n**: Decoupled `src/client/locales/*.json` architecture with dynamic imports, memory and local storage caching, and instant fallback to bundled English.
- **Expanded Indian Languages**: Six-language coverage including English (`en`), Kannada (`kn`), Hindi (`hi`), Tamil (`ta`), Telugu (`te`), and Bengali (`bn`).
- **Comprehensive Coverage & Regional Formatting**: Full coverage across navigation, payslips, Money Jar, dispute generator, heat safety, reports, and error messages with locale-aware INR and date formatting.

### Priority 2 — Heat-Stress and Outdoor Worker Safety

- **Scientifically Grounded Heat Index**: NOAA/NWS Rothfusz regression algorithm adapted for occupational frontline safety, distinguishing Heat Index from Wet Bulb Globe Temperature (WBGT).
- **NDMA & Indian Guidelines**: Work-rest cycles, hydration intervals (250ml per 15-20 min), shade requirements, acclimatization advice, and heat stroke warning signs.
- **Worker & Admin Views**: Interactive calculator and presets (Delhi Dry Heat, Chennai Humid, Bengaluru Moderate) for workers, and aggregated hazard overview for admins without reporter deanonymization.

### Priority 2 — Upgrade Existing Features

- **Proof Explainer**: Plain-language explanations of HMAC-SHA256, version chain comparisons, and Merkle checkpoint verification.
- **Safe Signal Transparency**: Cohort suppression ($k \ge 3$) explanations and differencing defense disclosures.
- **Accountability Loop Stepper**: Complete 7-state lifecycle visualization with separation-of-duties clarity.

### Priority 3 — Mobile Worker Experience Improvements

- Comfortable touch targets ($\ge 44 \times 44\text{px}$), safe-area insets, keyboard-friendly forms, and responsive glassmorphism containers preserving Deep Aubergine (`#3A0F34`), Ice Silver (`#DDE3E8`), and Marigold (`#EAAA00`).

---

## 4. Planned Commit Sequence

Granular, logically scoped commits will be created following verified tests:

1. `docs(plan): establish V4.1 baseline, dependency map and enhancement architecture`
2. `feat(payroll): implement Money Jar calculation model and Agreed-Worked-Paid comparison`
3. `feat(ui): add accessible Money Jar component with layered earnings visualization`
4. `test(payroll): verify Money Jar mathematical consistency and edge cases`
5. `feat(documents): implement worker labour dispute notice generator with PDF print styling`
6. `test(documents): verify dispute notice privacy bounds and receipt linkage`
7. `feat(i18n): refactor localization to modular asynchronous architecture`
8. `feat(i18n): add Hindi, Tamil, Telugu, and Bengali translations`
9. `test(i18n): verify translation completeness and regional formatting`
10. `feat(safety): implement NOAA/NDMA heat stress assessment and worker safety calculator`
11. `test(safety): verify environmental heat safety calculations and boundaries`
12. `feat(proof): add plain-language cryptographic receipt explainer and version diffs`
13. `feat(ui): add mobile demonstration QR code and responsive touch refinements`
14. `docs(readme): update README with authentic architecture, features, and screenshots`
15. `docs(release): publish V4.1 release verification and sanity audit`
