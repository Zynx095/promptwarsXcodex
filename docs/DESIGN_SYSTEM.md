# FairShift Design System: Glassmorphism V2

FairShift keeps records of work and pay for people on construction sites, factory floors, hospital wards and campuses, and lets them report danger. Most workers use a mid-range Android phone, often outdoors, in one of six languages, with varied reading confidence. Site managers use a laptop.

The screens are shaped like the records they show: a **time card** for the working day, a **money jar** and a **pay statement** for wages, a **receipt with a seal** for verifiable records, and a **case file with a lifecycle** for safety reports. Glassmorphism V2 is the material those records are made of: frosted panels over a softly lit, ruled background, smoked aubergine glass for the parts that hold your place (the time card and navigation), and lit marigold for the one action that matters.

This document describes what is implemented in `src/client/styles/`. Values live in `tokens.css`; `glass.css` is the one place that decides which surface wears which material.

## Principles

1. **Records, not widgets.** Content is shaped like what it is. Glass is the material of a record, not decoration added to it.
2. **Materials have jobs.** A panel, a floating sheet, a control and a recessed well are different kinds of glass. Nothing gets transparency and blur just to look modern.
3. **Readable before beautiful.** Every fill is tested for text contrast over the darkest point of the background. Where reading matters most (pay statements, tables, form fields, legal notices) the glass is almost opaque.
4. **Numbers first.** Hours and rupees are the largest type on any screen they appear on, in tabular figures with their unit.
5. **Say exactly what is known.** Unknowns are labelled as unknown ("Payment not recorded in FairShift"), never shown as zero. Nothing in the visual design implies a payment, a verification or anonymity that the data does not support.
6. **Thumb first.** On phones the main action sits in the lower half of the screen, targets are at least 44 px (48 px for buttons and fields) and the main destinations live in a floating tab bar.
7. **One bold element per screen.** The time card on Home, the jar on Pay, the seal on a receipt, the lifecycle on a report, the gate code on the console's shift page.

## Atmosphere

One fixed layer behind the whole app (`body::before` and `body::after` in `base.css`), painted once and composited. It is never animated or filtered.

| Layer         | Token                                   | What it does                                                                        |
| :------------ | :-------------------------------------- | :---------------------------------------------------------------------------------- |
| Dusk wash     | `--atmo-dusk` `#EEEBF3` → `--fs-canvas` | A faint lilac at the top fading into the Ice Silver canvas                          |
| Orchid light  | `--atmo-orchid` `rgba(214,176,206,.36)` | Aubergine light from the upper left                                                 |
| Marigold lamp | `--atmo-lamp` `rgba(234,170,0,.2)`      | Warm light low on the right                                                         |
| Silver sheen  | `--atmo-sheen`                          | A highlight near the top right                                                      |
| Ledger rules  | `--atmo-rule` `rgba(58,15,52,.045)`     | Horizontal rules every 32 px, fading out down the screen; glass visibly frosts them |
| Floor         | `--atmo-floor` `#DDCCDD`                | The darkest colour the layers produce together; all contrast is checked against it  |

The lights are luminous tints, never dark, so text placed directly on the canvas keeps its contrast. No blobs, noise or moving backgrounds.

## Glass materials

| Material    | Tokens                                  | Fill                                             | Blur (desktop / phone) | Used for                                                                                                       |
| :---------- | :-------------------------------------- | :----------------------------------------------- | :--------------------- | :------------------------------------------------------------------------------------------------------------- |
| Primary     | `--glass-1-*`                           | White, 86% at the lit upper left to 66%          | 18 / 12 px, saturate   | Records and panels: cards, row lists, the week record, the jar, a report case, the heat check, console ledgers |
| Secondary   | `--glass-2-*`                           | White 50%                                        | 10 / 8 px              | Supporting panels on the canvas: "nothing needs attention", empty states, the add-skill form                   |
| Paper       | `--glass-paper` with the primary filter | White 94%                                        | 18 / 12 px             | Pay statements and table frames, where every figure must read cleanly                                          |
| Floating    | `--glass-float-*`                       | White 94% to 88%                                 | 28 / 20 px, saturate   | Sheets and dialogs, over a tinted (not blurred) scrim                                                          |
| Bar         | `--glass-bar-*`                         | White 74%                                        | 18 / 12 px             | Top bars that content scrolls beneath                                                                          |
| Smoked      | `--glass-dark-*`, `--glass-dark-glint`  | Aubergine 93% to 95%, orchid and marigold glints | 20 / 16 px             | The time card, the worker tab bar and rail, the console sidebar, the gate code, the sign-in story              |
| Interactive | `--glass-control-*`                     | White 82% to 60%; pressed is an aubergine tint   | none                   | Secondary buttons, choice tiles, chips, language and bell buttons, demo accounts, rating faces, versions       |
| Well        | `--glass-well`, `--glass-well-edge`     | Aubergine 4.5% with a hairline                   | none                   | Recessed areas inside glass: explanations, privacy notes, receipt facts, the segmented control track           |
| Field       | `--glass-field`                         | White 90%, solid white when focused              | none                   | Inputs, selects and text areas                                                                                 |

Every material has a lit top edge (`inset 0 1px 0` white) and a hairline ring; floating and smoked glass have the deepest shadows. Rules that keep the system cheap and legible:

- **Only panels, bars and floating layers blur.** Controls, wells and fields sit on glass already, so they are translucent without a filter of their own.
- **Glass inside glass never filters again** (a table inside a card, a card inside a sheet).
- **Phones get smaller blur radii**, which cost less to draw on mid-range hardware.
- **Blur is never animated.** Motion uses transform and opacity only.
- **Sheets render in an overlay layer**, outside any glass panel. A panel with `backdrop-filter` becomes the containing block for fixed-position descendants, so a sheet rendered inside one would be clipped by it.

### Fallbacks

- Without `backdrop-filter` support (`@supports not`), every fill token is replaced by an opaque colour of the same tone.
- With `prefers-reduced-transparency: reduce`, the same opaque fills apply and filters are removed.
- In print, glass, shadows and the atmosphere are removed; records print black on white.

## Colour

| Token                    | Hex                               | Use                                                      |
| :----------------------- | :-------------------------------- | :------------------------------------------------------- |
| `--fs-aubergine`         | `#3A0F34`                         | Brand, headings, navigation, smoked glass                |
| `--fs-aubergine-deep`    | `#24081F`                         | Text on marigold, the deepest smoked tone                |
| `--fs-silver`            | `#DDE3E8`                         | Ice Silver: hairlines, the glass tint at the jar's edge  |
| `--fs-canvas`            | `#EEF1F4`                         | The canvas under the atmosphere                          |
| `--fs-marigold`          | `#EAAA00`                         | The one action that matters; active navigation; overtime |
| `--fs-marigold-lit`      | `#F4C02A`                         | The lit top of marigold buttons and fills                |
| `--fs-ink` / `-2` / `-3` | `#2B1027` / `#5E4659` / `#654E5E` | Body, secondary and tertiary text                        |

States use paired text/background/line tokens: good `#0B6340`, caution `#7A4A00` on `#FFF3CF`, danger `#A3122F` on `#FCE8EC`, info `#1F4E8C` on `#E5EEF9`. State panels (receipt seals, the heat result, alerts) keep solid tints so their meaning never depends on what is behind them. Hazard tape is reserved for critical severity and extreme heat.

Contrast (WCAG 2.2 AA), checked in `tests/unit/design-tokens.test.ts`:

- Secondary and tertiary text, and every state colour, on the atmosphere floor: 4.8:1 or more.
- Ink, secondary, tertiary and state text on every light material at its least opaque stop, over the floor: 4.5:1 or more.
- Light text on smoked glass at its most see-through stop over a white page: on-dark 7:1, on-dark-2, on-dark-3 and marigold 4.5:1 or more.
- Deep aubergine on every marigold stop (lit, base, hover): 7:1 or more.

## Type

- **Display and figures: Bricolage Grotesque** for headings, money, hours, times and counts, with tabular figures.
- **Text: Atkinson Hyperlegible Next**, designed to keep easily confused characters apart. Its digits and ₹ come from Bricolage (`FairShift Text`), so amounts look the same everywhere.
- **Indic scripts** use the platform fonts with a taller line height.
- Scale (16 px base): 13, 14, 16, 18, 21, 26, 34, 44 and 56 px.

## Space and shape

- 4-point spacing: 4, 8, 12, 16, 20, 24, 32, 40, 56. Page gutter 16 px on phones, 24 px on tablets, 32 px on wide screens.
- Radius follows hierarchy: chips are pills, controls 12 px, records 14 px, glass panels and slabs 20 px, sheets and the tab bar 22 to 24 px.

## Navigation

- **Worker, phones:** a floating tab bar of smoked glass (Home, Shifts, Pay, Safety, More), inset 12 px from the screen edges and above the safe area. A lens of lighter glass sits behind the current destination and glides to the next one (CSS only, from `aria-current`); the current icon turns marigold. Items are 52 px tall.
- **Worker, from 960 px, and console, from 1024 px:** a floating smoked column with the organisation, navigation and account. Both use the same link style: a glass lens behind the current page and a glowing marigold mark on its edge.
- **Top bars** are glass that content scrolls under.
- **Sheets** rise from the bottom on phones and are centred dialogs from 600 px; they trap focus, close with Escape or the backdrop and return focus to the opener.

## Motion

| Moment                    | Duration and easing                          |
| :------------------------ | :------------------------------------------- |
| Colour and state          | 120 ms                                       |
| Dialog in                 | 260 ms, `--ease-glide`                       |
| Sheet up (phones)         | 320 ms, `--ease-glide`                       |
| Tab lens moving           | 420 ms, `--ease-glide`                       |
| Expanding sections        | 200 ms fade and settle                       |
| Time card ruler, jar fill | 420 to 640 ms, once, when they appear        |
| "On shift" dot            | a slow ring every 2.4 s while the clock runs |

Pressed controls scale down slightly; row chevrons nudge on hover. There are no entrance animations on scroll and no hover lifts on cards. `prefers-reduced-motion: reduce` removes all of it.

## Components and patterns

| Pattern                 | Material           | Notes                                                                                                                                                                                                                |
| :---------------------- | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time card               | Smoked             | Status with a live dot, hours so far, a ruler cut into the glass (recorded, running, marigold overtime), check in or out with confirmation                                                                           |
| Money jar               | Primary, glass jar | A lit glass jar: aubergine liquid for regular pay, marigold for overtime, a hatch for deductions, a dashed agreed line. Take-home pay sits in a lit well. "Paid to you" is shown as not recorded, never as an amount |
| Statement               | Paper              | Ruled ledger grouped as hours, earnings, deductions; numbered calculation in a well                                                                                                                                  |
| Receipt and seal        | Floating sheet     | The seal is a lit glass stamp whose colour, icon and words name the result; it says what was checked and what it does not prove                                                                                      |
| Case file and lifecycle | Primary            | Five steps (reported, seen, being fixed, fixed, checked); the current step glows marigold; a timeline of every recorded step                                                                                         |
| Heat check              | Primary            | Sliders, preset chips, the result in a solid state tint, advice and sources; states that it is an estimate, not a measurement                                                                                        |
| Notifications           | Floating sheet     | New and earlier groups in a glass list; unread items carry a marigold dot and a warm wash                                                                                                                            |
| Gate code               | Smoked             | The rotating site check-in code in glowing marigold figures                                                                                                                                                          |
| Action list and ledgers | Primary            | Console dashboard: what needs action first, then the period's figures                                                                                                                                                |
| Tables                  | Paper              | Ruled, numbers right-aligned; on phones they keep a minimum width and scroll inside their frame with edge shadows                                                                                                    |

## Stylesheets

`tokens.css` (values), `fonts.css`, `base.css` (atmosphere, type, focus, motion, print), `primitives.css`, `shell.css`, one file per feature (`timecard`, `records`, `home`, `jar`, `statement`, `attendance`, `receipt`, `safety`, `heat`, `notifications`, `login`, `voice`, `dispute`, `console`), and `glass.css` last.

`glass.css` lists the surfaces for each material. To change a surface's material, move it between lists; do not restate colours, shadows or filters in feature files. Feature files that need to override a material property must use a more specific selector, because `glass.css` loads last.

## Language and script

- Every worker-facing string is in all six dictionaries. A unit test fails if Kannada, Tamil, Telugu or Bengali text contains Devanagari letters, or if less than 95% of a language's strings are in its own script.
- Still English: the employer console, server-generated notification text and alert details, and the dispute notice document.

## Verification

See [GLASSMORPHISM_V2_FINAL_REPORT.md](GLASSMORPHISM_V2_FINAL_REPORT.md) for the browser sweep, accessibility, rendered contrast and test results.

## Appearance themes (final update)

Three appearances share one set of tokens. Light is the `:root` block in `src/client/styles/tokens.css`; Dark and Night redefine the same tokens under `:root[data-theme='dark']` and `:root[data-theme='night']` in `src/client/styles/themes.css`, which also fixes the few surfaces that used literal light colours (sheet footers, table hovers, chart labels, skeletons, the danger button). Their opaque fallbacks (no `backdrop-filter`, or reduced transparency) sit at the end of `tokens.css`.

- **Dark:** deep aubergine-black glass with clear card edges; aubergine text and lines become an orchid tint (`#e5b7da`); marigold is unchanged and still carries dark text.
- **Night:** for night shifts and long reading. Darker canvas, no pure white text (`#e2d7dd`), a dimmed marigold (`#d39c1c`, still 7:1 under dark text), a quieter atmosphere and no glows.
- **System** follows `prefers-color-scheme`. The choice is stored as `fairshift.theme` on the device; `public/theme-init.js` applies it before the first paint and `src/client/lib/theme.tsx` takes over.
- QR codes always keep a white quiet zone so scanners can read them.
- `tests/unit/themes.test.ts` checks every theme's text against every glass material over its darkest background (WCAG AA, 7:1 for body text and the main action).
