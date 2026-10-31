# FairShift Glassmorphism V2: final visual pass

Scope: the visual language of the worker app and the employer console, on top of the V4.2 redesign (`fff9bdd`). Navigation, layouts, copy and every server behaviour from V4.2 are kept. The one code change beyond styling is described under "Functional change" below. Nothing was pushed or deployed. The full design rules are in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

## 1. Design philosophy

FairShift's screens are shaped like the records they show: a time card, a money jar, a pay statement, a sealed receipt, a safety case file. Glassmorphism V2 makes those records out of glass that sits on a lit, ruled background:

- **Frosted glass** for the records themselves, blurring faint ledger rules behind them, so the material is visible rather than implied.
- **Smoked aubergine glass** for what holds your place: the time card, the floating tab bar, the worker rail, the console sidebar and the gate code.
- **Lit marigold** for the one action that matters on a screen, for overtime and for the current destination.
- **Near-opaque paper** wherever reading comes first: pay statements, tables, form fields and the dispute notice.

The materials have jobs, so they differ: not every element gets the same transparency and blur. Contrast is designed against the darkest point the background reaches, and tested.

## 2. Glass materials

| Material    | Fill                                             | Blur (desktop / phone) | Used for                                                                           |
| :---------- | :----------------------------------------------- | :--------------------- | :--------------------------------------------------------------------------------- |
| Primary     | White 86% (lit upper left) to 66%                | 18 / 12 px             | Cards, row lists, week record, money jar, report case, heat check, console ledgers |
| Secondary   | White 50%                                        | 10 / 8 px              | Calm panels on the canvas, empty states, the add-skill form                        |
| Paper       | White 94%                                        | 18 / 12 px             | Pay statement, table frames                                                        |
| Floating    | White 94% to 88%                                 | 28 / 20 px             | Sheets and dialogs                                                                 |
| Bar         | White 74%                                        | 18 / 12 px             | Top bars                                                                           |
| Smoked      | Aubergine 93% to 95%, orchid and marigold glints | 20 / 16 px             | Time card, tab bar, worker rail, console sidebar, gate code, sign-in story         |
| Interactive | White 82% to 60%; pressed aubergine tint         | none                   | Secondary buttons, tiles, chips, language and bell buttons, rating faces           |
| Well        | Aubergine 4.5% with a hairline                   | none                   | Explanations, privacy notes, receipt facts, segmented control track                |
| Field       | White 90%, solid when focused                    | none                   | Inputs, selects, text areas                                                        |

Each material has a lit top edge and a hairline ring; floating and smoked glass have the deepest shadows. `glass.css` is the single place that assigns materials to surfaces.

## 3. Colour and typography tokens

- Brand kept exactly: Deep Aubergine `#3A0F34`, Ice Silver `#DDE3E8`, Marigold `#EAAA00`. Added `--fs-marigold-lit` `#F4C02A` for lit marigold surfaces.
- Adjusted for contrast on the new background: tertiary ink `#77606F` → `#654E5E`, the good state `#0D6B43` → `#0B6340`, marigold ink `#8A5A00` → `#7A5000`, tertiary text on dark `#B49AAE` → `#C8B1C2`.
- Type is unchanged: Bricolage Grotesque for display and figures, Atkinson Hyperlegible Next for text, platform fonts for Indic scripts, 13 to 56 px scale.

## 4. Lighting and depth

- **Atmosphere** (one fixed layer, painted once, never animated or filtered): a dusk wash at the top, orchid light from the upper left, a marigold lamp low on the right, a silver sheen and horizontal ledger rules every 32 px that fade down the screen. The lights are luminous tints, so the darkest colour they produce together (`--atmo-floor` `#DDCCDD`) still leaves secondary text at 5.5:1 and tertiary text at 4.9:1.
- **Depth** comes from the materials: wells sit below panels, panels sit on the canvas, the top bar and tab bar float over content, sheets float over a tinted scrim.
- **Light inside the glass:** smoked glass catches orchid and marigold glints; the time card has a soft reflection along its top edge and a ruler cut into it like a groove; marigold elements (overtime, the gate code, the current lifecycle step, the active navigation mark) glow faintly.

## 5. Worker screens

| Screen               | What changed                                                                                                                                                                                                                         |
| :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation           | Floating smoked tab bar with a glass lens that glides to the current destination and a marigold icon; on wide screens a floating smoked rail                                                                                         |
| Home                 | Smoked-glass time card with a live "on shift" ring, a grooved ruler with glowing overtime, glass fact tiles and a lit check-out button; the week record, attention list and record rows on frosted glass                             |
| Money Jar            | A lit glass jar: silver-tinted glass, aubergine liquid for regular pay, marigold for overtime, a meniscus highlight, reflections and a shadow; take-home pay in a lit well. Figures and the "payment not recorded" row are unchanged |
| Shifts and receipts  | Paper-glass table, frosted range picker; the receipt sheet on floating glass with the seal as a lit glass stamp whose colour, icon and words name the result                                                                         |
| Pay statement        | Paper glass, so every figure reads as on paper; the calculation steps in a well                                                                                                                                                      |
| Safety and case file | Report case on frosted glass; the current lifecycle step glows marigold; the timeline's latest step glows; hazard and severity tiles use interactive glass                                                                           |
| Heat check           | Frosted panel, glass preset chips; the result keeps a solid state tint and still says it is an estimate                                                                                                                              |
| Notifications        | Floating glass sheet with the list in a glass well; unread items carry a marigold dot and a warm wash                                                                                                                                |
| Forms and dialogs    | Frosted fields with a lit focus ring, interactive-glass tiles that lift when chosen, floating-glass sheets that glide in                                                                                                             |
| Sign-in              | Smoked-glass story pane (one continuous pane on wide screens), frosted sign-in panel, glass demo-account tiles                                                                                                                       |

## 6. Employer console

| Area              | What changed                                                                                                        |
| :---------------- | :------------------------------------------------------------------------------------------------------------------ |
| Sidebar           | Floating smoked column; the same lens-and-marigold-mark link style as the worker rail                               |
| Top bar and menu  | Glass top bar; the phone menu is a floating glass sheet                                                             |
| Dashboard         | "Needs action" and the ledgers on frosted glass; chart bars with lit gradients                                      |
| Tables            | Paper glass for density; the scroll-edge shadows now show (a duplicate solid background had hidden them since V4.2) |
| Filters and chips | Interactive glass; the chosen chip is aubergine with a lit edge                                                     |
| Safe Signal       | Frosted panel with glass pattern cards; copy unchanged                                                              |
| Gate code         | Smoked glass with glowing marigold digits                                                                           |

Tables on phones still scroll sideways inside their frame rather than turning into cards. The glass frame and the working edge shadows make the scroll visible, but the density remains.

## 7. Navigation and interaction

- Tab lens glides between destinations (CSS only, driven by `aria-current`); current icons turn marigold and rise 1 px.
- Sheets glide up on phones (320 ms) and dialogs settle in (260 ms) with the same easing; expanding sections fade and settle.
- Pressed controls scale down slightly; chosen tiles lift; row chevrons nudge on hover.
- Blur is never animated; only transform and opacity move. `prefers-reduced-motion` removes all motion.

## 8. Accessibility verification

- **axe-core 4.14, WCAG 2.0, 2.1 and 2.2 A and AA rules**, against the production build: 18 worker and console screens at 390 px and 12 interactive states (language, notification and More sheets, a receipt, the check-out confirmation, hazard form errors, the dispute sheet, Tamil home, the console menu, the add-worker and deactivate dialogs, sign-in at 360 px). No violations.
- **Rendered text contrast.** axe cannot judge text on gradients and blurred glass, so a separate check measured the real pixels. For each visible run of text, the page was captured with all text made transparent, and the text colour was compared with every background pixel under it (the 2nd-percentile worst pixel, so one anti-aliased edge does not decide the result). Text covered by something else (a scrim, the floating tab bar) or scrolled out of a sheet's own scroll area was skipped, because it is not visible there. Threshold 4.5:1, or 3:1 for large text. Result: **2,883 text runs across 80 screens and states (the 32 screenshot states, plus 24 screens at 390 px and at 1440 px), no failures.**
- The first rendered run found one real problem, fixed before the final run: tertiary text on smoked glass (the organisation's industry in the sidebar, the "In" label on the time card) measured 4.3:1 to 4.5:1 where the orchid glint brightens the glass, so `--fs-on-dark-3` was lightened from `#B49AAE` to `#C8B1C2`. The checker itself also had to learn to skip text hidden behind the floating tab bar or clipped by a sheet.
- Unit tests (`tests/unit/design-tokens.test.ts`) check contrast through every material at its least opaque stop over the darkest point of the background, the opaque fallback, reduced motion and reduced transparency, 44 px minimum targets (tab bar items are 52 px, buttons and fields 48 px) and the 3 px focus ring (marigold on smoked glass).
- Kept from V4.2: semantic HTML, labels, focus trapping in sheets, states named in words and not by colour alone.

## 9. Performance

- Only panels, bars and floating layers use `backdrop-filter`. Controls, wells and fields do not, and glass inside glass never filters twice.
- Blur radii are smaller on phones (8 to 20 px instead of 10 to 28 px).
- The atmosphere is one fixed layer of gradients behind the app, never animated or filtered. The sheet scrim is tinted, not blurred, so no full-screen blur is ever drawn.
- No animation touches a filter. The one continuous animation is the small "on shift" ring, which uses transform and opacity.
- Build size: client JavaScript 461.5 kB (134.4 kB gzipped), unchanged from V4.2; CSS 97.4 kB (19.1 kB gzipped).

Not measured: frame rates on a physical mid-range Android phone.

## 10. Responsive verification

Headless Microsoft Edge against the production build, 24 worker and console screens at each of 360×800, 375×812, 390×844, 412×915, 768×1024, 1280×800 and 1440×900 (168 captures):

- No horizontal scrolling on any capture.
- No console errors except the expected 401 from the session check before sign-in.
- One planned state could not be opened at any size: the worker report case for Ravi Kumar, because that account has no reports in the seeded data. The report case is covered by screenshot 22 (Lakshmi Devi) and by the console report case (32).

The floating tab bar, the floating rail and sidebar, sheets and the glass top bars were checked visually at phone, tablet and desktop widths in the screenshots below. No physical device was used.

## 11. Test results

| Check                                         | Result                                                                                                 |
| :-------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| `npm test`                                    | 39 files, 334 tests, all passing (V4.2: 328; the design-token test grew from 6 to 12 checks)           |
| Typecheck, lint                               | Pass                                                                                                   |
| `npm run format:check`                        | Fails only on the four Markdown files added in `b4a351b`; every file changed in this pass is formatted |
| Client and server production builds           | Pass                                                                                                   |
| HTTP walk-through on a fresh production build | 57 of 57 checks passed                                                                                 |
| axe-core                                      | 30 screens and states, no violations                                                                   |
| Rendered text contrast                        | 2,883 text runs on 80 screens and states, no failures                                                  |
| Seven-viewport sweep                          | 168 captures, no horizontal scrolling                                                                  |

## 12. Screenshots

32 states in `docs/screenshots/glass-v2/` (JPEG, about 2.2 MB, with `report.json` recording overflow and console errors for each), taken from a fresh production build:

- Worker: sign-in on a phone and a desktop (01, 02); home on a phone, with the week and attention list, in Tamil, on a tablet and on a desktop with the rail (03, 04, 06, 07, 08); the check-out confirmation (05); shift history and a receipt seal (09, 10); the Money Jar (11); the pay statement (12); the dispute notice (13); the heat check at an extreme reading (14); the hazard form with and without errors (15, 16); notifications, language and More sheets (17 to 19); feedback and the skill passport (20, 21); a report case with its lifecycle (22).
- Console: dashboard on desktop and phone (23, 24); the menu sheet (25); workforce with the deactivate confirmation and the add-worker sheet (26 to 28); sites (29); shifts with the gate code (30); the report queue with Safe Signal (31); a report case (32).

They are not committed, because tracked files are already over the 10 MB submission limit.

## 13. Functional change

`Sheet` now renders into an overlay layer placed in each shell (worker, console, sign-in) through a React portal. An element with `backdrop-filter` becomes the containing block for fixed-position descendants, so sheets opened from inside glass panels (the time card's check-out confirmation, receipt sheets from table rows, the language and notification sheets from the top bar) would otherwise have been positioned and clipped by the panel. Markup, focus trapping, Escape and focus return are unchanged; outside a shell a sheet still renders in place. Print rules for receipts and dispute notices follow the new location.

No server code, calculation, schema, permission, proof, Safe Signal threshold, accountability state, CSV or legal notice text was changed. The Money Jar's SVG changed only in presentation (gradients, highlights); every figure and the "payment not recorded" statement come from the same model.

## 14. Commits

All on `main` after `fff9bdd`; nothing amended, squashed or rebased.

| Commit    | Change                                                                                                                                |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `4f94f03` | Sheets render in a shell overlay layer (the functional change above)                                                                  |
| `5547ebb` | Material, atmosphere and motion tokens; `glass.css`; the rewritten design-token test                                                  |
| `4492f76` | Shared primitives on glass (fields, buttons, tiles, chips, sheets, tables)                                                            |
| `b62f6c5` | Floating smoked-glass navigation                                                                                                      |
| final     | "glass morphism": the worker and console screens, the glass Money Jar, the contrast fix for text on smoked glass, and these documents |

The final HEAD is that last commit.

## 15. Remaining limitations

1. **Not tested on physical devices** or with TalkBack and VoiceOver; blur performance on low-end phones is designed for (smaller radii, few filtered layers) but not measured.
2. **Console tables on phones** still scroll sideways rather than reflowing.
3. **Repository size:** tracked files are over the 10 MB submission limit, mainly the PNGs in `docs/screenshots/` from `b4a351b`. The screenshots for this pass are therefore not committed.
4. **Translations** of Tamil, Telugu and Bengali still need a native-speaker review; the console, server-generated text and the dispute notice are English only.
5. **Formatting:** four Markdown files from `b4a351b` fail `prettier --check`.
6. **Add worker** still pre-fills the first PIN with 1234 (unchanged behaviour).
