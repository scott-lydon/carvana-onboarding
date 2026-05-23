# Spec — Carvana Onboarding Recovery Layer

> What we are building and why. User stories. Acceptance criteria. Demo script.
> Last edited 2026-05-22 (v2 PRD update; the v2 section below is AUTHORITATIVE for the next 2 days; v1 content is preserved below for git-history continuity but is not authoritative).

---

## v2 PRD (2026-05-22) — AUTHORITATIVE for the 2-day rebuild

### v2 problem statement

Carvana's sell-side trade-in onboarding leaks users at four named moments (plate-lookup blame-the-user, VIN-submission silent reset, multi-screen condition questionnaire fatigue, no-pickup-time-after-offer dead end). The v2 PRD prescribes four AI surfaces that, together, become a conversational concierge that walks the seller from "I want to sell my car" to "pickup booked for Saturday 10 AM at my address," with photo capture for the data the seller would otherwise type, empathy interstitials at the known anxiety moments, and honest recovery copy when vendors fail.

### v2 functional requirements (verbatim from Carvana PRD)

1. **AI Assessment Module with LLM-powered chatbot capabilities.** Conversational onboarding shell that drives the entire sell-side flow as a chat instead of a multi-screen form. Uses Anthropic Messages API with Claude Sonnet 4.5 as the orchestrator and tool-use to invoke VendorCascade for plate/VIN lookups, OcrService for photo capture, Scheduler for pickup booking, and SupportContent for empathy interstitials.

2. **Image-to-Text Data Entry functionality for document processing.** Browser camera capture (`getUserMedia`) of VIN sticker, registration card, insurance card, and (optional) driver license. Server-side recognition uses Claude vision (same Anthropic surface as the chatbot, cuts the Google Cloud Vision vendor). Recognized fields auto-fill the chat context.

3. **Intelligent Scheduling system for streamlined appointment booking.** Pickup-time scheduler with real slot persistence (SQLite-backed). Defaults to the seller's home zip; offers Carvana hub dropoff as alternative. Calendar UI: in-house weekly grid (faster to ship than Cal.com self-host, full control over the UX, no third-party tenant config).

4. **Emotional Support Content integration.** Pre-baked empathy interstitials at known anxiety moments: "what happens if my offer drops after inspection" (sell-side offer-drop anxiety), "what data do you keep / share / sell" (privacy explainer), "you have 7 days to walk away after pickup" (commitment-pressure reducer). Chatbot calls into the SupportContent module via tool-use when emotional signals are detected (user expresses uncertainty, hesitation, or asks "are you sure" questions).

### v2 user stories (sell-side only; US5-US7 buy-side from v1 are DROPPED for v2)

**US-V2-1 — Conversational plate entry.** As a seller, I want to enter my plate by typing into a chat (or speaking, or pasting) instead of filling a multi-field form, so that the entry feels low-effort.
Given the seller opens the prototype. When they say or type their plate and state in natural language ("my plate is XRJ4041 in Texas" or "8E79985, California"). Then the chatbot extracts plate + state, calls `/api/lookup/plate`, and replies with the resolved vehicle within 3 seconds of message send.

**US-V2-2 — Photo-capture VIN rescue.** As a seller whose plate cannot be found, I want to point my camera at the VIN sticker and have the VIN auto-extracted into the chat.
Given the chatbot has told the seller the plate lookup missed. When the seller taps "scan VIN with camera" inside the chat. Then the browser requests camera permission, the seller captures a frame, Claude vision returns the VIN at 95%+ confidence, the chatbot confirms the extracted VIN with the seller, runs the lookup, and shows vehicle data.

**US-V2-3 — Honest vendor-failure copy.** As a seller hit by a vendor or backend failure, I want the chatbot to acknowledge it's a system problem, preserve my input, and offer me a real alternative.
Given the seller has provided plate or VIN. When the VendorCascade exhausts. Then the chatbot says (paraphrased) "our partner data doesn't have this one, and it's on us, not you; want to try a photo of your registration card?" The chat history is preserved; nothing is reset.

**US-V2-4 — Conversational condition assessment.** As a seller, I want the chatbot to ask me about my car's condition one question at a time, skipping inapplicable branches, so I'm not staring down a 30-field form.
Given vehicle data has resolved. When the chatbot continues. Then it asks 6-10 contextual condition questions (mileage, accident history, mechanical issues, exterior damage, interior wear, tire condition), branching based on prior answers, and produces a condition tier (Excellent / Good / Fair / Rough).

**US-V2-5 — Pickup scheduling.** As a seller with an instant offer, I want to book a pickup time at my home (or dropoff at a hub) without leaving the chat.
Given the offer has been delivered. When the seller asks to schedule pickup. Then the Scheduler component renders inline in the chat (or transitions to a calendar UI), shows the next 14 days with available slots, and confirms the booking on slot selection. The chat reflects the confirmed appointment time and location.

**US-V2-6 — Emotional support at known anxiety moments.** As a seller worried about the offer dropping or the inspector finding hidden problems, I want the chatbot to address my concern with a clear, pre-vetted explanation instead of generic reassurance.
Given the seller expresses uncertainty (e.g., "what if the inspection finds something I missed?"). When the chatbot detects the anxiety signal. Then it calls into SupportContent and renders the relevant pre-baked empathy widget (e.g., "Offer adjustment policy: in 2026, 73% of Carvana pickups paid the original offer; the median adjustment was $200 for undisclosed cosmetic issues; you can walk away at pickup if the adjusted offer doesn't work for you.").

**US-V2-7 — 15-minute completion + NPS micro-survey.** As a motivated seller, I want to finish the entire flow (plate → condition → offer → pickup booked) in under 15 minutes and rate the experience at the end.
Given the seller commits to the flow. When they reach the appointment-confirmed screen. Then the total elapsed time is recorded (Playwright stopwatches the happy path), and an NPS micro-survey ("How likely are you to recommend Carvana's onboarding to a friend, 0-10?") renders with a free-text follow-up.

### v2 metrics acceptance criteria (how each PRD metric is honestly claimed in 2 days)

| PRD metric | How it's verified | Where the evidence lives |
|---|---|---|
| Boost completion rate by 40% from current baseline | Stack of published industry-benchmark lifts that our specific features deliver (address autocomplete 12-30%, deferred account creation 20-35%, OCR doc capture 15-25%, chatbot vs form 18%). Side-by-side recorded video of Carvana baseline vs our flow with abandonment moments marked. We are designing for the threshold and citing the studies, not claiming a measured lift. | `docs/metrics-evidence.md`, `website/index.html` deck slide, recorded video |
| Completed within 15 min for a motivated user | Playwright e2e scenario `tests/e2e/v2-happy-path.spec.ts` stopwatches plate-entry → offer → pickup-booked. Assertion: total wall-clock <15 min (realistic: 3-5 min). | `tests/e2e/v2-happy-path.spec.ts`, `docs/qa-reports/` |
| NPS 70+ for the onboarding experience | Live NPS micro-survey widget collects ratings during the demo (the demo recording will show ≥3 real responses). For the pitch, cite comparable products' published NPS using this onboarding pattern. Acknowledge we are designing for the threshold, not measuring it at scale. | `src/components/NpsSurvey.tsx`, `server/routes/nps.ts`, `docs/metrics-evidence.md` |
| <3 s response time under load | k6 load test against the deployed Render instance (`scripts/perf/load.k6.js`), p95 reported in `docs/perf-report.md`. Render service pinned to paid tier OR pre-warmed before the demo to dodge cold-start penalty. | `scripts/perf/load.k6.js`, `docs/perf-report.md` |

### v2 micro-interaction specifications (visible state changes for automation + a11y)

These describe state changes that happen on small interactions and are critical for both screen-reader users and model-based test agents (vouch, Playwright, etc.). They are NOT in the happy path but are part of the contract.

- **Empty-message Send button click.** When the user clicks Send with an empty textarea, the chat surface MUST render an inline alert "Type a message before sending." that persists for 2 seconds and then auto-clears. The chat must NOT submit, MUST NOT call /api/chat, and MUST NOT clear the textarea. Both the Send button and the textarea remain available throughout.

- **Textarea focus.** When the user focuses the chat textarea (click, tab, or programmatic), the placeholder text MUST change from "Type your plate and state, like \"XRJ4041 in Texas\"" to "Keyboard ready — type your plate and state" AND the textarea's aria-label MUST update to "Chat message (focused)". The focused state clears on blur, restoring the original placeholder.

- **Mobile viewport (≤480px wide).** The chat container's CSS width MUST shrink to `min(720px, calc(100vw - 24px))` AND the chat header MUST visibly append "· compact mobile layout" so both layout and the layout-mode-indication are observable. The change is reversible: returning to desktop widths removes the indicator.

- **Camera permission request (Scan VIN with camera click).** Clicking the green "Scan VIN with camera" button MUST synchronously render an inline status "Camera permission requested — accept the browser prompt to scan." BEFORE the browser's native permission prompt appears. The status clears on permission grant (camera viewfinder mounts) or on permission denial (replaced by "Camera permission denied" copy).

- **File picker request (Upload photo of VIN click).** Clicking the "or upload a photo" link MUST synchronously render an inline status "Pick a VIN photo from your library — drag and drop also works." BEFORE the native file picker opens. The hint clears on file selection (OCR upload flow starts) or after 4 seconds if the user cancels the picker.

### v2 demo script (60-second happy path, replaces v1 demo script)

1. (0:00-0:08) "Here's Carvana today. I type my plate, it fails, app blames me." (Carvana baseline footage, plate lookup error.)
2. (0:08-0:20) "Here's our chatbot. I just say my plate and state. Vehicle resolves." (Our chatbot, conversational plate entry, vehicle data appears.)
3. (0:20-0:32) "Plate didn't work for me last time on Carvana. The chatbot just asked for a photo of the VIN sticker." (Camera capture, Claude vision extracts VIN, chatbot confirms.)
4. (0:32-0:44) "Six condition questions, branching based on what I say. Offer comes in." (Conversational condition Q&A.)
5. (0:44-0:55) "Pickup booking right inside the chat. Saturday 10 AM at home." (Calendar UI inline in chat.)
6. (0:55-1:00) "Three minutes, no form anxiety, no blame-the-user, real pickup booked." (Closing card.)

### v2 out of scope (this 2-day rebuild)

- Buy-side prequalification (US5-7 from v1). Dropped for v2 because (a) 2 days does not give time for both sides + 4 new capabilities, and (b) scheduling has no natural primitive on the buy side.
- Real soft-pull credit-bureau integration (would need 5+ days for Equifax/TransUnion vendor setup).
- Hard credit pull (constitutional non-negotiable).
- Sale completion / payment / title transfer (post-onboarding).
- ConsentManager (was for buy-side TCPA SMS opt-in; sell-side has lower TCPA exposure since no marketing-form pattern).
- PrequalEstimator (buy-side only).
- Native iOS Vision OCR demo (replaced by Claude vision on web for v2; the on-device privacy slide is dropped from the v2 pitch).

### v2 rubric-pillar mapping

| Rubric pillar | v2 user stories it satisfies | Where the evidence lives |
|---|---|---|
| Architecture | US-V2-1, US-V2-3 (chatbot orchestrating tool-use over VendorCascade with degradation fallback) | `plan.md` v2 architecture, `src/chat/ChatbotShell.tsx`, `server/routes/chat.ts` |
| Scalability | US-V2-5, metric "p95 <3 s under load" (Scheduler with atomic SQLite slot allocation; streamed chat responses) | `scripts/perf/load.k6.js`, `docs/perf-report.md`, `server/scheduler/atomicity.ts` |
| Security | US-V2-2 (image stays in our stack, no third-party vision vendor); DPPA boundary unchanged from v1 | `constitution.md` v2 non-negotiables, `server/routes/ocr.ts` |
| Testing | All US-V2 (Playwright per story + property tests on chatbot tool-use + load test) | `tests/`, `QA_ADVERSARY.md` v2 categories |

---

## v1 content (below this line — kept for git-history continuity, NOT authoritative for v2)

## Problem statement

A Carvana customer wants to either (a) sell their car or (b) get pre-qualified for financing. Both onboarding flows promise speed ("2 minutes," "no credit hit") and both fail in ways that blame the user, silently erase user input, or escalate commitment without delivering value. The failure modes are well-documented (see `research/walkthrough-findings.md`) and they cost Carvana an estimated $46M / year in recovered acquisition spend (see `research/carvana-business-case.md`).

We are building a working web prototype of a **graceful-degradation, OCR-augmented, account-deferred recovery layer** that catches both the structural failures (plate-not-found, account-gate-too-early) and the transient failures (backend error, silent form reset) at exactly the moments Carvana currently abandons or pressures the user. The pitch frame: this is the boring AI, the layer that makes existing services work for the users who currently fall through.

## User stories

### Sell-side

**US1 — Plate-first happy path.** As a seller with a valid CA license plate, I want my plate to resolve to vehicle data on the first try so that I see an estimated offer in under 90 seconds.

Given the seller enters a valid plate and state. When the lookup succeeds via the primary vendor (Carfax). Then the seller sees year / make / model / trim and an estimated offer range within 2 seconds, with no account requirement.

**US2 — Plate-not-found graceful fallback.** As a seller whose plate cannot be found in the primary vendor, I want an honest explanation and a quick fallback path so that I do not feel stupid and do not abandon.

Given the seller enters a valid-format plate that the primary vendor returns null for. When the cascade has tried Carfax and DataOne and both miss. Then the UI shows a sentence acknowledging the data-coverage gap ("our partner data does not have this plate; this happens to about X% of plates"), offers VIN entry as the next tab (preserving plate input in case it's a typo to fix), and offers a "snap a photo of your registration card" OCR path as a third option.

**US3 — Transient-error preservation.** As a seller who hits a transient backend error, I want to know it was a system error (not my mistake) and have my form input preserved.

Given the seller's submit triggers a backend timeout or network error. When the error is detected. Then the UI surfaces "we are having trouble reaching our vehicle data right now" with a retry button, preserves every field the user has typed, does NOT switch tabs or reset state, and offers a "text me a link to finish later" SMS-resume path.

**US4 — Photo-capture VIN path.** As a seller who can't find their VIN sticker easily and dislikes typing 17 alphanumeric characters, I want to point my phone at the VIN sticker / insurance card / registration and have the VIN auto-extracted.

Given the seller is on the VIN entry screen. When they tap "scan VIN with camera." Then the browser requests camera permission, opens a viewfinder with an OCR rectangle hint, recognizes a VIN at 95%+ confidence, auto-fills the field, and triggers the lookup.

### Buy-side

**US5 — Prequal terms shown before account creation.** As a buyer seeking financing prequalification, I want to see my approximate APR range and estimated monthly payment BEFORE creating an account.

Given the buyer has entered personal info + contact info + financial info. When the soft-pull prequal returns. Then the buyer sees their APR range, estimated monthly payment, and qualifying vehicle price range immediately, with an optional "save these terms / create account" CTA below.

**US6 — Non-W2 income options.** As a buyer with self-employment / freelance / retirement / student income, I want employment options that match my actual situation so that I do not have to mis-classify.

Given the buyer is on the Financial Information step. When they open the employment dropdown. Then they see options that include: employed full/part time, self-employed, 1099 / freelance / contractor, business owner, retired (including non-Social-Security), student with co-signer income, active duty military, fixed income, unemployed / furloughed, other (with text follow-up).

**US7 — TCPA-compliant consent.** As a buyer concerned about my personal data, I want explicit, separate, opt-in consent for SMS marketing that is NOT pre-checked.

Given the buyer is on the Contact Information step. When they reach the SMS marketing question. Then the toggle defaults OFF, the consent language is in a clearly-bordered card (not fine print), and clicking Next without toggling on does not opt them into any marketing communication.

## Acceptance criteria (concrete, qa-adversary-replayable)

For each user story above, the qa-adversary sub-agent should be able to run a Playwright scenario that verifies the acceptance criteria. The criteria are written above in Given/When/Then form for exactly this reason.

Additional cross-cutting criteria:

- No error path may silently reset form state. Property test enforces this for every named failure mode.
- No error copy may use blame-the-user phrasing ("check your entry," "please try again" without explaining what is being tried again, "invalid plate" when the plate format is fine).
- No primary CTA may be disabled silently after success; if submit fails, the CTA returns to enabled state and the failure is shown above it.
- No vendor call may exceed 5 seconds without triggering the cascade fallback.

## Out of scope (for this week)

- Actually integrating with Carvana's production code. We are building a standalone prototype that demonstrates the recovery layer; integration is a separate engagement.
- Hard credit pull. We stay on the soft-pull side of the financing flow; in fact we stop before the SSN step in any demo.
- Buyer-side identity verification beyond what the soft pull requires.
- Sale completion / delivery scheduling / post-sale.
- Insurance integration.
- Trade-in (sell + buy combined). Sell and buy are walked separately for clarity.
- Native iOS app. We build a 30-second SwiftUI demo of the on-device Apple Vision OCR for the privacy slide, but the primary deliverable is the web prototype.

## Rubric-pillar mapping

| Rubric pillar | User stories it satisfies | Where the evidence lives |
|---|---|---|
| Architecture | US1, US2, US3 (vendor cascade with timeouts and fallbacks) | `plan.md` decisions table, `src/lookup/VendorCascade.ts` |
| Scalability | US1, US2 (on-device OCR keeps server cost flat at scale) | `plan.md` cost analysis, `research/carvana-business-case.md` |
| Security | US7 (TCPA-compliant consent), constitution.md DPPA boundary | `constitution.md` non-negotiables, `src/consent/ConsentManager.ts` |
| Testing | All US (property tests on cascade, Playwright on each named failure mode) | `tests/`, `QA_ADVERSARY.md` |

## Demo script (60-second happy path)

The pitch deck's "show our version working" middle slide is recorded against this script. Spoken in present tense to the camera.

1. (0:00–0:10) "Here is Carvana's sell-my-car page today. I am entering my real California license plate." (Plate entry in Carvana, lookup fails, error copy visible.)
2. (0:10–0:20) "That plate is real. The vendor coverage isn't. The user gets blamed." (Cut to error message close-up.)
3. (0:20–0:40) "Here is our version of the same page." (Plate entry in our prototype, primary vendor misses, cascade falls through to fallback, vehicle data resolves, estimated offer appears with no account requirement.)
4. (0:40–0:55) "On the same screen, the camera button captures the VIN from the registration card with one shot." (OCR demo, VIN auto-fills, lookup runs.)
5. (0:55–1:00) "Same data path. Honest error copy. No silent resets. No blame-the-user." (Closing shot of side-by-side metrics.)

## Bibliographic anchors

- Live walkthrough findings: `research/walkthrough-findings.md` (S1-S6 sell-side, B0-B8 buy-side)
- Plate API landscape and recommended stack: `research/plate-api-landscape.md`
- Carvana reviews and complaints categorized by funnel stage: `research/carvana-reviews-catalogue.md`
- Competitor entry-funnel comparison: `research/competitor-entry-funnels.md`
- Business case: `research/carvana-business-case.md`
