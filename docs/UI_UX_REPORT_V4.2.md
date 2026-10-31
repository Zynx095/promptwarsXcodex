# FairShift V4.2: interface redesign report

Scope: the worker app and the employer console, redesigned for phones first, without changing payroll, attendance, authentication, proof, Safe Signal or any other server logic. The design system is described in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

Baseline: `acf10eb` (end of the V4.1 engineering audit). Head at the end of this phase: see the commit list below. Nothing was pushed or deployed.

## 1. Design summary

FairShift's screens are shaped like the records they show, not like a dashboard template: a **time card** for the working day, a **money jar** and a **ruled statement** for pay, a **receipt with a seal** for verifiable records, and a **case file with a five-step lifecycle** for safety reports. Each screen has one bold element; everything around it is quiet.

- Brand kept: Deep Aubergine `#3A0F34` for structure and dark slabs, Ice Silver `#DDE3E8` for lines and wells (a lighter step for the canvas), Marigold `#EAAA00` for the single main action and the current navigation item.
- Type: Atkinson Hyperlegible Next for text (built to keep similar characters apart for low-vision and low-literacy readers) and Bricolage Grotesque for headings, money and hours. Digits and ₹ come from Bricolage everywhere, so amounts look the same in text and in figures. Indic scripts use the platform fonts with taller line height.
- No glass, gradients or hover lifts. Motion is limited to sheets opening and two moments (the time card ruler and the jar filling); `prefers-reduced-motion` removes it.
- Copy says exactly what is known: payment is "not recorded in FairShift" rather than zero; a receipt seal says what was checked and that it does not prove the recorded times were right; Safe Signal and feedback say thresholds make people harder to single out, not impossible.

## 2. Screens

**Worker (phones first, rail from 960 px)**

| Screen              | What changed                                                                                                                                                                                                                                 |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell               | Bottom bar (Home, Shifts, Pay, Safety, More) with safe-area padding; More sheet for feedback, skills, account and sign out; light rail with every destination on wide screens; top bar with the sample-data chip, language and notifications |
| Sign-in             | Short aubergine band, then the form in thumb reach, demo accounts as tiles, then what FairShift does; methods named plainly; unavailable methods say they are not set up on this server                                                      |
| Home                | Time card, this week's estimate with hours by day, what needs attention (only when something does), record rows                                                                                                                              |
| Shifts              | Day rows with corrections and site-code check-ins marked; receipt sheet with seal, facts, pay for the shift and every version with who changed it and why                                                                                    |
| Pay                 | Money jar, issued payslips, how this week's pay is calculated; payslip statement that prints on its own                                                                                                                                      |
| Dispute notice      | Two-step sheet: what is wrong and the worker's own words, then the printable notice (unchanged wording, plain paper styling)                                                                                                                 |
| Safety              | Report list with lifecycle bars; hazard form with icon tiles, severity tiles and a named or confidential choice; report case with the five-step path and the timeline; heat check that states it is an estimate                              |
| Notifications       | Sheet with new and earlier groups, kinds, relative times and links                                                                                                                                                                           |
| Feedback and skills | Topic tiles and a face scale with the ends named; privacy notes next to the send button; skill passport as one record                                                                                                                        |
| Language            | Sheet listing every language in its own script; switching keeps the current page                                                                                                                                                             |

**Employer console (sidebar from 1024 px, menu sheet below)**

| Screen              | What changed                                                                                                                                               |
| :------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell               | Aubergine sidebar with the organisation, navigation and account; top bar with a menu sheet on smaller screens                                              |
| Dashboard           | What needs action first, then attendance and safety ledgers whose rows link to their records, then trends with the peak marked, activity and feedback      |
| Workforce, sites    | Toggle-chip filters with counts, styled row actions, confirmations before deactivating, add forms as sheets; site copy now matches what the site list does |
| Shifts              | Site check-in code as a gate display; compact filters                                                                                                      |
| Safety report queue | Honest Safe Signal copy, lifecycle bars in rows, readable severities                                                                                       |
| All tables          | Contained horizontal scrolling on phones with an edge shadow                                                                                               |

## 3. Defects found and fixed along the way

- Tamil, Telugu and Bengali were largely Hindi (175, 188 and 188 strings with Devanagari letters). Translated, with a regression test. The V4.1 audit's localization section now carries a correction.
- About 50 layout class names used by components were never defined in the CSS.
- Links inside sheets did a full page load because the router's link replaced the navigation handler with the caller's.
- A visually hidden table header escaped its scroll container and widened console pages on phones.
- The console top bar overflowed at 360 px; the old heat widget overflowed at 360 to 390 px.
- Check-out used the browser's untranslated confirm box; the dispute notice overwrote the worker's statement when the category changed; the sites page used `window.alert` and described site codes as appearing on records, which they do not.
- `tests/unit/design-tokens.test.ts` failed from the first commit of this phase (it read tokens from the old stylesheet) until `11d461a`, because only the client tests were run per commit at that point. After that the full suite was run regularly, and it passes at the end of the phase.

## 4. Verification

| Check                                           | Result                                                                                                                                                                                                                                              |
| :---------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit and integration tests (`npm test`)         | 39 files, 328 tests, all passing                                                                                                                                                                                                                    |
| Typecheck, lint                                 | Pass                                                                                                                                                                                                                                                |
| Format (`npm run format:check`)                 | Fails on four Markdown files added in `b4a351b` (benchmark and roadmap documents); every file changed in this phase passes                                                                                                                          |
| Client and server builds                        | Pass (main bundle 460 kB, 134 kB gzipped; each language loads separately, 39 to 52 kB)                                                                                                                                                              |
| HTTP walk-through on a fresh production build   | 57 of 57 checks passed                                                                                                                                                                                                                              |
| Browser sweep, headless Microsoft Edge          | 24 worker and console screens at 360×800, 375×812, 390×844, 412×915, 768×1024, 1280×800 and 1440×900: no horizontal scrolling after the 360 px console fix; no console errors except the 401 before sign-in and a deliberate 400 from an empty form |
| Accessibility, axe-core 4.14, WCAG 2.2 AA rules | 18 screens and 12 interactive states (sheets, dialogs, form errors, Tamil): no violations after fixing target size and a non-focusable scrolling table                                                                                              |

Not verified: real Android or iOS devices and their screen readers, printing to paper, Google, GitHub and SMS sign-in against real providers, and right-to-left scripts (none are supported).

## 5. Screenshots

32 states were captured to `docs/screenshots/v4.2/` (JPEG, about 2.2 MB in total): sign-in on a phone and a desktop; worker home on a phone, tablet and desktop and in Tamil; check-out confirmation; shift history and the receipt seal; Money Jar and the payslip statement; the dispute notice preview; the heat check at an extreme reading; the hazard form with and without errors; notifications, language and More sheets; feedback and skill passport; a report case; the console dashboard on desktop and phone; the console menu; workforce with its confirmation and add sheet; sites; shifts with the gate code; the report queue with Safe Signal; and the console report case. `report.json` in the same folder records overflow and console errors for each. They are not committed: tracked files already total about 11.3 MB, over the 10 MB submission limit, mostly because of `docs/screenshots/*.png` from `b4a351b`.

## 6. Commits in this phase

All on `main`, after `acf10eb`, none amended or rebased. `b4a351b` (competitive audit documents and screenshots) was committed separately during this phase and is not part of the redesign.

| Commit               | Change                                                         |
| :------------------- | :------------------------------------------------------------- |
| `3abd56e`            | Design tokens and type system                                  |
| `d9baef7`            | Shared primitives on the new tokens                            |
| `0f20471`, `48790b6` | Worker shell: bottom bar, More sheet, rail                     |
| `f000961`            | Time card                                                      |
| `8b680fc`            | Language picker                                                |
| `8c5359e`            | Worker home                                                    |
| `0106931`            | Money Jar                                                      |
| `867809f`            | Pay screen and payslip statement                               |
| `ac5c7fe`            | Shift history                                                  |
| `c6e4ff4`            | Receipt and seal                                               |
| `e07206f`            | Hazard report form                                             |
| `30f3d16`            | Report case and lifecycle                                      |
| `381fd18`            | Heat check                                                     |
| `1c8e62b`            | Notification centre                                            |
| `52db182`            | Sign-in page                                                   |
| `526720b`            | Feedback and skill passport                                    |
| `11d461a`            | Design token test moved to the split stylesheet                |
| `8933f5a`            | Dispute notice sheet                                           |
| `a1ad4aa`            | Router link fix                                                |
| `6df5a5e`            | Console shell and dashboard                                    |
| `b0abc5d`            | Console tables, filters, confirmations; old stylesheet removed |
| `13aae88`            | Console copy                                                   |
| `675c9ab`            | Tamil, Telugu and Bengali translations and script test         |
| `e953981`            | Correction in the V4.1 audit                                   |
| `5a938cd`            | Console bar at 360 px; worker-only report note                 |
| `b0db5c6`            | Accessibility fixes                                            |
| `a8d6331`            | Invalid-state styling                                          |

This report and the design system update are in the final commit of the phase.

## 7. Remaining issues

1. **Repository size:** tracked files are about 11.3 MB, over the 10 MB limit, mainly the PNG screenshots in `docs/screenshots/` from `b4a351b`. Compressing or removing them is the owner's decision.
2. **Translations need native-speaker review**, especially the Tamil, Telugu and Bengali text written in this phase.
3. **Still English:** the employer console, server-generated notification and alert text, the dispute notice document, and the demo PIN hint from the server.
4. **Formatting:** four Markdown files from `b4a351b` fail `prettier --check`.
5. **Console tables on phones** scroll sideways rather than reflowing into cards; usable, but dense.
6. **Add worker** still pre-fills the first PIN with 1234 (unchanged behaviour); a production deployment should require the administrator to enter one.
7. **Not tested on real devices** or with TalkBack and VoiceOver.
