# Manual Test Walkthrough — Full 9-Stage Sell Flow

> Click-by-click. Each stage has a literal action and an expected result.
> If anything diverges from the expected line, note it at the bottom in
> "Issues found" and we'll fold it into the automated tests
> (the automated mirror lives at `tests/e2e/v2-full-9-stage-flow.spec.ts`).

## A quick word on terms used in this doc

- **Chat input box** — the text field at the very bottom of the page where you type your message to the chatbot. Same field every chat app has at the bottom.
- **Send button** — the button next to (or just below) the chat input box.
- **Chat message bubble** — one speech-bubble-shaped chunk of conversation, either yours (typed by you) or the assistant's (the chatbot's reply).
- **Vehicle card** — a non-bubble panel that the chatbot shows inline (in the conversation) with structured data like year/make/model.
- **Popup form** — a form that opens below the chat input box. Used for the condition photo uploader, the payoff form, the scheduler, the payment method picker, and the contract checkbox. They open one at a time when the chatbot needs you to do something visual.
- **Right sidebar** — the panel on the right side of the page (or below the chat on a narrow window) that summarizes everything captured so far. The codebase calls this "SellWorkspace"; you'll just see seven sections each with a "Not started" or "Complete" pill.
- **Test data** — real plate `XRJ4041` (Texas) which resolves to a 2021 Toyota Highlander, real VIN `JTEEW21A060032314`, and five real HEIC photos at `/Users/scottlydon/Desktop/Clutter/iOS/carvana-onboarding/test-plates/IMG_6910.HEIC` through `IMG_6914.HEIC`.

---

## Pre-flight (do once, takes ~30 seconds)

1. Open **https://carvana-onboarding.onrender.com** in Chrome or Safari.
2. Wait for the page to render. The greeting should appear within 2-3 seconds on a warm server, up to ~30 seconds if the server had spun itself down (Render's free tier sleeps after idle).
3. **You should see:** A chat with one assistant message starting "Hi — I'm here to help you sell your car." A text field below the message with the placeholder `Type your plate and state, like "XRJ4041 in Texas"`. Two buttons under the text field: a green **"Scan VIN with camera"** button and a **"Send"** button.
4. **If you see "Demo warming up" or "configuration_missing":** the Render dashboard environment variables (`ANTHROPIC_API_KEY`, `CARSXE_API_KEY`) got dropped on a redeploy. Go to https://dashboard.render.com → carvana-onboarding service → **Environment** tab → confirm both variables are present with values. Save → click **Manual Deploy** in the top right. Retry the URL once the deploy finishes.

---

## Stage 1 — Greeting

1. Page loads.
2. **You should see:** One assistant message visible. The chat input box is focused (ready to type). The right sidebar is **hidden** — it appears only after you've completed at least one stage. This is intentional: an empty sidebar would clutter the first impression.

**Pass:** Greeting visible, no right sidebar yet, no red errors in the browser tab.

---

## Stage 2 — Vehicle lookup (you describe your car in plain English)

1. Click into the chat input box at the bottom.
2. **Type exactly:** `my plate is XRJ4041 in Texas`
3. Click **Send** (or press Enter).
4. **Within 3 seconds you should see:**
   - Your message bubble appears with what you typed.
   - The assistant bubble appears showing three small typing dots (just dots, no progress bar).
   - A **vehicle card** appears in the conversation with: year `2021`, make `Toyota`, model `Highlander`, body `SUV`, and a small label like `via carsxe (~500ms)`.
   - The assistant's text says something like "Great — I found your 2021 Toyota Highlander. The vehicle details are on the right." The assistant will NOT repeat your plate number in its text. This is on purpose (no personal data in the AI's prose).
   - **The right sidebar appears** with a Vehicle section showing a green "Complete" tag and "2021 Toyota Highlander".

**Pass:** Vehicle card shows up, your plate is NOT inside the assistant's text reply, right sidebar shows Vehicle as Complete.

---

## Stage 3 — Condition assessment (photos do most of the work)

1. Immediately after the vehicle card, the assistant says something like "Now let's assess the condition" and a **photo uploader form** opens below the chat input box with **9 photo slots** labeled: front-left, front-right, rear-left, rear-right, odometer, interior, VIN plate, damage closeup 1, damage closeup 2.
2. Click the **"Front left"** slot. Your Mac's file picker opens.
3. Navigate to `/Users/scottlydon/Desktop/Clutter/iOS/carvana-onboarding/test-plates/` and pick `IMG_6910.HEIC`. (HEIC is fine — the server converts it.)
4. **You should see:** the slot fills with a thumbnail of the photo within 1-2 seconds.
5. Repeat with **"Front right"** (`IMG_6911.HEIC`) and **"Odometer"** (`IMG_6912.HEIC`).
6. (Optional) Add `IMG_6913.HEIC` and `IMG_6914.HEIC` to any other two slots. Minimum is 3 photos, maximum is 12.
7. Click **"Submit photos"** at the bottom of the uploader form.
8. **Within 10-20 seconds (the AI is looking at all your photos in one pass):**
   - The uploader shows typing dots, then closes.
   - A new message appears that looks like it came from you: `Condition assessment: extracted mileage 47000; 0 damage finding(s); suggested tier Good` (your numbers may differ).
   - The assistant either confirms the suggested condition tier or asks **at most 4** follow-up questions in plain English (things like "Any check-engine light on?", "Any unrepaired accidents in the last 3 years?", "Tire age?", "Any modifications?"). Count them — more than 4 is a regression.
   - Right sidebar: Condition section now shows "Complete" with the mileage and tier.
9. Answer each follow-up the chatbot asks. Type plain English ("no accidents", "no warning lights", "tires are about a year old"). Press Enter after each.

**Pass:** Photos uploaded, the AI extracted a mileage number (not "unknown"), suggested tier is one of `Excellent / Good / Fair / Rough`, at most 4 follow-up questions, right sidebar shows Condition as Complete.

**Worth knowing:** If your photos don't include a clearly-readable odometer, the chatbot will explicitly ask you for the mileage in chat. That's correct — the system requires high confidence on the vision read before trusting it.

---

## Stage 4 — Loan / payoff

1. After follow-ups are done, the assistant asks: **"Do you still have a loan on this car?"**
2. **For the no-loan path:** type `no` and Send.
   - **You should see:** Assistant says the title is clean and moves on to Stage 5.
   - Right sidebar: Title & Loan section now shows "No lien".
3. **For the yes-loan path** (test this on a SECOND walk-through; refresh the page to start over): type `yes` and Send.
   - **Within 1-2 seconds:** a **payoff form** opens below the chat input box with two fields: **Lender** and **10-day payoff amount (USD)**.
   - Type lender: `Chase Auto`. Type payoff amount: `12500`. Click **Save**.
   - A new chat message appears (formatted like it came from you): `Loan payoff recorded: $12,500 owed to Chase Auto`.
   - Right sidebar: Title & Loan section shows "Chase Auto · $12,500".

**Pass for either path:** Right sidebar's Title & Loan section matches what you answered.

---

## Stage 5 — Instant offer (the dollar amount you can audit on the spot)

1. The assistant generates the offer automatically once it has the year, make, model, mileage, condition, and loan answer.
2. **Within 1-2 seconds (this part has no AI — it's a plain calculation):**
   - An **offer card** appears in the conversation with a dollar amount at the top (for example, `$9,500` for a 2021 Highlander at 47k miles, Good condition, no loan — this is the exact output of our formula version `2026-05-24.v1`).
   - Below the headline number, you should see a **line-itemed breakdown** with at least 4 rows:
     - `2021 Toyota Highlander — base (Mainstream)` with the depreciated base value and a one-sentence explanation
     - `Mileage adjustment (X mi vs expected Y mi)` with a positive or negative number
     - `Condition: Good (×1.00)` (or whichever tier)
     - `Rounded to nearest $50`
     - If you have a loan: an extra row `Loan payoff (subtracted from gross)`
   - Footer text says "Offer valid for 7 days or 1,000 miles, whichever first."
   - Right sidebar: Instant Offer section shows Complete with the dollar amount.
3. **Anxiety-card test (the system catches when you sound unsure):** Reply to the assistant with: `is that really all? feels low`.
   - **You should see:** the chatbot shows a pre-written **support card** titled something like "Offer Drop Anxiety" with a short body (60-80 words) explaining the offer-adjustment policy. The body is the exact text from our content file — the chatbot is NOT writing this paragraph itself, it's pulling a pre-written one so the facts can't drift.

**Pass:** Offer card shows the line-itemed breakdown. The anxiety reply triggers a pre-written support card (not a freshly-written paragraph from the chatbot).

---

## Stage 6 — Pickup scheduling

1. Type: `let's lock it in and schedule pickup`
2. **You should see:**
   - A **scheduler form** opens below the chat input box with a weekly grid of the next 14 days, 8 slots per day (9 AM to 5 PM).
   - Each slot is clickable. Slots already booked by someone else are grayed out.
3. Pick any open slot (for example, next Saturday at 10:00 AM).
4. An address field appears below the grid. Type: `1234 Main St, Austin TX 78701`.
5. Click **Confirm pickup**.
6. **Within 1-2 seconds:**
   - A new chat message appears (formatted like it came from you): `Pickup booked: Sat Jun 6 10:00 AM at 1234 Main St, Austin TX 78701` (your date and address).
   - Assistant acknowledges warmly.
   - Right sidebar: Pickup section shows Complete.

**Pass:** Slot booked, no double-book error, right sidebar reflects the booking.

**Concurrency check (optional, takes ~30 seconds):** Open the same deployed URL in a SECOND private/incognito browser window AT THE SAME TIME. Walk both windows through Stages 2-5 and on both try to book the EXACT SAME slot at Stage 6. **You should see:** exactly one window succeeds. The other shows "that slot just got taken, here are alternatives." This proves the booking is atomic at the database layer.

---

## Stage 7 — Payment method

1. The assistant opens the payment picker automatically.
2. **You should see:** a **payment method form** with **3 radio button cards**:
   - **ACH (direct deposit, 1-2 business days)** — should NOT be pre-selected
   - **Check at pickup** — should NOT be pre-selected
   - **Trade-in credit (toward a Carvana purchase)** — should NOT be pre-selected
3. Pick **ACH**. Click **Confirm**.
4. **You should see:** New chat message `Payment method selected: ach`. Assistant briefly acknowledges. Right sidebar: Payment section shows Complete with "ACH".

**Pass:** None of the three options was pre-selected for you (a pre-checked default would be the same kind of dark pattern Carvana uses on the buy side for SMS marketing), and the option you picked landed in the right sidebar.

---

## Stage 8 — Contract acknowledgement (the marquee simplification)

1. The assistant opens the contract page automatically.
2. **You should see:** a **contract form** with **three legal disclosures in plain English** stacked vertically:
   - **Limited Power of Attorney** (lets Carvana sign DMV paperwork on your behalf)
   - **Bill of Sale** (records the transfer)
   - **Federal Odometer Disclosure** (legally required for any car sale)
   - **One single checkbox** at the bottom: "I have read and agree to all three of the above."
3. Read the disclosures (they're short on purpose). Check the box. Click **Acknowledge**.
4. **Within 1-2 seconds:**
   - New chat message: `Contract acknowledged at 2026-05-24T23:55:12.789Z` (your timestamp).
   - Right sidebar: Contract section shows Complete.
   - Assistant moves to the wrap-up.

**Pass:** ONE checkbox covered ALL THREE legal documents. (This is the big revolutionary simplification compared to Carvana's real flow, which makes you go through three separate signing screens.) The Acknowledge button stays disabled until you check the box.

---

## Stage 9 — Wrap-up + rating

1. Assistant thanks you and reiterates when payment arrives based on the method you picked ("Your direct deposit will arrive 1-2 business days after pickup" for ACH).
2. **You should see:**
   - A **rating widget** appears in the conversation asking "How likely are you to recommend this onboarding to a friend, 1-5?".
   - Pick a score. A free-text "what's the one thing that would make this better?" field appears.
   - Type something brief and click **Submit**.
3. **Total time check:** Compare the timestamp on your first user message to the rating submit. The spec target is **under 15 minutes for a motivated user**. Realistic on this test is 3-6 minutes if you don't get stuck on the photos.

**Pass:** Rating widget appears, free text accepted, total time under 15 minutes.

---

## Side flows (do each on a fresh page load)

### Side flow A — Camera scan rescue when a plate doesn't resolve

1. Refresh the page. Type: `my plate is FAKEPLT in California` (this plate will miss in our vendor's data).
2. **You should see:** the assistant returns an HONEST message — something like "Our partner data missed this plate — that's on us, not you. Want to try scanning the VIN sticker with your camera?"
3. The message must NOT contain "check your entry", "invalid plate", or "please try again" with no context. Those are blame-the-user phrasings (the exact failure mode Carvana exhibits at this step).
4. Click the green **"Scan VIN with camera"** button (it's below the chat input box).
5. **You should see:** Your browser asks for camera permission. Just below the button, a status line appears: `Camera permission requested — accept the browser prompt to scan.`
6. Click **Block** in the browser permission popup (we're testing the denied path). **You should see:** the status line replaces itself with `Camera permission denied`. No silent failure.
7. **Alternative path:** Click the **"or upload a photo"** link next to the camera button. **You should see** a hint: `Pick a VIN photo from your library — drag and drop also works.` Pick `/Users/scottlydon/Desktop/Clutter/iOS/carvana-onboarding/tests/fixtures/vin-sticker-test.png`. The system extracts a VIN, posts a new chat message `Scanned VIN: <17 chars>`, and the chatbot looks the VIN up automatically.

**Pass:** Honest message on the miss (no blame-the-user phrasing), camera permission shows visible status changes (no silent fail), file-upload alternative works end-to-end.

### Side flow B — Form-state preservation when the network blips

1. Refresh. Open the browser's developer tools (Cmd+Option+I in Chrome, Cmd+Option+I in Safari after enabling the Develop menu). Go to the **Network** tab. Find the dropdown that says "No throttling" and change it to **Offline**.
2. Type: `my plate is XRJ4041 in Texas`. Send.
3. **You should see:** the assistant returns the transient-error path. Your message is still visible in the chat. The assistant explicitly says something like "we're having trouble reaching our vehicle data right now — that's on our side, not yours." No silent reset. No erasing.
4. Switch the throttling dropdown back to **No throttling**. Type: `try again`.
5. **You should see:** lookup succeeds, vehicle resolves.

**Pass:** Your chat history is intact after the error, the assistant explicitly names that the error was on the system's side, and the retry works.

### Side flow C — Personal data does not leak into the AI's prose

1. Walk the happy path through Stage 2 (until the vehicle resolves).
2. In the developer tools **Network** tab, click on the `/api/chat` request (the most recent one). On the right side, click the **Response** sub-tab. You'll see a long text stream.
3. Press Cmd+F inside that response panel and search for the literal string `XRJ4041`.
4. **You should see:** `XRJ4041` appears ONLY inside structured blocks labeled `tool_use` (the AI calling a tool) and `tool_result` (the tool returning data). It must NOT appear inside any block labeled `text_delta` (the AI's spoken prose).

**Pass:** No plate, VIN, driver-license number, or address appears inside the AI's prose stream. (This is the system's non-negotiable rule #1 — personal data flows through tools, not through the AI's text.)

### Side flow D — Narrow window layout indicator

1. In the developer tools, click the device-toolbar button (top-left of the developer panel, looks like a phone/tablet icon). Set the size to **375 × 812** (iPhone 13).
2. Refresh the page.
3. **You should see:** the chat takes up most of the narrow width, AND the chat header visibly appends the text "· compact mobile layout" so the layout-mode change is observable.
4. Turn the device toolbar off (or pick a wider preset like "Responsive" at 1280px). **You should see:** the "· compact mobile layout" text disappears.

**Pass:** Layout adapts AND the indicator text is present at narrow widths, absent at wide widths.

### Side flow E — Empty-message guard

1. With the chat input box empty, click **Send**.
2. **You should see:** an inline alert appears with the exact text "Type a message before sending."
3. Start typing in the input box — the alert auto-clears. No request was sent to the AI. The input box text is not cleared.

**Pass:** The guard appears with the exact copy, no chat request fires, your in-progress text survives.

---

## Issues found (note them here as you go)

For each issue, capture:
- **Where:** the stage number and the specific click
- **What you did:** the input you typed / the slot you picked
- **What happened:** what the page actually did
- **What you expected:** the line from this doc

Example shape so I can copy it straight into a chat reply and turn it into a new test case:

> **Stage 3, photo upload.** Uploaded `IMG_6910.HEIC` to the "Front left" slot. The thumbnail showed as a broken-image icon for ~10 seconds before resolving. Expected: thumbnail within 1-2 seconds.

---

## When you're done

Tell me which stages passed and which (if any) failed. If everything passed, I'll run the final QA sweep (the Slice F-Flow follow-up task F.18) and declare ready-to-ship. If something failed, I'll fix it and add a regression test so it can't fail the same way twice.
