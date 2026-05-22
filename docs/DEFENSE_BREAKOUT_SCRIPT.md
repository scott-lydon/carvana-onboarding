# Defense Breakout Script — Carvana Onboarding Recovery Layer

> 5-minute spoken script. Target pace ~4:30 with a 30-second buffer.
> Audience: 3 cohort members in the architecture breakout room.
> Style: substance only, content-describing headers, no meta about the format.

---

## What the system is (0:00 to 0:45)

The Carvana Onboarding Recovery Layer is a graceful-degradation layer that sits between Carvana's sell-flow entry form and their existing lookup vendors. It catches the failure modes that today produce a single hostile error message and routes each one to the correct next-action prompt.

The headline finding from our audit: when a user enters a license plate or VIN on `carvana.com/sell-my-car`, at least six distinct backend conditions can fire, and all six get the same string: "we couldn't find that license plate." Bot detection. Vendor coverage miss. Transient backend error. A format edge case like the Texas asterisk separator. A character ambiguity like `I` for `1` or `O` for `0`. A user typo. The user has no way to know which one hit them, and Carvana has no way to recover the user who is one click away from leaving for KBB or AutoTrader.

We rebuilt that one screen. Same data sources. Same architecture pattern Carvana would ship if they had three engineers for six months.

## How the data flows (0:45 to 1:45)

The user types a plate and a state. The frontend normalizes the input through a strip-and-uppercase layer that removes the Texas asterisk, whitespace, dashes, and dots before validation. The normalized string flies to our gateway as a POST.

The gateway dispatches to a vendor cascade. Primary vendor first, with a two-second timeout. On miss or timeout, the cascade falls through to a secondary vendor with independent coverage. On all-vendors-miss, the cascade returns a structured `not_found` result with the list of vendors attempted.

Every cascade outcome is a discriminated union: `resolved`, `not_found`, `transient_error`, `bot_detected`, `format_error`. The frontend's degradation layer pattern-matches each one to its own user-facing copy and next-action prompt. There is no single shared error path. There is no string interpolation of `error.message` into the user view.

If the cascade exhausts, the user sees an OCR camera button to scan the VIN sticker, the registration card, or the insurance card. On iOS we use Apple's Vision framework on-device; on the web we use `getUserMedia` for capture and Google Cloud Vision for recognition. The recognized string flows back through the same cascade.

## The Target Adapter boundary (1:45 to 2:30)

The vendor cascade does not know about Carfax, DataOne, or VinAudit. It knows about a `VendorAdapter` interface with two methods, a structured return shape, and named throw conditions. Each concrete adapter wraps one vendor's API in that interface.

This is the load-bearing decision. It is the difference between "you have to ship our gateway as part of your stack" and "you wire your existing vendor calls through our gateway." Carvana keeps its contracts, its rate limits, its observability. Our layer adds the cascade decisioning, the timeout enforcement, the failure-mode discrimination, and the recovery routing.

The DPPA boundary lives at the adapter interface level. Adapters request plate-to-VIN-to-vehicle-specs only. They never request plate-to-owner. The constitution treats that as a non-negotiable; a type-level escape from the boundary is impossible because the interface does not expose the owner fields.

## Trade-offs (2:30 to 3:30)

We pick a single-process Render web service over a multi-service deploy because the prototype demo benefits from one URL and zero CORS. The cost is that a backend bug can take down the static-serve path; in production Carvana would split this into a CDN-fronted static site plus an API service.

We pick VinAudit as the prototype primary vendor over Carfax QuickVIN Plus because VinAudit offers self-service signup and Carfax does not. In a real Carvana deployment, the primary would be Carfax (their existing relationship) and VinAudit would be the fallback. The adapter interface makes the swap a one-file change.

We pick on-device OCR on iOS over a server round-trip because the privacy story is strong and the Apple Vision framework is free. The cost is platform-specific code; the web fallback uses Cloud Vision for the same recognition with a real per-call cost of about a tenth of a cent.

We pick the drop-in gateway pattern over a frontend overlay because Carvana's product team can integrate our layer without rewriting their React app. The cost is that the demo is less visually compelling on its own; we build a thin wrapper UI on top of the gateway for the demo, with a note that this UI is replaceable.

We pick honest error copy over fault-obscuring copy because the audit's central economic claim is that the hostile copy itself is the funnel killer. The cost is admitting in writing on Carvana's own site that the failure cause was not the user's plate. Bot detection in particular costs us a sliver of obscurity against actually-malicious actors, and saves us a meaningful fraction of legitimate users.

## What this is worth (3:30 to 4:15)

The audit's ROI model uses Carvana's published Q1 2026 numbers. $630 in advertising per retail unit sold. $6,400 in retail gross profit per unit. 596,641 retail units in 2025. 35 million monthly visits per Similarweb.

With conservative inputs (12% entry-step failure, 60% abandonment after failure, 55% go-to-competitor), and an 18% recovery rate from the proposed fixes, the conservative annual leakage recovered is $47 million. Base case $62 million. Stretch $78 million.

Implementation cost at three engineers for six months loaded is roughly $600,000. Conservative payback is under two weeks at Carvana's traffic.

The number that matters is not the recovery dollar figure. It is the per-failure-mode telemetry that exists in our gateway and does not exist in Carvana's current entry step. Once they ship this, they can measure for the first time how often each named failure mode actually fires. The recovery number adjusts to reality from there.

## Summary (4:15 to 4:30)

One layer between the existing form and the existing vendors. Five named failure modes, five distinct user-facing recoveries. Built on a vendor-agnostic adapter interface that respects Carvana's contracts, the DPPA boundary, and a no-blame-the-user copy rule. Conservative recovery $47 million per year. The first commit lands tomorrow.

---

## Speaker notes (not read aloud)

- Pace: aim for about 150 spoken words per minute. The script clocks in around 720 spoken words at that pace, giving a 30-second buffer for breaths and any pauses.
- Slide cues: each section heading is a slide. Diagram slides at "How the data flows" (cascade topology with Mermaid) and "The Target Adapter boundary" (boundary diagram with the DPPA non-negotiable highlighted).
- The "trade-offs" section is the moment the cohort is most likely to push. The script doesn't invite the push (per Gauntlet style); it presents each trade-off as a positioned decision.

## Anticipated peer questions and short rebuttals

- **"Why not just push Carvana to add OCR to their existing app?"** Because the OCR fix is necessary but not sufficient. Half the failure modes the audit identified are not about input difficulty; they're about hostile error copy and silent backend behavior. OCR alone leaves four of the five named failures in place.
- **"Why VinAudit and not just NHTSA vPIC for the prototype?"** vPIC decodes VIN to specs. It has no plate data. Our prototype needs both surfaces to demonstrate the cascade.
- **"Why not LLM the user through the failure?"** LLM-mediated rescue copy is in the stretch slice. The conservative recovery model does not depend on it. Adding the LLM path is positive optionality, not load-bearing.
- **"Doesn't admitting bot detection give an advantage to attackers?"** Sophisticated attackers already detect the block by measuring success rates. The honest message changes nothing for them and saves the legitimate users who currently bounce.

## Critique cheat sheet for poking holes in peer architectures

- Are they explaining a failure mode honestly or sliding it past?
- Are they showing telemetry before / after, or just claiming improvement?
- Are they admitting where their architecture would NOT work, or pretending it works everywhere?
- Are they citing real numbers (10-K, Similarweb) or making up multipliers?
- Are they showing the trade-offs they accept, or hand-waving them?

## Vote-criteria mental model

The cohort votes on strongest and weakest defense. Strongest: clear problem framing + honest trade-offs + numbers that line up + a concrete fix. Weakest: hand-wavy AI claims + invented numbers + refusal to admit constraints. Aim for the strongest; avoid every signal that maps to weakest.

## Pre-call checklist

- Repo: https://github.com/scott-lydon/carvana-onboarding (public)
- Audit report and ROI calculator are live in the repo's `docs/` folder.
- Render deployment URL: pending (one-click in Render dashboard).
- Test corpus: five Texas asterisk plates in `test-plates/`.
- The "we'll know what each failure mode costs" telemetry slide is the closing visual.
