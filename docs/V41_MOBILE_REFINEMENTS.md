# FairShift V4.1 — Mobile Worker Experience & Touch Refinements

**Document Version:** 4.1.0  
**Feature:** Frontline Smartphone Usability & Mobile Demonstration Access  
**Target Viewports:** 320px to 480px (Frontline Android & iOS Handsets)

---

## 1. Objectives & Boundaries

The FairShift V4.1 mobile upgrade focuses on operational touch refinement, responsive layout robustness, and demonstration accessibility without disrupting the established Glassmorphism V2 design language or triggering a full visual overhaul (which is reserved for a future dedicated mobile redesign workstream).

### Preserved Brand Tokens

- **Ice Silver**: `#DDE3E8` (Light glassmorphism background)
- **Deep Aubergine**: `#3A0F34` (Primary brand identity, high-contrast headings)
- **Marigold**: `#EAAA00` (High-contrast action accents, warning highlights)

---

## 2. Touch Target Architecture (WCAG 2.5.5 / AAA)

Frontline workers frequently operate smartphones with gloved, dusty, or wet hands. All interactive elements across newly added and existing views adhere to strict minimum touch dimensions:

```css
:root {
  --tap: 44px; /* Minimum touch target height across all controls */
}

.btn {
  min-height: var(--tap);
  padding: var(--space-2) var(--space-4);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

- **Buttons & Icon Controls**: Explicit `min-height: 44px` and minimum 44px touch bounding box.
- **Form Fields & Inputs**: Select boxes, range sliders, and textareas use 44px touch bounding boxes with high-contrast active borders (`#eaaa00`).
- **Segmented Auth & Tab Buttons**: Padded to allow effortless thumb switching without accidental taps.

---

## 3. Responsive Layout Adaptations for V4.1 Modules

### 1. FairShift Money Jar (`src/client/components/MoneyJar.tsx`)

- On desktop viewports ($\ge 768\text{px}$), renders as a 280px visual jar alongside a detailed ledger.
- On mobile viewports ($< 768\text{px}$), smoothly collapses into a single vertical column:
  - The glass jar container centers horizontally with full-width baseplate.
  - The Agreed vs Worked vs Paid comparison grid transitions from 3 columns to stacked cards with clear numbered badges (`1. Agreed`, `2. Worked`, `3. Payable`).
  - Text scales appropriately with zero horizontal overflow.

### 2. Labour Dispute Notice Modal (`src/client/components/DisputeNoticeModal.tsx`)

- Full-width mobile dialog card (`width: 95vw; max-height: 90vh`).
- Sticky header and footer actions (`Done`, `Print / Save PDF`, `Download TXT`).
- Scrollable document preview formatted for standard mobile reading and clean A4/letter print layouts.

### 3. Environmental Heat Safety Widget (`src/client/components/HeatSafetyWidget.tsx`)

- Presets wrap into rounded pill buttons (`padding: 0.25rem 0.65rem`) easily tap-selectable on phones.
- Temperature and humidity sliders stack cleanly with prominent real-time value callouts (`34°C`, `60%`).
- Touch-friendly direct action button ("Report Heat Hazard") links directly to safety reporting.

---

## 4. Mobile Demonstration QR Code Integration

To eliminate the friction of evaluating mobile interfaces on desktop monitors, FairShift V4.1 introduces instant **Mobile Smartphone Demonstration Access**:

- Accessible via a prominent "Mobile Demo" button on the login screen.
- Renders a pure vector SVG QR code generated on-the-fly (`src/client/lib/qr.ts`) pointing directly to `window.location.origin`.
- Features a one-tap "Copy URL" button and clear local Wi-Fi guidance for hackathon judges evaluating on local networks.
- **Zero Exposure**: No demo credentials, tokens, or personal identifiers are embedded in the QR payload.

---

## 5. Safe Area Handling & Motion Sensitivities

- **Notch & Home Indicator Handling**: Bottom navigation and sticky footers observe `padding-bottom: env(safe-area-inset-bottom, 16px)`.
- **Reduced Motion**: All newly introduced CSS animations (e.g. Money Jar liquid layer transitions) are neutralized when the user enables `@media (prefers-reduced-motion: reduce)`.

---

## 6. Recommendations for Future Dedicated Mobile Redesign

While V4.1 delivers full responsive stability and touch accessibility, the following opportunities are documented for the future dedicated mobile UX workstream:

1. Native pull-to-refresh gestures for shift attendance logs.
2. Bottom sheet drawer pattern for safety report filtering and payslip details.
3. Offline service worker caching for offline timecard receipt browsing.
4. Biometric WebAuthn (fingerprint / face) unlock for instant worker sign-in.
