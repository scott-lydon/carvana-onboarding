# QA_ADVERSARY — Carvana Onboarding Recovery Layer

> How the qa-adversary sub-agent attacks this project. Read by `~/.claude/agents/qa-adversary.md` on every invocation.

## Project context

The Carvana Onboarding Recovery Layer is a working web prototype that fixes Carvana's broken sell-side plate / VIN lookup and buy-side account-creation gate. The entire pitch hinges on the system NOT exhibiting the failure modes catalogued as S1-S6 and B0-B8 in `research/walkthrough-findings.md`. Any QA pass that finds those same failure modes in OUR prototype is a critical regression that blocks the slice.

## How to run the tests

Run from repo root unless noted.

```
npm run typecheck         # TypeScript strict, must pass zero errors
npm run lint              # ESLint, must pass zero warnings
npm run test              # Vitest unit + integration
npm run test:property     # fast-check property tests against VendorCascade
npm run test:e2e          # Playwright covering each named failure mode
npm run test:all          # all of the above
```

End-to-end pipeline command for a single-command "is the whole repo green":

```
npm run typecheck && npm run lint && npm run test:all
```

## Base branch for diff

`main`. Adversary diffs against the most recent commit on `main`. For multi-commit slices, diff the slice branch against `main`.

## Hot files (where bugs are most likely)

Per the architecture in `plan.md`, the bug surfaces concentrate in:

- `src/lookup/VendorCascade.ts` — vendor adapter ordering, timeouts, fallback decision logic, error type mapping
- `src/lookup/adapters/Carfax.ts` and `src/lookup/adapters/DataOne.ts` — credential handling, error response parsing, timeout enforcement
- `src/components/EntryForm/EntryForm.tsx` — tab state, field state preservation across errors, indicator state consistency
- `src/components/DegradationLayer/DegradationLayer.tsx` — error-to-copy mapping, next-action routing, telemetry emission
- `src/components/ConsentManager/ConsentManager.tsx` — toggle default state, checkbox separation, audit-log write
- `src/ocr/OCRService.ts` — image crop, network error handling, low-confidence path
- `server/routes/lookup.ts` — request validation, vendor call orchestration, response shape

Run `git diff --name-only HEAD~15..HEAD` at adversary time to see the actual recent hot files; the above is the steady-state list.

## Named bug categories (what to attack)

For each category, the adversary writes a failing test that demonstrates the regression, or a written report citing the offending file + line. The implementing agent is NOT allowed to declare the slice done while any of these regress.

### CAT-1 — Silent failure (must throw or display)
Any code path that catches an error and continues without either rethrowing or surfacing to the user via DegradationLayer is a CAT-1 regression. This is the literal pattern Carvana exhibits in S6 (uncaught axios error → silent form reset). Grep for `catch` blocks; each one must either rethrow, log AND continue with an explicit comment naming why continuation is safe, or route to DegradationLayer.

### CAT-2 — Form reset on error (must preserve input)
Any error path that resets `EntryForm` tab state, field values, or focus is a CAT-2 regression. This is the literal pattern Carvana exhibits in S6. Playwright tests under `tests/e2e/preservation.spec.ts` enforce this; if those fail, slice is blocked.

### CAT-3 — Blame-the-user copy (must never)
Any user-facing error string containing "check your entry," "please try again" without context, "invalid plate" / "invalid VIN" when the format is fine, or any phrasing that implies user error when the actual cause is system / vendor failure, is a CAT-3 regression. This is the literal pattern Carvana exhibits in S4. Static analysis test: `tests/copy/blame-the-user.test.ts` greps every UI string against a blocked-phrase list.

### CAT-4 — Default-on marketing opt-in (must default off)
Any consent toggle, checkbox, or input that defaults to opted-in for SMS marketing, email marketing, or third-party data sharing is a CAT-4 regression. This is the literal pattern Carvana exhibits in B5. Component test: `tests/components/ConsentManager.test.tsx` asserts initial state for every consent control.

### CAT-5 — Account before value (must defer)
Any code path that requires account creation before showing prequalification terms, vehicle data, estimated offer, or any other primary value is a CAT-5 regression. This is the literal pattern Carvana exhibits in B8. Playwright: `tests/e2e/buy-flow-no-account-gate.spec.ts` walks the prequal flow with no account and asserts the result panel renders.

### CAT-6 — DPPA boundary violation (constitutional)
Any vendor call that requests plate -> owner-name, plate -> owner-address, or any DMV-PII field is a CAT-6 regression. This is a constitutional non-negotiable. Static analysis: grep every vendor adapter call for owner / driver / registrant fields in the request shape.

### CAT-7 — Network call from automated tests to real Carvana endpoints (forbidden)
Any test that hits `*.carvana.com` is a CAT-7 regression. ESLint rule enforced by `eslint-plugin-disallowed-domains`.

### CAT-8 — `as any` or `// @ts-ignore` without a justifying comment
Any escape from TypeScript strict mode without a `// eslint-disable-next-line` comment that names a specific reason (vendor SDK boundary, test fixture, etc.) is a CAT-8 regression.

### CAT-9 — Vendor mocked in integration test
Integration tests must hit real vendor sandboxes (gated by env flag). Mocked vendor responses in integration tests are a CAT-9 regression because mocked vendor integration is exactly the failure mode the prototype critiques.

### CAT-10 — Stale telemetry event names
Every emitted event name in EventReporter must appear in the `EventName` union type in `src/telemetry/events.ts`. Drift between emitted strings and the type union is a CAT-10 regression caught by a strict-type-check test.

## Conventions for failing tests

Failing tests authored by the adversary go under `tests/adversary/` and are named for the bug category and the slice they regress (`tests/adversary/CAT-2-slice3-tab-reset.spec.ts`). They are NOT pushed to main until the implementing agent fixes the underlying issue; in the interim they live on the slice branch with the failing assertion.

## Ignored paths

- `research/` — read-only research; not application code.
- `website/` — architecture website; static HTML, has its own lint (`stylelint`) but does not run through Vitest.
- `docs/` — documentation, no code.
- `test-plates/` — image corpus for OCR tests, not application code.
- `node_modules/`, `dist/`, `build/`, `.next/`, `coverage/` — generated.

## End-to-end pipeline command

```
npm run typecheck && npm run lint && npm run test:all
```

If that command exits zero, the slice has not regressed against the above bug categories at the static level. Adversary still hand-reviews the diff for category-specific concerns (especially CAT-3 copy, CAT-5 account gating, and CAT-6 DPPA).

## Where reports go

`docs/qa-reports/slice-N.md`, one file per slice, with: verdict (PASS / FAIL), categories tested, regressions found (if any) with file + line + reproduction steps, recommended fix shape (NOT the fix itself — adversary does not have Edit / Write access).

## Reference

- `~/.claude/agents/qa-adversary.md` — generic adversary prompt that reads this file as the project-specific override.
- `~/Documents/Claude/Projects/Gauntlet/qa-pipeline.html` — design rationale for fresh-context adversary.
- `constitution.md` — the non-negotiables this adversary enforces.
- `research/walkthrough-findings.md` — the Carvana failure modes this prototype must NOT replicate.

---

## v2 PRD delta (2026-05-22) — AUTHORITATIVE for the 2-day rebuild

### v2 hot files (where v2 bugs will concentrate)

- `src/components/ChatbotShell.tsx` — streaming, message history, tool-use UI affordances, error rendering inside the chat
- `server/routes/chat.ts` — Anthropic API call, tool dispatch, streaming back to client, error handling on tool failures
- `server/chat/tools.ts` — tool definitions; mismatch between tool schema and the dispatch handler is a silent class of bugs
- `server/chat/system-prompt.ts` — the system prompt is the spec for the chatbot's behavior; drift between prompt and actual behavior is a v2-specific bug surface
- `src/components/Scheduler.tsx` — slot rendering, slot selection, optimistic update vs server confirmation, conflict UI
- `server/routes/schedule.ts` — atomic slot allocation; concurrency bugs hide here
- `src/components/OcrCapture.tsx` — camera permission flow, crop overlay, capture-to-bytes path
- `server/routes/ocr.ts` — Claude vision call, image-to-tokens conversion, confidence threshold
- `src/components/SupportContentWidget.tsx` — card-by-topic rendering
- `src/components/NpsSurvey.tsx` — score selection, free text capture, submission
- `server/routes/nps.ts` — NPS row insert, completion-time recording

### v2 named bug categories (additive to CAT-1 through CAT-10)

**CAT-11 — LLM free-text contains PII (constitutional non-negotiable #9).** Any chatbot response that echoes back the user's plate, VIN, driver license number, or address inside the LLM's narrative text (not as a structured tool-result) is a CAT-11 regression. Test: `tests/adversary/CAT-11-pii-in-free-text.spec.ts` walks the chatbot through a full happy path, captures every assistant message, asserts no message body contains the plate or VIN as a substring (the UI may render them, but the LLM's text must not).

**CAT-12 — LLM-generated empathy content (constitutional non-negotiable #10).** Any SupportContentWidget render that displays text not present in the committed `src/support-content/cards.ts` file is a CAT-12 regression. Test: `tests/components/SupportContentWidget.test.tsx` mocks the chatbot's tool-call asking for a specific topic, asserts the rendered text matches the committed card body byte-for-byte.

**CAT-13 — Non-streamed chat response (constitutional non-negotiable #11).** Any `/api/chat` response that is not chunked-transfer-encoded streaming is a CAT-13 regression. Test: `tests/integration/chat-streaming.test.ts` issues a chat request, asserts `Transfer-Encoding: chunked` is set, asserts first token arrives within 1.5 s (mocked Anthropic stream for the assertion-timing test).

**CAT-14 — Double-booked scheduler slot (constitutional non-negotiable #12).** Two parallel requests booking the same slot that both return success is a CAT-14 regression. Test: `tests/integration/scheduler-concurrency.test.ts` fires 10 parallel bookings of the same slot, asserts exactly 1 success and 9 conflict errors.

**CAT-15 — NPS demo data not labeled.** Any pitch slide or dashboard that reports an NPS number without labeling the n and source (real demo respondents vs cited industry comparable) is a CAT-15 regression. This is content review, not code, but the adversary checks the architecture website + AI interview prep file for this.

**CAT-16 — Perf test against dev server.** Any reported p95 latency number in `docs/perf-report.md` or the pitch deck that was measured against the local dev server (port 5173 / 8787) rather than the deployed Render URL is a CAT-16 regression. Check: the perf-report.md should include the target URL it was measured against.

**CAT-17 — Chatbot tool-use schema drift.** Any tool defined in `server/chat/tools.ts` whose JSON schema does not match the handler's accepted arguments is a CAT-17 regression. Test: `tests/integration/tool-schema.test.ts` parses each tool definition, attempts a representative dispatch, asserts no validation errors on the handler side.

### v2 end-to-end pipeline command (updated)

```
npm run typecheck && npm run lint && npm run test:all && npm run perf:smoke
```

Where `npm run perf:smoke` is a 10-second k6 run that produces a smoke-level perf check (the full load test is `npm run perf:load`, runs against deployed only, not in CI).

### v2 ignored paths (additive)

- `src/support-content/cards.ts` — content file, reviewed manually, not subject to drift-testing beyond CAT-12 byte-for-byte match.

### v2 base branch for diff

Still `main`. For v2 slices, diff the slice branch against the most recent v1 main commit OR the v2 baseline commit (which will be tagged `v2-baseline` after the artifact updates land).
