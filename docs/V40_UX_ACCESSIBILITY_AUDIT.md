# FairShift V4.0 — UX & Accessibility (a11y) Audit Report

## Executive Summary

FairShift V4.0 was audited for usability, responsive layout integrity, screen-reader accessibility (WCAG 2.1 Level AA), and bilingual Kannada localization.

---

## 1. Design System Compliance (Glassmorphism V2)

| Design Token             | Specification                      | Application in FairShift V4.0                                                       |
| :----------------------- | :--------------------------------- | :---------------------------------------------------------------------------------- |
| **Canvas Background**    | Ice Silver (`#DDE3E8`)             | Provides a calm, low-glare canvas for outdoor sunlight visibility.                  |
| **Primary Typography**   | Deep Aubergine (`#3A0F34`)         | High-contrast heading and body text meeting WCAG AAA contrast ratio ($> 12:1$).     |
| **Accent & Focus**       | Marigold (`#EAAA00`)               | Warm gold accent used for focus rings, notifications, and primary highlights.       |
| **Surface Translucency** | `rgba(255, 255, 255, 0.85 - 0.96)` | Multi-layered frosted glass panels with `backdrop-filter: blur(12px)`.              |
| **Borders & Elevation**  | Dual-layered outline & soft shadow | Subtle border (`#CCD5DC`) with strong outline (`#B0BCC6`) prevents visual blending. |

---

## 2. Accessibility & Usability Audit (WCAG 2.1 AA)

### A. Touch Target Sizing ($\ge 44\text{px}$)

- Frontline workers frequently operate mobile devices on job sites while wearing gloves or in rugged environments.
- All primary interactive elements—including check-in/out buttons, navigation tabs, notification bells, language switches, and dialog dismiss controls—meet or exceed the $44\text{px} \times 44\text{px}$ minimum clickable area.

### B. Keyboard Navigation & Visible Focus Indicators

- All interactive controls feature distinct, high-contrast keyboard focus indicators:
  ```css
  :focus-visible {
    outline: 2px solid var(--c-gold);
    outline-offset: 2px;
  }
  ```
- Modals trap keyboard focus and dismiss on `Escape` keypress (`ReceiptModal`, `AddWorkerModal`, `AddSiteModal`).
- Skip links (`<a className="skip-link" href="#main">`) allow screen-reader users to bypass repetitive navigation bars directly to main content.

### C. Screen Reader Landmarks & ARIA Compliance

- Data tables feature explicit scope headers (`<th scope="col">`), responsive horizontal wrappers (`.table-wrap`), and tabular numbers (`font-variant-numeric: tabular-nums`).
- Dialogs utilize `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` referencing heading IDs.
- Expandable controls (such as the notification bell dropdown) accurately communicate live state via `aria-expanded` and `aria-haspopup`.

---

## 3. Bilingual Kannada Localization & Text Flow

### A. Regional Language Accuracy

- 100% of worker-facing strings have native Kannada translations in `src/client/lib/i18n.tsx`.
- Key terminology was curated for frontline clarity:
  - Attendance: `ಹಾಜರಾತಿ`
  - On Shift: `ಪಾಳಿಯಲ್ಲಿದ್ದಾರೆ`
  - Completed: `ಮುಕ್ತಾಯಗೊಂಡಿದೆ`
  - Work Receipt: `ಕೆಲಸ ಮತ್ತು ಗಳಿಕೆಯ ರಶೀದಿ`
  - Worker Guarantee: `ಫೇರ್‌ಶಿಫ್ಟ್ ಕಾರ್ಮಿಕ ಭರವಸೆ`

### B. Preventing Text Clipping

- Kannada script features complex character glyphs and vowel modifiers (matras) that require 15–25% greater vertical height than Latin characters.
- Component line-heights and button padding were designed with dynamic flex wrapping (`flex-wrap: wrap`) and min-height constraints to eliminate text truncation or broken matras.

---

## 4. Multi-Industry Terminology Adaptability

FairShift adapts dynamically to the organization's frontline sector:

- **Construction Operations**:
  - Workplace called: **Site** / `ಸೈಟ್`
  - Workforce grouped into: **Crews**
  - Hazard categories: _Fall from height, Missing PPE, Exposed wiring, Unstable scaffolding, Heat stress_.
- **Campus & Educational Support Services**:
  - Workplace called: **Campus Area** / `ಕ್ಯಾಂಪಸ್ ಪ್ರದೇಶ`
  - Workforce grouped into: **Departments**
  - Hazard categories: _Cleaning chemicals, Wet floors / slips, Unsafe waste handling, Personal security, Heavy lifting_.
