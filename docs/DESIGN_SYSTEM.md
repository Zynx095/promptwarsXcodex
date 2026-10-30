# FairShift Design System (V4.2)

FairShift keeps records of work and pay for people on construction sites, factory floors, hospital wards and campuses, and lets them report danger. Most workers use a mid-range Android phone, often outdoors, in one of six languages, with varied reading confidence. Site managers use a laptop.

The design starts from that world rather than from a dashboard template: a **time card** for the working day, a **pay statement** and a **money jar** for wages, a **receipt with a seal** for verifiable records, and a **case file with a lifecycle** for safety reports.

## Principles

1. **Records, not widgets.** Content is shaped like what it is: a time card, a statement, a receipt, a case. A white surface is used only where the content is a record; everything else sits on the canvas, separated by space and hairlines.
2. **Numbers first.** Hours and rupees are the largest type on any screen they appear on, set in tabular figures with their unit. Labels stay small, in sentence case.
3. **Say exactly what is known.** Every status names what was checked and by whom. Unknowns are labelled as unknown ("Payment not recorded in FairShift"), never shown as zero.
4. **Thumb first.** On phones the primary action sits in the lower half of the screen, controls are at least 48 px, and the four main destinations live in a bottom bar.
5. **One bold element per screen.** The time card on Home, the jar on Pay, the seal on a receipt, the lifecycle on a report. Everything around it is quiet.

## Colour

| Token                    | Hex                               | Use                                                             |
| :----------------------- | :-------------------------------- | :-------------------------------------------------------------- |
| `--fs-aubergine`         | `#3A0F34`                         | Brand, headings, navigation, primary structure                  |
| `--fs-aubergine-deep`    | `#24081F`                         | The time card and other dark slabs; text on marigold            |
| `--fs-silver`            | `#DDE3E8`                         | Ice Silver: hairlines, wells, chips                             |
| `--fs-canvas`            | `#EEF1F4`                         | App background (a lighter step of Ice Silver for large areas)   |
| `--fs-paper`             | `#FFFFFF`                         | Record surfaces                                                 |
| `--fs-marigold`          | `#EAAA00`                         | The one action that matters on a screen; active navigation mark |
| `--fs-ink` / `-2` / `-3` | `#2B1027` / `#5E4659` / `#77606F` | Body, secondary and tertiary text                               |

States use paired text/background/line tokens: good `#0D6B43`, caution `#7A4A00` on `#FFF3CF`, danger `#A3122F` on `#FCE8EC`, info `#1F4E8C` on `#E5EEF9`. Hazard tape (marigold and aubergine stripes) is reserved for critical safety states.

Contrast (WCAG 2.2 AA): ink on canvas > 12:1, tertiary text on canvas 5.0:1, aubergine-deep on marigold 9.1:1, state text on state backgrounds 5.7–7.1:1, input borders on white 3.3:1. Focus is a 3 px aubergine ring on light surfaces and a marigold ring on dark ones.

## Type

- **Display and figures — Bricolage Grotesque** (variable, 200–800). Headings, money, hours, times and counts. Plain zeros and tabular figures, so amounts line up and read the same everywhere.
- **Text — Atkinson Hyperlegible Next** (variable). Labels, paragraphs and controls. Designed by the Braille Institute to keep easily confused characters apart, which matters for readers with low vision or limited literacy.
- **One set of digits.** The text face is a composite (`FairShift Text`): letters from Atkinson, digits and ₹ from Bricolage. Atkinson's slashed zero looks like a technical symbol inside a wage amount.
- **Indic scripts** use the platform fonts (Nirmala UI on Windows, Noto Sans on Android). Kannada, Hindi, Tamil, Telugu and Bengali get a taller line height.
- Code-like values (receipt digests) use the system monospace face, and only inside expandable technical details.

Scale (16 px base): 13 · 14 · 16 · 18 · 21 · 26 · 34 · 44 · 56. Headings are tracked slightly tight; Indic headings are not.

## Space, shape and elevation

- 4-point spacing: 4, 8, 12, 16, 20, 24, 32, 40, 56. Page gutter 16 px on phones, 24 px on tablets, 32 px on wide screens.
- Radius follows hierarchy: chips are pills, controls 12 px, records 14 px, slabs 20 px, sheets 24 px at the top corners.
- Elevation is rare: records get a hairline edge, floating layers (sheets, menus, dialogs) get a shadow. No glass, no gradient washes.

## Layout

Worker, phone (360–430 px):

```
┌──────────────────────────────┐
│ ▣ FairShift      [ಕನ್ನಡ] [🔔3] │  top bar: identity, language, notifications
├──────────────────────────────┤
│ Good morning, Lakshmi         │
│ ┌──────── time card ───────┐ │  aubergine slab, the one bold element
│ │ ● On shift since 8:02 am  │ │
│ │ 6h 42m                    │ │  worked today, large tabular figures
│ │ ├──────────┼─────┤ ruler  │ │  scheduled day mark, overtime in marigold
│ │ [        Check out       ]│ │  primary action in thumb reach
│ └───────────────────────────┘ │
│ This week so far  ₹4,320.00   │  estimate, labelled as such
│ Needs your attention          │  only when something does
│ Your records            ›     │  plain rows, not a card grid
├──────────────────────────────┤
│ Home  Shifts  Pay  Safety  More│  bottom bar + safe area
└──────────────────────────────┘
```

Worker, wide screens (≥ 960 px): a left rail replaces the bottom bar; content stays in a readable column (max 760 px).

Administrator: an aubergine sidebar (≥ 1024 px) or a top bar with a menu sheet below that. Dense but ruled tables, filters above tables, and actions in rows. The dashboard leads with what needs action, then a single ledger of period figures, then trends.

Text is left-aligned throughout; numbers in tables are right-aligned.

## Navigation

- Worker bottom bar: Home, Shifts, Pay, Safety, More. "More" opens a sheet with Feedback, Skill passport, language and sign out. Active destination: aubergine label with a marigold bar.
- Sheets slide up from the bottom on phones and appear as centred dialogs on wide screens. They close with Escape, the backdrop or the close button, and return focus to the control that opened them.
- Language is always one tap away in the top bar and shows its options in their own scripts.

## Motion

- 120 ms for colour and state, 200 ms for sheets and dialogs, 420 ms for the two orchestrated moments: the time card ruler filling on Home and the jar filling on Pay.
- Motion answers an action (opening, confirming, checking in). There are no entrance animations on scroll and no hover lifts on cards.
- `prefers-reduced-motion: reduce` removes all of it.

## Breakpoints

| Name    | Width      | Changes                                          |
| :------ | :--------- | :----------------------------------------------- |
| Phone   | < 600 px   | Bottom bar, single column, stacked tables        |
| Tablet  | 600–959 px | Wider gutters, two-column records where they fit |
| Desktop | ≥ 960 px   | Worker rail; sheets become dialogs               |
| Console | ≥ 1024 px  | Admin sidebar                                    |

## Review against generic defaults

The first plan was checked against what a template would produce for the same brief, and changed where it matched:

- **Stat-card dashboard with an icon grid of quick links** → replaced by the time card, an attention list that appears only when needed, and plain record rows.
- **Inter for everything** → replaced by Atkinson Hyperlegible Next (a reason specific to this audience) with Bricolage Grotesque for display and figures.
- **Hazard stripes as a safety theme** → limited to critical severity and dangerous heat, where they carry meaning.
- **Ice Silver as the full-page background** → too flat at large sizes; a lighter step is used for the canvas and the brand silver for lines and wells.
- **All-caps eyebrow labels, middle-dot meta strings, arrow-suffixed links** → not used.
