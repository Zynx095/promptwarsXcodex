# FairShift — Glassmorphism V2 Engineering & UI Upgrade Handoff

This document details the engineering and implementation phase for the **Glassmorphism V2** upgrade of the FairShift workforce transparency and safety platform. It provides the architectural foundation, design tokens, component specifications, test verification results, and guidance for Claude's subsequent visual-polish pass.

---

## 1. Architecture and Styling Conventions

The visual styling architecture is implemented as a cohesive, token-driven design system inside [`src/client/styles.css`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/styles.css). No CSS-in-JS runtime or bloated CSS frameworks were introduced; instead, CSS custom properties (`:root`) govern the entire visual system, ensuring fast compile times, zero runtime overhead, and strict type and accessibility compliance.

### Exact Brand Palette

The platform strictly uses the requested brand palette:

- **Ice Silver**: `#DDE3E8` — The primary canvas foundation. Used with subtle ambient radial gradients (Deep Aubergine aura top-left, Marigold aura bottom-right) to give luminous depth to overlaid glass surfaces.
- **Deep Aubergine**: `#3A0F34` — The primary identity color. Governs strong text, headings, dark console surfaces (Admin Sidebar, ShiftCard hero, PayslipBreakdown hero), and brand elements.
- **Marigold**: `#EAAA00` — Strategic accent color. Used purposefully for high-priority actions, focus indicators, shift status highlights, and overtime metric bars.

### Light-Mode Glassmorphism V2 Principles

1. **Layered Translucency**: Glass surfaces use high-alpha translucent backing (`rgba(255, 255, 255, 0.82)` for cards, `0.68` for secondary sub-panels) over the Ice Silver canvas to guarantee WCAG contrast without milky opacity.
2. **Controlled Blur**: Surface diffusion is calibrated to `backdrop-filter: blur(14px) saturate(180%)` with `-webkit-backdrop-filter` fallback, avoiding over-blurring while keeping background textures softly refracted.
3. **Specular Rim Lighting**: Cards and interactive elements feature crisp specular inner highlights (`box-shadow: inset 0 1px 1px 0 rgba(255, 255, 255, 0.9)`) combined with layered ambient shadows (`0 4px 20px -2px rgba(58, 15, 52, 0.06)`).
4. **Hairline Dual Boundaries**: Glass elements use a dual-layer boundary (`border: 1px solid rgba(255, 255, 255, 0.85)` with outer outline `rgba(58, 15, 52, 0.08)`) to maintain crisp geometric definition against low-gamma displays.
5. **Accessible Action Contrast**: Marigold (`#EAAA00`) buttons and accent pills strictly pair with **Deep Aubergine** bold text (`#260822`), yielding a **7.9:1 contrast ratio**, well exceeding WCAG AAA standards (which requires 7.0:1). White text is never placed on Marigold.

---

## 2. Design Tokens and Reusable Components

All design tokens are defined in [`src/client/styles.css`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/styles.css#L1-L86):

### Design Tokens Summary

| Token Family        | Variable Names                                                                                                             | Values / Description                                                                                                                                  |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brand**           | `--brand-ice-silver`<br>`--brand-deep-aubergine`<br>`--brand-marigold`                                                     | `#DDE3E8`<br>`#3A0F34`<br>`#EAAA00`                                                                                                                   |
| **Surfaces**        | `--c-surface`<br>`--c-surface-hover`<br>`--c-surface-2`<br>`--glass-blur`                                                  | `rgba(255, 255, 255, 0.82)`<br>`rgba(255, 255, 255, 0.94)`<br>`rgba(245, 248, 251, 0.68)`<br>`blur(14px) saturate(180%)`                              |
| **Typography**      | `--c-heading`<br>`--c-text`<br>`--c-muted`<br>`--c-subtle`                                                                 | `#3A0F34` (13.5:1 on light glass)<br>`#2D1429` (14.2:1)<br>`#5E3B5A` (7.68:1, passes AAA)<br>`#7A5A76` (5.05:1, passes AA)                            |
| **Dark Aubergine**  | `--c-navy`<br>`--c-navy-2`<br>`--c-navy-border`                                                                            | `#2D0B29` (Sidebar, Hero cards)<br>`#1C0619`<br>`rgba(234, 170, 0, 0.22)`                                                                             |
| **Marigold Action** | `--c-gold`<br>`--c-gold-hover`<br>`--c-gold-text`<br>`--c-gold-soft`                                                       | `#EAAA00`<br>`#DCA000`<br>`#260822` (High-contrast Deep Aubergine text)<br>`rgba(234, 170, 0, 0.12)`                                                  |
| **Status Tokens**   | `--c-good` / `--c-good-soft`<br>`--c-warn` / `--c-warn-soft`<br>`--c-bad` / `--c-bad-soft`<br>`--c-info` / `--c-info-soft` | Emerald (`#0A6B40`, 5.4:1 contrast)<br>Amber (`#8F4700`, 5.3:1 contrast)<br>Ruby (`#9E1430` / `#BA1435`, 4.9:1)<br>Indigo (`#1B458C`, 6.8:1 contrast) |
| **Elevation**       | `--shadow`<br>`--shadow-raised`<br>`--shadow-dark`                                                                         | Inset highlight + ambient Aubergine diffusion<br>Hover elevation shadow<br>Dark hero card drop shadow                                                 |
| **Target & Radius** | `--tap`<br>`--radius-sm`<br>`--radius`<br>`--radius-lg`                                                                    | `44px` (WCAG minimum touch target)<br>`8px`<br>`12px`<br>`18px`                                                                                       |

### Upgraded Reusable Components

1. **`Card`** ([`src/client/components/ui.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/ui.tsx#L24-L32)): Translucent glass surface with subtle specular edge, smooth hover transition, and crisp Aubergine headings.
2. **`Button`** ([`src/client/components/ui.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/ui.tsx#L34-L45)):
   - `btn-primary`: Marigold gradient with Deep Aubergine bold text and specular rim light.
   - `btn-secondary`: Frosted glass button with subtle dark Aubergine border and hover lift.
   - `btn-danger`: Ruby glass button for critical check-outs or destructive operations.
   - `btn[aria-busy='true']`: CSS-driven accessible spinner that preserves text matching.
3. **`Field`** ([`src/client/components/ui.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/ui.tsx#L48-L88)): Label with optional indicator, hint text, linked ARIA attributes, and accessible inline error state. Inputs feature translucent glass backdrops and high-visibility 3px Marigold focus rings.
4. **`Badge` & `ReportStatusBadge`** ([`src/client/components/ui.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/ui.tsx#L151-L174)): Frosted glass status pills with geometric dot indicator and text (never color alone).
5. **`Stat`** ([`src/client/components/ui.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/ui.tsx#L177-L190)): High-contrast metric card with tabular numerals, contextual icon chip, and hover rise effect.
6. **`BarChart`** ([`src/client/components/ui.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/ui.tsx#L219-L275)): Glass chart container with Deep Aubergine regular hours bars and Marigold overtime bars, complete with a hidden screen-reader table.
7. **`ShiftCard`** ([`src/client/components/ShiftCard.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/ShiftCard.tsx)): Worker hero card in dark Aubergine glass with glowing state dot, large tactile Check In / Out buttons, collapsible 6-digit site code input, and read-aloud button.
8. **`PayslipBreakdown`** ([`src/client/components/PayslipBreakdown.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/PayslipBreakdown.tsx)): Dark Aubergine hero with large net pay figure, itemized deductions breakdown, numbered plain-language calculation steps with Marigold step pills, and voice read-aloud.
9. **`ReportDetail`** ([`src/client/components/ReportDetail.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/ReportDetail.tsx)): Hazard detail card with timeline of administrator status changes and transition form.
10. **`SiteCodeCard`** ([`src/client/components/SiteCodeCard.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/SiteCodeCard.tsx)): Large tabular 6-digit rotating site code with validity countdown and status badge.
11. **`SkillList`** ([`src/client/components/SkillList.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/SkillList.tsx)): Skills, training, and certifications with employer-checked vs self-reported indicators, expiration tracking, and verification toggles.
12. **`ConfirmDialog`** ([`src/client/components/ui.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/ui.tsx)): Accessible modal dialog with glass backdrop blur (`backdrop-filter: blur(8px)`), elevated surface card, Escape key dismissal, and primary/danger action buttons.
13. **`Skeleton` & Enhanced `Loading`** ([`src/client/components/ui.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/ui.tsx)): Smooth Glassmorphism V2 shimmer animation (`.skeleton-shimmer`) preventing layout jumps while preserving screen-reader status announcements.
14. **Upgraded `LoginPage`** ([`src/client/pages/Login.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/pages/Login.tsx)): Multi-provider segmented interface supporting Phone & PIN, SMS OTP, and Google / GitHub OAuth, with clear guidance for unprovisioned accounts and preserved Synthetic Demo Accounts.

---

## 3. Screens and Workflows Upgraded

### Worker Experience

- **Home (`/worker`)**:
  - Real-time shift status card with active pulse indicator.
  - Direct punch actions (Check in / Check out).
  - Quick links card including direct navigation to Skill passport.
  - Excessive-hours warnings list with rule details and date formatting.
- **Attendance (`/worker/attendance`)**:
  - Date range filter form with mobile touch targets.
  - Shift records table displaying check-in/out timestamps, durations, and administrative correction badges.
- **Payslips (`/worker/payslips`, `/worker/payslips/:id`)**:
  - Current period estimated earnings with line-by-line explanation and voice read-aloud.
  - History of immutable issued payslips with gross and net earnings.
  - Expandable day-by-day hours breakdown table.
- **Safety Reports (`/worker/reports`, `/worker/reports/new`, `/worker/reports/:id`)**:
  - Hazard report list with severity, status, and confidentiality badges.
  - Report submission form with speech-to-text voice dictation (`DictateButton`) and confidentiality guarantee.
  - Full timestamped resolution history and supervisor action notes.
- **Feedback (`/worker/feedback`)**:
  - Anonymous submission with privacy policy explanation (small-group suppression hides averages under 3 responses).
  - Category selector, optional 1–5 star rating, and comment field with voice input.
- **Skill Passport (`/worker/skills`)**:
  - Passport record list differentiating employer-verified credentials from self-reported skills.
  - Form for adding self-reported qualifications, certificates, and license expiry dates.

### Administrator Experience

- **Workforce Dashboard (`/admin`)**:
  - Filterable date range picker with live recalculation.
  - Attendance KPI cards (Active workers, On shift now, Completed shifts, Hours worked, Overtime recorded, Open hours alerts) with direct drill-down links.
  - Safety KPI cards (Unresolved hazards, Critical unresolved hazards).
  - Daily attendance and overtime trend bar charts.
  - Recent activity log and aggregate worker feedback summary.
- **Shifts Management (`/admin/shifts`)**:
  - Rotating 6-digit site check-in code display for workplace gate or briefing boards.
  - Shift filter by worker, open/completed status, and date range.
  - Shift correction modal enforcing mandatory audit reason and recording actor identity.
- **Safety Report Queue (`/admin/reports`, `/admin/reports/:id`)**:
  - Filterable queue by resolution status, severity, category, and date.
  - Status transition workflow (Submit → Acknowledge → In Progress → Resolved / Reopened) requiring mandatory resolution notes.
- **Hours & Fatigue Alerts (`/admin/alerts`)**:
  - Scheduling warnings triggered by excessive hours, repeated overtime, or insufficient rest.
  - One-click acknowledgement workflow.
- **Payslip Management (`/admin/payslips`, `/admin/payslips/:id`)**:
  - Calculation preview for worker and period.
  - Prevention of issuing when shifts in the period remain open.
  - Issued immutable payslips archive with pagination.
- **Pay & Hours Rules (`/admin/pay-rules`)**:
  - Scheduled daily hours and overtime multiplier configuration.
  - Dynamic deduction editor (percent of base, percent of gross, or fixed rupees).
  - Fatigue warning thresholds (max daily hours, max weekly hours, min rest hours, overtime days per week).
  - Mandatory site code toggle.
- **Feedback Moderation (`/admin/feedback`)**:
  - Aggregate ratings view protecting worker privacy.
  - Moderation queue with status controls (New, Reviewed, Action taken, Hidden).
- **Workforce Management (`/admin/workers`, `/admin/workers/:id/skills`)**:
  - Worker directory with team assignment and attendance state.
  - Inline hourly wage editor with real-time recalculation preview.
  - Worker skill verification interface for reviewing and checking worker credentials.
- **Audit Log (`/admin/audit`)**:
  - Scoped, immutable audit trail of all check-ins, check-outs, corrections, payslips, and rule adjustments with before/after state diffs.
- **Sign In (`/login`)**:
  - Dual-pane layout featuring UN SDG 8 Decent Work mission statement and feature list.
  - Phone + PIN authentication.
  - Synthetic demo accounts selector with one-click autofill for both Construction and Education industries.
  - English and Kannada language switcher.

---

## 4. Dependencies Added or Avoided

- **Zero new dependencies added**:
  - Avoided introducing Framer Motion, Tailwind, or external UI libraries.
  - The production bundle remains exceptionally lean:
    - Client CSS: **29.81 kB** (7.06 kB gzip)
    - Client JavaScript: **346.72 kB** (101.23 kB gzip)
    - Server bundle: **105.4 kB**
- **Existing stack retained**:
  - React 19, Lucide React, Zod, Express 5, Node:sqlite, Vite, Vitest.

---

## 5. Accessibility and Responsive Improvements

1. **Color Contrast**:
   - Deep Aubergine on light glass canvas: **13.5:1** (WCAG AAA requires 7:1).
   - Deep Aubergine on Marigold actions: **7.9:1** (exceeds WCAG AAA).
   - Muted text on light glass canvas: **7.68:1** (exceeds WCAG AAA).
   - Subtle labels/hints: **5.05:1** (exceeds WCAG AA).
   - Semantic status colors: all >= **4.9:1** (exceeds WCAG AA).
2. **Keyboard Navigation & Focus**:
   - `:focus-visible` styling with 3px solid Marigold outline and 2px offset on all interactive elements.
   - Skip link to `#main` content with high-contrast active state.
3. **Touch Targets**:
   - Minimum touch target of **44px** enforced via `--tap: 44px` on all buttons, navigation tabs, select triggers, and inputs.
4. **Information Architecture**:
   - Status indicators use text + geometric dot/icon; color is never the sole indicator.
   - Charts feature visually hidden semantic `<table>` elements with complete caption and headers for screen readers.
5. **Reduced Motion**:
   - Media query `@media (prefers-reduced-motion: reduce)` sets animation and transition duration to `0.01ms` across all elements.
6. **Responsive Layouts**:
   - Mobile (<600px): Bottom fixed glass dock for workers, stacked form rows, optimized compact cards.
   - Tablet (600px–1024px): Responsive multi-column grids, horizontal navigation bar.
   - Desktop (>1024px): Two-column admin layout with sticky Deep Aubergine sidebar and spacious content area.

---

## 6. Tests and Builds Executed

All test suites, static analysis, and builds were executed cleanly with zero errors:

| Check                        | Tool / Command                                | Result             | Details                                                                                                                                                                             |
| :--------------------------- | :-------------------------------------------- | :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code Formatting**          | `prettier --check .`                          | **PASS**           | All matched files use Prettier style. Untracked pitch assets ignored.                                                                                                               |
| **Linting**                  | `eslint .`                                    | **PASS**           | Strict TypeScript, React Hooks, JSX A11y rules pass with 0 errors.                                                                                                                  |
| **Type Check**               | `tsc --noEmit`                                | **PASS**           | 0 TypeScript compiler errors.                                                                                                                                                       |
| **Unit & Integration Tests** | `vitest run`                                  | **PASS (135/135)** | 17 test files passed: payroll, attendance, time/money, site-code, safety, schemas, design-tokens, proof receipts, safe signals, accountability loop, integration workflows, and UI. |
| **Design Tokens Test**       | `vitest run tests/unit/design-tokens.test.ts` | **PASS (5/5)**     | Validates palette hex codes, glass tokens, contrast guarantees, accessibility rules, and badge indicators.                                                                          |
| **Client UI Integration**    | `vitest run tests/client/ui.test.tsx`         | **PASS (3/3)**     | Tests complete worker journey (English & Kannada), admin journey (all admin pages), and unauthorized route guards in Happy-DOM.                                                     |
| **Production Build**         | `npm run build`                               | **PASS**           | Vite client built in ~348ms (`dist/client`); Esbuild server built in ~76ms (`dist/server/main.js`).                                                                                 |
| **Live Server Verification** | `node dist/server/main.js`                    | **PASS**           | Verified: `/healthz` returns 200 OK, `/api/demo/accounts` returns synthetic accounts, `/` serves valid HTML.                                                                        |

---

## 7. Important Files for Final Visual-Polish Phase

Inspect the following key files during any visual-polish phase:

1. **[`src/client/styles.css`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/styles.css)**: The single source of truth for all Glassmorphism V2 tokens, component styling, glass filters, shadows, and responsive media queries.
2. **[`src/client/components/Layout.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/Layout.tsx)**: Shell layouts, BrandMark, top navigation bar, bottom worker dock, and admin console sidebar.
3. **[`src/client/components/ui.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/ui.tsx)**: Fundamental design system primitives: `Card`, `Button`, `Field`, `Stat`, `Badge`, `Notice`, `BarChart`, `Empty`, `Loading`, `Pager`.
4. **[`src/client/components/ReceiptView.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/ReceiptView.tsx)**: FairShift Proof work receipt modal with version comparison tabs, cryptographic digest verification, and calculation breakdowns.
5. **[`src/client/components/SafeSignalView.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/SafeSignalView.tsx)**: Safe Signal hazard pattern card banner with k-anonymity privacy indicators and actionable mitigation steps.
6. **[`src/client/components/ShiftCard.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/ShiftCard.tsx)**: Primary worker interaction widget (shift status, punch action, site code drawer, hours counter).
7. **[`src/client/components/PayslipBreakdown.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/PayslipBreakdown.tsx)**: Earnings hero card, deduction breakdown, and plain-language explanation steps.
8. **[`src/client/components/ReportDetail.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/components/ReportDetail.tsx)**: Hazard timeline, corrective action display, outcome verification seal, and admin lifecycle transition form.
9. **[`src/client/pages/Login.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/pages/Login.tsx)**: Two-column login page with SDG 8 features, Phone OTP, Google/GitHub SSO, and demo account selectors.
10. **[`src/client/pages/admin/Dashboard.tsx`](file:///D:/College/SOMESHIT%20DOWNLOADS/ACM/src/client/pages/admin/Dashboard.tsx)**: Admin workforce KPI card grid, trend charts, and real-time Safety & Accountability Loop metrics.

---

## 8. Known Limitations and Remaining Considerations

- **Backdrop Filter Support**: Older browsers or virtualized machines without hardware acceleration may fall back to semi-translucent opaque rendering. Surface opacity was calibrated (`rgba(255, 255, 255, 0.82)`) to ensure high contrast even if backdrop-filter is disabled by the browser.
- **System Fonts**: The font stack uses `@fontsource-variable/inter` for English numerals and typography, falling back to `'Noto Sans Kannada'` for Kannada text.
- **Speech Synthesis / Recognition**: Dependent on browser Web Speech API support; both `DictateButton` and `ReadAloudButton` gracefully hide when the browser lacks support.
