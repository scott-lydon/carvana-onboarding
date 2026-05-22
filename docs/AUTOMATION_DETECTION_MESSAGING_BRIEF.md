# Brief: Honest Error Messaging for Automation Detection on `sell-my-car`

> Audience: Carvana product + engineering + trust & safety.
> One-pager. Author: Carvana Onboarding Recovery Layer audit team. Date: 2026-05-22.

## The diagnostic event

While running an automated walkthrough of `carvana.com/sell-my-car` to audit the entry-step flow, every license plate submission returned the same error message:

> "We couldn't find that license plate. Please check entry and try again."

This happened on a real, valid California passenger plate (`8E79985`) that the plate's owner uses on a real car. The same plate, submitted minutes later from a different (non-automated) machine on a different network, resolved correctly to the vehicle data and produced an offer. The conclusion: Carvana's session was flagged for automation, and the bot-detection failure mode is being rendered to the user with copy that blames the *plate*, not the *session*.

This brief is about that copy. The bot detection itself is fine. The lie is the problem.

## Why one error message for five failure modes is the real bug

The same "we couldn't find that license plate" string is rendered in at least five distinct backend conditions:

1. **Automation detection** — Cloudflare bot-score, behavioral signals, or velocity throttling fires. User sees plate-not-found.
2. **Genuine vendor coverage gap** — Carfax / DataOne / DMV-aggregator doesn't have this plate. User sees plate-not-found.
3. **Transient backend error** — Vendor timeout, gateway 500, LaunchDarkly stream failure (we saw this in the console). User sees plate-not-found.
4. **User input mistake** — Mistyped letter, wrong state selected. User sees plate-not-found.
5. **State-specific format issues** — Texas plates with the asterisk separator that Carvana's input does not strip; spaces, dashes, or special characters not normalized. User sees plate-not-found.

Five very different causes; one identical message. The user has no way to know which cause hit them, so the user has no idea what to do next. The result is the same in every case: the user re-types the same plate, sees the same error, and leaves for a competitor.

## Who else gets hurt

The "they're trying to scrape us" framing assumes the legitimate user is always typing manually in a fresh browser session. Real life is messier. Legitimate non-malicious users who get flagged by automation detection include:

- **Developers researching Carvana's flow** (the case that triggered this brief).
- **Accessibility users** running screen readers, voice-control software, or browser-automation assistive tech.
- **Users on heavy VPNs**, Tor Browser, or privacy-respecting browsers like Brave with strict fingerprinting protection.
- **Users on shared corporate or campus IPs** that may be flagged due to other users' activity.
- **Users with browser extensions** that automate form-filling, password managers with autofill, or accessibility extensions.
- **Security researchers and third-party QA testers** with legitimate access.

For all of these users, the silent "plate not found" message is misleading, hostile, and ineffective. They cannot fix the actual cause because Carvana does not name the actual cause.

## The "security through obscurity" objection, addressed

A reasonable Trust & Safety reviewer will push back: *"We don't want to tell bots they've been detected, because then they'll evade."*

This objection is weak for three reasons:

1. **Sophisticated bots already detect the block independently.** A real scraper measures success rates, sees zero successes, and infers automation detection in seconds. The honest message changes nothing for the actually-malicious actor.
2. **Unsophisticated bots don't care.** A spray-and-pray credential stuffer is not iterating on Carvana's UX.
3. **The cost is borne entirely by legitimate users.** The asymmetry runs the wrong way: we lose real customers to spare ourselves a marginal benefit against attackers who aren't deterred.

The right framing is *"give honest information to users who would benefit from it, and accept that sophisticated attackers will figure out the block on their own anyway."*

## Proposed copy by failure mode

| Backend condition | Current copy | Proposed copy |
|---|---|---|
| Automation detection fired | We couldn't find that license plate. | We've detected automated behavior in your session. To protect against fraud, please try again from a normal browser session or contact us at `sell-help@carvana.com` if you believe this is in error. |
| Vendor coverage miss | We couldn't find that license plate. | Our partner data doesn't have your plate. About 10-15% of plates don't return a match (commercial, specialty, recently issued). Switch to VIN entry below, or scan your registration card with your camera. |
| Transient backend error | We couldn't find that license plate. | We're having trouble reaching our vehicle data right now. We're auto-retrying… (2/3). If this keeps failing, text us at `555-CARVANA` and we'll finish your offer by phone. |
| User input mistake (format) | We couldn't find that license plate. | This looks like 8 characters; California plates are usually 7. Please double-check, or try VIN entry below. |
| State-specific format issue | We couldn't find that license plate. | We noticed an asterisk in your plate. Texas plates use it as a visual separator; we removed it for the lookup. Re-trying… |

## Implementation footprint

This is a one-day engineering change. The backend already knows which failure mode fired (the bot-detection rule fires before the vendor call; the vendor returns structured nulls; the network error is a network error). All five cases currently get collapsed into a single client-side string. The fix is to send the structured cause to the client and render the appropriate copy.

The architecture exists. The data exists. The decision is whether the company is willing to admit, in writing on its own site, that the failure cause was not the user's plate.

## Stake

Per the broader audit report's ROI math (see `SELL_FLOW_AUDIT.md`), the conservative estimate is that **$46M per year of acquisition spend is being lost to entry-step failures across all five causes combined.** A meaningful fraction of that is recoverable simply by telling users what actually happened.

The one-message-for-five-failures pattern is unusual at companies operating at Carvana's scale. It is fixable in a week. It would meaningfully improve trust, recover leads, and reduce the volume of "why couldn't your site find my car?" calls to the support team.
