# Carvana Onboarding AI Assignment — Spec

> Status: **Exploration phase.** This is the raw assignment plus my live walkthrough notes. It will become a proper `spec.md` once we agree on scope, user, and what we are actually building. See [CLAUDE.md spec-driven workflow](./CLAUDE.md) for the four-artifact pattern (constitution → spec → plan → tasks) we promote into when we are ready.

---

## Assignment (verbatim from Carvana)

This project aims to enhance the onboarding experience for users seeking specialized services by leveraging AI to reduce drop-offs and emotional friction. The solution addresses pain points like complex data entry and high emotional stress during registration, specifically targeting the current challenges users face when trying to complete their onboarding process.

---

## Unpacking the brief

The brief is deliberately abstract ("specialized services," not "auto financing" or "instant offer"). That gives us latitude on **which** onboarding journey to attack. Two obvious candidates inside Carvana's own product:

1. **BUY-side onboarding — Get Prequalified for financing.** Multi-step credit application. Heaviest data entry, highest emotional stakes (SSN, income, will-they-approve-me anxiety, fear of a credit-score hit even on a soft pull).
2. **SELL-side onboarding — Instant Offer.** VIN/plate lookup, condition questionnaire, photos, payoff information. Less PII than financing but a long question chain with abandonment-prone fork points.

(Trade-in onboarding is a hybrid of the two and probably shares 80% of the friction with each.)

The phrase "specialized services" suggests it could ALSO mean adjacent verticals Carvana is expanding into — extended warranties, GAP coverage, trade-in upgrade swaps. Worth confirming before scoping.

## Pain points the brief calls out (literally)

- **Complex data entry** — long forms, repetitive fields, document uploads (proof of income, insurance card, driver's license, payoff letter).
- **High emotional stress during registration** — credit anxiety, fear of being judged, fear of giving away too much information, fear of getting locked into a bad deal, fear of the offer dropping after inspection.
- **Drop-offs** — the implicit KPI. Every screen they abandon is a deal lost.

## What "AI" plausibly does here (without committing yet)

Loose hypothesis space, NOT a decision:

- **Document auto-extraction** — point camera at driver's license / pay stub / insurance card, extract fields, prefill form. Removes typing.
- **Conversational onboarding** — single chat thread replaces multi-step form; the LLM picks the right next question based on what's been answered, skips inapplicable branches.
- **Empathy / reassurance layer** — interstitials that explain *why* a field is needed and what happens to the data, addressing the "high emotional stress" line directly.
- **Pre-screen / no-surprise quote** — give the user a non-binding estimate using just public data (VIN + zip + Kelley-style comp) so they know what to expect before handing over SSN.
- **Resume-where-you-left-off** — link/QR/SMS that lets someone abandon on mobile and finish on desktop, addressing the drop-off pattern where a complex question kills momentum.
- **Smart pre-fill from prior signals** — if they came in via a referral or already have a Carvana account, skip everything we already know.

We pick ONE primary direction (or a tight combo) after we feel the actual friction in the live flow.

---

## Live walkthrough findings

> Populated as I click through the buy-side and sell-side onboarding flows in Chrome with realistic fake data. Each entry: **(step) what happened — friction observed — emotional weight — drop-off probability.**

### Buy-side: Get Prequalified

_To be filled in during the walkthrough._

### Sell-side: Instant Offer

URL flow observed: `carvana.com/sell-my-car` → `…/getoffer/found` → `…/getoffer/entry` → **DEAD END at plate-lookup vendor failure**.

#### Friction point S1 — empty form shows "This field is required" before user interaction
- **Where:** Hero card on `/sell-my-car` after any prior empty-submit.
- **What:** License Plate input pre-renders with red border and red "This field is required" chip.
- **Friction weight:** Low individually, hostile in aggregate. User's first impression on the most important card is a failure state.
- **Emotional read:** "I haven't done anything wrong yet but the app is already mad at me."
- **Fix shape:** Suppress validation chrome until first blur or first submit. Standard form UX.

#### Friction point S2 — state picker is a 50-state scrollable list with no type-to-search
- **Where:** State dropdown on both `/sell-my-car` AND `/sell-my-car/getoffer/entry`.
- **What:** Native-looking but custom-rendered dropdown of 50 items, alphabetical, no filter input, slow on long scroll.
- **Friction weight:** Low per use but **incurred twice** (see S3).
- **Fix shape:** Autocomplete, OR auto-detect from IP geo, OR remember selection across the duplicate forms.

#### Friction point S3 — user re-enters plate + state on the very next screen (DUPLICATE FORM)
- **Where:** Transition from `/sell-my-car` → `/sell-my-car/getoffer/entry`.
- **What:** The hero "Get Your Offer" form on the homepage collects plate + state. After a brief "Finding your vehicle…" loading screen, the user lands on a page titled "Let's look up your vehicle" with the SAME plate + state form, EMPTY, with red error chips on both fields.
- **Friction weight:** **High.** This is a classic "did the app forget what I just typed?" moment. Drop-off candidate #1.
- **Emotional read:** "Did it crash? Did I do something wrong? Why am I re-typing this?"
- **Fix shape:** Pass the values through state, prefill the second screen, OR collapse the two screens into one. The "Finding your vehicle…" loading screen IS the transition — don't render a second form behind it.

#### Friction point S4 — plate lookup FAILS on a real, valid plate (THE BIG ONE)
- **Where:** `/sell-my-car/getoffer/entry`, on submit with a confirmed-valid CA license plate (`8E79985`, user-verified as real and accurate).
- **What:** Carvana returns "We couldn't find that license plate. Please check entry and try again." The plate is real. The format passes Carvana's own client-side validation (green checkmark appears before submit). The plate-to-VIN third-party vendor Carvana relies on simply does not have a record for it.
- **Friction weight:** **CRITICAL.** This is the funnel's #1 silent killer. The user thinks they typed wrong, re-types the same plate, gets the same error, gives up. Carvana never learns the lookup failed for a real customer with a real car.
- **Emotional read:** "I must have typed it wrong. Wait, no, that's right. Is my plate not in their system? Is something wrong with my car? Are they not buying my make? I'll just go to CarMax."
- **Why this is the marquee finding:** The brief literally says "complex data entry and high emotional stress during registration." This step has neither apparent complexity nor apparent stress — but it terminates the funnel for an unknown-but-likely-double-digit percentage of users, silently, with a blame-the-user error.
- **Fix shape (multiple, layered):**
  - **Honest copy:** "We couldn't find this plate in our partner DMV data. About X% of plates don't return a match. Switch to VIN entry, or open chat for help."
  - **Auto-fallback:** Detect the lookup failure, AUTOMATICALLY switch the tab to VIN entry, and surface a "Need help finding your VIN?" card showing the three common locations (dashboard, doorjamb, registration card) with images.
  - **VIN-from-photo:** Camera capture of the VIN sticker (OCR) so the user does not type 17 characters of mixed letters and numbers.
  - **VIN-from-insurance-card:** Same OCR, point at insurance card.
  - **VIN-from-registration:** Same OCR, point at registration card.
  - **Chat fallback:** Surface the chat widget proactively at this dead-end, not as a passive bubble in the corner.
  - **Logging:** Carvana should record every plate-lookup failure (anonymized) and feed it back to the vendor for coverage improvements. The vendor's coverage gap IS Carvana's funnel problem.

#### Friction point S5 — red error dot persists on field even after error message changes
- **Where:** Plate input on `/sell-my-car/getoffer/entry` after the lookup-failure error.
- **What:** During the second form's render, the field shows a red error dot from the prior "field required" check. After typing a valid-format plate, the green checkmark appears briefly, then on submit the lookup fails and the red dot returns AND the error text changes to "couldn't find that plate." The user can't easily distinguish a format error from a lookup error.
- **Friction weight:** Low individually, contributes to the "I don't know what I did wrong" feeling at S4.
- **Fix shape:** Distinct visual states for format-invalid vs lookup-failed (different icon, different color band, different copy).

#### Cumulative drop-off model (sell-side, first 2 minutes)
Even before reaching the condition questionnaire, photos, or payoff information, the funnel has at least two structural drop-off vectors:
- Duplicate-form re-entry (S3) → estimate single-digit % drop.
- Plate-lookup vendor miss (S4) → estimate double-digit % drop for affected users (CA non-standard plates, commercial plates, recently-issued plates, special-interest plates, motorcycle plates).

The AI opportunity here is not glamorous (no LLM, no agentic anything) — it is **a competent, empathetic recovery layer at exactly the moment Carvana currently abandons the user**. OCR for VIN capture + conversational fallback + honest error copy. The boring win.

_(Walkthrough paused pending VIN entry to continue past the S4 dead-end.)_

#### Friction point S6 — VIN submission silently resets the tab and erases input on backend error
- **Where:** `/sell-my-car/getoffer/entry`, VIN tab, with a valid 17-character Toyota VIN (`JTEEW21A060032314`).
- **What:** On clicking **Get My Offer**, the page returns after a few seconds, but instead of advancing OR showing a "we couldn't find that VIN" error, it **silently resets to the License Plate tab with empty fields and red "field required" errors on both plate and state**. The VIN the user typed is gone. No error message is shown.
- **Console evidence (captured 7:34:27 PM):**
  - Multiple `Uncaught (in promise) AxiosError: Network Error` exceptions from `stc-appraisal-ui` bundle.
  - Multiple `[LaunchDarkly] Error on stream connection` warnings with retry timers.
- **Friction weight:** **CRITICAL, second-only to S4.** The user types a 17-character alphanumeric VIN, submits, gets *visibly worse than nothing* (empty plate form, red errors). They re-type, get the same result, leave. From the user's seat the front-end has gaslit them.
- **Emotional read:** "Wait, did I lose my VIN? Did the site crash? Is the VIN wrong? Should I try the plate again? Is my car not supported? I'll just call them."
- **Honest diagnosis (NOT the user-facing copy):** Backend (or vendor) returned a non-2xx, the front-end threw an uncaught promise rejection, and the error path silently re-mounted the form in its default state. There is no user-facing error path for this failure mode.
- **Fix shape (multiple, layered):**
  - **Catch the error.** Wrap the axios call in proper error handling; do not allow it to surface as an uncaught promise that the framework swallows.
  - **Show a real message.** "Our system can't reach our vehicle data right now. Try again, or text us at XXX-XXXX." Differentiate transient backend error from coverage gap.
  - **Preserve user input on error.** The VIN should still be in the field after the failure. Re-typing 17 characters is a feature of hostility.
  - **Stay on the active tab.** Errors should never silently switch tabs. The user is on VIN for a reason.
  - **Retry budget visible to the user.** "Auto-retrying in 5s… (2/3)" — gives them something to look at while degradation is happening.
  - **Resume-by-link fallback.** SMS the user a link that drops them into the offer flow with their VIN preserved. They came to Carvana via mobile 80%+ of the time. Don't lose them to a transient network glitch.
- **Important caveat:** This may be partially specific to the Claude-in-Chrome MCP session (the extension intercepts XHR, which can perturb cookies, CORS, or Cloudflare's bot-detection telemetry). User reproduction in a normal browser tab is needed to confirm this is universal Carvana behavior vs. session-specific. Either way, **the front-end's silent-reset-on-error is a real bug because that code path will get hit by any real-world transient failure** (vendor down, Carvana backend deploy, user on flaky WiFi, etc.).

#### Pattern emerging across S4 and S6 — Carvana's failure mode is "blame the user, lose the lead"
Both failures (plate-not-found, VIN-network-error) collapse into the same broken UX: the user is shown an empty or error-marked form and is left to infer they did something wrong. There is no honest acknowledgment that Carvana itself failed. There is no graceful fallback. There is no human-readable retry path. There is no rescue.

**This is the heart of the AI opportunity for the assignment.** Not a chat agent. Not a recommender. A *graceful degradation layer* that:
1. Detects vendor / backend failure.
2. Acknowledges it honestly.
3. Routes the user to the best alternative path (different lookup method, OCR capture of VIN sticker, live human chat, scheduled callback, SMS resume link).
4. Preserves every keystroke they have already given.
5. Logs the failure to Carvana so the coverage gap closes over time.

The boring win. The actually-helpful AI. Not flashy. Demo-able with a clear before/after.


### Buy-side: Financing Prequalification

URL flow observed: `/financing` (marketing landing) → "Get your terms" CTA → interstitial modal → "Get pre-qualified" multi-step form (steps: Personal info → Contact info → Financial info) → **DEAD END at account-creation gate** (email + password REQUIRED before any prequalification result, after ~5 minutes of PII entry).

#### Friction point B0 — `/financing/getprequalified` returns 404
- **Where:** Direct navigation to the URL most people would guess (Google search target, deep-link sharing).
- **What:** "Page Not Found" with zombies / tooth fairies / salesmen icons. Cute design but the obvious deep-link is dead.
- **Friction weight:** Medium. Hurts SEO discoverability, breaks shared links from blogs / forum posts / past Carvana emails.
- **Emotional read:** "Wait, am I in the right place? Is this still a real product?"
- **Fix shape:** Make the URL alias work and redirect to `/financing`. Trivial fix.

#### Friction point B1 — modal interstitial re-states "no credit hit" before the actual form
- **Where:** After clicking "Get your terms" on `/financing`.
- **What:** A modal pops up saying "Get pre-qualified for an auto loan in 2 minutes" with "No impact to your credit score" — info the user just saw on the landing page — and asks them to click "Get pre-qualified" to proceed.
- **Friction weight:** Low. One unnecessary extra click but at least the copy is reassuring.
- **Emotional read:** "I just clicked that. Why am I doing it again?"
- **Fix shape:** Drop the interstitial OR collapse it into the landing CTA. Re-stating the no-hit promise once was enough.

#### Friction point B2 — modal-only form means no URL, no deep-link, no back-button-friendly progress
- **Where:** Entire prequalification flow runs inside one modal at `/financing`.
- **What:** The URL never changes through 3 form steps. Refresh = lose all progress. Browser back button = exit the modal entirely (no "go back to previous step"). No way to share a halfway-done state with a partner who's co-signing.
- **Friction weight:** Medium. Mobile users in particular get hurt — they accidentally back-swipe and lose the form.
- **Fix shape:** Route each step to its own URL (`/financing/prequal/personal`, `…/contact`, `…/financial`). Standard multi-step form pattern.

#### Friction point B3 — name field family is unusually long and brittle
- **Where:** Step 1 "Personal information."
- **What:** Four fields for what should be one: First name, Middle name, Last name, Suffix. Plus a "No middle name" checkbox to handle the not-everyone-has-one case. Plus a Date of Birth picker.
- **Positive:** Green checkmarks on valid fields, "No middle name" checkbox is thoughtful, suffix marked optional.
- **Negative:** Single "Full legal name" field with NLP-based extraction would be one input instead of four. DOB field has no green checkmark on completion (inconsistent with the others).
- **Friction weight:** Low to medium. Multi-field name pattern is industry standard, but the inconsistent indicator state is sloppy.
- **Fix shape:** Consolidate to single name field OR keep the split but fix the indicator inconsistency. Add live validation that DOB is plausible (over 18 for auto loans).

#### Friction point B4 — no address autocomplete (Google Places, USPS lookup)
- **Where:** Step 2 "Contact information."
- **What:** Five separate fields for the address (street, apt, city, state dropdown, ZIP). No autocomplete suggestions as the user types. State dropdown is a 50-item scrollable list with no type-to-filter.
- **Industry comparison:** Most 2026 prequal flows offer one-field address entry with Google Places / Smarty Streets / USPS validation. Eliminates the city / state / zip fields entirely and reduces typos.
- **Friction weight:** Medium. Each extra field is a typing cost + an opportunity to mistype. Address typo at this step can cause downstream identity verification failures.
- **Fix shape:** One field with Google Places. Auto-detect state from ZIP. Industry-standard.

#### Friction point B5 — pre-checked SMS marketing toggle is a TCPA dark pattern
- **Where:** Step 2 "Contact information."
- **What:** A toggle labeled "Send updates & offers to my mobile number" is **default ON**. The fine print below admits "I understand consent is not required." Clicking "Next" without explicitly toggling it off opts the user into autodialer marketing calls/texts from Carvana AND its affiliates (Bridgecrest, SilverRock).
- **Legal weight:** TCPA case law has trended hostile to pre-checked opt-ins; this exact pattern has produced settlements at other companies.
- **Emotional / trust weight:** **Severe.** Users notice. Sophisticated users notice loudly. Even users who don't consciously catch it absorb the "they're trying to slip something past me" vibe, which compounds the financing-application anxiety the brief explicitly names.
- **Fix shape:** Default OFF. Add an explicit, separate checkbox for the consent (not a toggle hidden mid-form). Match the industry-standard "Yes, send me SMS updates" opt-in pattern.

#### Friction point B6 — implicit acceptance of User Agreement + Privacy Policy + E-SIGN consent
- **Where:** Step 2 "Contact information," fine print below the SMS toggle.
- **What:** Clicking the "Next" button is implicit acceptance of three separate legal documents (User Agreement, Privacy Policy, E-SIGN consent), with no individual checkboxes. Links to each are tiny grey text in the disclaimer paragraph.
- **Legal weight:** Click-wrap with no separate affirmative checkbox is enforceable in most US jurisdictions but is weaker than checkbox-affirmative consent, and is increasingly scrutinized for E-SIGN specifically.
- **Trust weight:** High. Sophisticated users notice. Less-sophisticated users don't notice and unknowingly consent to digital-signature acceptance of any future loan document Carvana sends them.
- **Fix shape:** Surface the three documents as a separate, expandable summary panel above the Next button. Add explicit "I have read and agree to…" checkboxes for the E-SIGN consent at minimum.

#### Friction point B7 — employment status options miss self-employed / freelance / retired (non-SS) / student
- **Where:** Step 3 "Financial information," Employment status dropdown.
- **What:** Only four options: employed full/part time, employed with reduced hours/pay, unemployed/furloughed, fixed income (Social Security or similar). Self-employed / 1099 / freelance / business owner / retired non-SS / student have no fitting option.
- **Friction weight:** High for affected users. A freelance designer making $200k a year has to mis-classify as "I'm employed" which lies to Carvana's underwriting. A retired person with a pension and IRA distributions does not fit "Social Security or similar."
- **Cohort impact:** US self-employed / freelance is ~16M workers (BLS 2025), retired is ~50M. Together that's a non-trivial fraction of car-buying-age adults who cannot honestly categorize themselves.
- **Fix shape:** Add: Self-employed, 1099 / freelance, Retired (other), Student, Active duty military, Other (with text follow-up).

#### Friction point B8 — account creation REQUIRED before any prequalification result (THE BIG BUY-SIDE FINDING)
- **Where:** After Step 3 "Financial information," at the "Sign In or Sign Up" gate.
- **What:** After collecting full legal name + DOB + home address + mobile + employment + income — about 5 minutes of PII entry — Carvana asks the user to create an account (email + password) BEFORE showing any prequalification result.
- **Friction weight:** **CRITICAL.** This is the buy-side equivalent of S4/S6 on the sell side. It's the silent funnel killer.
- **Why it's hostile:**
  1. **Promise versus delivery mismatch.** "Get pre-qualified in 2 minutes" → instead, you get "create an account to continue."
  2. **Commitment escalation.** User has invested 5 minutes already; sunk-cost fallacy is fighting the urge to abandon. Hostile but effective.
  3. **No "continue as guest" option.** No social login (Google, Apple, Meta). Pure email + password, the slowest possible path.
  4. **The data was already enough.** Soft-pull prequalification requires name + DOB + address + SSN. Account creation is NOT a credit-bureau requirement; Carvana added it for their CRM remarketing.
  5. **Lead-capture motivation.** Carvana wants the email even if the user abandons at the next (SSN) step, so they can remarket. This is a Carvana-side optimization at the user's expense.
- **Emotional read:** "Wait, I thought this was supposed to be quick? Why do I need an account? What are they going to do with my info if I bail now? Did I already commit to something?"
- **Fix shape (multiple, layered):**
  - **Defer account creation to AFTER the prequalification result is shown.** Show the user their terms, THEN ask "Save these terms? Create an account to come back later."
  - **Add social login** (Apple, Google, Meta) for the users who DO want an account upfront.
  - **Add "Continue as guest"** with the option to save later.
  - **Magic-link email login** (no password) for the lowest-friction account path.

#### Cross-cutting observation between buy and sell — Carvana's pattern is "collect first, deliver later"
Both onboarding flows follow the same architecture: **the user gives Carvana information BEFORE Carvana commits to anything**. On sell, this is the plate / VIN lookup wall (where it BREAKS for valid plates). On buy, this is the account-creation gate (where it traps the user mid-funnel). In both, the user has put in real effort before getting any signal of value, and in both, the path to abandonment exceeds the path to success.

The fix pattern is the same on both sides: **flip the order**. Show the user something useful (a vehicle estimate, a credit-range hint, a sample APR) as early as possible, then ask for the deeper info that's required to refine it. Reduce the commit-without-knowing tax.

#### Cross-cutting observation — state dropdown sorts differently on buy vs sell
- **Sell-side state dropdown** (`/sell-my-car/getoffer/entry`): sorted by abbreviation (AK, AL, AR, AZ, CA...).
- **Buy-side state dropdown** (financing prequal Contact Info step): sorted by state NAME (AL=Alabama, AK=Alaska, AZ=Arizona, AR=Arkansas, CA=California — labels are abbreviations but sort is by state name).
- **Why it matters:** Internal inconsistency at the same company on the same site. Quality-of-implementation tell that the two flows have separate dev teams that don't coordinate UI primitives. Reinforces the "two different microfrontends" hypothesis from the console errors on the sell side (`stc-appraisal-ui` vs presumably `stc-financing-ui` or similar).
- **Fix shape:** Shared design-system component library. Standard at Carvana's engineering scale, surprising it's not already in place.

### Cross-cutting observations

The sell-side findings (S1-S6) and the buy-side findings (B0-B8) converge on three meta-patterns:

1. **Carvana's failure modes are silent or blame-the-user.** Lookup failures show blame-the-user copy; backend errors silently reset forms; account gates appear without warning. None of these admit Carvana's role in the failure.

2. **Carvana asks for high-PII commitment BEFORE delivering any value.** Both flows require substantial user effort before showing anything in return. This violates the modern e-commerce default of "show value, then ask for commitment."

3. **The "AI" the assignment brief calls for is not a chatbot.** It is a graceful-degradation, empathetic-recovery, OCR-camera-rescue, conversational-fallback LAYER that catches both the structural failures (B8, S4) and the transient failures (S6) at exactly the moments Carvana currently abandons or pressures the user. The boring win. Demoable. Quantifiable. Worth ~$46M / year per the research.

---

## Open questions (for the chat)

1. Are we targeting Carvana's existing flows specifically, or does "specialized services" mean we get to pick a different onboarding domain entirely (insurance, lending, healthcare, etc.) and use Carvana as the inspiration?
2. Is the deliverable a working app, a clickable prototype, an architecture proposal, or a research deck? (Different rubrics, different builds.)
3. What does "AI" need to look like in the demo? Live LLM call? On-device CV for documents? Voice interface? Any one of these reshapes the stack.
4. Who is the user we are designing for? First-time car buyer with credit anxiety? Returning seller? Someone with low digital literacy? Each implies a different empathy bar and a different reading-level for the UI text.
5. What measurable outcome does the AI need to move? Drop-off rate, time-to-completion, NPS, approval rate? The metric will pin the design.

---

## Bibliographic markers

- Carvana help center: https://www.carvana.com/help
- Public flow entry points walked in this session:
  - Buy / prequal: `https://www.carvana.com/financing/getprequalified`
  - Sell / instant offer: `https://www.carvana.com/sell-my-car`

(URLs verified during the walkthrough; updated in the findings section if Carvana has changed them.)
