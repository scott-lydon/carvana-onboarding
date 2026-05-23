# Plan — Carvana Onboarding Recovery Layer

> Architecture. Component breakdown. Data flow. Decisions. Trade-offs. Sequencing.
> Last edited 2026-05-22 (v2 PRD update; v2 architecture below is AUTHORITATIVE for the next 2 days; v1 content is preserved further down).

---

## v2 architecture (2026-05-22) — AUTHORITATIVE for the 2-day rebuild

### v2 topology (text)

```
Browser
  ├─ React app (Vite + TypeScript)
  │    ├─ ChatbotShell (Anthropic streaming, tool-use orchestrator)   [NEW]
  │    ├─ OcrCapture (getUserMedia → cropped image → server)          [renamed from OCRCapture]
  │    ├─ Scheduler (weekly slot grid, atomic booking)                [NEW]
  │    ├─ SupportContentWidget (pre-baked empathy interstitials)      [NEW]
  │    ├─ NpsSurvey (post-flow micro-survey + free text)              [NEW]
  │    ├─ EntryForm (kept as fallback escape hatch from chatbot)
  │    └─ DegradationPanel (preserved from v1; chatbot calls into it for vendor failures)
  │
Server (Express on Node 22)
  ├─ /api/chat        ──── streams ──► Anthropic Messages (Claude Sonnet 4.5)
  │                              └─► tools: lookup_plate, lookup_vin, ocr_recognize, schedule_pickup, get_support_content
  ├─ /api/lookup/plate ──► VendorCascade [CarsXE primary, VinAudit fallback when live]
  ├─ /api/lookup/vin   ──► same VendorCascade
  ├─ /api/ocr/recognize ─► Anthropic Messages (Claude vision)         [SWAPPED from Google Cloud Vision]
  ├─ /api/schedule/slots (GET available slots for a zip + 14-day window)
  ├─ /api/schedule/book  (POST atomic slot allocation, SQLite transaction)
  ├─ /api/nps/submit (POST NPS score + free text + completion-time stopwatch)
  └─ /api/events (telemetry; unchanged from v1)
```

The polished Mermaid version with Simple Icons logos for Anthropic, React, TypeScript, Vite, Express, Node, Render, SQLite, CarsXE, GitHub, GitLab lives in `website/index.html` per the Gauntlet pattern; no edge crossings, layout reordered for the v2 chat-centric flow.

### v2 components (new, modified, or dropped relative to v1)

**ChatbotShell (NEW).** React component that owns the chat history, sends user messages to `/api/chat`, streams responses, renders tool-use UI affordances (vehicle data card, OCR camera card, scheduler card, support content card). Streaming via SSE or fetch+ReadableStream — chosen on slice A. The chatbot is the primary entry surface; EntryForm is a fallback link ("prefer a form? click here").

**ChatRouter (NEW, server-side, inside /api/chat).** Validates each user turn, calls `client.messages.stream({ model: 'claude-sonnet-4-5', tools: [...], messages: history })`, handles tool-use turns by dispatching to the existing route handlers (lookup, ocr, schedule) and posting tool-result blocks back. Tool definitions live in `server/chat/tools.ts`. System prompt lives in `server/chat/system-prompt.ts` and is one of the few hand-tuned strings in the repo.

**OcrCapture (modified, was OCRCapture).** Camera capture via `getUserMedia` + crop overlay + capture button. Server-side recognition now via Claude vision (not Google Cloud Vision). The chatbot triggers the camera card via tool-use when a vendor cascade exhausts OR when the user proactively asks "can I just take a photo?"

**Scheduler (NEW).** Two pieces: (a) `<Scheduler>` React component rendering a weekly grid of 30-min slots over the next 14 days with availability colors, (b) server-side atomic slot allocation backed by SQLite with `BEGIN IMMEDIATE` transaction + UNIQUE constraint on (slot_start, scope) to prevent double-booking under concurrent requests. Slot generation is deterministic from `(zip, day)` → 8 slots/day between 9 AM and 5 PM. Hub locations are hardcoded for the demo (3 Texas Carvana hubs).

**SupportContentWidget (NEW).** Pre-baked content cards keyed by `SupportTopic` enum: `OfferDropAnxiety`, `DataPrivacy`, `WalkAwayPolicy`, `InspectionExpectations`, `PaymentTiming`. Each card has a short title, 60-80 word body, and a stable telemetry event name. Content is reviewed and committed; LLM does NOT generate the body at runtime (constitutional non-negotiable — see v2 constitution delta).

**NpsSurvey (NEW).** Single-screen widget rendered after pickup is booked. Captures the 0-10 score, a free-text "what's the one thing that would make this better" prompt, and the total flow duration (computed client-side from the first chat message). Posts to `/api/nps/submit`; results aggregated for the metric overlay on the architecture website.

**VendorCascade (UNCHANGED).** Live from slice 1, CarsXE primary, VinAudit fallback pending B2B approval, 8-second timeout per adapter, 14 unit tests + property tests. Chatbot invokes this via tool-use rather than the user invoking it via a form.

**DegradationPanel (UNCHANGED).** Live from slice 1, error-to-copy mapping for resolved/not_found/transient_error/bot_detected/format_error/configuration_missing. Chatbot calls into this via tool-use when a cascade misses.

**PrequalEstimator (DROPPED for v2).** Buy-side only; out of v2 scope.

**ConsentManager (DROPPED for v2).** Buy-side TCPA SMS opt-in; sell-side has lower TCPA exposure.

### v2 data flow (chatbot orchestrates the entire happy path)

1. Seller opens prototype → ChatbotShell mounts, greets, asks for plate + state.
2. Seller types or speaks. Client sends message to `/api/chat`.
3. ChatRouter streams `client.messages.stream` with full history + tool definitions.
4. Claude responds with `tool_use` block invoking `lookup_plate({ plate, state })`.
5. ChatRouter dispatches to VendorCascade, gets `LookupResult`, posts `tool_result` back to stream.
6. Claude continues with vehicle-confirmation message + asks 6-10 condition questions one by one.
7. After condition Q&A, Claude generates condition tier and invokes a (mock-for-demo) `generate_offer` tool that returns an offer range.
8. Claude offers pickup booking; seller agrees; Claude invokes `schedule_pickup({ zip, day_range })` which returns available slots.
9. Scheduler component renders inline; seller picks a slot; client posts to `/api/schedule/book` (atomic).
10. Claude confirms; NpsSurvey renders; seller scores + comments; `/api/nps/submit` records.

If at ANY step a vendor call fails, ChatRouter posts the failure result to Claude with structured fields; Claude routes through DegradationPanel copy AND optionally invokes `get_support_content` if anxiety signals are detected.

### v2 decisions table (additive to v1)

| Decision | What we chose | Alternative considered | Why |
|---|---|---|---|
| Chatbot LLM | Claude Sonnet 4.5 (orchestrator) + Claude Haiku 4.5 (cheap tool-result summarization if needed) | OpenAI GPT-4.1, Gemini 2.5 Pro | One vendor for chatbot AND vision (Claude vision) cuts a key. Anthropic's tool-use is mature and well-documented. Streaming is well-supported. |
| Vision provider | Claude vision (same Anthropic surface) | Google Cloud Vision, Tesseract.js, AWS Textract | One vendor, one billing relationship, one API key, fewer secrets to rotate. Cloud Vision is a great product; cutting it saves config and money at our scale. |
| Scheduling primitive | In-house calendar grid + SQLite atomic booking | Cal.com (self-host or hosted), Calendly embed | In-house grid: 1 day to ship, full UX control, no third-party tenant config, atomic booking story is part of the rubric defense. Cal.com is more featureful but ships slower and the demo doesn't need the full Cal.com surface. |
| Streaming transport | fetch + ReadableStream (no SSE library) | EventSource (SSE), WebSocket, Vercel AI SDK | Vanilla fetch + ReadableStream works on Render's free tier without sticky-session config; Vercel AI SDK would add a dependency for a benefit we don't need. |
| Support content authoring | Pre-baked, reviewed, committed | LLM-generated at runtime | Hallucination risk on emotional content is unacceptable. Pre-baked content is auditable, A/B-testable, and citable. The CHATBOT can pick which pre-baked card to show; the LLM does not write the words. |
| Scheduling UI placement | Inline in chat (card) vs full-screen takeover | Modal popup | Inline keeps the conversation visible (the chatbot's reassurance copy stays on screen while the user picks a slot). Modal popup would push the chat off screen. |
| Atomic slot allocation | SQLite `BEGIN IMMEDIATE` + UNIQUE constraint | Postgres advisory lock, Redis SETNX, ETag CAS | SQLite is already in the stack for events. `BEGIN IMMEDIATE` + UNIQUE is the simplest correct pattern. Demo concurrency is low. |

### v2 trade-offs

- **Chatbot adds first-token latency.** Mitigation: stream responses (perceived latency is time-to-first-token, not total). Pre-cache the greeting message client-side so the first paint is instant.
- **Claude vision is more expensive than Tesseract.** Mitigation: it's more accurate and we can crop the image client-side to minimize tokens. At demo scale (<100 calls) the cost is under $1.
- **In-house scheduler ships less polished than Cal.com.** Mitigation: scope the calendar grid to "next 14 days, 8 slots/day, 1 location selector" — that's a 1-day build that looks intentional.
- **Pre-baked support content is rigid.** Mitigation: the chatbot's LLM can REPHRASE the pre-baked content in its own voice as long as the underlying facts (offer-drop stats, walk-away policy) are not changed. Treat the pre-baked content as facts the chatbot must cite.
- **No buy-side coverage in v2.** Mitigation: explicit "v2 scope" callout in the architecture website + AI interview prep block explaining the 2-day collapse and the engineering decision to do sell-side excellently rather than both shallowly.

### v2 slice sequencing (informs `tasks.md`)

Day 1 (chatbot + OCR + scheduler spine):
- Slice A: ChatbotShell + /api/chat with Claude Sonnet 4.5 + tool definitions for existing VendorCascade. Demo: type "my plate is XRJ4041 in Texas," get vehicle data in chat.
- Slice B: OcrCapture wired into chatbot tool-use; Claude vision swap-in for `/api/ocr/recognize`. Demo: chatbot offers camera; capture VIN; chatbot confirms.
- Slice C: Scheduler component + atomic SQLite booking + chatbot tool. Demo: after offer, chatbot offers slots; seller picks; booking confirmed.

Day 2 (emotional support + metrics + perf + polish):
- Slice D: SupportContentWidget + 5 pre-baked cards + chatbot detection of anxiety signals.
- Slice E: NpsSurvey widget + completion-time stopwatch + /api/nps/submit + on-page metrics overlay.
- Slice F: k6 load test (`scripts/perf/load.k6.js`) + p95 report at `docs/perf-report.md` + Render service pinned to "starter" paid tier.
- Slice G: Architecture website refresh + DEFENSE_BREAKOUT_SCRIPT.md + AI_INTERVIEW_PREP.md update + 60-second demo video recording per v2 spec.md demo script.

Each slice ends with `qa-adversary` in a fresh context briefed against the v2-updated constitution + spec + plan + tasks + QA_ADVERSARY. Submit-gate runs at the end of every code-touching response.

---

## v1 content (below this line — kept for git-history continuity, NOT authoritative for v2)

## Topology (text)

```
Browser
  ├─ React app (Vite + TypeScript)
  │    ├─ EntryForm (plate / VIN tabs, mirrors Carvana's UX)
  │    ├─ OCRCapture (getUserMedia + crop + send)
  │    ├─ ResultPanel (vehicle data + estimated offer, NO account gate)
  │    └─ DegradationLayer (catches errors, routes to fallbacks, preserves state)
  │
  └─ getUserMedia (camera) ───────┐
                                  │
Server (Express on Node 22)       │
  ├─ /api/lookup/plate ──────────────► VendorCascade
  │                                       ├─ CarsXE platedecoder (prototype primary, live)
  │                                       └─ VinAudit (fallback, pending B2B approval)
  ├─ /api/lookup/vin    ──────────────► same VendorCascade
  ├─ /api/ocr/recognize ◄────── crop ────┘
  │                            ──────────► Google Cloud Vision (OCR)
  ├─ /api/prequal/estimate (mock soft-pull range, NO real bureau hit)
  ├─ /api/consent/log (TCPA consent audit trail)
  └─ /api/events (telemetry: every failure mode is named and logged)
```

The full polished Mermaid version with Simple Icons logos lives in `website/index.html` per the Gauntlet pattern.

## Component breakdown

### EntryForm
Owns the plate / VIN tab state, the form fields, and the green-check / red-error indicators. Tab state is preserved across submission errors. Field values are preserved across submission errors. **This is the literal fix for finding S6** (Carvana silently resets tab + erases input on backend error).

### VendorCascade
Pure domain module, no I/O of its own (takes vendor adapters as constructor args). Tries the primary vendor with an 8-second timeout (`DEFAULT_VENDOR_TIMEOUT_MS = 8_000`, bumped from 2s after a Render cold-start regression on 2026-05-22; see `src/lookup/VendorCascade.ts`). On miss or timeout, falls through to the fallback. Short-circuits on `bot_detected`. On all-vendors-miss, returns a structured `NotFound` result with `attemptedVendors` and `lastVendorTried`. The DegradationLayer translates that into honest user copy. **This is the literal fix for finding S4** (Carvana blames the user instead of acknowledging a vendor gap).

### OCRService
Two paths. Server path: receives a cropped image from the browser, calls Google Cloud Vision, returns text + confidence. Client iOS path (recorded for the privacy slide): SwiftUI app uses `VNRecognizeTextRequest` on-device, returns text without a network round-trip. Both paths produce the same `OCRResult` shape so the rest of the system is OCR-source-agnostic.

### DegradationLayer
A React context provider that wraps the error boundary. Catches errors from VendorCascade misses, OCRService failures, network timeouts. For each named failure mode, emits the correct user-facing message, preserves form state, and offers the right next-action (retry, switch tab, scan VIN, text-me-a-link). **The single most important component in the system.**

### ConsentManager
Owns the SMS marketing toggle and the User Agreement / Privacy Policy / E-SIGN consent affirmation. Toggle defaults OFF. Each agreement is a separate checkbox (not click-wrap inferred from submit). All consent decisions are written to `/api/consent/log` with a timestamp and the IP / user-agent for the TCPA audit trail. **This is the literal fix for findings B5 and B6.**

### PrequalEstimator (Mock for the demo)
Returns an APR range and monthly payment estimate based on the user's stated income + employment + a publicly-available range table. This is NOT a real soft-pull; it's a demo-only mock that produces a believable range. The real production integration would replace this with the actual soft-pull vendor (Equifax / TransUnion / Experian). **This addresses finding B8** (show prequal range BEFORE account creation).

### EventReporter
Every named failure mode is a stable event name (e.g., `lookup.plate.primary_miss`, `lookup.plate.cascade_exhausted`, `ocr.confidence_low`, `consent.sms_declined`, `prequal.shown_before_account`). Aggregated counts go to a `/api/events` endpoint that writes to a local SQLite for the demo and would be wired to Carvana's existing telemetry in production.

## Data flow (sell-side happy path)

1. User types plate + selects state in EntryForm.
2. Client sends `POST /api/lookup/plate { plate, state }`.
3. Server calls VendorCascade.lookupByPlate(plate, state).
4. Primary vendor returns vehicle (year, make, model, trim).
5. Server returns `{ status: 'resolved', vehicle, estimatedOfferRange }`.
6. ResultPanel renders, NO account gate.
7. EventReporter logs `lookup.plate.primary_hit`.

## Data flow (sell-side cascade-fallback path)

1. Same as steps 1-3.
2. Primary vendor returns null. VendorCascade calls fallback vendor.
3. Fallback returns vehicle. Server returns `{ status: 'resolved', vehicle, viaVendor: 'fallback' }`.
4. ResultPanel renders, NO account gate. DegradationLayer optionally surfaces a one-line "we had to use our backup data source for this plate, results look good" note for transparency.
5. EventReporter logs `lookup.plate.primary_miss` AND `lookup.plate.fallback_hit`.

## Data flow (sell-side cascade-exhausted path)

1. Steps 1-2 same.
2. Both primary and fallback miss. Server returns `{ status: 'not_found', lastVendorTried: 'fallback', attemptCount: 2 }`.
3. DegradationLayer surfaces honest copy ("our partner data does not have this plate, this happens to about X% of plates") and the three fallback options: switch to VIN tab (input preserved), scan VIN with camera, open chat.
4. Form state is preserved. Tab does NOT reset. User input is NOT erased.
5. EventReporter logs `lookup.plate.cascade_exhausted`.

## Decisions table

| Decision | What we chose | Alternative considered | Why |
|---|---|---|---|
| Architecture pattern | Drop-in API gateway (we sit between Carvana's frontend and their vendor) | Front-end overlay (we rewrite their entry component) | Gateway means Carvana keeps their stack; the integration story is "wire your vendor calls through us" which is what a real PM can buy. Overlay is easier to demo but harder to defend as a real integration. |
| Primary vendor (production) | Carfax QuickVIN Plus | DataOne, ClearVIN, VinAudit, PlateToVin | Per `research/plate-api-landscape.md`, Carfax is the industry's most-comprehensive plate-to-VIN data source and any Carvana-scale dealer already has it under their existing contract. The fix is "use the vendor you already pay for, correctly." |
| Primary vendor (prototype) | **CarsXE platedecoder** (live in slice 1) | Wait on Carfax dealer-vendor sales gate | Carfax requires a dealer-relationship sales call to issue sandbox credentials, which makes it unworkable for a one-week prototype. CarsXE offers self-service signup with a 100-call lifetime sandbox tier, lets us ship a working live demo *today*, and the swap to Carfax in production is a one-line adapter change because `VendorAdapter` hides the vendor specifics. |
| Fallback vendor | VinAudit (slice 2, pending B2B approval) | DataOne, CarAPI | VinAudit's pricing and coverage are both reasonable for a fallback role; their signup is a B2B sales gate that we started on 2026-05-21 and are waiting on. CarsXE alone covers the slice 1 happy path; VinAudit adds independent failure modes once approved. |
| OCR primary path | Browser `getUserMedia` + Google Cloud Vision server-side | Tesseract.js client-side | Tesseract.js works but accuracy on plates and VIN stickers is lower than cloud vision; per `research/plate-api-landscape.md` Apple Vision is the iOS gold standard and Google Vision is the web equivalent. Cost is negligible at $1.50 per 1k. |
| iOS OCR demo | SwiftUI + Apple `VNRecognizeTextRequest` | React Native + Tesseract | Privacy story is the differentiator; on-device OCR with no PII leaving the phone is exactly the slide we want. SwiftUI is the user's preferred language. 30-second demo video, not the primary deliverable. |
| Frontend framework | React + Vite + TypeScript | Next.js | Vite is lighter, faster local dev, and matches existing Gauntlet repos (`boxy-fractions`, `adversary`). Next.js would add SSR / SEO that the prototype does not need. |
| Backend framework | Express on Node 22 | Hono, Fastify, Nest | Express is unsurprising and matches existing Gauntlet repos; a Carvana PM reading the code reads it without learning a new framework. |
| Account-creation timing (buy-side) | Show prequal terms first, account creation deferred to "save these terms" | Carvana's current pattern (account-required before terms) | Per finding B8; the entire buy-side pitch is built on this inversion. |
| TCPA SMS opt-in | Default OFF, separate checkbox, not click-wrap | Pre-checked toggle in fine print | Per finding B5; the entire trust pitch is built on this fix. |
| Plate -> Owner lookups | NEVER. Stay on plate -> VIN -> specs only. | Allow plate -> owner for "fraud prevention" use cases | DPPA, Bartholomew v. Parking Concepts CA 1st DCA Feb 2026. $2,500 per violation statutory minimum. Constitutional non-negotiable #6. |

## Trade-offs

- **API gateway architecture: harder to demo standalone.** Mitigated by building our own React frontend on top of the gateway for the demo, with the gateway exposed as a "this is the integration shape" callout.
- **Real vendor integration costs money even in dev.** Mitigated by sandbox accounts (Carfax dealer sandbox, DataOne developer tier) and by demo-time hits only.
- **OCR in browser requires camera permission, which scares some users.** Mitigated by showing the camera request just-in-time (after the user clicks "scan VIN") not on page load, and by an explicit "this image is sent to our server for VIN recognition then discarded" copy.
- **Demo-only mock for prequal soft-pull range.** Mitigated by labeling clearly in the demo and by the fact that a real PM-side integration would swap this for the actual bureau call.

## Sequencing (informs `tasks.md`)

Slice 0 ships the scaffold: empty React app, empty Express server, one failing Vitest test, one Playwright smoke test, dual-push gitflow set up, deployable to Render.

Slice 1 is the load-bearing slice: VendorCascade with Carfax integration and the EntryForm + ResultPanel for the plate happy path. After this slice the demo can show US1.

Slice 2 adds DataOne fallback. After this slice the demo can show US2's cascade-fallback path.

Slice 3 adds the DegradationLayer and honest error copy. After this slice the demo can show US2's cascade-exhausted path.

Slice 4 adds OCR via `getUserMedia` + Google Cloud Vision. After this slice the demo can show US4.

Slice 5 adds the buy-side: PrequalEstimator mock + ResultPanel showing terms before account. After this slice the demo can show US5.

Slice 6 adds ConsentManager with TCPA-compliant toggle. After this slice the demo can show US7.

Slice 7 adds the EventReporter and the "drop-off rate before / after" metrics overlay for the closing slide.

Slice 8 is demo polish + architecture website (`website/index.html`) + defense breakout script + AI interview prep.

Each slice is shippable in isolation and runs through `qa-adversary` before being merged.
