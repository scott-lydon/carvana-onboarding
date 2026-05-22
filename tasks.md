# Tasks — Carvana Onboarding Recovery Layer

> Sliced, actionable, checkbox-tracked. Each slice maps to a user story in `spec.md` and a component in `plan.md`. Each task names the rubric line it advances. Done-criteria are tiny acceptance tests the qa-adversary can replay.

## Current slice

### Slice 2 — bot-detected differentiation copy + OCR fallback path (next up)

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
