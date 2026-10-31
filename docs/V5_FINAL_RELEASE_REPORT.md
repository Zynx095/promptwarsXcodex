# FairShift V5.0: feature completion, security hardening and release

## 1. Starting point

- Branch `main`, starting HEAD `0edf41a` ("glass morphism"). The remote `origin` (`github.com/Zynx095/promptwarsXcodex`) was at `4f94f03`.
- Baseline measured before any change: 39 test files, 334 tests passing.

## 2. Final state

- Final HEAD: the commit that adds this report (see the commit list below; the hash is given in the release message because a commit cannot contain its own hash).
- 44 test files, 380 tests passing; typecheck and lint clean; client and server production builds pass; 57 of 57 HTTP walkthrough checks pass on a fresh production build.
- **Not deployed to production.** See section 12: the database is not durable on Vercel (or on Cloud Run), and the hackathon rules recorded for this project require Google Cloud Run, not Vercel. The repository was pushed to `origin`.

## 3. Commits in this phase

| Commit    | Change                                                                                           |
| :-------- | :----------------------------------------------------------------------------------------------- |
| `c96ff0e` | Read-aloud: voice per language, honest states, full player                                       |
| `b510acc` | Optional server voice (Google Cloud Text-to-Speech); camera and microphone allowed for this site |
| `a931669` | Safety photos: intake, metadata removal, seal, access, advisory analysis, two-key closure        |
| `b2ab87a` | Camera capture, before/after review, reporter confirmation, photo inspections page               |
| `0bf4869` | Passkey (WebAuthn) verification for check-in and check-out (server)                              |
| `0000011` | Passkey page, time card passkey check, console passkey reset                                     |
| `1886a6a` | Console loaded on demand (worker bundle 516 kB → 397 kB)                                         |
| final     | Documentation: this report, deployment, security and configuration                               |

## 4. Text-to-Audio (read-aloud)

**Why it did not play.** The control set only the utterance language and never chose a voice. Where the device has no voice for that language (Chrome on Windows has none for Kannada, Tamil, Telugu or Bengali; many Android phones have not downloaded them), the browser read Indic text with its default voice, usually English: silence or noise, while the button said "Stop reading". Long texts were one utterance, which Chrome cuts off after about 15 seconds, and the button switched to "playing" before speech had started. The site's Permissions-Policy also blocked the microphone outright, so dictation could not work in production.

**What it does now** (`src/client/lib/speech.ts`, `components/Voice.tsx`):

- Waits for the browser's voice list (it loads asynchronously), then picks a voice only within the requested language: exact locale first (`kn-IN`), then the same language in another region (`bn-BD` for `bn-IN`), installed voices before online ones, never another language. "Multilingual" voices are skipped.
- Splits text at sentence ends (including the danda) into short utterances without breaking words or amounts such as ₹3,716.68, and queues them.
- Shows "Reading in ಕನ್ನಡ" only after the engine reports that speech started; reports a missing voice, a voice that never starts (10 s) and engine errors in the worker's language. Switching language stops the old reading.
- Controls: read aloud (labelled with the language it will use), pause, resume, stop, start again, speed (0.75×, 1×, 1.25×, remembered), choice of voice where the device has several, progress bar.
- **Fallback:** if the device has no voice for the language and `GOOGLE_TTS_API_KEY` is set, the server voices the text with Google Cloud Text-to-Speech (all six locales). The key stays on the server and is sent in a header; text is capped at 2000 characters, never logged or stored; audio is not cached; 12 requests a minute and 300 a day per person. Provider errors return 502 and the control says nothing was read. Without a key, the control says the device has no voice for that language and how to add one.

**Tested playback (headless Microsoft Edge on Windows, real speech engine; events recorded from the engine itself):**

| Language | Voice chosen                           | Short text (time card) | Long text (Money Jar, 3 sentences)  |
| :------- | :------------------------------------- | :--------------------- | :---------------------------------- |
| English  | Microsoft Ravi, English (India), local | started, ended         | 3 of 3 utterances started and ended |
| Kannada  | Microsoft ಸಪ್ನಾ, kn-IN, online         | started, ended         | 3 of 3                              |
| Hindi    | Microsoft स्वरा, hi-IN, online         | started, ended         | 3 of 3                              |
| Tamil    | Microsoft பல்லவி, ta-IN, online        | started, ended         | 3 of 3                              |
| Telugu   | Microsoft శ్రుతి, te-IN, online        | started, ended         | 3 of 3                              |
| Bengali  | Microsoft তানিশা, bn-IN, online        | started, ended         | 3 of 3                              |

Also checked in Edge: ten rapid clicks left one consistent state and stop left nothing speaking; switching language mid-reading stopped it; with the Hindi voices hidden, reading Hindi produced no utterance and the "this device has no हिन्दी voice" message. Unit tests cover voice choice, splitting, asynchronous voice loading, missing voice, server fallback and failure, a silent engine, engine errors, rapid play/stop, pause/resume/replay. The server voice was tested with a mocked provider only: no Google key was available, so real server audio was not played. Audio was not listened to: the test machine ran headless, so "played" means the engine reported start, word boundaries and end.

## 5. Camera and safety workflow

- **Capture:** "Take a photo" uses the phone's own camera app (`<input capture="environment">`: no live video, no in-page camera permission); "Choose a photo" opens the gallery. Either works alone, so a missing camera, a refused permission or a desktop never blocks a report; photos are optional. Up to six photos with a note each; preview, retake and remove before sending.
- **On the device:** photos are turned upright, resized to 1600 px and re-encoded as JPEG, which drops EXIF (GPS, phone, owner) before upload.
- **Report form:** inspection points from a per-industry list (construction: helmet, vest, safety footwear, eye protection, gloves, electrical, fire or smoke, machinery, unsafe structure, housekeeping, restricted area, heat, emergency exit; campus: gloves, eye protection, chemicals, electrical, fire, housekeeping, emergency, restricted area, heat) and, where the organisation has sites, the site.
- **Report case:** before and after photos side by side, each with "Check the seal". The reporter is asked "Is it fixed?" and confirms, or says what is still wrong (which reopens the report).
- **Console:** "Photo inspections" lists every report with photos: before/after thumbnails, status, severity, the most serious advisory outcome, reviews pending and where the closure stands. On a case, administrators see each photo's advisory result with the provider's labels and scores, confirm or dismiss it, add photos of the fix and see the closure state.
- **Two-key closure** (reports that came with photos): marking resolved needs a photo of the fix; the reporter is notified (named reports) and confirms or disputes; the outcome can be verified after confirmation, or, if the reporter does not answer within 24 h (critical), 48 h (high) or 72 h (other), or their account is inactive, only by an administrator other than the one who resolved it, recorded as "escalated". Disputes reopen the report. Reports without photos keep the earlier flow, including its independent-verification setting. Confidential reporters are not notified (a notification would link them to the report); they see the request in their reports, and the escalation window covers no answer.
- Browser check (Edge, real JPEGs with EXIF GPS, make, model and artist): report with photo, admin fix photo, resolution and reporter confirmation all worked; the stored photos contained no EXIF.

## 6. Photo analysis (advisory)

- Provider: Google Cloud Vision label and object detection, server-side, only when `GOOGLE_VISION_API_KEY` is set. Only the cleaned image is sent.
- Findings come from the provider's own labels and confidence: possible fire or smoke (potential hazard); electrical equipment, machinery, structures or chemicals visible (manual inspection required); protective gear that may be missing, only gear the workplace requires and only when people are visible (feet, hands and eyes often out of frame give "unable to determine"). Outcomes: potential hazard, PPE may be missing, manual inspection required, unable to determine, no visible issue in this photo.
- The interface states that results are advisory, can miss hazards and raise false ones, and never show that a place is safe; "no visible issue" says it is not the same as the place being safe. A person confirms or dismisses each result.
- **Limitation:** no Vision key was available, so analysis was tested with recorded provider responses and a failing provider, not against the live service. Label-based detection cannot judge context (a helmet on a table, a vest that is not high-visibility); it is a pointer for a reviewer, nothing more. Before/after comparison is shown side by side for people; it is not automated.

## 7. Image privacy

- Format identified from the bytes; declared type must match; 1.5 MB and 8000 px limits; six photos per stage per report; 30 uploads an hour per person; larger request bodies accepted only on the photo route.
- EXIF (including GPS), XMP, IPTC, comments and PNG/WebP text chunks are removed on the server before hashing, in addition to the client re-encode. No file name is kept.
- Photos are stored in the database (separately from their hash), served only to the reporter or administrators of the same organisation, with private no-store caching; another organisation's administrator gets 404.
- Confidential reports: the uploader is not stored, the photo shows as "Reporter", and the audit entries carry no actor.
- Retention: photos of reports verified more than 365 days ago are deleted at start-up and daily.

## 8. FairShift Proof for photos

- Each photo has a SHA-256 of its stored bytes and a seal: HMAC-SHA256 with the existing receipt signing key (key ID stored, so rotation keeps working) over the evidence record (id, organisation, report, stage, hash, type, size, time). No new cryptographic scheme was introduced; the HMAC, Merkle and key-rotation code for work receipts is unchanged.
- A database trigger refuses changes to a stored photo, its hash or seal. The verify endpoint recomputes both; a test that bypasses the trigger and swaps the bytes is detected.
- The seal says the photo has not changed since upload. It does not say the photo shows a true event, and the interface says so. Photos are not yet included in the Merkle checkpoints used for work receipts.

## 9. Passkeys (WebAuthn) for attendance

- Library: SimpleWebAuthn 14 (server and browser).
- Enrolment: the worker opens "Passkey for check-in" (More menu), names the phone and adds a passkey; the phone's own screen lock (fingerprint, face or PIN) unlocks it. Several passkeys per worker (up to five), each revocable.
- Stored: credential ID, public key, counter, transports, device type, label. No fingerprint, face, PIN or template.
- Check-in and check-out, once a worker has a passkey: the time card asks the phone to confirm, the server issues a challenge for that action, verifies the assertion and only then records the shift with `check_in_auth` / `check_out_auth = passkey`. Check-out needs its own fresh assertion. Timestamps are the server's.
- Security: server challenges bound to user and action, five-minute expiry, deleted on first use; origin and RP ID from configuration (off in production until configured, rather than trusting the Host header); user verification required; credential ownership and revocation checked; signature and counter verified; attempts rate limited; registration and revocation audited.
- Fallback and recovery: workers without a passkey use their sign-in (recorded as `session`); a worker removes a lost phone; an administrator resets a worker's passkeys (Workforce table, audited); supervisors can record attendance through shift corrections. The record never claims "fingerprint", because WebAuthn only reports that the user was verified.
- Browser check: in Edge with a virtual platform authenticator (CDP WebAuthn), enrolment, check-out and check-in each ran a real WebAuthn ceremony through the browser and were stored as passkey-verified. Not tested on a physical phone.

## 10. Security testing

Negative tests added (all passing):

- Passkeys: replayed assertion; expired challenge; check-out challenge used to check in; tampered signature; wrong origin; wrong RP ID; no user verification; counter going backwards; another worker's passkey; another worker's challenge; revoked passkey; registration without user verification, from another origin, or replayed; admin reset across organisations refused; production without configuration.
- Photos: non-image files (PDF, HTML), a PNG declared as JPEG, unknown types, invalid base64, decoded size over the limit, request over the size limit, a seventh photo, truncated files, absurd dimensions; workers adding photos to others' reports; administrators adding "hazard" photos; reporters adding "fix" photos; another worker or another organisation's administrator fetching a photo; unauthenticated access; confidential reporter identity absent from photo record, case, inspection list and audit; database tampering detected by the seal.
- Analysis: provider failure stores no findings and keeps the photo; weak or absent signals produce no finding; gear findings only for required gear and visible people.
- Two-key closure: resolve without a fix photo refused; verification before confirmation refused; confirmation then verification; dispute reopens and needs a reason; double answers refused; another worker cannot answer; escalation refused before the window and to the resolver, allowed to an independent administrator after it.
- Read-aloud server voice: unauthenticated, not configured, unsupported language, empty and oversized text, provider error, empty answer, network failure, rate limit.

Existing security tests (tenant isolation, sessions, CSV formula injection, proof, Safe Signal thresholds, accountability state machine) were not changed and pass.

## 11. Database architecture

Unchanged: SQLite through Node's built-in driver, synchronous repositories and services, additive migrations at start-up (new tables `report_evidence`, `passkeys`, `webauthn_challenges`; new columns on `safety_reports` and `shifts`). Existing databases migrate in place; the migration test passes.

## 12. Vercel compatibility and deployment

- The Vercel build (`npm run build:vercel`, Build Output API v3) succeeds; the bundled function was started locally with production settings and answered health, auth configuration and sign-in correctly. Request sizes fit Vercel's 4.5 MB body limit.
- **Blocker 1, persistence:** on Vercel the database lives in the function's `/tmp`, which is discarded whenever an instance stops or another starts. Worker records, photos and passkeys written there would be lost. A durable database needs an account and credentials (for example Turso/libSQL embedded replicas, which keep the synchronous driver, or PostgreSQL with an asynchronous data layer). None is configured, so a production deployment was not made. Cloud Run with the current image has the same limitation.
- **Blocker 2, platform choice:** this project's own deployment guide and the hackathon rules recorded for it require Google Cloud Run for the submitted link, with Vercel only as an extra demo. Deploying to Vercel does not satisfy that rule; this needs the owner's decision.
- What a demo deployment would need: `NODE_ENV=production`, `DEMO_MODE=true`, `SESSION_SECRET` (48+ random characters), `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGINS` for the deployment's domain, and optionally `GOOGLE_TTS_API_KEY` and `GOOGLE_VISION_API_KEY`. It must be labelled as synthetic data that resets.
- Production URL: none.

## 13. Test results

| Check                                         | Result                                                                                                                                                                                         |
| :-------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                    | 44 files, 380 tests, all passing (baseline 39 files, 334 tests)                                                                                                                                |
| Typecheck, lint                               | Pass                                                                                                                                                                                           |
| Format                                        | Fails only on the four Markdown files from `b4a351b`; all files changed in this phase pass                                                                                                     |
| Client and server builds; Vercel build output | Pass. Worker bundle 397 kB (117 kB gzip) after loading the console on demand                                                                                                                   |
| HTTP walkthrough, fresh production build      | 57 of 57                                                                                                                                                                                       |
| axe-core (WCAG 2.2 AA rules), new screens     | 8 states (passkey page in English and Tamil, report form with a photo, report case with photos, read-aloud player, inspections, console case with photos, passkey reset dialog): no violations |
| Rendered text contrast, new screens           | 459 text runs on 14 screens at 390 and 1440 px: no failures                                                                                                                                    |
| Viewport sweep, new screens                   | 49 captures at seven sizes: no horizontal scrolling, no console errors beyond the expected 401                                                                                                 |
| Earlier accessibility and sweep sets          | axe-core on the 30 earlier screens and states: no violations. 168 captures (24 screens at seven sizes): no horizontal scrolling; only the expected 401 before sign-in                          |

## 14. Remaining limitations

1. No durable database; no production deployment (section 12).
2. Repository size: tracked files are about 11.7 MB, over the 10 MB submission limit, mainly the PNGs in `docs/screenshots/` from `b4a351b`.
3. Speech providers and photo analysis were tested with recorded or mocked provider responses; no keys were available.
4. Read-aloud was tested in Edge on Windows only (headless, engine events, not listened to). Chrome on Android and Safari on iOS were not tested; voice availability on real phones varies.
5. Passkeys were tested with a software authenticator and a browser virtual authenticator, not on physical phones.
6. Photo analysis is label-based and advisory; before/after comparison is for people to judge.
7. Photos are not part of the Merkle checkpoints; confidential reporters get no notification to confirm a fix (by design).
8. Rate limits are per server instance.
9. Translations added in this phase need native-speaker review; the console remains English.

## 15. Manual device testing still needed

- Read-aloud on a mid-range Android phone (Chrome, Google speech services with and without Kannada, Tamil, Telugu, Bengali voice data) and on an iPhone (Safari).
- Camera capture on Android and iPhone: the camera app opening from "Take a photo", HEIC photos on iPhone, permission refused, and gallery selection.
- Passkey enrolment and check-in with fingerprint, face unlock and device PIN on Android and iPhone; a phone with no screen lock; replacing a phone and the administrator reset.
- TalkBack and VoiceOver on the new screens.
