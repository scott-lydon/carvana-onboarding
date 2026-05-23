# Tasks — Carvana Onboarding Recovery Layer

> Sliced, actionable, checkbox-tracked. Each slice maps to a user story in `spec.md` and a component in `plan.md`. Each task names the rubric line it advances. Done-criteria are tiny acceptance tests the qa-adversary can replay.

## v2 PRD slice plan (2026-05-22) — AUTHORITATIVE for the 2-day rebuild

> Carvana updated the PRD to prescribe four AI surfaces (chatbot, OCR, scheduling, emotional support content), four metrics (40% completion lift, 15-min process, NPS 70+, p95 <3 s), and a 2-day time budget. The v1 slice plan (slices 2-8 below in "Deferred under v2") was sized for one week. v2 collapses the remaining work into 7 slices over 2 days.

### v2 Day 1 — chatbot + OCR + scheduler spine

#### v2 Slice A — ChatbotShell + /api/chat + tool-use over existing VendorCascade
- [x] **A.1** Install `@anthropic-ai/sdk` if not already present. Done: `npm ls @anthropic-ai/sdk` shows `@anthropic-ai/sdk@0.98.0`.
- [x] **A.2** Add `ANTHROPIC_API_KEY` to `.env.example` and `.env.local`; document in README. Done: `.env.example` updated with the key + signup URL + 503 fallback documentation. (`.env.local` is gitignored and lands with the user's actual key.)
- [x] **A.3** `server/chat/system-prompt.ts` — sell-side onboarding assistant persona, instructions to use tools, instructions to NEVER echo PII in free text (CAT-11). Done: exported as `SYSTEM_PROMPT` constant; hard rules #1 enforces CAT-11.
- [x] **A.4** `server/chat/tools.ts` — tool definitions for `lookup_plate`, `lookup_vin`, `ocr_recognize` (stub for slice B), `schedule_pickup` (stub for slice C), `get_support_content` (stub for slice D). Done: `tests/integration/tool-schema.test.ts` passes (5 tests, CAT-17). `generate_offer` deferred to slice E with the offer-generation flow.
- [x] **A.5** `server/routes/chat.ts` — POST handler, streams `client.messages.stream({ model: 'claude-sonnet-4-5', tools, system, messages })`, handles tool-use turns by dispatching to existing route handlers, posts tool-result blocks. Done: SSE format with `Content-Type: text/event-stream`; `tests/integration/chat-streaming.test.ts` validates the 503 configuration_missing path + input validation (CAT-13).
- [x] **A.6** `src/components/ChatbotShell.tsx` — chat history, message input, send button, streamed-response renderer, tool-use UI affordance (renders vehicle data card inline when `lookup_plate` returns Resolved). Done: component built with fetch + ReadableStream SSE parser, pre-baked client-side greeting, vehicle data card renderer, fallback link. Playwright `tests/e2e/v2-chatbot-plate-happy-path.spec.ts` written; auto-skips when ANTHROPIC_API_KEY or CARSXE_API_KEY absent (will run on user's machine once key lands).
- [x] **A.7** Mount ChatbotShell as primary surface in `src/App.tsx`; demote EntryForm to a fallback link ("prefer a form? click here"). Done: `src/App.tsx` renders ChatbotShell; EntryForm reachable via the fallback button inside the shell.
- [x] **A.8** Invoke qa-adversary against slice A in fresh context. Done: report at `docs/qa-reports/slice-A.md` (PASS on most categories, FAIL on 2 blockers — historyRef multi-turn bug + missing CAT-11 test). Both blockers addressed in commit b34a5b0. Adversary also dropped 2 regression tests at `tests/adversary/CAT-13-sliceA-chunked-header-missing.test.ts` and `tests/adversary/CAT-17-sliceA-malformed-tool-input-with-cascade.test.ts`.
- [x] **A.9** Submit-gate at end of slice-A response. Done: READY. Local + deployed two-turn smoke test PASS, 6/6 e2e PASS including v2 chatbot happy path, 42/42 vitest PASS, typecheck + lint clean, dual-push verified, Render serving b34a5b0 (uptime 82s = fresh build) with ANTHROPIC + CARSXE keys live.

#### v2 Slice B — OcrCapture + Claude vision swap-in
- [ ] **B.1** `server/routes/ocr.ts` — accept multipart image upload, call Anthropic Messages API with `claude-sonnet-4-5` and the image content block, system prompt: "extract the VIN from this image; respond with only the 17-character VIN or 'NOT_FOUND'." Done: integration test posts a known VIN-sticker fixture image, asserts the correct VIN is returned.
- [ ] **B.2** `src/components/OcrCapture.tsx` — `getUserMedia` permission request, viewfinder with VIN-rectangle overlay, capture button, client-side crop to the overlay, POST to `/api/ocr/recognize`. Done: Playwright scenario with a fixture image asserts the OCR result is returned to the client.
- [ ] **B.3** Wire `ocr_recognize` tool dispatch in `/api/chat` to call into OcrCapture flow when the chatbot invokes the tool. Chatbot's UI affordance: render the camera card inline. Done: Playwright scenario where the chatbot asks for a VIN photo, fixture image is fed, VIN extracts, chatbot confirms.
- [ ] **B.4** Drop Google Cloud Vision dependencies if any were installed. Done: `package.json` does not list any `@google-cloud` packages.
- [ ] **B.5** qa-adversary on slice B; submit-gate.

#### v2 Slice C — Scheduler + atomic SQLite booking
- [ ] **C.1** SQLite schema: `appointments(slot_start TIMESTAMP, scope TEXT, status TEXT, created_at TIMESTAMP, UNIQUE(slot_start, scope))`. Done: migration script creates table.
- [ ] **C.2** `server/scheduler/slots.ts` — `availableSlots(zip, dayRange)` returns deterministic slots (next 14 days, 8 slots/day 9 AM-5 PM, minus already-booked from SQLite). Done: unit test.
- [ ] **C.3** `server/scheduler/atomicity.ts` — `bookSlot(slotStart, scope)` wraps in `BEGIN IMMEDIATE`, attempts INSERT, returns success or conflict. Done: `tests/integration/scheduler-concurrency.test.ts` fires 10 parallel bookings of same slot, asserts exactly 1 success (CAT-14).
- [ ] **C.4** `server/routes/schedule.ts` — GET `/api/schedule/slots` + POST `/api/schedule/book`. Done: integration test covers happy path and conflict path.
- [ ] **C.5** `src/components/Scheduler.tsx` — weekly grid component, slot click → POST book → optimistic update + server confirmation, conflict shows "that slot just got taken, here are alternatives." Done: Playwright covers both happy and conflict paths.
- [ ] **C.6** Wire `schedule_pickup` tool dispatch in `/api/chat`; chatbot UI renders Scheduler inline after the offer step. Done: Playwright full happy path: chatbot → plate → vehicle → offer → schedule → booked.
- [ ] **C.7** qa-adversary on slice C; submit-gate.

### v2 Day 2 — emotional support + metrics + perf + polish

#### v2 Slice D — SupportContentWidget + pre-baked cards + anxiety-signal detection
- [ ] **D.1** `src/support-content/cards.ts` — 5 cards: `OfferDropAnxiety`, `DataPrivacy`, `WalkAwayPolicy`, `InspectionExpectations`, `PaymentTiming`. Each: short title, 60-80 word body, telemetry event name. Done: TypeScript union type `SupportTopic` enumerates all 5.
- [ ] **D.2** `src/components/SupportContentWidget.tsx` — render the card matching a given `SupportTopic`. Done: `tests/components/SupportContentWidget.test.tsx` mocks each topic and asserts byte-for-byte match against the committed card body (CAT-12).
- [ ] **D.3** Wire `get_support_content` tool dispatch in `/api/chat`; chatbot UI renders SupportContentWidget inline. System prompt updates to instruct the chatbot to invoke `get_support_content` when anxiety signals are detected (uncertainty, "what if" questions, hesitation). Done: Playwright simulates "what if my offer drops at pickup?" asserts the OfferDropAnxiety card renders.
- [ ] **D.4** qa-adversary on slice D; submit-gate.

#### v2 Slice E — NpsSurvey + completion-time stopwatch + metrics overlay
- [ ] **E.1** `src/components/NpsSurvey.tsx` — 0-10 score buttons, free-text follow-up, submit. Renders after the schedule-confirmed screen. Done: component test covers all scores.
- [ ] **E.2** Client-side stopwatch: record first chat message timestamp on mount, compute elapsed time at NPS-submit. Done: stopwatch reads correct elapsed time in Playwright happy-path test.
- [ ] **E.3** `server/routes/nps.ts` — POST `/api/nps/submit` writes (score, comment, elapsed_seconds, timestamp) to SQLite `nps` table. Done: integration test.
- [ ] **E.4** Dev-only on-page metrics overlay (toggleable via `?metrics=1` query param) showing current chatbot first-token latency, total flow elapsed time, NPS average. Done: visible when query param is set, hidden otherwise.
- [ ] **E.5** qa-adversary on slice E; submit-gate.

#### v2 Slice F — k6 perf load test + Render service pinning
- [ ] **F.1** `scripts/perf/load.k6.js` — 60-second load test, 20 virtual users, hits `/api/chat` (mocked Anthropic on the test side so the test isolates server perf not LLM latency) + `/api/lookup/plate` + `/api/schedule/slots`. Reports p95 latency per endpoint. Done: script runs locally and emits JSON summary.
- [ ] **F.2** `npm run perf:smoke` (10s, 5 VU) and `npm run perf:load` (60s, 20 VU) added to `package.json`. Done: both commands run.
- [ ] **F.3** Pin Render service to "starter" paid tier OR document the pre-warm procedure in `docs/perf-report.md`. Done: tier change confirmed in Render dashboard screenshot or pre-warm runbook is in the doc.
- [ ] **F.4** Run `npm run perf:load` against the deployed Render URL; capture p95 per endpoint; commit `docs/perf-report.md` with the numbers + the target URL + the date. Done: report exists with p95 < 3 s for all hot endpoints (CAT-16).
- [ ] **F.5** qa-adversary on slice F; submit-gate.

#### v2 Slice G — architecture website + defense breakout + AI interview prep + demo video
- [ ] **G.1** `website/index.html` refresh — Mermaid diagram of v2 topology (chatbot as orchestrator, tools as services), Simple Icons logos for Anthropic / Claude / React / TypeScript / Vite / Express / Node / Render / SQLite / GitHub / GitLab, no edge crossings; decision table v2; trade-offs v2; cost chart (Anthropic pricing + Render starter tier); tech stack grid v2. Done: page loads, diagrams render, all icons load.
- [ ] **G.2** `docs/DEFENSE_BREAKOUT_SCRIPT.md` — 5-minute spoken script, substance only, no meta about format. Threads: chatbot tool-use over VendorCascade, Claude vision in place of Google Cloud Vision, atomic scheduling, pre-baked support content. Done: 4-4:30-min spoken pace by user, no scheduling-overreach language.
- [ ] **G.3** `docs/AI_INTERVIEW_PREP.md` update — portal link at top, elevator pitch updated for v2, four rubric anchors updated (chatbot, atomic scheduler, PII-via-tool-use, k6 perf report), 12+ prepared answers, recurring questions from `~/Documents/Claude/Projects/Gauntlet/AI_INTERVIEW_QUESTION_LOG.md` at top of bank. Done: file exists with the structure mandated in CLAUDE.md.
- [ ] **G.4** Record 60-second demo video per the v2 demo script in `spec.md`. Done: file at `docs/demo-v2.mp4` (or equivalent).
- [ ] **G.5** Final qa-adversary on the deployed Render URL against the v2 end-to-end pipeline command. Done: report at `docs/qa-reports/v2-final.md` with PASS verdict.
- [ ] **G.6** Submit-gate at end of slice G response = final submit-gate for v2.

### v2 standing rules (apply to every v2 slice)

- qa-adversary in fresh context at slice end, briefed against v2-updated constitution + spec + plan + tasks + QA_ADVERSARY.
- Submit-gate at end of every code-touching response.
- Dual-push remote check on every push: `git ls-remote origin main` and `git ls-remote gitlab main` must return matching hashes.
- Vendor APIs (Anthropic, CarsXE) hit live sandboxes in integration tests, gated by env flags. Mocked Anthropic is permitted ONLY for the streaming-timing test (where the assertion is about the stream shape, not LLM behavior).

---

## v1 Current slice (DEFERRED under v2; preserved for git-history continuity)

### Slice 2 — bot-detected differentiation copy + OCR fallback path (DEFERRED)

(Slice 1 is COMPLETE and live at <https://carvana-onboarding.onrender.com>; see "Done slices" section below.)

## Done slices

### Slice 0 — scaffold + first failing test + deployable (COMPLETE)

- [x] **0.1** Initialize Vite + React + TypeScript app at repo root; `package.json` named `carvana-onboarding-prototype`. Done-criteria: `npm run dev` opens a working dev server.
- [x] **0.2** Initialize Express + TypeScript server in `server/`. Done-criteria: `npm run server` returns `{ ok: true }` from `GET /api/health`.
- [x] **0.3** Wire root-level `npm run dev:all` to run client + server concurrently via `concurrently`. Done-criteria: one command spins up both.
- [x] **0.4** Install Vitest, Playwright, ESLint (`@typescript-eslint/strict-type-checked`), Prettier, `fast-check`. Done-criteria: each tool's CLI version prints when run.
- [x] **0.5** Add one failing Vitest test: `it('placeholder failing test', () => expect(true).toBe(false))`. Done-criteria: `npm run test` exits non-zero with one expected failure. **Stays failing on purpose per spec §0.5 — do NOT close.**
- [x] **0.6** Add one passing Playwright smoke test: navigate to the dev server, assert page title contains "Carvana Onboarding." Done-criteria: `npm run test:e2e` exits zero.
- [x] **0.7** Set up dual-push gitflow per `~/Documents/Claude/Projects/Gauntlet/CLAUDE.md`: create GitHub repo `scott-lydon/carvana-onboarding`, create GitLab repo `labs.gauntletai.com/scottlydon/carvana-onboarding`, configure `origin` with two push URLs. Done-criteria: `git ls-remote origin main` and `git ls-remote gitlab main` return matching hashes.
- [x] **0.8** Add `.github/workflows/ci.yml` running typecheck + lint + test on every push. Done-criteria: CI passes on the scaffold commit.
- [x] **0.9** Deploy scaffold to Render (one web service for the Express server + static React build). Done-criteria: a public URL serves the scaffold page.
- [x] **0.10** Run `./scripts/check-placeholders.sh` to verify the five foundational artifacts contain no template placeholders. Done-criteria: script exits zero with five PASS lines.
- [x] **0.11** Invoke `qa-adversary` sub-agent against slice 0. Done-criteria: report saved under `docs/qa-reports/slice-0.md` with verdict. (PASS verdict on follow-up at `docs/qa-reports/slice-0-fix-and-prebake.md`.)

### Slice 1 — VendorCascade with CarsXE primary, plate happy path (US1) (COMPLETE)

> NOTE: Carfax sandbox was the original target. After the Carfax dealer-vendor sales gate proved unworkable for a one-week prototype, CarsXE became the *prototype* primary (self-service signup, sandbox 100 calls/lifetime; production swap-back to Carfax is a one-line adapter change). VinAudit is the live fallback. See plan.md decisions table.

- [x] **1.1** Domain types: `Plate`, `StateCode`, `Vin`, `Vehicle`, `LookupResult` (discriminated union of `Resolved | NotFound | TransientError | BotDetected | FormatError`). Validation in constructors. 14 tests covering EC1 (Texas asterisk normalization), EC2 (I/O/Q-permutation hint), EC4 (whitespace strip), EC5 (lowercase normalize). `src/lookup/types.ts`, `tests/unit/lookup-types.test.ts`.
- [x] **1.2** VendorAdapter interface; **CarsXEAdapter** as live primary (`src/lookup/adapters/CarsXEAdapter.ts`, against `GET https://api.carsxe.com/platedecoder`); VinAuditAdapter as fallback shape (`src/lookup/adapters/VinAuditAdapter.ts`, awaiting B2B sales approval). Real HTTP, not mocked.
- [x] **1.3** `VendorCascade` class taking an array of adapters, with `lookupByPlate(plate, state)` and `lookupByVin(vin)`. **8-second timeout per adapter** (bumped from 2s after Render cold-start). Short-circuits on `resolved` or `bot_detected`. `src/lookup/VendorCascade.ts`.
- [x] **1.4** Property tests (`fast-check`, 200 runs each): for any sequence of [Resolved, NotFound, Error] vendor responses, VendorCascade returns the first Resolved OR a NotFound when exhausted OR a TransientError only when ALL vendors errored. `tests/property/cascade.property.test.ts`.
- [x] **1.5** Express endpoints `POST /api/lookup/plate` and `POST /api/lookup/vin` wired to VendorCascade. Pattern-matches LookupResult kinds to HTTP statuses (200/400/404/429/503). Returns 503 `configuration_missing` when no API keys are set. `server/routes/lookup.ts`, `server/index.ts`.
- [x] **1.6** React `EntryForm` component with License Plate / VIN tabs. Form-state preservation across errors (tab AND field values). Inlined `DegradationPanel` pattern-matches LookupResult to per-mode user-facing copy: resolved (green) / not_found (yellow with 3 recovery paths) / transient_error (red, "on our side, not yours") / bot_detected (warm-amber with brief link) / format_error (blue with field-specific reason) / configuration_missing ("demo warming up"). `src/components/EntryForm.tsx`. **Live at <https://carvana-onboarding.onrender.com>.**
- [x] **1.7** ResultPanel responsibilities folded into DegradationPanel for slice 1.6 brevity. Vehicle data renders inline; estimated-offer copy deferred to slice 5 with the buy-side.
- [x] **1.8** Manual confirmation of US1 happy path: `XRJ4041 / TX` resolves to `2021 Toyota Highlander (SUV)` in 1053ms via CarsXE, HTTP 200, no account requested. Playwright scenario deferred to slice 2 alongside the bot-detected differentiation test.
- [x] **1.9** Invoke `qa-adversary` against slice 1. Latest report at `docs/qa-reports/slice-0-fix-and-prebake.md` (slice 1 prebake bundled in); fresh diff-range delegation against `b914f2b..HEAD` runs at the end of every slice-touching response per CLAUDE.md.

## Next slice

### Slice 2 — bot-detected differentiation copy + OCR fallback path (US3, US4)

## Backlog

### Slice 2 (renumbered, was "DataOne fallback") — VinAudit live-fallback once B2B sales approves

- [ ] **2.1** Receive VinAudit live API key (blocked on their B2B sales gate; signup completed 2026-05-21).
- [ ] **2.2** Add `VINAUDIT_API_KEY` to Render env vars; redeploy.
- [ ] **2.3** Integration test: CarsXE returns NotFound, VinAudit returns Resolved, cascade returns Resolved-via-VinAudit.
- [ ] **2.4** Playwright: known-CarsXE-miss plate resolves via VinAudit with a "we used our backup data source for this plate" transparency note.
- [ ] **2.5** qa-adversary on slice 2.

### Slice 3 — DegradationLayer + honest error copy (US2 cascade-exhausted, US3)

- [ ] **3.1** DegradationLayer React context: error boundary + state-preservation guarantee.
- [ ] **3.2** Named-failure-mode -> user-copy table. Each entry includes: short title, body, recommended next action, telemetry event name.
- [ ] **3.3** Form-state preservation: VendorCascade exhaustion does NOT reset tab; field values are preserved across error; tab switch preserves the other tab's field values.
- [ ] **3.4** Playwright: known-cascade-miss plate produces honest copy with VIN-fallback CTA, plate text is preserved, tab does not reset.
- [ ] **3.5** Playwright: simulated backend 500 produces "transient error" copy with retry CTA, plate text is preserved.
- [ ] **3.6** qa-adversary on slice 3.

### Slice 4 — OCR via getUserMedia + Google Cloud Vision (US4)

- [ ] **4.1** OCRCapture component: `getUserMedia` permission request, viewfinder with crop overlay, capture button.
- [ ] **4.2** Client-side crop to VIN-rectangle aspect ratio; ship cropped image to server.
- [ ] **4.3** `POST /api/ocr/recognize` endpoint, calls Google Cloud Vision text detection on the cropped image, returns recognized text + confidence.
- [ ] **4.4** Client wires the OCR result into the VIN field; if confidence > 90% triggers lookup automatically, else shows manual confirm.
- [ ] **4.5** Playwright (with a known fixture image): camera mock, OCR returns the expected VIN, lookup runs, vehicle data shows.
- [ ] **4.6** qa-adversary on slice 4.

### Slice 5 — Buy-side PrequalEstimator + terms-before-account (US5)

- [ ] **5.1** PrequalForm component with the three steps (Personal / Contact / Financial) modeled after Carvana but with our fixes (single full-name field, address autocomplete via Google Places, expanded employment options per US6).
- [ ] **5.2** PrequalEstimator mock service returning APR range + monthly payment estimate based on stated income.
- [ ] **5.3** PrequalResultPanel: shows the terms BEFORE any account requirement, with "save these terms (create account)" as a secondary CTA below.
- [ ] **5.4** Playwright: complete the three steps with fake data, see terms immediately, account creation is optional.
- [ ] **5.5** qa-adversary on slice 5.

### Slice 6 — TCPA-compliant ConsentManager (US7)

- [ ] **6.1** ConsentManager component: SMS toggle defaults OFF; User Agreement, Privacy Policy, E-SIGN as three separate checkboxes; full consent text expandable in-place.
- [ ] **6.2** `POST /api/consent/log` endpoint writing audit trail (timestamp, IP, user-agent, which consents were given) to a local SQLite.
- [ ] **6.3** Playwright: submit prequal without toggling SMS on, verify no consent is logged for SMS; submit with SMS on, verify it is logged.
- [ ] **6.4** qa-adversary on slice 6.

### Slice 7 — EventReporter + before/after telemetry overlay

- [ ] **7.1** `EventReporter` module emitting stable named events; `POST /api/events` endpoint.
- [ ] **7.2** Local SQLite aggregating event counts; `/api/metrics/summary` endpoint returning the dashboard data.
- [ ] **7.3** Optional dev-only metrics overlay on the prototype showing real-time event counts (NOT shipped in production demo, but useful for the architecture website).
- [ ] **7.4** qa-adversary on slice 7.

### Slice 8 — demo polish + architecture website + defense script + AI interview prep

- [ ] **8.1** `website/index.html` per the Gauntlet architecture-website pattern: Mermaid diagrams with Simple Icons logos, no edge crossings, decision table, cost charts.
- [ ] **8.2** `docs/DEFENSE_BREAKOUT_SCRIPT.md` 5-minute spoken script, substance only.
- [ ] **8.3** `docs/AI_INTERVIEW_PREP.md` 12+ prepared answers, portal link at top.
- [ ] **8.4** Record the 60-second demo video per `spec.md` demo script.
- [ ] **8.5** Final qa-adversary on the deployed Render URL.

## Notes for the implementing agent

- Every slice ends with qa-adversary in a fresh context. Skipping is forbidden unless the user says "hold off on QA."
- Every code change goes through submit-gate at the end of the response that ships it.
- Dual-push remote check on every push: `git ls-remote origin main` and `git ls-remote gitlab main` must return matching hashes.
- The `.env.local` file holds vendor credentials and is gitignored. The repo has a `.env.example` with placeholder values.
- Do not mock vendor APIs in integration tests. Use sandbox accounts. Mocked vendor integration is exactly the failure mode the entire project critiques.
