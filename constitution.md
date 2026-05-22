# Constitution — Carvana Onboarding Recovery Layer

> The rules. Tech stack. Style. Non-negotiables. Things we never do.
> Established 2026-05-22. Living document — re-open when stack or rules change.

## Project identity

Dual-purpose deliverable: primary audience is the Gauntlet AI-product rubric, secondary audience is a real Carvana product manager who could ship this. The pitch frame is that we fix Carvana's broken sell-side plate / VIN lookup wall and buy-side account-creation gate with a graceful-degradation layer, browser-side OCR, and TCPA-compliant consent UI. Quantified business case ~$46M / year recovered acquisition spend (see `research/carvana-business-case.md`).

## Tech stack (locked)

- **Frontend:** React 18 + Vite + TypeScript (strict mode)
- **Backend:** Express on Node 22, TypeScript
- **OCR (web):** browser `getUserMedia` for capture, Google Cloud Vision for server-side recognition
- **OCR (iOS recorded demo):** SwiftUI + Apple `VNRecognizeTextRequest` on-device, free, no PII leaves the device
- **Plate API primary:** Carfax QuickVIN Plus (the vendor Carvana likely already pays for under their dealer contract; the fix is competent integration, not a vendor swap)
- **Plate API fallback:** DataOne Software (enterprise contract recommended at Carvana scale)
- **Testing:** Vitest for unit + integration, Playwright for end-to-end, property-based tests via `fast-check` for the vendor cascade
- **Linting:** ESLint with `@typescript-eslint/strict-type-checked`, Prettier
- **Hosting:** Render web service (matches existing Gauntlet pattern from boxy-fractions; auto-deploy disabled, manual deploy button per existing memory)
- **Repo dual-push:** GitHub (`scott-lydon/carvana-onboarding`) + GitLab (`labs.gauntletai.com/scottlydon/carvana-onboarding`), single `origin` with two push URLs per the Gauntlet pattern in `~/Documents/Claude/Projects/Gauntlet/CLAUDE.md`

## Style rules

The repo follows the equivalent of the Google Swift Style Guide adapted to TypeScript, plus the cupid.dev principles (composable, Unix-philosophy, predictable, idiomatic, domain-based). Specifics:

- Functions do one thing well; if a function has an "and" in its summary, split it.
- Prefer type augmentation when it makes sense (extending standard classes / utility types) over creating wrapper services that hide a one-line operation.
- Comment any function that could create a "what is this doing" moment; preferably refactor the code so no comment is needed.
- No catch-log-continue. Errors either rethrow with context or are surfaced to the user via the DegradationLayer.
- Strict TypeScript: no `any` outside of vendor SDK boundaries; narrow with `unknown` plus type guards. No `as` casts outside of test fixtures and explicitly-justified vendor escape hatches.
- Domain types over primitives. `Vin`, `Plate`, `StateCode`, `Email`, `Money`, `EmploymentStatus` — never bare strings or bare numbers for these.

## Non-negotiables (rooted in the bug pattern we are FIXING)

1. **Never blame the user for a system failure.** Error copy must distinguish format errors ("this looks like 8 characters, plates are 7") from coverage gaps ("our partner data doesn't have this plate, try VIN") from transient backend errors ("we're having trouble reaching our vehicle data right now, try again in a moment"). This is the literal opposite of Carvana's S4 finding.

2. **Never silently reset a form on error.** User input is preserved on every error path. Tab state is preserved. Field-level state is preserved. This is the literal opposite of Carvana's S6 finding.

3. **Never gate value behind account creation when soft-pull-equivalent information has already been collected.** Show the prequalification range first; offer to save it via account creation second. This is the literal opposite of Carvana's B8 finding.

4. **Marketing opt-ins default OFF and are separate from primary form submission.** Pre-checked SMS opt-ins are a TCPA risk and an emotional-friction trust-killer. This is the literal opposite of Carvana's B5 finding.

5. **OCR runs on-device when possible.** Apple Vision on iOS is free, instant, and the user's image never leaves their phone. On web we use `getUserMedia` for capture and only ship the cropped plate / VIN crop to the server, never the full photo.

6. **DPPA boundary: plate → VIN → vehicle specs ONLY.** Never request plate → owner name, plate → owner address, or any DMV-PII path. Bartholomew v. Parking Concepts CA 1st DCA Feb 2026 raised the stakes ($2,500 per violation statutory minimum). All vendor requests stay on the vehicle side; this is a request-shape decision, not a vendor decision.

7. **No stub data in user-facing aggregates.** Numbers in dashboards / metrics / "we saved X leads this week" displays must be the real measurement. Zero is fine if zero is what was measured. Never `0.001` as a placeholder.

8. **Every failure mode is named and instrumented.** When the VendorCascade falls back, when OCR has low confidence, when the user retries, when consent is declined — each event is logged with a stable event name so the telemetry slide in the pitch deck has real numbers, not assertions.

## Quality gates (run before every commit to main)

- `npm run typecheck` (TypeScript strict)
- `npm run lint` (ESLint, must pass with zero warnings)
- `npm run test` (Vitest unit + integration)
- `npm run test:property` (fast-check property tests for vendor cascade)
- `npm run test:e2e` (Playwright happy path + each failure mode)
- Code coverage floor: 80% line, 75% branch, exceptions justified inline with `// coverage: ignore` comments that name a reason
- `qa-adversary` sub-agent in a fresh context, briefed against this constitution + `spec.md` + `plan.md` + `tasks.md` + `QA_ADVERSARY.md`

## Things we NEVER do (even if the user asks)

- Use `console.error` and continue without a user-facing recovery path.
- Set `value` directly on an input element without firing a synthetic React change event (the literal cause of S6 in our model: `form_input` set the DOM value but React saw empty, lookup failed, framework reset).
- Embed `getMessage()` from a caught exception in user-facing copy (security: may leak SQL, file paths, internal codes).
- Mock the vendor APIs in integration tests; we hit real sandbox endpoints, gated by an environment flag. Mocked vendor integration is exactly the failure mode that bit Carvana.
- Submit anything to a real Carvana endpoint from automated tests.

## Rubric anchor

- **Architecture pillar:** drop-in API gateway pattern (see `plan.md`) means we sit between Carvana's existing frontend and their broken vendor integration without forcing them to rewrite their stack.
- **Scalability pillar:** vendor cascade with timeouts / circuit breakers; OCR moves to client where possible; the architecture handles Carvana's 35M monthly visits / 3M monthly plate attempts (see `research/carvana-business-case.md`).
- **Security pillar:** DPPA boundary enforced at the type level, on-device OCR preferred, no raw PII in logs, TCPA-compliant consent.
- **Testing pillar:** property-based tests for the cascade (every vendor permutation), Playwright covering each named failure mode from S1-S6 and B0-B8, qa-adversary sub-agent on every change.
