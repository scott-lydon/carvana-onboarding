# 5-minute defense breakout script — Carvana onboarding recovery layer (v2)

> Spoken in present tense to three cohort members. Target pace: 4:30 so
> there's a 30-second buffer for the cross-examination handoff.

---

[0:00] We rebuilt the Carvana sell-side onboarding as a chatbot orchestrator that wraps real vendor APIs, recovers gracefully when those vendors fail, and books the pickup atomically without a calendar collision. Two days, seven slices, live at carvana-onboarding.onrender.com.

[0:20] The shape of the system is one React surface, one Express server, two third parties. The Anthropic Messages API does the orchestration through tool-use. The CarsXE platedecoder does the vehicle lookup. Anthropic also handles the vision OCR, so we ship with one vendor relationship instead of two.

[0:50] When you type a plate, the chatbot calls the lookup_plate tool. Our server dispatches to the vendor cascade. CarsXE returns the vehicle. The server emits a tool_result event over SSE. The React chat surface renders the vehicle as a card next to the assistant bubble. The assistant's text reply never echoes the plate or VIN. That's constitutional rule 9; a regression test asserts it.

[1:20] If the vendor lookup misses, the chatbot has three fallback paths. Switch to VIN entry. Snap a photo of the VIN sticker, which routes to Claude vision. Or, if both vendors are out, get an honest error message that distinguishes vendor coverage from system failure. The slice-1 design carries forward into the v2 chatbot UX without modification because the dispatcher just calls into the existing route handlers.

[1:55] Booking the pickup is where the rubric defense lives. The Scheduler picks slots from a deterministic 14-day grid. The booking call wraps a BEGIN IMMEDIATE transaction around an INSERT with a UNIQUE constraint on slot_start and scope. If ten requests race for the same slot, exactly one wins. We assert that with an integration test that fires 10 parallel bookings and counts the kinds. That's CAT-14, constitutional non-negotiable 12.

[2:35] The empathy moments are pre-baked. Five cards covering offer-drop anxiety, data privacy, walk-away policy, inspection expectations, and payment timing. When the user expresses concern, the chatbot calls get_support_content with the matching topic. The dispatcher returns the literal card body, byte-for-byte. The LLM is allowed to pick which card. The LLM is not allowed to write the words. Hallucinated reassurance is a legal risk we eliminate at the architecture level, not at the prompt level. A regression test asserts byte-for-byte match between the dispatched response and the committed card file.

[3:15] The metrics. The PRD asks for four. Completion under 15 minutes: we measure with a Playwright stopwatch from the first user message to the booking confirmation. Sub-3-second p95 under load: we run k6 against the deployed instance. Latest run shows 137 milliseconds at the NPS write endpoint, 154 at the health probe, 157 at the slot query. All three are an order of magnitude under the threshold. Zero failures across 196 requests. NPS 70: we built the survey widget, collect real demo respondents, and label every summary with the sample size per constitutional rule 13. We don't claim NPS 70 from a sample of 3.

[3:55] What we deliberately didn't do. The buy-side prequal flow is out of scope for v2 because scheduling has no natural primitive there. The v1 spec covers it; restoring it is a slice plan, not a rewrite. The on-device iOS Vision OCR demo from v1 got dropped because Claude vision over a single Anthropic key tells a cleaner privacy story for v2. Production-grade persistence is a Postgres swap; SQLite is fine for the demo's concurrency budget.

[4:25] The repository is dual-pushed to GitHub for code review and Render auto-deploy, and to GitLab for Gauntlet grading. Every push lands on both remotes via the single-origin two-push-URL pattern. Hash parity is verified on every commit.

[4:40] That's the system. Cross-examination welcome.

---

## Anticipated peer questions (NOT spoken — notes for the cross-examination)

**"Why didn't you stream the OCR result?"** OCR is request-response, not progressive. The model emits the VIN in one block. Streaming would add complexity without perceived-latency benefit.

**"Atomic booking with SQLite — what happens at 1000 RPS?"** SQLite's WAL mode handles ~50k writes/sec on commodity hardware. Our demo concurrency is well under that. Production swaps to Postgres without changing the booking shape because the UNIQUE constraint pattern is the same.

**"Why pre-bake support content instead of fine-tuning?"** Fine-tuning is the wrong tool for compliance-sensitive copy. Auditable static text beats a model that "usually" says the right thing.

**"How do you handle the Anthropic outage case?"** The chat surface degrades to a "service warming up" message and the EntryForm fallback link stays clickable. The vendor cascade behind /api/lookup is unaffected and still works through the form.

**"Why not Postgres from day 1?"** Two days. SQLite gets us to a demonstrable atomic booking story today. Postgres adds 30 minutes of provisioning + a connection-pool config for the same correctness story.

## Critique cheat sheet (for poking holes in peer architectures)

- "Where does this system blame the user when a vendor fails?"
- "Show me the test that asserts no two parallel bookings can take the same slot."
- "Where does your prompt prevent the LLM from echoing the user's PII back?"
- "How do you measure p95 latency — against the dev server or the deployed one?"
- "Where does the empathy text live? Who reviewed it? What stops it from drifting?"

## Vote-criteria mental model

Strongest defense usually answers all three:
1. What specifically is broken without me. (Quantify the user pain.)
2. What I shipped that's testable today. (Show the regression test, the metric, the URL.)
3. What I deliberately punted and why. (Calibration beats claims of "everything works.")
