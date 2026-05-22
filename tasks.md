# Tasks — Carvana Onboarding Recovery Layer

> Sliced, actionable, checkbox-tracked. Each slice maps to a user story in `spec.md` and a component in `plan.md`. Each task names the rubric line it advances. Done-criteria are tiny acceptance tests the qa-adversary can replay.

## Current slice

### Slice 0 — scaffold + first failing test + deployable

- [ ] **0.1** Initialize Vite + React + TypeScript app at repo root; `package.json` named `carvana-onboarding-prototype`. Done-criteria: `npm run dev` opens a working dev server.
- [ ] **0.2** Initialize Express + TypeScript server in `server/`. Done-criteria: `npm run server` returns `{ ok: true }` from `GET /api/health`.
- [ ] **0.3** Wire root-level `npm run dev:all` to run client + server concurrently via `concurrently`. Done-criteria: one command spins up both.
- [ ] **0.4** Install Vitest, Playwright, ESLint (`@typescript-eslint/strict-type-checked`), Prettier, `fast-check`. Done-criteria: each tool's CLI version prints when run.
- [ ] **0.5** Add one failing Vitest test: `it('placeholder failing test', () => expect(true).toBe(false))`. Done-criteria: `npm run test` exits non-zero with one expected failure.
- [ ] **0.6** Add one passing Playwright smoke test: navigate to the dev server, assert page title contains "Carvana Onboarding." Done-criteria: `npm run test:e2e` exits zero.
- [ ] **0.7** Set up dual-push gitflow per `~/Documents/Claude/Projects/Gauntlet/CLAUDE.md`: create GitHub repo `scott-lydon/carvana-onboarding`, create GitLab repo `labs.gauntletai.com/scottlydon/carvana-onboarding`, configure `origin` with two push URLs. Done-criteria: `git ls-remote origin main` and `git ls-remote gitlab main` return matching hashes.
- [ ] **0.8** Add `.github/workflows/ci.yml` running typecheck + lint + test on every push. Done-criteria: CI passes on the scaffold commit.
- [ ] **0.9** Deploy scaffold to Render (one web service for the Express server + static React build). Done-criteria: a public URL serves the scaffold page.
- [ ] **0.10** Run `./scripts/check-placeholders.sh` to verify the five foundational artifacts contain no template placeholders. Done-criteria: script exits zero with five PASS lines.
- [ ] **0.11** Invoke `qa-adversary` sub-agent against slice 0. Done-criteria: report saved under `docs/qa-reports/slice-0.md` with verdict.

## Next slice

### Slice 1 — VendorCascade with Carfax primary, plate happy path (US1)

- [ ] **1.1** Domain types: `Plate`, `StateCode`, `Vin`, `Vehicle`, `LookupResult` (discriminated union of `Resolved | NotFound | Error`). Validation in constructors. Tests for each.
- [ ] **1.2** VendorAdapter interface; one concrete adapter for Carfax QuickVIN Plus (sandbox / dev tier credentials in `.env.local`, NOT committed). Tests against recorded fixtures of real responses.
- [ ] **1.3** `VendorCascade` class taking an array of adapters, with `lookupByPlate(plate, state)`. 2-second timeout per adapter. Returns `LookupResult`.
- [ ] **1.4** Property tests (`fast-check`): for any sequence of [Resolved, NotFound, Error] vendor responses, VendorCascade returns the first Resolved OR a NotFound when exhausted OR an Error only when ALL vendors errored.
- [ ] **1.5** Express endpoint `POST /api/lookup/plate` wired to VendorCascade. Integration test against the recorded fixtures.
- [ ] **1.6** React EntryForm component, plate tab only. Plate input + state dropdown (alphabetical by state name with type-to-filter — fixes Carvana's S2 + the buy-vs-sell sort inconsistency). Submit calls `/api/lookup/plate`.
- [ ] **1.7** React ResultPanel component, renders vehicle data + a hardcoded "estimated offer range" placeholder (real offer model is out of scope). NO account gate.
- [ ] **1.8** Playwright scenario for US1: enter a known-good plate, see vehicle data within 2 seconds, no account requested.
- [ ] **1.9** Invoke `qa-adversary` against slice 1.

## Backlog

### Slice 2 — DataOne fallback (US2 cascade-fallback path)

- [ ] **2.1** DataOne VendorAdapter implementation against their sandbox.
- [ ] **2.2** Wire DataOne as the second adapter in VendorCascade.
- [ ] **2.3** Integration test: primary returns NotFound, fallback returns Resolved, cascade returns Resolved-via-fallback.
- [ ] **2.4** Playwright: known-Carfax-miss plate resolves via DataOne with a "we used our backup data source for this plate" transparency note.
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
