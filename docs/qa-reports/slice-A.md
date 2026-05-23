# QA Adversary Report — slice A (v2 chatbot orchestrator)

**Date:** 2026-05-22  
**Diff range:** `10e12c1..e0331bd`  
**Branch:** `main`  
**Adversary verdict:** `qa-adversary: FAIL on 3 findings`

---

## What I challenged

Slice A ships an LLM-orchestrated chatbot entry surface (`src/components/ChatbotShell.tsx`) that wraps the existing slice-1 VendorCascade via Anthropic tool-use. The chatbot is the new primary surface in `src/App.tsx`; the slice-1 EntryForm stays accessible via a "prefer a form?" fallback link. POSTs to `/api/chat` stream Server-Sent Events back to the client. The handler implements a multi-turn tool-use loop: assistant emits `tool_use` → server dispatches via `server/chat/tools.ts` → server posts `tool_result` back → Anthropic resumes. Five tools are declared: `lookup_plate` and `lookup_vin` are wired against VendorCascade now; `ocr_recognize`, `schedule_pickup`, `get_support_content` return a `not_wired` sentinel. Language: TypeScript (strict). Test runner: Vitest (unit/integration) + Playwright (e2e). Base branch: `main`.

Static gates at time of adversary run: `npm run typecheck` PASS, `npm run lint` PASS, `npm run test` PASS (35 tests → 42 tests with adversary additions, all pass). Mutation testing: not configured. Property-based testing: configured for VendorCascade; not applied to the new chatbot dispatch loop.

---

## Category verdicts (CAT-1 through CAT-17)

**CAT-1: PASS** — Every `catch` block in the diff either rethrows with context, logs AND continues with an explicit comment naming why continuation is safe, or routes to a structured error result. No silent swallow. (`server/routes/chat.ts:101-114`, `server/chat/tools.ts:259-272`, `server/chat/tools.ts:335-346`)

**CAT-2: PASS** — Slice A does not modify EntryForm; the form is accessible only via the "prefer a form?" toggle in ChatbotShell. The chatbot's own error path (`setChatError`) is additive and does not reset any form state. The pre-existing Playwright tests for form preservation are not regressed.

**CAT-3: CONCERNING** — See Finding 3 below. The uncaught-error fallback in `server/routes/chat.ts:108` reads "Please retry." — minimal context, no explanation of what is being retried or why the system failed. The copy test (`tests/copy/blame-the-user.test.ts`) referenced in `QA_ADVERSARY.md` does not exist; this copy escapes all automated enforcement. The lookup handlers also use "please refresh and try again" in `server/routes/lookup.ts:105,215` (same issue, pre-existed slice A but newly surfaced via the tool-use path). Not a blocking regression for slice A but should be addressed before demo.

**CAT-4: PASS** — ConsentManager is explicitly dropped in v2 scope. No new consent toggles appear in the diff.

**CAT-5: PASS** — No account gate introduced. The chatbot greets and proceeds without authentication.

**CAT-6: PASS** — No new vendor adapter code in the diff touches owner-name or owner-address fields. The `lookup_plate` tool schema passes `plate` and `state` only, which flow into the existing VendorCascade adapter.

**CAT-7: PASS** — No test in the diff contacts `*.carvana.com`. The adversary tests use stub keys and hit `api.anthropic.com` (correct: Anthropic, not Carvana).

**CAT-8: PASS** — The diff contains `as Record<string, unknown>` casts with accompanying type-guard checks (tools.ts:230, chat.ts:77). No `as any` or `// @ts-ignore` without justification. `as MessageParam[]` at chat.ts:90 has an explicit comment naming why re-validation is delegated to the SDK.

**CAT-9: PASS** — Integration tests use real vendor sandboxes (CarsXE) gated by env flags. Anthropic is mocked ONLY for the streaming-header test, which explicitly documents why: "Mocked Anthropic is permitted ONLY for the streaming-timing test (where the assertion is about the stream shape, not LLM behavior)." Consistent with the v2 standing rules in `tasks.md`.

**CAT-10: PASS** — No new EventReporter calls appear in the slice A diff. The telemetry layer is unchanged.

**CAT-11: FAIL** — See Finding 1 below. The spec mandates `tests/adversary/CAT-11-pii-in-free-text.spec.ts`; no such test exists. The existing e2e test (`tests/e2e/v2-chatbot-plate-happy-path.spec.ts`) does NOT assert that the assistant's text body excludes the plate string "XRJ4041". The system prompt correctly instructs the model, but there is no regression-test enforcement of the instruction.

**CAT-12: N/A** — SupportContentWidget ships in slice D. No cards.ts or SupportContentWidget.tsx appears in the diff.

**CAT-13: CONCERNING** — See Finding 2 below. The implementation correctly sets `Content-Type: text/event-stream` and omits `Content-Length` (verified by adversary tests that now pass). However, the existing test file `tests/integration/chat-streaming.test.ts` claims to cover CAT-13 in its title and file docstring but contains ZERO assertions about streaming headers. The adversary tests at `tests/adversary/CAT-13-sliceA-chunked-header-missing.test.ts` fill this gap. A future refactor that drops `res.flushHeaders()` would pass all pre-existing tests while silently regretting CAT-13. Classified concerning (not blocking) because the code IS currently compliant; the weakness is in the test coverage.

**CAT-14: N/A** — Scheduler ships in slice C. No slot-allocation code in the diff.

**CAT-15: N/A** — NpsSurvey ships in slice E. No NPS data in the diff.

**CAT-16: N/A** — `docs/perf-report.md` and `npm run perf:smoke/perf:load` ship in slice F. Not in this diff.

**CAT-17: CONCERNING** — See Finding 3 below. The existing `tests/integration/tool-schema.test.ts` always passes `cascade: undefined` to `dispatchTool`, meaning the format_error guards in `runLookupPlate` and `runLookupVin` (tools.ts:222-239, tools.ts:300-317) have never been exercised by any test with a real cascade. Adversary tests at `tests/adversary/CAT-17-sliceA-malformed-tool-input-with-cascade.test.ts` cover this and pass — the guards ARE correct — but the gap means a regression in the guards would be invisible to CI.

---

## Findings

### Finding 1 — BLOCKING: CAT-11 test is missing (spec-mandated, no implementation)

**File:** `QA_ADVERSARY.md:131`, `tests/e2e/v2-chatbot-plate-happy-path.spec.ts`

**Repro:** The spec says `tests/adversary/CAT-11-pii-in-free-text.spec.ts` "walks the chatbot through a full happy path, captures every assistant message, asserts no message body contains the plate or VIN as a substring." That file does not exist. The e2e test `v2-chatbot-plate-happy-path.spec.ts` asserts "Vehicle identified" appears and `2021.*Toyota.*Highlander` appears, but does NOT assert that the text "XRJ4041" is absent from any assistant bubble.

**Invariant violated:** Constitution non-negotiable #9 and CAT-11 are stated as regression-tested. "This is a regression-tested rule. Violating it fails the build." (`server/chat/system-prompt.ts:14`). No test exists to enforce this.

**Why it matters:** The system prompt instructs the LLM to avoid PII in its text. Instructions to LLMs drift under model updates, prompt changes, or edge-case user inputs. Without an assertion, a model update that changes behavior goes undetected.

**Suggested fix shape:** Create `tests/adversary/CAT-11-pii-in-free-text.spec.ts` as a Playwright e2e test (skip-gated on live API keys) that sends "my plate is XRJ4041 in Texas," collects all `.assistant-bubble` text content, and asserts none contains "XRJ4041" or "4041" as a substring. The test should also assert none contains any VIN string from the tool result.

---

### Finding 2 — BLOCKING: Multi-turn chat breaks on second user message (historyRef bug)

**File:** `src/components/ChatbotShell.tsx:95,128-130`

**Repro:** Open the chatbot. Type "my plate is XRJ4041 in Texas," wait for the vehicle card. Then type any second message. The second request to `/api/chat` sends a `messages` array with two consecutive `{role: "user"}` entries and no `{role: "assistant"}` entry between them:

```json
[
  {"role": "user", "content": "my plate is XRJ4041 in Texas"},
  {"role": "user", "content": "second message"}
]
```

The Anthropic Messages API requires strictly alternating user/assistant turns. This request will cause a 400 or API-level error. The error propagates through `runChatLoop`'s outer catch, which emits an SSE error event. The user sees "Chat error: 400 Bad Request" (or the Anthropic error body) in the chat and cannot continue the conversation.

**Root cause:** `historyRef.current` is only ever updated with user turns (line 128-131). The assistant's streamed response (text deltas, tool_use, tool_result blocks) is captured in React `turns` state for rendering but is NEVER written back to `historyRef.current`. The ref is the only state that persists across `sendMessage` calls (since `turns` is React state, not a ref, and its current value isn't read in the next `sendMessage` due to stale closure capture). After `streamChatResponse` resolves, no code assembles the final assistant `MessageParam` from the received SSE events and pushes it to `historyRef.current`.

**Evidence:** `historyRef` has exactly three references in the file (lines 95, 128-130, 136). None of them push an assistant turn.

**Severity:** Blocking. The v2 demo requires multi-turn conversation (plate → condition Q&A → offer → scheduling). A conversation that fails on the second user message cannot demonstrate the happy path.

**Suggested fix shape:** After `streamChatResponse` resolves, assemble the accumulated assistant content from the SSE events and push it to `historyRef.current`. One approach: have `streamChatResponse` return the assembled `ChatMessage` (or `MessageParam`) for the completed assistant turn, and append it after the `await` at line 140. The content blocks must be in the Anthropic wire format (`[{type: "text", text: "..."}, {type: "tool_use", id: "...", name: "...", input: {...}}]`), not the UI's `UiTurn` model.

---

### Finding 3 — CONCERNING: CAT-13 test claims to cover streaming headers but asserts none

**File:** `tests/integration/chat-streaming.test.ts:9` (file docstring), test assertions at lines 101-108, 141-153

**Repro:** Read `tests/integration/chat-streaming.test.ts`. The file title and docstring say "CAT-13 — /api/chat MUST stream (Transfer-Encoding: chunked)" and "the headers, the 503 shape, and the input-validation paths." Searching all `expect()` calls in the file reveals: status code assertions (503, 400, 400), body field assertions (`kind`, `missing_env_var`, etc.), and nothing about `Content-Type`, `Transfer-Encoding`, or `Cache-Control`. The test is misnamed.

**Current state:** The implementation is currently correct — `res.setHeader("Content-Type", "text/event-stream")` is set at `server/routes/chat.ts:94` and verified by the new adversary tests. But if a future change removes `res.flushHeaders()`, sets a `Content-Length`, or changes the `Content-Type`, all existing tests would still pass.

**Adversary tests added:** `tests/adversary/CAT-13-sliceA-chunked-header-missing.test.ts` (2 tests) assert:
1. `Content-Type` must match `/text\/event-stream/`
2. `Content-Length` must be `null` (proving chunked transfer, not buffered response)

Both tests pass against the current implementation.

**Suggested fix shape:** Add the header assertions from the adversary test to the existing `tests/integration/chat-streaming.test.ts` in the "CAT-13 part 2" describe block, where the stub key ensures the handler is wired.

---

### Finding 4 — CONCERNING: CAT-17 tool-input format_error guards untested with a real cascade

**File:** `tests/integration/tool-schema.test.ts:70-81`, `server/chat/tools.ts:222-239,300-317`

**Repro:** In `tool-schema.test.ts`, the test "lookup_plate with malformed input returns format_error not a throw" passes `cascade: undefined`. The comment acknowledges: "configuration_missing wins when cascade is undefined; that's fine." This means the format_error guards at `tools.ts:222` (`typeof input !== "object"`) and `tools.ts:233` (`typeof plateInput !== "string"`) have NEVER been reached by any test.

**Current state:** The guards are correct. The adversary tests at `tests/adversary/CAT-17-sliceA-malformed-tool-input-with-cascade.test.ts` inject a fixture cascade and verify:
- Numeric `plate` (e.g., `{plate: 12345, state: "TX"}`) returns `format_error` without invoking the cascade
- `null` state returns `format_error`
- Numeric `vin` returns `format_error`
- Missing required `state` returns `format_error`

All 5 adversary tests pass. The implementation is correct; the existing test coverage is insufficient to detect a regression in these guards.

**Suggested fix shape:** Extend the existing `tool-schema.test.ts` "lookup_plate with malformed input" test to inject a fixture cascade (as done in the adversary test) so the format_error guards are actually exercised.

---

### Additional finding — NOT a category: system prompt leaks implementation details to the LLM

**File:** `server/chat/system-prompt.ts:44`

The Confirmation instruction says: "Ask 'is this the vehicle you want to sell?' If yes, say **slice C of the build** will continue with condition questions; for slice A, end the turn after the confirmation."

This teaches the model to say "slice C" to users — implementation-internal naming. In the demo, the user would hear "slice C of the build will continue with condition questions," which is confusing product copy. This is not a functional bug but it is a UX bug that will surface on the demo recording. No existing test asserts on the content of the assistant's narrative text.

**Suggested fix shape:** Rewrite the Confirmation instruction to use user-facing language: "After confirming, tell the user that condition questions and scheduling are coming next; for now, the plate-to-vehicle step is complete." Remove all "slice A/C/B" wording from the user-facing script.

---

## Tests added

**`tests/adversary/CAT-13-sliceA-chunked-header-missing.test.ts`** (2 tests, all pass)
- Proves `Content-Type: text/event-stream` is set on any response that clears the validation gates.
- Proves `Content-Length` is absent (confirming chunked, not buffered, transfer).
- Acts as a regression guard for future changes that might drop `res.flushHeaders()`.

**`tests/adversary/CAT-17-sliceA-malformed-tool-input-with-cascade.test.ts`** (5 tests, all pass)
- Numeric `plate` with a real cascade → `format_error`, cascade NOT called (0 plate calls).
- `null` state with a real cascade → `format_error`, cascade NOT called.
- Numeric `vin` with a real cascade → `format_error`, cascade NOT called.
- Missing `state` field with a real cascade → `format_error`, cascade NOT called.
- `TOOLS.length === 5` assertion (exact count protects against undeclared tool additions).

Total test count: 35 (pre-adversary) → 42 (post-adversary). All 42 pass.

---

## Mutation escapes

Mutation testing not configured. No `infection.json5`, `stryker.conf.json`, or `cosmic-ray.toml` found. Recommend adding `stryker` or `mutmut` to CI for the tool dispatch loop in particular (the `switch (toolName)` and the format_error type guards are high-value mutation targets).

---

## What I tried that did not break

- **CAT-1 silent failure:** Traced all `catch` blocks in `server/routes/chat.ts`, `server/chat/tools.ts`. Every catch either rethrows, emits a structured SSE error event, or logs with `console.error` and returns a `transient_error` result. No silent swallow found.
- **CAT-6 DPPA boundary:** Grepped all new code for `owner`, `registrant`, `driver`, `address` in vendor request shapes. None found. The `lookup_plate` tool passes `{plate, state}` only to VendorCascade.
- **`dispatchTool` default-throw propagation:** The throw on unknown tool names propagates to `runChatLoop`'s outer catch, which emits a SSE error event and calls `res.end()`. Not a crash; graceful degradation.
- **Empty messages array accepted by server:** `{messages: []}` passes `Array.isArray([])` but hits Anthropic's API validation which throws. The outer catch handles it cleanly with an SSE error event. Not a crash. However, an empty messages array should arguably be rejected early with a 400 (not a 200-with-error SSE). Noted as a nit.
- **`tool_use_id` matching:** Confirmed `dispatchTool` is called with `block.id` (the ID from Anthropic's response) and returns `toolUseId` unchanged. The `tool_result` block pushed to the messages array uses the same ID. The SSE event also uses the same ID. No ID mismatch in the happy path.
- **CAT-8 `as` casts:** `as Record<string, unknown>` at tools.ts:230 and chat.ts:77 are justified by preceding type guards. `as MessageParam[]` at chat.ts:90 has an inline comment explaining the delegation decision. No unjustified escape from strict mode found.
- **CAT-7 Carvana endpoint hits:** All HTTP calls in tests go to `api.anthropic.com` or `127.0.0.1`. No `*.carvana.com` contact.
- **CAT-9 vendor mocks in integration tests:** Anthropic mock used ONLY for header-timing test (with explicit documented justification). CarsXE adapter uses sandbox credentials. Consistent with the v2 standing rules.
- **`generate_offer` tool:** Not in `TOOLS` array (comment on line 5 of tools.ts mentions it but tasks.md confirms it is deferred to slice E). System prompt does not instruct the LLM to call `generate_offer`. No hallucination risk for slice A.
- **Client-disconnect resource leak:** Server continues streaming to Anthropic even if the client disconnects (no `req.on('close', ...)` abort). This is a cost concern at scale but not a functional regression for slice A's demo context.
- **`parseStateCode` lowercase input in tool dispatcher:** The `runLookupPlate` function passes `stateInput` directly to `parseStateCode`. If Anthropic sends `"texas"` instead of `"TX"`, `parseStateCode` will uppercase-trim it and accept it. The `Plate` constructor normalizes. Both handle the natural-language input the system prompt is likely to extract.

---

## Recommendations

1. **Fix Finding 2 (historyRef bug) before any demo.** Multi-turn conversation is the core UX story. The second message will always fail.
2. **Create `tests/adversary/CAT-11-pii-in-free-text.spec.ts`** per the spec. The system prompt has the right instructions; add the regression test that would catch a drift.
3. **Add streaming header assertions to `tests/integration/chat-streaming.test.ts`** so the file matches its stated purpose.
4. **Remove "slice A/C" wording from the system prompt** (user-facing copy should not expose internal build phasing).
5. **Add `stryker` or `mutmut` mutation testing** targeting `server/chat/tools.ts` and `server/routes/chat.ts` — the tool dispatch switch is a high-value mutation target.
6. **Consider rejecting `{messages: []}` with a 400** before setting streaming headers, so the client gets a proper error response rather than a 200 SSE stream whose first event is an error.

---

## Static gates

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test` (35 pre-adversary tests) | PASS |
| `npm run test` (42 post-adversary tests) | PASS |
| `npm run test:e2e` | SKIPPED (no ANTHROPIC_API_KEY in env, per instructions) |

---

`qa-adversary: FAIL on 3 findings`

Findings ranked by severity:
1. **Finding 2 (BLOCKING):** Multi-turn chat breaks on second user message — `historyRef` in `ChatbotShell.tsx` never records the assistant turn. The demo cannot progress beyond one exchange.
2. **Finding 1 (BLOCKING):** CAT-11 test mandated by spec does not exist. No regression enforcement for PII-in-free-text.
3. **Finding 3 (CONCERNING):** CAT-13 streaming test claims to cover streaming headers but asserts none. Filled by adversary test but the existing test is misleading.
4. **Finding 4 (CONCERNING):** CAT-17 format_error guards untested with a real cascade. Filled by adversary test but the existing test gap would hide a future regression.
