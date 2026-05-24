# Manual Test Walkthrough — Full 9-Stage Sell Flow

> Click-by-click. Each stage has a literal action and an expected result.
> If anything diverges from the expected line, that's a regression — note it
> at the bottom in "Issues found" and we'll fold it into the automated tests
> (Playwright spec at `tests/e2e/v2-full-9-stage-flow.spec.ts` is the
> automated mirror of this doc).

## Pre-flight (do once, ~30 seconds)

1. Open **https://carvana-onboarding.onrender.com** in Chrome or Safari.
2. Wait for the page to render. The greeting should appear within ~2-3 seconds on a warm dyno; up to ~30 seconds if Render had spun the free-tier instance down (cold start).
3. **Expected on screen:** A chat shell with a single assistant message starting with "Hi — I'm here to help you sell your car." A textarea below it with placeholder `Type your plate and state, like "XRJ4041 in Texas"`. Two buttons below the composer: a green "Scan VIN with camera" and a "Send" button.
4. **If you see "Demo warming up" or "configuration_missing":** the Render dashboard env vars (`ANTHROPIC_API_KEY`, `CARSXE_API_KEY`) got dropped on a redeploy. Check Render → carvana-onboarding service → Environment. Both must be set with `sync: false`. Fix and re-deploy from the Render dashboard's "Manual Deploy" button.

**Test data you'll use throughout this walkthrough:**
- Known-good plate: `XRJ4041` in Texas → resolves to 2021 Toyota Highlander
- Known-good VIN: `JTEEW21A060032314` (Toyota; same vehicle, alternate path)
- Condition photos: `/Users/scottlydon/Desktop/Clutter/iOS/carvana-onboarding/test-plates/IMG_6910.HEIC` through `IMG_6914.HEIC` (5 real HEIC photos)

---

## Stage 1 — Greeting

1. Page loads.
2. **Expected:** One assistant message visible. Composer is focused and ready. The SellWorkspace right rail is **hidden** (it appears only after any stage produces data — this is intentional, no clutter on the empty chat).

**Pass criteria:** Greeting visible, no SellWorkspace, no errors in browser console.

---

## Stage 2 — Vehicle lookup (conversational plate entry)

1. Click into the composer.
2. **Type literally:** `my plate is XRJ4041 in Texas`
3. Click **Send** (or press Enter).
4. **Expected within 3 seconds:**
   - Your message bubble appears with the text you typed.
   - An assistant bubble appears with three typing dots (no four-phase progress bar — that's the Haiku 4.5 latency budget showing).
   - A tool-use card appears titled **"Vehicle identified"** with: year `2021`, make `Toyota`, model `Highlander`, body `SUV`, source `via carsxe (~500ms)`.
   - The assistant text says something like "Great — I found your 2021 Toyota Highlander. The vehicle details are on the right." It will **NOT** echo back the plate number in its text (constitutional rule #1 — PII out of free text).
   - **SellWorkspace right rail appears** with Vehicle = Complete (green pill, "2021 Toyota Highlander").

**Pass criteria:** Vehicle card renders, plate is NOT in the assistant's text, SellWorkspace shows Vehicle as Complete.

---

## Stage 3 — Condition intake (photo-driven, the revolutionary simplification)

1. Immediately after the vehicle card, the assistant will say something like "Now let's assess the condition" and the **ConditionIntake panel** opens below the composer with **9 photo slots** (front-left, front-right, rear-left, rear-right, odometer, interior, VIN plate, damage closeup 1, damage closeup 2).
2. Click slot **"Front left"**. The OS file picker opens.
3. Navigate to `/Users/scottlydon/Desktop/Clutter/iOS/carvana-onboarding/test-plates/` and select `IMG_6910.HEIC`. (HEIC is fine — the server has a sharp/heic-convert pipeline.)
4. **Expected:** the slot fills with a thumbnail preview within 1-2 seconds.
5. Repeat for slots **"Front right"** (`IMG_6911.HEIC`), **"Odometer"** (`IMG_6912.HEIC`).
6. Optionally add `IMG_6913.HEIC` and `IMG_6914.HEIC` to any two more slots — the panel accepts 3 to 12 photos; 3 is the minimum.
7. Click **"Submit photos"** at the bottom of the panel.
8. **Expected within 10-20 seconds (single Claude vision call over all photos):**
   - The panel shows typing dots, then closes.
   - A user-shaped message appears in the chat: `Condition assessment: extracted mileage XXXXX; N damage finding(s); suggested tier <T>`.
   - The assistant acknowledges, then either confirms the tier or asks 1-4 follow-up questions inline (e.g., "Any check-engine light on?", "Any unrepaired accidents in the last 3 years?"). Maximum of 4 follow-ups by spec — count them.
   - SellWorkspace right rail: Condition = Complete with mileage + tier shown.
9. Answer each follow-up the chatbot asks. Type plain English ("no accidents", "no warning lights", "tires are about a year old"). Press Enter after each.

**Pass criteria:** Photos uploaded, vision extracted a mileage number (not "unknown"), suggested tier is one of `Excellent / Good / Fair / Rough`, at most 4 follow-ups, SellWorkspace shows Condition as Complete.

**Known gotcha:** If your photos don't include a readable odometer, the chatbot will explicitly ask you for the mileage in chat — that's correct behavior (the system prompt requires confidence ≥ 0.7 on the vision read before trusting it).

---

## Stage 4 — Loan / payoff

1. After follow-ups end, the assistant asks: **"Do you still have a loan on this car?"**
2. **For the no-lien path:** type `no` and Send.
   - **Expected:** Assistant says title is clean and moves to Stage 5.
   - SellWorkspace: Title & Loan = "No lien".
3. **For the yes-lien path** (test this AFTER you've done the no-lien path once; refresh the page to reset): type `yes` and Send.
   - **Expected within 1-2 seconds:** The **PayoffForm panel** opens below the composer with two fields: **Lender** and **10-day payoff amount (USD)**.
   - Type lender: `Chase Auto`, payoff: `12500`. Click **Save**.
   - A user-shaped chat message appears: `Loan payoff recorded: $12,500 owed to Chase Auto`.
   - SellWorkspace: Title & Loan = "Chase Auto · $12,500".

**Pass criteria for both paths:** SellWorkspace's "Title & Loan" slice reflects what you answered.

---

## Stage 5 — Instant offer (the auditable deterministic formula)

1. The assistant calls `generate_offer` automatically once it has year, make, model, mileage, condition, and loan status.
2. **Expected within 1-2 seconds (this is a pure compute, no LLM):**
   - **OfferCard renders inline** with a dollar amount at the top (e.g., `$9,500` for 2021 Highlander / 47k mi / Good / no lien — matches `OfferEngine` formula version `2026-05-24.v1`).
   - Below the headline: a **line-itemed breakdown** with at least 4 lines:
     - `2021 Toyota Highlander — base (Mainstream)` with the depreciated base value and a one-sentence "what" explanation
     - `Mileage adjustment (X mi vs expected Y mi)` with positive or negative value
     - `Condition: Good (×1.00)` (or whatever tier)
     - `Rounded to nearest $50`
     - If you have a lien: an extra `Loan payoff (subtracted from gross)` line
   - Footer copy: "Offer valid for 7 days or 1,000 miles, whichever first."
   - SellWorkspace: Instant Offer = Complete with the dollar amount.
3. **Anxiety-interstitial test:** Reply to the assistant with: `is that really all? feels low`.
   - **Expected:** The assistant calls `get_support_content({topic: "offer_drop_anxiety"})` and a pre-baked **SupportContent card** renders titled something like "Offer Drop Anxiety" or similar, with a 60-80 word body explaining the offer-adjustment policy. The body is byte-for-byte from `src/support-content/cards.ts` (no LLM-generated empathy text — constitutional rule).

**Pass criteria:** Offer card renders with line-itemed breakdown, anxiety reply triggers a pre-baked support card (NOT a paragraph generated by the chatbot).

---

## Stage 6 — Pickup scheduling

1. Type: `let's lock it in and schedule pickup`
2. **Expected:**
   - The **Scheduler panel** opens below the composer with a weekly grid of the next 14 days, 8 slots per day (9 AM-5 PM).
   - Each slot is clickable; already-booked slots are dimmed.
3. Pick any open slot (e.g., next Saturday 10:00 AM).
4. The address field appears below the grid. Type: `1234 Main St, Austin TX 78701`.
5. Click **Confirm pickup**.
6. **Expected within 1-2 seconds:**
   - A user-shaped message appears: `Pickup booked: Sat Jun 6 10:00 AM at 1234 Main St, Austin TX 78701` (date will match what you picked).
   - Assistant warmly acknowledges.
   - SellWorkspace: Pickup = Complete.

**Pass criteria:** Slot booked, no double-book error, SellWorkspace reflects the booking.

**Concurrency check (optional):** Open the deployed URL in a second incognito window AT THE SAME TIME, walk both through to this stage, and try to book the EXACT same slot from both windows. Expected: exactly one succeeds, the other shows "that slot just got taken, here are alternatives" (CAT-14 — atomic SQLite `BEGIN IMMEDIATE` + UNIQUE constraint).

---

## Stage 7 — Payment method

1. Assistant calls `select_payment_method` automatically.
2. **Expected:**
   - The **PaymentMethod panel** opens with **3 radio cards**:
     - **ACH (direct deposit, 1-2 business days)** — no auto-default checked
     - **Check at pickup** — no auto-default checked
     - **Trade-in credit (toward a Carvana purchase)** — no auto-default checked
3. Pick **ACH**. Click **Confirm**.
4. **Expected:** User message `Payment method selected: ach`. Assistant briefly acknowledges. SellWorkspace: Payment = Complete with "ACH".

**Pass criteria:** No default option pre-selected (a pre-checked radio would be a CAT-4 / TCPA-style dark pattern), selection lands in SellWorkspace.

---

## Stage 8 — Contract acknowledgement (the marquee simplification)

1. Assistant calls `acknowledge_contract` automatically.
2. **Expected:**
   - The **ContractConsent panel** opens with **three disclosures in plain English** stacked vertically:
     - **Limited Power of Attorney** (so Carvana can sign DMV paperwork on your behalf)
     - **Bill of Sale** (records the transfer)
     - **Federal Odometer Disclosure** (legally required)
   - **One single checkbox** at the bottom: "I have read and agree to all three of the above."
3. Read the disclosures. Check the box. Click **Acknowledge**.
4. **Expected within 1-2 seconds:**
   - User message: `Contract acknowledged at 2026-05-24T23:55:12.789Z` (your timestamp).
   - SellWorkspace: Contract = Complete.
   - Assistant moves to wrap-up.

**Pass criteria:** ONE checkbox covers ALL THREE legal documents (this is the revolutionary simplification vs Carvana's real flow which has 3 separate signing screens). Submit button stays disabled until the box is checked.

---

## Stage 9 — Wrap-up

1. Assistant thanks you. Reiterates when payment arrives based on the method you picked ("Your direct deposit will arrive 1-2 business days after pickup" for ACH).
2. **Expected:**
   - An **NpsSurvey widget** renders inline asking "How likely are you to recommend this onboarding to a friend, 1-5?".
   - Pick a score. A free-text "what's the one thing that would make this better?" field appears.
   - Type something brief and click **Submit**.
3. **Total elapsed time check:** Look at the timestamp of your first user message vs the NPS submit. Per spec acceptance criterion, this should be **under 15 minutes for a motivated user** (realistic: 3-6 minutes if the photos and answers are quick).

**Pass criteria:** NPS renders, free text accepted, total elapsed under 15 minutes.

---

## Side-flow tests (do these on a fresh page load each time)

### Side flow A — VIN OCR rescue (the S4 fix)

1. Refresh. Type: `my plate is FAKEPLT in California` (this plate WILL miss on CarsXE).
2. **Expected:**
   - Assistant returns the not_found path with HONEST copy: something like "Our partner data missed this plate — that's on us, not you. Want to try scanning the VIN sticker with your camera?"
   - The text MUST NOT contain "check your entry", "invalid plate", or "please try again" with no context (CAT-3 blame-the-user regression).
3. Click the green **"Scan VIN with camera"** button below the composer.
4. **Expected:** Browser asks for camera permission. Below the button, an inline status appears: `Camera permission requested — accept the browser prompt to scan.`
5. Decline the permission for this test. **Expected:** the status replaces with `Camera permission denied`. No silent failure.
6. **Alternative path:** Click "or upload a photo" link. **Expected inline status:** `Pick a VIN photo from your library — drag and drop also works.` Pick `tests/fixtures/vin-sticker-test.png`. The OCR runs, extracts a VIN, and posts a user message `Scanned VIN: <17 chars>`. Assistant then calls `lookup_vin` automatically.

**Pass criteria:** Honest copy on miss (no blame), camera permission has visible state changes (not silent), file-upload alternative works.

### Side flow B — Form-state preservation on transient error (the S6 fix)

1. Refresh. Open browser DevTools → Network → throttle to "Offline".
2. Type: `my plate is XRJ4041 in Texas`. Send.
3. **Expected:** Assistant returns the transient_error path. The chat history is preserved (your message is still visible, the assistant explicitly says "on our side, not yours"). No silent form reset. No tab switch.
4. Turn DevTools throttling back off. Type: `try again` (or reuse the prior plate).
5. **Expected:** Lookup succeeds, vehicle resolves.

**Pass criteria:** Chat history intact on error, transient_error explicitly named, retry path works.

### Side flow C — PII-out-of-text verification (CAT-11)

1. Walk the happy path through Stage 2 (vehicle resolves).
2. Open DevTools → Network → click the `/api/chat` SSE response.
3. Search the response stream for the literal string `XRJ4041`.
4. **Expected:** The plate appears ONLY inside the structured tool_use input JSON and tool_result JSON. It MUST NOT appear inside any `text_delta` chunk (the assistant's prose).

**Pass criteria:** No plate / VIN / driver-license / address values inside assistant text streams (constitutional rule #1, CAT-11 regression test).

### Side flow D — Mobile viewport (compact layout indicator)

1. DevTools → toggle device toolbar → set viewport to 375 × 812 (iPhone 13).
2. Refresh.
3. **Expected:**
   - The chat container's CSS width shrinks to `min(720px, calc(100vw - 24px))`.
   - The chat header visibly appends "· compact mobile layout" so the layout-mode change is observable.
4. Toggle back to desktop width. **Expected:** indicator clears, width returns to normal.

**Pass criteria:** Layout adapts, the indicator text is present at narrow widths and absent at wide widths.

### Side flow E — Empty-send guard

1. With the composer empty, click **Send**.
2. **Expected inline alert:** "Type a message before sending."
3. Start typing — the alert auto-clears. No `/api/chat` request was made. The composer text is not cleared.

**Pass criteria:** Inline guard renders the exact copy, the chat does not submit.

---

## Issues found (note them here as you go, with as much detail as possible)

For each issue, capture:
- **Where:** the stage and the specific click
- **What I did:** the input I typed / the slot I picked
- **What happened:** the actual behavior
- **What I expected:** the line from this doc

Format the issue so I can copy it into a chat reply and it becomes a new manual-test case + automated regression test. Example:

> **Stage 3, photo upload.** Uploaded `IMG_6910.HEIC` to the "Front left" slot. The thumbnail showed as a broken-image icon for ~10 seconds before resolving. Expected: thumbnail within 1-2 seconds.

---

## When you're done

Tell me which stages PASSED and which (if any) failed, and we'll either fix and add a regression test, or if everything passed, run the final qa-adversary sweep (Slice F-Flow follow-up task F.18) and declare ready-to-ship.
