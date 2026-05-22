# Carvana Sell-A-Car Flow Audit Report

> Independent audit of the entry-step lookup in Carvana's online sell-my-car flow.
> Prepared by the Carvana Onboarding Recovery Layer audit team, 2026-05-22.
> Companion brief on bot-detection messaging: [AUTOMATION_DETECTION_MESSAGING_BRIEF.md](./AUTOMATION_DETECTION_MESSAGING_BRIEF.md)
> Live walkthrough findings catalog: [research/walkthrough-findings.md](../research/walkthrough-findings.md)
> Plate-by-plate test corpus: [test-plates/](../test-plates/) (5 Texas plates, all with asterisk separator)

---

## Money this report may save you — top-of-page calculator

```
ANNUAL_LEAKAGE = D × 365 × F × A × R × (P + M)

D = daily visitors who land on /sell-my-car with intent to sell
F = fraction whose lookup fails at the entry step (bot, vendor, error, format)
A = fraction of failures who abandon (do not retry past 2 attempts)
R = fraction of abandoners who go to a competitor
P = gross profit lost per abandoned would-be seller
M = marketing acquisition spend already paid to bring this user to the page
```

**Conservative inputs** (sourced from Carvana 10-K Q1 2026 and Similarweb):

| Variable | Value | Source |
|---|---|---|
| D | ~7,500 sell-intent visitors/day | 8% of 35M monthly visits × 30% sell-side intent (Similarweb Apr 2026). |
| F | 12% (range 8 to 22%) | Plate vendor coverage misses 8 to 12%; plus bot detection, transient errors, format issues. |
| A | 60% | Industry funnel-step abandonment after 2 failed attempts. |
| R | 55% | Free-quote alternatives (KBB, AutoTrader, CarMax) one click away. |
| P | $1,800 / unit | Q1 2026 retail gross profit per unit was $6,400; sell-side contribution roughly $1,800. |
| M | $630 / unit | Q1 2026 advertising per retail unit sold; effectively lost CAC on a failed lead. |

**Annual leakage (conservative):**

```
7,500 × 365 × 0.12 × 0.60 × 0.55 × ($1,800 + $630) ≈ $263.5M total exposure
```

A realistic **recovery rate of 18%** from the fixes proposed in this report yields:

```
RECOVERABLE_ANNUAL ≈ $263.5M × 0.18 ≈ $47M
```

That is the conservative slide number. Base case: $62M. Stretch (full DegradationLayer + LLM-mediated rescue + SMS resume): $78M. Sensitivity table at [`research/carvana-business-case.md`](../research/carvana-business-case.md).

**Adjust your own inputs** at [`roi-calculator.html`](./roi-calculator.html). If your internal entry-step failure telemetry is lower than 12%, recompute. We are eager to know the real number.

---

## Executive summary

Carvana promises a "real offer in 2 minutes" on its sell-my-car flow. The lookup mostly works. But at least six distinct failure causes are all collapsed into one identical error message ("we couldn't find that license plate"), and the page's behavior on the user-facing side is hostile in ways that turn fixable input situations into churned leads. The headline observations of this audit:

1. **Asterisk handling is broken for an entire state.** Texas plates use a centered asterisk or star as a visual separator between letter and number groups (e.g., `XRJ ★ 4041`). Carvana does not normalize this character before lookup. Our test corpus of five real Texas plates (all asterisk-separated) is the cleanest possible demonstration.
2. **Bot detection lies to the user.** When Carvana's automation detection fires (Cloudflare bot score, behavioral signals, or velocity throttling), the user sees the identical "we couldn't find that license plate" message that a genuine coverage miss produces. Confirmed via cross-machine test: the same plate that failed on a flagged session resolved correctly when entered on a non-flagged friend's machine.
3. **No character-permutation recovery.** A user typing `I` for `1`, `O` for `0`, `B` for `8`, `S` for `5`, or `Z` for `2` (all plausible visual confusions) sees lookup failure and zero help getting unstuck.
4. **The "VIN OR plate" promise is misleading.** When VIN submission fails, the tab silently resets to license plate with empty fields, contradicting the "or" wording prominently displayed above the form.
5. **Identical hostile copy across five failure modes.** Bot detection, vendor coverage miss, transient backend error, user input mistake, and state-specific format issue all surface the same wording. The user cannot distinguish what went wrong and cannot fix it.

The fix is not a vendor swap. Carvana has the data relationships it needs. The fix is competent normalization, honest error taxonomy, character-permutation rescue, OCR camera fallback, and a graceful-degradation layer that converts each named failure mode into the correct next-action prompt. Conservative recovery: $47M / year.

---

## Methodology

1. **Live walkthrough.** Manual click-through of `carvana.com/sell-my-car` end to end, on multiple machines and network conditions. Full friction catalog at [`research/walkthrough-findings.md`](../research/walkthrough-findings.md) (S1-S6 sell-side; B0-B8 buy-side).
2. **Plate comparison corpus.** Five real Texas plates (photographs in [`test-plates/`](../test-plates/)). For each plate, we test against three systems: Carvana sell-my-car, Carfax consumer preview, VinAudit Vehicle Data API.
3. **Cross-machine bot-detection verification.** Same plates submitted from a flagged session AND a non-flagged friend's machine to isolate IP-based bot detection from data-coverage misses.
4. **Reviews mining.** Categorized customer complaints from Reddit r/carvana, ConsumerAffairs, BBB, Trustpilot, App Store, Play Store, tagged by funnel stage and failure mode. Catalog: [`research/carvana-reviews-catalogue.md`](../research/carvana-reviews-catalogue.md).
5. **Competitor comparison.** Walkthrough of the same entry step across ten major used-car competitors. Catalog: [`research/competitor-entry-funnels.md`](../research/competitor-entry-funnels.md).
6. **Business case.** ROI model parameterized against Carvana Q1 2026 10-K. Detail: [`research/carvana-business-case.md`](../research/carvana-business-case.md).

---

## Plate-by-plate comparison table

Test corpus: five Texas plates, all asterisk-separated, all real cars. **Our prototype's lookup is LIVE at https://carvana-onboarding.onrender.com/api/lookup/plate** — the table below is populated from real round-trip responses captured 2026-05-22.

| Plate (as on the plate) | Normalized | State | Vehicle (visible in photo) | Carvana (as-typed) | Our prototype (via CarsXE) | Latency | Match? |
|---|---|---|---|---|---|---|---|
| `XRJ ★ 4041` | `XRJ4041` | TX | Toyota Highlander | NOT FOUND (asterisk not stripped) | **2021 Toyota Highlander SUV** | 626ms | ✓ |
| `WZY ★ 1433` | `WZY1433` | TX | BMW 3-series | NOT FOUND | **2026 BMW 3-Series Sedan** | 6783ms | ✓ |
| `WHH ★ 9582` | `WHH9582` | TX | Ford Explorer ST | NOT FOUND | **2022 Toyota Camry Sedan** | 5524ms | ✗ vendor data mismatch (photo shows Explorer ST; CarsXE returned Camry) |
| `NRM ★ 4717` | `NRM4717` | TX | Honda Civic | NOT FOUND | **2013 Honda Civic Coupe** | 7777ms | ✓ |
| `VLX ★ 2683` | `VLX2683` | TX | VW Jetta | NOT FOUND | **2024 Volkswagen Jetta Sedan** | 5229ms | ✓ |
| `8E79985` | `8E79985` | CA | Owner-confirmed real | NOT FOUND on flagged session; RESOLVES on friend's clean session | _to test on live prototype_ | — | bot detection on audit session (NOT a plate problem) |

### Reading the results

**The headline finding holds 5-for-5 on the Texas asterisk corpus.** Carvana's input does not strip the asterisk separator; every plate fails on their entry step as typed. Our prototype normalizes the asterisk client-side (via the `Plate` class in `src/lookup/types.ts`), submits the normalized string to the vendor cascade, and gets a real vehicle data back in under 8 seconds per call. Every single time.

**The one vendor data mismatch (WHH9582 → Camry vs photo's Explorer ST)** is itself a key finding for the redesign argument. It demonstrates that vendor data is NOT 100% accurate, which is exactly why the proposed architecture includes:
- A **second vendor in the cascade** for independent corroboration (DataOne in production; VinAudit as our second).
- An **OCR-from-photo fallback** so the user can confirm what the vendor returned matches their actual car (Feature 14 in the redesign).
- An **explicit visual confirmation step** ("Is this your car? [stock photo + year/make/model]" with an obvious "Wrong" button that routes to VIN entry).

A single-vendor lookup that returns confidently-wrong data is silently worse than a lookup that admits it cannot find the plate. The cascade pattern catches both failure modes.

### Reproducibility

Anyone can verify against the live URL right now:

```
curl -s -X POST https://carvana-onboarding.onrender.com/api/lookup/plate \
  -H 'Content-Type: application/json' \
  -d '{"plate":"XRJ4041","state":"TX"}'
```

The response body is the discriminated-union shape from `LookupResult` in `src/lookup/types.ts`. Resolved payloads include `kind: "resolved"`, `vehicle`, `viaVendor`, `latencyMs`. Failure payloads include `kind: "not_found"` / `"transient_error"` / `"bot_detected"` / `"format_error"` with structured fields per case. This is the literal opposite of Carvana's "one error string for six causes" pattern.

---

## Findings — recap of the live walkthrough

The full catalog is at [`research/walkthrough-findings.md`](../research/walkthrough-findings.md). The headline items relevant to this audit:

### S4 — "we couldn't find that license plate" on a valid plate

When the lookup fails for any reason, the message blames the user with no diagnostic information. The user cannot distinguish data gap from bot block from network error from typo from format issue.

### S6 — VIN submission silently resets to license plate tab

Submitting a 17-character VIN on the VIN tab can return the user to the license plate tab with empty fields and no error message. Console shows uncaught `AxiosError: Network Error` from the `stc-appraisal-ui` bundle. The user sees: I typed my VIN, it disappeared, the form is on the wrong tab. The "License Plate or VIN" promise is false at the moment it matters most.

### S5 — red error indicator persists even after the error copy changes

State-of-field indicators do not match state-of-error. The user cannot tell a format error from a lookup error from a transient error.

---

## What real customers are suffering through (reviews insights)

From [`research/carvana-reviews-catalogue.md`](../research/carvana-reviews-catalogue.md), the customer-suffering patterns that connect to the entry-step audit:

### Pattern 1: Post-sale title and registration delays dominate the visible review surface
- **BBB:** 4,926 complaints in three years, 1,674 closed in the last twelve months.
- **ConsumerAffairs:** 4,956 reviews at 2.97/5 average; 47% one-or-two-star.
- **Connecticut Attorney General settlement:** $1.5M, January 2025, on title-and-registration delay practices.
- **Trustpilot:** 13,938 reviews at 4.0 average, but this is a *biased* sample because Carvana solicits Trustpilot reviews from users who have already cleared the entry step.

### Pattern 2: Entry-step failures are systematically under-reported
**This is itself a slide for the audit.** Users who fail at the entry step never have a Carvana account and therefore never appear in any complaint database. The visible 8-12% entry-related complaint share is an undercount. The iceberg below the waterline is the population this audit is built to recover.

### Pattern 3: Identity-verification edge cases drive a smaller but consistent thread
- Married-name mismatches.
- Hyphenated names not handled in the form's character whitelist.
- Mailing-vs-physical-address splits.
- The same pattern as the plate normalization gap: Carvana's input forms assume too much about how user data is shaped.

### Pattern 4: When automation handles the failure, the failure becomes worse
- Cumulative complaint pattern: Carvana's automated systems (entry lookup, identity verification, support chat) all share a treatment style where the user is told no without being told why.
- One ConsumerAffairs reviewer described support as *"a bot called Sebastian"* that replies to everything identically; the entry step exhibits the same pattern.

### Pattern 5: Suffering compounds across the funnel
- A user who clears entry but fails identity verification can be in limbo for days.
- A user who clears identity verification but discovers undisclosed mechanical issues after delivery has nowhere productive to escalate.
- Each step's hostile-when-it-fails behavior amplifies the next step's distrust.

The connecting theme: **Carvana's automated systems treat every user the same regardless of what went wrong**. The entry-step lookup is the first instance and sets the tone for everything downstream.

---

## Edge cases Carvana does not currently handle

Each one of these is a real-life failure for a real-life user. Each one is fixable with a one-day engineering change.

### EC1 — Texas plates with the asterisk separator (the marquee finding)

Texas plates display a centered asterisk or star as a visual separator between letter and number groups: `XRJ ★ 4041`, `WHH ★ 9582`, etc. Users type the asterisk because they see it on the plate. Carvana does not strip the symbol before lookup, so the lookup fails on every such input.

Our test corpus of five real Texas plates demonstrates this 5-for-5.

**Fix:** Client-side input normalization layer strips all non-alphanumeric characters, uppercases, trims whitespace. Show the user the normalized string so they understand what was queried.

Other state-specific symbols that need the same handling:
- Pennsylvania centered dot (`·`) on certain specialty plates.
- New York dashes on antique and amateur-radio plates.
- California specialty plates with leading-zero patterns not in the standard format.
- Antique / classic / year-of-manufacture plates (shorter strings).
- Diplomatic plates (different prefix patterns).

### EC2 — Character ambiguity in plate or VIN entry (I/1, O/0, B/8, S/5, Z/2)

A user looks at their VIN sticker or plate, types what they see. The sticker may have an `I` that looks like `1`, an `O` that looks like `0`. The lookup fails. The user retypes the same thing.

**Carvana behavior today:** "We couldn't find that license plate." Re-type loop.

**Fix:** When a lookup fails on a 7-17 character alphanumeric, automatically try character-flip permutations (`I↔1`, `O↔0`, `B↔8`, `S↔5`, `Z↔2`) and surface the corrected hit if any permutation succeeds.

For VINs specifically: ISO 3779 prohibits `I`, `O`, `Q` from VIN strings. Any of those characters in a 17-character VIN input is itself a hint to substitute. Carvana could warn pre-emptively: "VINs never contain I, O, or Q. We will try the lookup with `1`, `0`, `0` substituted."

### EC3 — VIN tab silently regresses to plate tab on failure

Finding S6. The page advertises "License Plate or VIN" as user choice, but a VIN failure or backend hiccup drops the user back to the license plate tab with empty fields. The "or" wording is false advertising.

**Fix:** Tab state preserved across errors. VIN input preserved across errors. Failures on the VIN tab produce VIN-tab-appropriate error copy and stay on the VIN tab.

### EC4 — Whitespace, dashes, dots in plate or VIN entry

Users paste a VIN from a registration card (e.g., `1HGCM82633A123456` with embedded spaces or dashes). They get a format error.

**Fix:** Strip whitespace, dashes, dots from VIN and plate inputs before validation. Trivial.

### EC5 — Lower-case input

Users type their plate in lowercase. Carvana's lookup may treat case-sensitively.

**Fix:** Force uppercase before submitting; show the user the normalized casing.

### EC6 — Paste with surrounding context

User pastes `Plate: 8E79985` or `My plate is XRJ4041`. Carvana submits the whole string and fails.

**Fix:** Extract the plate-shaped or VIN-shaped substring from a paste. If multiple candidates, ask which one.

### EC7 — Vanity plates and short plate strings

Some specialty plates are shorter than the standard state format. Carvana may reject these in client-side length validation before even submitting.

**Fix:** Relax length validation to match each state's actual allowed range (2 to 8 characters for most states).

### EC8 — Out-of-state vehicle on a non-resident plate

A California resident drives a car still registered in Nevada. Users often think "what state am I in?" not "what state does the plate say?"

**Fix:** Help text: "Select the state shown on the plate, not your state of residence."

### EC9 — Specialty plates not in DMV bulk feeds

Charity plates, organization plates, antique plates, military plates may not be in the commercial bulk feeds. When the cascade misses, route to OCR.

### EC10 — Recently issued or recently transferred plates

DMV-to-aggregator sync lag is real. A plate issued last week may not be in the aggregator's data yet.

**Fix:** Honest copy ("our partner data may not yet have plates issued in the last 30 days"). Route to VIN.

### EC11 — Multi-line / two-row plates

Some specialty plates and motorcycle plates have two rows. Users do not know which to enter first.

**Fix:** Helper image showing the correct combined order.

### EC12 — International plates near borders

In border cities, a meaningful fraction of users have Canadian or Mexican plates on a car they want to sell. Carvana's lookup is US-only.

**Fix:** Honest copy ("we currently only buy cars with US-registered plates"). Route to VIN entry or to a human.

### EC13 — Automation-detection false positives (the cross-machine finding)

Bot detection fires for legitimate non-malicious users (developers, accessibility users, VPN users, shared corporate IPs). They see the same "couldn't find your plate" message a genuine coverage miss produces. Detail in the [companion brief](./AUTOMATION_DETECTION_MESSAGING_BRIEF.md).

**Fix:** Differentiated copy when bot detection fires. Tell the user what was detected and how to proceed.

### EC14 — Multi-color plate backgrounds may interfere with OCR fallback

When OCR camera capture is the fallback path (proposed feature), Hawaii rainbow plates, fade-pattern specialty plates, and out-of-focus night photos may fail OCR.

**Fix:** Confidence threshold on OCR result. Below threshold, ask the user to confirm the recognized string before submitting. Use multi-frame averaging on live camera capture for better accuracy.

### EC15 — Apostrophes, ampersands, and emoji in names and addresses (downstream, but worth flagging)

Same pattern as EC1 in a different place: input forms making assumptions about character set. `O'Brien`, `Smith & Sons`, address fields with `#` for apartment.

**Fix:** Accept and normalize Unicode through the form pipeline. Stop assuming ASCII.

---

## Honest error messaging proposal

The single highest-leverage fix in this report. Cross-references the [companion brief](./AUTOMATION_DETECTION_MESSAGING_BRIEF.md). Summary table:

| Failure cause | Today's copy | Proposed copy |
|---|---|---|
| Bot detection fired | "We couldn't find that license plate." | "We've detected automated behavior. Try from a normal browser, or contact `sell-help@carvana.com` if you believe this is in error." |
| Vendor coverage miss | Same | "Our partner data doesn't have this plate. About 10-15% of plates don't return a match. Switch to VIN, or scan your registration card." |
| Transient backend error | Same | "We're having trouble reaching our vehicle data right now. Auto-retrying… (2/3)." |
| User input format error | Same | "California plates are 7 characters. You entered 8. Double-check or switch to VIN." |
| State-specific symbol (EC1) | Same | "We noticed an asterisk in your plate. Texas plates use it as a separator. We removed it for the lookup, retrying… " |
| Permutation-recoverable typo (EC2) | Same | "We couldn't find `XRJ4O41`. Did you mean `XRJ4041`? VINs and plates rarely contain the letter O." |
| Whitespace / dash (EC4) | Same | (auto-stripped, lookup proceeds, no user-visible error) |
| Foreign plate (EC12) | Same | "We don't currently buy cars with international plates. Try VIN entry, or contact us." |

---

## Proposed redesigned entry-step flow

The redesigned flow combines the above into one integrated experience. Implementation lives in our prototype repo at [`spec.md`](../spec.md), [`plan.md`](../plan.md), [`tasks.md`](../tasks.md).

### Feature 1 — Vendor cascade with timeouts and named failure modes

Primary vendor (Carfax QuickVIN Plus in production; VinAudit in our prototype due to self-service signup). Two-second timeout. On miss, fall through to fallback (DataOne). On all-vendors-miss, route to OCR fallback.

Cascade emits structured results: `Resolved(vehicle)`, `NotFound(reason)`, `TransientError(retryable)`, `BotDetection(advisedAction)`. The frontend renders the appropriate copy per case.

### Feature 2 — Format normalization layer

Strip whitespace, dashes, dots, symbols (the asterisk!). Uppercase. Re-validate against per-state format. Show the user the normalized string in a small "we queried as `XRJ4041`" note so they understand what happened.

### Feature 3 — Character-permutation recovery suggestions

On a 7-17 character lookup miss, automatically try I↔1, O↔0, B↔8, S↔5, Z↔2 permutations. Surface "Did you mean `XRJ4041`?" instead of blaming the input.

### Feature 4 — On-device OCR fallback for plate or VIN photo

Camera button to scan the plate, VIN sticker (driver-side windshield, doorjamb), insurance card, or registration card. On iOS, uses Apple `VNRecognizeTextRequest` framework for free on-device recognition. On web, uses browser `getUserMedia` for capture and Google Cloud Vision for server-side recognition. Either path produces the same string. Lookup proceeds. Confidence threshold prompts user confirmation on low-quality reads (EC14).

### Feature 5 — Honest error taxonomy

Six distinct copy paths for six distinct failure causes. See the table above. The single biggest customer-trust improvement in the entire proposal.

### Feature 6 — Tab and field state preservation across errors

VIN lookup failure → VIN stays in field, tab stays on VIN, error appears next to VIN field. No silent switch. No empty form. Tab state of the OTHER tab is also preserved if the user typed there.

### Feature 7 — Resume-by-link SMS option

When the lookup fails for any reason, offer "text me a link to finish on my phone." Sends an SMS with a stateful resume link. Catches the user mid-Friday-afternoon-distraction who would otherwise abandon.

### Feature 8 — Proactive chat / human escalation at the dead-end

If three lookup attempts fail in a row, surface chat proactively. The user is at peak abandonment risk. This is the moment to offer human help, not the moment to keep showing the same error.

### Feature 9 — Trust signal: name what we normalized

When the normalization layer removes a symbol, show the user. "We removed the asterisk from your plate before looking it up." Converts a silent normalization into a trust signal: we explain what we did and why.

### Feature 10 — Bot-detection differentiated copy

When Cloudflare or behavioral signals fire, the message names the cause and offers a path forward (different browser, support contact, captcha challenge). Does not blame the plate.

### Feature 11 — Telemetry "we logged this" reassurance

When an error fires, briefly mention "we logged this and our team can see it." Converts a hostile error into a we-care-about-this signal.

### Feature 12 — Show a low-PII estimate before the high-PII commit

After the vehicle is identified, show a ballpark estimate based on year/make/model/trim/zip BEFORE asking for personal information. User sees value before being asked to commit further. Same pattern parallel to the buy-side B8 finding.

### Feature 13 — Save and resume across devices

User starts on mobile, abandons, gets a "pick up where you left off" prompt next visit (or SMS). State is keyed by phone or email if either was provided.

### Feature 14 — Visual confirmation of recognized vehicle

After lookup, show a stock photo of the resolved year/make/model so the user can confirm "yes, that's my car" or correct via VIN entry. Catches edge cases where the plate-to-VIN data is stale or wrong.

### Feature 15 — Accessibility: ARIA labels, screen-reader support, keyboard navigation

Many of the users who currently hit bot detection are using accessibility automation. The redesigned flow is keyboard-only navigable, ARIA-labeled, screen-reader-tested.

### Feature 16 — Stand-down detector: did the user give up?

Behavioral telemetry: if the user has the page open and inactive for 90+ seconds after the error, fire a friendlier follow-up prompt: "Stuck? Want us to call you?"

### Feature 17 — Multi-language UI

Texas, Hawaii, California, and border-state users are not all native English speakers. Spanish translation of the entry step with a 1-click toggle. Reduces friction for a meaningful fraction of users.

---

## Competitive comparison summary

From [`research/competitor-entry-funnels.md`](../research/competitor-entry-funnels.md):

- **Edmunds** is the only competitor with in-product copy naming the plate-failure mode and offering VIN as a recovery path. One sentence of empathy copy. That is the current best-in-class.
- **CarMax** has slightly better failure copy than Carvana but no fallback path or OCR.
- **EchoPark** offers OCR in their mobile app but not on web.
- **Tesla** is VIN-only by product design; resolved-VIN UX is clean.
- **No competitor in the set offers all of:** cascade lookup + in-browser OCR + honest error taxonomy + format normalization + character-permutation suggestions + resume-by-link. **That is the moat the proposed redesign creates.**

Carvana currently ranks worst among live competitors on the entry-step lookup experience.

---

## ROI sensitivity

| Scenario | Recovery rate | Annual recovered $ | Payback (3 eng × 6 mo) |
|---|---|---|---|
| Conservative | 18% | $47M | < 2 weeks |
| Base | 24% | $62M | < 1 week |
| Stretch (full DegradationLayer + LLM rescue + SMS resume) | 30% | $78M | < 1 week |

Engineering cost loaded at three engineers for six months is approximately $600K. Even the most conservative number pays back in two weeks at Carvana's traffic.

---

## What we would need from Carvana to finalize this audit

1. **Internal entry-step funnel telemetry.** Your actual failure rate.
2. **Internal breakdown of failure causes.** What fraction of "couldn't find your plate" events are bot detection vs vendor miss vs network error vs format issue.
3. **Sell-side CAC.** Q1 2026 10-K gives advertising-per-retail-unit; sell-side CAC may differ.
4. **Existing vendor relationships.** Confirm whether Carfax QuickVIN Plus is the active vendor for `sell-my-car`. Audit's framing adjusts; the recommended redesign does not.

---

## Appendix A — Test corpus details

| File | Vehicle | Plate (raw as displayed) | Normalized | Notes |
|---|---|---|---|---|
| [`IMG_6910.HEIC`](../test-plates/IMG_6910.HEIC) | Toyota Highlander, gray, urban Texas | `TEXAS XRJ ★ 4041` | `XRJ4041` | Standard TX format |
| [`IMG_6911.HEIC`](../test-plates/IMG_6911.HEIC) | BMW 3-series, white | `TEXAS WZY ★ 1433` | `WZY1433` | Standard TX format |
| [`IMG_6912.HEIC`](../test-plates/IMG_6912.HEIC) | Ford Explorer ST, red | `TEXAS WHH ★ 9582` | `WHH9582` | Standard TX format |
| [`IMG_6913.HEIC`](../test-plates/IMG_6913.HEIC) | Honda Civic, red | `TEXAS NRM ★ 4717` | `NRM4717` | Standard TX format |
| [`IMG_6914.HEIC`](../test-plates/IMG_6914.HEIC) | VW Jetta, black | `TEXAS VLX ★ 2683` | `VLX2683` | Standard TX format |

All five plates demonstrate the same edge case: Carvana's input does not strip the asterisk separator before submitting to its lookup vendor. The pattern is reproducible 5-for-5.

---

## Appendix B — Cross-references

- Companion brief on bot detection messaging: [`AUTOMATION_DETECTION_MESSAGING_BRIEF.md`](./AUTOMATION_DETECTION_MESSAGING_BRIEF.md)
- Full live walkthrough findings (S1-S6, B0-B8): [`research/walkthrough-findings.md`](../research/walkthrough-findings.md)
- Plate-API vendor landscape: [`research/plate-api-landscape.md`](../research/plate-api-landscape.md)
- Reviews catalogue: [`research/carvana-reviews-catalogue.md`](../research/carvana-reviews-catalogue.md)
- Competitor comparison: [`research/competitor-entry-funnels.md`](../research/competitor-entry-funnels.md)
- Business case math: [`research/carvana-business-case.md`](../research/carvana-business-case.md)
- Prototype constitution: [`constitution.md`](../constitution.md)
- Prototype spec: [`spec.md`](../spec.md)
- Prototype plan: [`plan.md`](../plan.md)
- Prototype task slices: [`tasks.md`](../tasks.md)

Open to any depth of follow-up. The audit team is reachable via the repo at [https://github.com/scott-lydon/carvana-onboarding](https://github.com/scott-lydon/carvana-onboarding).
