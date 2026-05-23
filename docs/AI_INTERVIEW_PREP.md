# AI interview prep — Carvana onboarding recovery layer (v2)

> Open the interview here: [AI video interview portal](https://portal.gauntletai.com/video-interview).
> Fallback: [mirror](https://gauntlet-portal.web.app/video-interview).
> The portal asks 4 questions in ~5 minutes. We don't know which 4 will come up, so this file pre-bakes 12+ answers. The top section covers questions that ALWAYS get asked; rubric-pillar answers cover the four big categories; backup bench covers everything else.

---

## 60-second elevator pitch

Two-day rebuild of Carvana's sell-side onboarding as a conversational chatbot that wraps real vendor APIs, captures VINs via the camera using Claude vision, books pickup atomically against SQLite with no double-booking, and surfaces pre-baked support content at known anxiety moments. Live at carvana-onboarding.onrender.com. Seven slices A through G, 67 tests passing, p95 latency 137 milliseconds, dual-pushed to GitHub and GitLab. The trade-off I'd defend hardest: pre-baked empathy text instead of LLM-generated reassurance. Hallucinated trust-building is a legal risk; auditable static copy isn't.

---

## Always-asked questions (prepare these every submission)

### "Walk me through the data flow of this feature/functionality."

The user opens the chat surface. They type their plate and state in natural language. The React shell posts the message history to /api/chat. The chat handler streams an Anthropic Messages call back via SSE. Anthropic emits a tool_use block for lookup_plate. The handler dispatches to the existing VendorCascade, which calls CarsXE. CarsXE returns the resolved vehicle. The handler posts a tool_result block back to Anthropic and continues the stream. Anthropic emits a short confirmation reply. The React shell renders the vehicle as a card next to the assistant bubble. The assistant's text never echoes the plate value, only the year, make, and model. After confirmation, the user taps Schedule pickup. The Scheduler component fetches available slots from /api/schedule/slots and POSTs the chosen one to /api/schedule/book, which wraps a BEGIN IMMEDIATE transaction around an INSERT with UNIQUE on slot_start and scope. A booking confirmation appears as a user message in the chat. The NpsSurvey widget renders. The user scores zero to ten, and the elapsed time is recorded.

### "What would you do differently next time or if you had more time?"

Three things. First, I'd ship the buy-side prequal flow that's deliberately out of v2 scope. Two days only fit sell-side; with three or four I'd restore the buy-side and unify both surfaces under the same chatbot. Second, I'd swap SQLite for Postgres so the demo persists across redeploys. The UNIQUE constraint pattern is identical so it's a 30-minute change. Third, I'd add a real telemetry pipeline so the metrics overlay numbers feed something durable like Datadog instead of a dev-only on-page panel. Right now the NPS sample size in production is whatever respondents submitted since the last redeploy.

### "What did you find challenging?"

Two real challenges. The first was the historyRef bug in the chatbot's multi-turn handling. I shipped slice A with the user message pushed to history but not the assistant turn or the tool_result turn. The qa-adversary sub-agent caught it as a blocker. I fixed it by adding a history_sync SSE event that ships the full Anthropic-shaped messages array back to the client at the end of every turn. The second was Render's auto-deploy being off without me knowing. I pushed five commits before realizing the deployed instance was stale. I caught it via a curl probe and triggered a manual deploy. The takeaway was checking the deployed commit hash against local on every submit-gate run.

---

## Four rubric-pillar anchors

### Architecture pillar

The chatbot orchestrator pattern means the LLM is the user surface and the existing services are the tools. Adding a capability means adding a tool, not re-architecting. The slice-1 VendorCascade did not need to change. The vendor adapters did not need to change. The DegradationPanel did not need to change. The chatbot just calls into them via tool-use and renders the structured tool_result inline. See server/chat/tools.ts for the dispatch table, plan.md for the topology, and src/components/ChatbotShell.tsx for the orchestration on the client side. This is the architecture I'd defend hardest because it's the one I'd ship at Carvana scale.

### Scalability pillar

The atomic scheduler uses BEGIN IMMEDIATE plus a UNIQUE constraint on slot_start and scope. The regression test at tests/integration/scheduler-concurrency.test.ts fires 10 parallel bookings of the same slot and asserts exactly one wins. The streamed chat responses keep first-token latency under 1.5 seconds at the perceived-latency level. The k6 perf test at scripts/perf/load.k6.js runs against the deployed Render instance and reports p95 per endpoint. Latest run is 137 milliseconds for the NPS write, 154 for the health probe, 157 for the slot query, with zero failures across 196 requests. All three an order of magnitude under the PRD's 3-second threshold.

### Security pillar

Constitutional non-negotiable 9 says the LLM's free-text response must never contain the user's plate, VIN, address, or other identifying value. PII flows into the chatbot only as tool-use arguments. The vehicle data is rendered as a structured card next to the assistant bubble, not embedded in prose. A regression test at tests/adversary/CAT-11-pii-in-free-text.spec.ts drives a real Anthropic call and asserts the assistant's prose does not contain the plate value. The DPPA boundary is enforced at the request shape: every vendor call asks plate to VIN to specs, never plate to owner. The Bartholomew v. Parking Concepts case from February 2026 raised the statutory minimum to twenty-five hundred per violation.

### Testing pillar

Sixty-seven tests across unit, property, integration, e2e, and adversary categories. Property tests cover every permutation of the vendor cascade. Integration tests cover the chat streaming headers, the OCR validation paths, the scheduler concurrency, the NPS Bain-formula correctness. Playwright e2e covers the v2 chatbot happy path end-to-end against real Anthropic plus real CarsXE. The qa-adversary sub-agent runs in a fresh Claude Code context on every slice, briefed against the constitution and QA_ADVERSARY.md, with no access to my reasoning so it cannot rationalize the regressions away. On slice A it caught two blockers I fixed in the same turn.

---

## Anticipated follow-ups

**"You said the chatbot doesn't echo PII. Show me where."** Open server/chat/system-prompt.ts. The first hard rule forbids it. Then open tests/adversary/CAT-11-pii-in-free-text.spec.ts. It drives a real chat call and asserts the assistant text doesn't contain the literal plate. Both the prompt-level instruction and the regression test are in the repo.

**"What if Anthropic adds a model that ignores your hard rule?"** The regression test catches it on the next CI run. If we shipped without the test catching it, we'd add a deterministic post-filter to redact the plate value from any text_delta event before forwarding to the client.

**"How do you know p95 is really under 3 seconds?"** The k6 report at docs/perf-report.md shows the target URL, the commit hash, the per-endpoint p95, and the failure rate. The script's threshold fails the run if any endpoint exceeds 3000 milliseconds. It targets the deployed Render instance, not the dev server. Reporting against the dev server is CAT-16.

**"How do you handle the slot-race condition?"** BEGIN IMMEDIATE acquires a RESERVED SQLite lock before any read in the transaction. The UNIQUE constraint enforces uniqueness at the storage layer regardless of how the application logic is wired. tests/integration/scheduler-concurrency.test.ts fires 10 parallel bookings and asserts exactly one succeeds.

---

## Backup bench (6 to 10 likely)

**Cost.** Per-flow Anthropic cost is about 1.6 cents for chat plus 0.4 cents for vision. Render free tier carries no per-flow cost. CarsXE sandbox is free. At 1000 flows per day, that's $16 per day. At a million, $16k per day, which is where you'd start renegotiating with Carfax for production CarsXE replacement.

**Team workflow.** Every code change runs typecheck, lint, vitest, and the qa-adversary sub-agent in a fresh Claude Code context. Each slice gets its own commit with the conventional-commits subject line. Dual-push verifies GitHub and GitLab hashes match after every push.

**AI-assisted decisions.** Two big ones. The chatbot tool-use pattern over the existing VendorCascade — I picked it because it lets the LLM be the user surface without re-architecting the services. Pre-baked support content over LLM-generated empathy — I picked it because hallucinated trust-building copy is a legal risk that auditable static text eliminates.

**Deployment.** Render free tier auto-deploys from the main branch when auto-deploy is on; the deploy hook URL lets me trigger deploys via curl without browser interaction. Manual deploys via dashboard work as a fallback. Render spins down free-tier instances after 15 minutes of idle; the k6 setup() function pre-warms with a health probe to dodge that cost during measurement.

**Observability.** Dev-only metrics overlay at ?metrics=1 shows current chat flow elapsed time plus NPS summary with sample-size labeling. Slice F's k6 perf-report.md feeds the architecture website's stat cards.

**Prior-week comparison.** v1 was a graceful-degradation thesis: chatbot was not in scope, scheduling was explicitly out of scope. v2 PRD prescribed both. v2 keeps slice 1's CarsXE plate decoder unchanged and wraps it in the chatbot tool-use loop. Nothing from v1 was thrown away.

**Dependency choices.** Anthropic SDK for the LLM. better-sqlite3 for synchronous SQLite (faster install than native bindings would suggest, and the test mocking story is clean). k6 for load. No agent framework, no SSE library, no calendar library. Each kept-out dependency is documented in plan.md.

**Error handling.** Constitutional rule says catch blocks either rethrow, surface to the user via the DegradationLayer, or log AND continue with an explicit comment naming why. CAT-1 regression catches anything that catches and silently continues.

**Accessibility.** ARIA labels on the chat input, the score buttons, the camera viewfinder, the slot grid. aria-live on the chat transcript so screen readers announce new turns. Not WCAG-audited; flagging this as a v3 task.

**Demo-vs-production gap.** Three known: ephemeral SQLite, no real SMS confirmation, mock pre-qual estimator (out of v2 scope). Each is documented as a "what this report does not measure" section in the relevant slice doc.

---

## Escalation block (if the first rebuttal does not land)

**Re-ask: "Why not just use [other LLM]?"** Anthropic's tool-use is mature, the streaming API is first-class, and we get vision in the same vendor relationship for free. OpenAI's function-calling is comparable on the chat side but ships separately from vision. Cutting a vendor relationship saves us a billing relationship, an API key to rotate, and a different SDK for the same call shape.

**Re-ask: "Why not just use Postgres?"** SQLite ships zero-dep, BEGIN IMMEDIATE plus UNIQUE constraint is the simplest correct atomic-booking pattern, the demo's concurrency budget is well under SQLite's WAL-mode capacity (50k writes per second on commodity hardware), and Postgres adds 30 minutes of provisioning for no correctness change.

**Re-ask: "Why not use Cal.com?"** Two days, full UX control over the inline-in-chat rendering, no third-party tenant config. Cal.com is the right answer for a production rollout where the booking is calendar-aware on the user's side; for this prototype, in-house ships faster and the atomic-booking story is OUR story to tell, not Cal.com's.

---

## Moment-of-truth block (defending LLM-made decisions)

The chatbot decided to call lookup_plate the first time without explicit user confirmation of the parsed plate and state. This was MY decision in the system prompt: low-friction first, verification on result. Commit `e0331bd` is the original system prompt; commit `b34a5b0` is the cleanup that removed slice-number leakage. If a reviewer challenges either: the audit log is in git, with the message bodies explaining the trade-off.

The Render env-var addition for ANTHROPIC_API_KEY was made through the dashboard via Chrome MCP. The action wrote the key to the production env, was committed nowhere, and was followed by a fresh deploy. Commit `66d42e5` is the env-file fix that made local development pick up .env.local correctly; this is the bug the env-var addition exposed but didn't cause.

---

## Things to NOT say

- "The AI decided." (I decide; the LLM proposes within constraints I set.)
- "I didn't really test." (I have 67 tests, including a 10-parallel concurrency test and a real-Anthropic PII-in-free-text test.)
- "It works on my machine." (Live at carvana-onboarding.onrender.com. Verified end-to-end on the deployed instance.)
- "Just trust me." (Everything I claim has a file path or a commit hash next to it.)
- "Move fast and break things." (The qa-adversary sub-agent and submit-gate run on every slice for a reason.)
