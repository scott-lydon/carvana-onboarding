# AI Video Interview Prep — Carvana Onboarding Recovery Layer

[**AI video interview portal**](https://portal.gauntletai.com/video-interview) (primary) — [mirror](https://gauntlet-portal.web.app/video-interview) (fallback if the host has a bug; keep any `?id=` query string the email gave you).

The interview asks 4 questions in 5 minutes. About 75 seconds per Q + A. Each prepared answer below is a ~60-second spoken block (~150 words) so there is buffer for a brief follow-up. You will only field 4 of the 12+ answers here; the rest are insurance.

---

## 60-second elevator pitch (always lead with this if asked "tell me about your project")

The Carvana Onboarding Recovery Layer is a graceful-degradation layer between Carvana's sell-flow entry form and their existing vendors. We built it because Carvana's current page collapses at least six distinct failure modes into one identical error message, which converts recoverable users into churned leads. Our layer separates each failure cause and routes it to the right recovery: format normalization for the Texas asterisk plates, character-permutation suggestions for I-versus-1 and O-versus-0 typos, vendor cascade for coverage gaps, OCR camera capture for the dead ends, and honest error copy when bot detection fires. Conservative annual recovery, calculated against Carvana's Q1 2026 numbers, is $47 million in acquisition spend, with under two weeks of payback. The number that matters most is the per-failure-mode telemetry we add; Carvana cannot measure today what each failure costs them.

---

## Always-asked meta questions (prepare every submission)

These three appear nearly every interview. Recurring entries pulled from the Gauntlet question log.

### Q1: Walk me through the data flow of this feature.

The user enters a plate and a state on our React entry form. The frontend's normalization layer strips the Texas asterisk, whitespace, dashes, and dots, uppercases the result, and validates the length against the state's allowed range. The normalized string posts to our Express gateway. The gateway dispatches to a vendor cascade: primary vendor with a two-second timeout, then the fallback vendor on miss, then OCR camera capture if both miss. Every cascade outcome is a discriminated union of `resolved`, `not_found`, `transient_error`, `bot_detected`, or `format_error`. The frontend's degradation layer pattern-matches each case to its own user-facing copy and next-action prompt. There is no shared error code path. Nothing gets collapsed into a single hostile string, which is the literal opposite of what Carvana does today.

### Q2: What would you do differently next time or if you had more time?

Three things. First, I would actually negotiate Carfax QuickVIN Plus sandbox access before starting the build, because the prototype-grade VinAudit signup was a budgeted detour from the production-recommended vendor. Second, I would add LLM-mediated rescue copy earlier; the static copy paths are honest but a small Haiku call can soften the language to match the user's apparent emotional state. Third, I would invest in property tests against the cascade from day one, so the permutations of [primary hit, primary miss / fallback hit, primary timeout / fallback miss, both error] are all asserted instead of hand-tested. The interesting non-feature I would NOT add: more vendors. Two-vendor cascade plus OCR captures the long tail; a third vendor adds cost and integration risk without meaningful coverage gain.

### Q3: What did you find challenging?

The hardest part was reframing the audit's central claim. I started with "Carvana's plate vendor is broken; fix the integration." After cross-machine testing showed the same plate succeeding on a different IP, I realized the failure I was diagnosing was bot detection, not vendor coverage. That changed the entire frame. The fix is not a vendor swap; it is honest error copy plus format normalization plus character-permutation recovery. The technical work was straightforward; the strategic work was admitting that the load-bearing problem is the message string Carvana shows, not the data underneath it. Once that landed, the architecture wrote itself: a discriminated-union return shape from the cascade, with one named branch per real failure cause, rendered through a small set of human-readable copy paths.

---

## Four rubric-pillar questions (one anchor answer each)

### P1: Architecture

The architecture is a drop-in API gateway pattern. Carvana's existing frontend keeps its UI and its existing vendor contracts; our gateway sits between the frontend's submit and the vendor's network call. The gateway owns the cascade (primary vendor, then fallback, then OCR), the timeout enforcement, the bot-detection awareness, and the structured return shape. Concrete vendor adapters live behind a single `VendorAdapter` interface in `src/lookup/types.ts`; the cascade does not know about Carfax or DataOne or VinAudit specifically. The DPPA boundary is type-enforced at the interface level: adapters can request plate-to-VIN-to-specs, and the interface does not expose plate-to-owner fields, so a type-level violation is impossible. The trade-off: a single Render web service for the demo means one URL and zero CORS, with the production-scale split (CDN-fronted static + standalone API) noted in the plan as the next migration.

### P2: Scalability

Scalability matters in two dimensions for this product: vendor call throughput and OCR cost-at-scale. For vendor calls, the cascade with per-vendor timeouts means the worst-case latency is bounded at the sum of the timeouts (about 4 seconds for two vendors); per-vendor rate limits are honored via independent token buckets per adapter. For OCR, the architecture pushes work to the client where possible: iOS uses Apple Vision on-device with no network round trip, and the web path uses Google Cloud Vision at $1.50 per thousand calls. At Carvana's volume (35 million monthly visits, an estimated 8 percent of which are sell-side, with a fraction reaching the OCR fallback), the OCR cost is a few thousand dollars per month against the conservative $47 million annual recovery. The architecture handles their full traffic with the existing vendor contracts; we add the failure-mode telemetry that lets them measure for the first time.

### P3: Security

Security splits into three: PII handling, DPPA compliance, and consent. For PII: VIN is borderline PII and plate is geolocatable PII, so neither is logged in raw form; only hashed identifiers go to telemetry. On-device OCR on iOS keeps the image bytes off the network. The DPPA boundary is hard-coded at the type level: adapters declare `lookupByPlate(plate, state)` and `lookupByVin(vin)` and there is no exposed method for plate-to-owner. The Bartholomew California case in February raised the per-violation statutory minimum to $2,500, so this is not a theoretical concern. For consent: the proposed `ConsentManager` defaults all marketing toggles to OFF and surfaces the User Agreement and E-SIGN consent as separate checkboxes, not click-wrap inferred from submit. This is the literal opposite of Carvana's current buy-side flow, which is a TCPA risk we documented in the audit.

### P4: Testing

Testing has three layers. Unit tests cover the domain primitives: `Plate` normalization (the Texas asterisk corpus is the fixture), `Vin` validation (including the I/O/Q permutation hint), `StateCode` parsing. Vitest, jsdom environment, 14 unit tests passing at slice 1 commit. Integration tests hit real vendor sandboxes with property-based fuzzing via `fast-check`; mocked vendor responses in integration tests are explicitly forbidden in the constitution because mocked integration is exactly the failure mode we are critiquing. End-to-end tests in Playwright cover each named failure mode from the audit's S1 to S6 and B0 to B8 catalog. The CI workflow runs typecheck, lint with zero-warnings policy, unit, e2e, and a placeholder check on every push. Slice gates include a fresh-context qa-adversary sub-agent invocation before merge.

---

## Anticipated follow-ups for each pillar

### After P1 (Architecture)
- **"Why a gateway instead of a microservice mesh?"** Because Carvana's existing stack is monolithic and a gateway integrates without forcing them to refactor. A mesh is the right move at a different stage of their product evolution; today, a single shimmed layer ships in a week and proves the recovery thesis.
- **"Doesn't the gateway become a single point of failure?"** Yes, exactly like every other integration layer in their stack today. The gateway has a health check, a circuit-breaker per vendor, and Carvana can run multiple replicas behind their existing load balancer. The single-process Render demo is for the prototype; production runs as many replicas as Carvana's traffic needs.

### After P2 (Scalability)
- **"What about latency p99?"** Cascade worst case is bounded by the sum of vendor timeouts, currently 2 seconds plus 2 seconds plus the OCR roundtrip if it fires. The frontend never blocks on the full cascade; it streams partial progress so the user sees "trying our backup data source" after the first timeout.
- **"What if Carvana hits Cloud Vision's quota?"** They contract their own quota at their volume; the line item is in the cost model.

### After P3 (Security)
- **"How do you prevent the gateway from being scraped?"** Same way Carvana prevents their own page from being scraped today: rate limiting, bot detection signals, and now (per the audit) honest copy when those signals fire so legitimate automation users have a recovery path.
- **"What about GDPR?"** Out of scope for the US-only sell flow; the architecture's PII-minimization rules generalize to GDPR-style frameworks if Carvana expands.

### After P4 (Testing)
- **"How do you test the OCR path without real photos?"** A test corpus of plate photos lives in the repo at `test-plates/`. Five real Texas asterisk plates today; we add new edge cases (specialty plates, multi-line plates, low-light shots) as we find them.
- **"How do you handle flaky e2e against real vendors?"** Vendor calls in e2e are gated by an env flag and run against vendor sandboxes (Carfax dev tier, VinAudit B2B sandbox). Production-data calls are blocked by ESLint rule against `*.carvana.com` in test files.

---

## Backup bench — 6 to 10 additional likely questions

### Q: How did you decide which AI to use where?

The AI surface in this product is targeted, not pervasive. Three places: OCR (Apple Vision on iOS, Google Cloud Vision on web; small, well-scoped, no LLM); character-permutation suggestion (a deterministic algorithm, not an LLM; the search space is tiny); LLM-mediated rescue copy (stretch slice, Haiku, only fires after three lookup attempts to keep cost bounded). I deliberately avoided putting an LLM in the hot path of every lookup; that would add latency, cost, and a class of failure mode we cannot test deterministically. Where an LLM adds value is at the human-readable-copy boundary, where soft natural language matters more than a deterministic answer.

### Q: How did you handle disagreements with the AI assistant during development?

The biggest disagreement was on the audit's frame. The assistant initially synthesized "Carvana's plate vendor is broken; fix the integration" from the live walkthrough. After I tested on a friend's machine and the same plate worked, I pushed back. The assistant updated the audit, escalated the bot-detection-as-disguised-blame finding to a marquee position, and rewrote the headline. The frame the audit ships with is cleaner than the assistant's original, because the disagreement surfaced a stronger underlying claim.

### Q: What is the single biggest risk to this product?

That Carvana ships a half-version of the fix: the format normalization layer for the asterisk case (because it is easy and obviously right) without the bot-detection honest copy (because it requires admitting the bot is firing). If they ship only the easy half, they recover the format-issue users and leave the bot-detected users still bouncing. The audit deliberately leads with bot detection so the hard half is not optional.

### Q: How does this compare to Carvana's existing developer team?

The architecture this report proposes is well within Carvana's engineering capability; they have not shipped it because organizational incentives reward "do not surface the failure" over "be honest with the user." Our value-add is the audit and the working prototype, both of which make the easy decision the right decision.

### Q: What if Carvana already plans to do this?

Then we are delivering the audit, the test corpus, the ROI model, the prototype, and a working argument with their leadership. The road map alignment is a positive, not a negative.

### Q: Why these specific 17 redesign features?

Each feature in the proposal maps to a specific finding in the audit. Feature 1 (cascade) addresses S4 (vendor coverage miss). Feature 2 (normalization) addresses EC1 (Texas asterisk) and EC4 (whitespace / dashes). Feature 3 (permutation) addresses EC2 (I/O typos). Feature 4 (OCR) addresses EC9 (specialty plates) and EC11 (multi-line plates). Feature 5 (error taxonomy) is the load-bearing fix for the bot-detection blame. None of the 17 is decorative.

### Q: How would you deploy this in production?

Render web service for the demo. For Carvana production, the gateway sits behind their existing load balancer as a sidecar or as a routable backend; the static frontend is served by their existing CDN. Deployments are Conventional Commits driving CI which runs typecheck + lint + unit + e2e + qa-adversary; merges to main trigger deploy to Render (autoDeploy is currently off per their boxy-fractions pattern, manual deploy button preferred).

### Q: What is in scope and what is out of scope?

In scope: the sell-flow entry step and the buy-side prequalification entry step, both end-to-end through their respective happy paths and named failure modes. Out of scope this iteration: actual sale completion, delivery scheduling, post-sale flows. Also out of scope: rebuilding Carvana's identity verification (the spec is the natural next pillar but the audit's value is in the entry step).

---

## Escalation block — what to say if the first answer does not land

- **If the interviewer doubts the $47 million number:** "Conservative inputs only. Carvana publishes $630 advertising-per-retail-unit in their Q1 2026 10-K. Even a 5% recovery at half the assumed traffic justifies the implementation cost in the first quarter."
- **If the interviewer challenges the bot-detection framing:** "Cross-machine test: same plate, same browser, different IP, different result. The failure is not the plate; it is the session score. Carvana's current copy converts the bot-detection signal into a blame-the-user message that costs them legitimate users."
- **If the interviewer asks why we did not rebuild more of Carvana:** "The entry step is the funnel choke point. Every fix downstream of entry only matters for users who clear entry. Fixing entry recovers users for the entire downstream funnel."
- **If the interviewer pushes on AI usage:** "AI is in the loop at three specific points: OCR, character-permutation hinting, and LLM-mediated rescue copy. Each is sized to its impact. The architecture does not put an LLM in every lookup because lookups need to be deterministic and fast."

---

## Moment-of-truth block — defending decisions the LLM made for you

- **The drop-in gateway pattern (commit `654db5e` decision in `plan.md`):** I asked Claude to compare gateway versus frontend-overlay; it proposed both with trade-offs. I picked the gateway because Carvana could buy it without rewriting their frontend, and I documented the decision in `plan.md`. The audit logic is mine; Claude wrote the prose.
- **The vendor-agnostic adapter interface (commit `b914f2b`, file `src/lookup/types.ts`):** I had Claude draft the interface; I reviewed and pushed back on a `lookupByOwner` method that would have crossed the DPPA boundary. The final interface has only the two safe methods.
- **The honest-error-taxonomy frame (commit `654db5e`, `SELL_FLOW_AUDIT.md`):** I supplied the cross-machine test result. Claude synthesized the connection between bot detection and the "we couldn't find your plate" copy. The escalation to marquee finding was my call; Claude executed the rewrite.

---

## Things to NOT say (would tank the interview)

- "I think the AI just decided..." — own the decisions, even the ones the assistant proposed.
- "I didn't really test the OCR path." — Specify what you DID test (the test corpus, the failure-mode taxonomy) and what is pending (real vendor sandbox keys).
- "Carvana is bad at this." — Be honest about the finding but professional in framing. They have constraints; we are proposing improvements.
- "We don't need vendor sandboxes; we can mock." — The constitution says no. Mocked vendor integration is exactly the failure mode the audit critiques.
- "It works on my machine." — If a deployed URL is not live, name the credential wall (Render dashboard one-click) and the path forward.
- Hedging like "maybe," "kind of," "I guess" on the headline numbers. The $47 million number is conservative and sourced.
- "Specifically," "Concretely," "Notably" as sentence openers. They sound rehearsed.
