# Spec — Carvana Onboarding Recovery Layer

> What we are building and why. User stories. Acceptance criteria. Demo script.
> Last edited 2026-05-22.

## Problem statement

A Carvana customer wants to either (a) sell their car or (b) get pre-qualified for financing. Both onboarding flows promise speed ("2 minutes," "no credit hit") and both fail in ways that blame the user, silently erase user input, or escalate commitment without delivering value. The failure modes are well-documented (see `research/walkthrough-findings.md`) and they cost Carvana an estimated $46M / year in recovered acquisition spend (see `research/carvana-business-case.md`).

We are building a working web prototype of a **graceful-degradation, OCR-augmented, account-deferred recovery layer** that catches both the structural failures (plate-not-found, account-gate-too-early) and the transient failures (backend error, silent form reset) at exactly the moments Carvana currently abandons or pressures the user. The pitch frame: this is the boring AI, the layer that makes existing services work for the users who currently fall through.

## User stories

### Sell-side

**US1 — Plate-first happy path.** As a seller with a valid CA license plate, I want my plate to resolve to vehicle data on the first try so that I see an estimated offer in under 90 seconds.

Given the seller enters a valid plate and state. When the lookup succeeds via the primary vendor (Carfax). Then the seller sees year / make / model / trim and an estimated offer range within 2 seconds, with no account requirement.

**US2 — Plate-not-found graceful fallback.** As a seller whose plate cannot be found in the primary vendor, I want an honest explanation and a quick fallback path so that I do not feel stupid and do not abandon.

Given the seller enters a valid-format plate that the primary vendor returns null for. When the cascade has tried Carfax and DataOne and both miss. Then the UI shows a sentence acknowledging the data-coverage gap ("our partner data does not have this plate; this happens to about X% of plates"), offers VIN entry as the next tab (preserving plate input in case it's a typo to fix), and offers a "snap a photo of your registration card" OCR path as a third option.

**US3 — Transient-error preservation.** As a seller who hits a transient backend error, I want to know it was a system error (not my mistake) and have my form input preserved.

Given the seller's submit triggers a backend timeout or network error. When the error is detected. Then the UI surfaces "we are having trouble reaching our vehicle data right now" with a retry button, preserves every field the user has typed, does NOT switch tabs or reset state, and offers a "text me a link to finish later" SMS-resume path.

**US4 — Photo-capture VIN path.** As a seller who can't find their VIN sticker easily and dislikes typing 17 alphanumeric characters, I want to point my phone at the VIN sticker / insurance card / registration and have the VIN auto-extracted.

Given the seller is on the VIN entry screen. When they tap "scan VIN with camera." Then the browser requests camera permission, opens a viewfinder with an OCR rectangle hint, recognizes a VIN at 95%+ confidence, auto-fills the field, and triggers the lookup.

### Buy-side

**US5 — Prequal terms shown before account creation.** As a buyer seeking financing prequalification, I want to see my approximate APR range and estimated monthly payment BEFORE creating an account.

Given the buyer has entered personal info + contact info + financial info. When the soft-pull prequal returns. Then the buyer sees their APR range, estimated monthly payment, and qualifying vehicle price range immediately, with an optional "save these terms / create account" CTA below.

**US6 — Non-W2 income options.** As a buyer with self-employment / freelance / retirement / student income, I want employment options that match my actual situation so that I do not have to mis-classify.

Given the buyer is on the Financial Information step. When they open the employment dropdown. Then they see options that include: employed full/part time, self-employed, 1099 / freelance / contractor, business owner, retired (including non-Social-Security), student with co-signer income, active duty military, fixed income, unemployed / furloughed, other (with text follow-up).

**US7 — TCPA-compliant consent.** As a buyer concerned about my personal data, I want explicit, separate, opt-in consent for SMS marketing that is NOT pre-checked.

Given the buyer is on the Contact Information step. When they reach the SMS marketing question. Then the toggle defaults OFF, the consent language is in a clearly-bordered card (not fine print), and clicking Next without toggling on does not opt them into any marketing communication.

## Acceptance criteria (concrete, qa-adversary-replayable)

For each user story above, the qa-adversary sub-agent should be able to run a Playwright scenario that verifies the acceptance criteria. The criteria are written above in Given/When/Then form for exactly this reason.

Additional cross-cutting criteria:

- No error path may silently reset form state. Property test enforces this for every named failure mode.
- No error copy may use blame-the-user phrasing ("check your entry," "please try again" without explaining what is being tried again, "invalid plate" when the plate format is fine).
- No primary CTA may be disabled silently after success; if submit fails, the CTA returns to enabled state and the failure is shown above it.
- No vendor call may exceed 5 seconds without triggering the cascade fallback.

## Out of scope (for this week)

- Actually integrating with Carvana's production code. We are building a standalone prototype that demonstrates the recovery layer; integration is a separate engagement.
- Hard credit pull. We stay on the soft-pull side of the financing flow; in fact we stop before the SSN step in any demo.
- Buyer-side identity verification beyond what the soft pull requires.
- Sale completion / delivery scheduling / post-sale.
- Insurance integration.
- Trade-in (sell + buy combined). Sell and buy are walked separately for clarity.
- Native iOS app. We build a 30-second SwiftUI demo of the on-device Apple Vision OCR for the privacy slide, but the primary deliverable is the web prototype.

## Rubric-pillar mapping

| Rubric pillar | User stories it satisfies | Where the evidence lives |
|---|---|---|
| Architecture | US1, US2, US3 (vendor cascade with timeouts and fallbacks) | `plan.md` decisions table, `src/lookup/VendorCascade.ts` |
| Scalability | US1, US2 (on-device OCR keeps server cost flat at scale) | `plan.md` cost analysis, `research/carvana-business-case.md` |
| Security | US7 (TCPA-compliant consent), constitution.md DPPA boundary | `constitution.md` non-negotiables, `src/consent/ConsentManager.ts` |
| Testing | All US (property tests on cascade, Playwright on each named failure mode) | `tests/`, `QA_ADVERSARY.md` |

## Demo script (60-second happy path)

The pitch deck's "show our version working" middle slide is recorded against this script. Spoken in present tense to the camera.

1. (0:00–0:10) "Here is Carvana's sell-my-car page today. I am entering my real California license plate." (Plate entry in Carvana, lookup fails, error copy visible.)
2. (0:10–0:20) "That plate is real. The vendor coverage isn't. The user gets blamed." (Cut to error message close-up.)
3. (0:20–0:40) "Here is our version of the same page." (Plate entry in our prototype, primary vendor misses, cascade falls through to fallback, vehicle data resolves, estimated offer appears with no account requirement.)
4. (0:40–0:55) "On the same screen, the camera button captures the VIN from the registration card with one shot." (OCR demo, VIN auto-fills, lookup runs.)
5. (0:55–1:00) "Same data path. Honest error copy. No silent resets. No blame-the-user." (Closing shot of side-by-side metrics.)

## Bibliographic anchors

- Live walkthrough findings: `research/walkthrough-findings.md` (S1-S6 sell-side, B0-B8 buy-side)
- Plate API landscape and recommended stack: `research/plate-api-landscape.md`
- Carvana reviews and complaints categorized by funnel stage: `research/carvana-reviews-catalogue.md`
- Competitor entry-funnel comparison: `research/competitor-entry-funnels.md`
- Business case: `research/carvana-business-case.md`
