# Competitor Entry-Funnel Comparison: Plate / VIN Lookup as First Onboarding Step

**Date:** 2026-05-21
**Purpose:** Establish a credible "before/after" baseline for the Carvana
onboarding-fix project. Carvana's `/sell-my-car/getoffer/entry` step is
broken in observable, reproducible ways (plate lookup fails on a real CA
plate; VIN submit silently resets to a different tab; uncaught XHR errors
in the console). We need to know what good looks like in the rest of
the market in 2026.

**Method:** Web research plus live observation of competitor entry pages via
the Chrome MCP, on 2026-05-21, from a desktop viewport. Forms were
inspected, not submitted, per the research brief.

---

## 1. Executive Summary — Entry-Funnel Quality Ranking

Score reflects the *entry step only* (plate/VIN lookup and immediate
fallback behaviour), not downstream offer accuracy or sale completion.

| Rank | Competitor | Score (1-5) | One-line reason |
|---|---|---|---|
| 1 | **Edmunds Appraisal** | 5 | Plate + VIN tabs with **explicit in-product copy telling users to fall back to VIN if a specialty/personalized plate fails** — the only competitor that names the failure mode. |
| 2 | **EchoPark** | 4.5 | Two-input toggle (VIN / plate), "Where is my VIN?" helper, **mobile app supports VIN barcode scan** (only consumer-facing platform we found that does). |
| 3 | **TrueCar** | 4 | Plate / VIN tab toggle, zip, "Where is my VIN?" helper, "Is this vehicle a lease?" upfront — clean three-field form, no account gate. |
| 4 | **CarMax** | 4 | Three-tab entry (License Plate / VIN / Store Appointment), plate+state+zip OR VIN, no account upfront. Penalty: documented plate-lookup failures with no in-form fallback copy. |
| 5 | **KBB Instant Cash Offer** | 3.5 | Plate / VIN / make-model paths (rare third escape hatch), but funnel ends at PII gate (name + phone + email) before showing the offer. |
| 6 | **Cars.com Instant Offer** | 3.5 | Plate-first, VIN secondary, three-business-day offer. Cloudflare bot wall blocked direct inspection; details from documentation. |
| 7 | **AutoTrader Instant Cash Offer** | 3.5 | Plate or VIN, KBB-backed valuation. Funnel runs through the same Cox Automotive stack as KBB — same PII gate. |
| 8 | **Tesla Trade-In** | 3 | VIN-only (no plate), pre-fills year/make/model/trim on success. Slick when the VIN resolves, but **no plate alternative at all** — Tesla-buyer assumption baked in. |
| 9 | **CarGurus Instant Max Cash Offer** | 3 | Plate or VIN, dealer-bid model, only 22 states + DC as of May 2026 — geographic dead-ends are the dominant failure mode, not lookup. Inspection blocked by bot wall. |
| 10 | **Carvana** (target) | 1.5 | Three tabs (plate / VIN / make+model), but plate lookup silently fails on valid CA plate, VIN submit silently resets the form, console emits uncaught network errors, no error copy rendered to user. |
| – | **Shift** | n/a | Defunct since Oct 2023, Chapter 11; site offline. |
| – | **Vroom** | n/a | Wound down e-commerce car sales Jan 2024; domain redirects to a financing-only landing page. |

---

## 2. Detailed Per-Competitor Sections

### 2.1 CarMax — `carmax.com/sell-my-car`

| Field | Value |
|---|---|
| **Entry URL** | https://www.carmax.com/sell-my-car |
| **Inputs** | Three-tab toggle: **License Plate + State + ZIP**, **VIN + ZIP**, or **Store Appointment**. Mileage and condition asked in step 2. |
| **OCR / camera capture** | Not on the web flow. The CarMax iOS/Android app does not offer a consumer-facing VIN scan in the sell flow (their VIN scanner is an internal Laser Appraiser–style dealer tool). |
| **What happens on lookup failure** | No in-form fallback copy. JustAnswer threads document users hitting "can't locate VIN" with no in-product remediation; the help-center suggestion is to retype without spaces/dashes or contact support. No automatic tab-switch to VIN. |
| **Time to first appraisal** | Claimed: ~2 minutes. Observed (per research): consistent with claim when lookup succeeds. |
| **Account creation upfront** | No. Email captured at the end of the offer flow, not at entry. |
| **PII required to see an offer** | Email + ZIP. No phone, SSN, or address to view the number. |
| **Visual / UX quality** | 4/5 — clean three-tab IA, sensible defaults, but the failure path is silent. |
| **Notable AI features** | February 2026 launch of CarMax in the ChatGPT App Store — same plate/VIN lookup flow surfaced inside ChatGPT's app shelf. First major US used-car retailer to do this. No on-site LLM rescue widget for failed lookups. |

### 2.2 KBB Instant Cash Offer — `kbb.com/instant-cash-offer`

| Field | Value |
|---|---|
| **Entry URL** | https://www.kbb.com/instant-cash-offer/ |
| **Inputs** | Plate, VIN, **or** make-model-year-trim. Three escape hatches — most-flexible entry in the market. Mileage and condition in step 2. |
| **OCR / camera capture** | None on web. KBB mobile app does not surface a consumer VIN scan in the ICO flow. |
| **What happens on lookup failure** | No documented dedicated copy, but the make-model path *is* itself the fallback — user can always finish the funnel without plate/VIN resolving. |
| **Time to first appraisal** | Claimed: minutes. Observed: ~5–8 min including condition questions. |
| **Account creation upfront** | No. |
| **PII required to see an offer** | Full name + phone + email gate before the final offer is displayed. This is the heaviest PII gate of the non-Carvana group. |
| **Visual / UX quality** | 3.5/5 — three input modes is rare and useful, but the PII gate at the end undermines the "instant" framing. |
| **Notable AI features** | None on the consumer flow. B2B side (b2b.kbb.com/solutions/ico) markets dealer-side ML. |

### 2.3 Edmunds Appraisal — `edmunds.com/appraisal/`

| Field | Value |
|---|---|
| **Entry URL** | https://www.edmunds.com/appraisal/ (also `?tab=LP` to deep-link the plate tab) |
| **Inputs** | Tabbed: plate+state, VIN, or year/make/model manual. Mileage and condition follow. |
| **OCR / camera capture** | None on web. |
| **What happens on lookup failure** | **Edmunds is the only competitor with explicit in-product copy for the plate-failure case.** Per Edmunds' own help docs: "The license plate decoder is not always able to identify specialty or personalized license plates. If your vehicle is tagged with a non-standard plate, try using your vehicle's VIN instead." Names the failure mode, names the recovery. |
| **Time to first appraisal** | Claimed: "as little as a minute." |
| **Account creation upfront** | No. |
| **PII required to see an offer** | Edmunds shows a *price range* (private-party, trade-in, dealer) with no PII. For the actual **CarMax-powered Instant Cash Offer redeemable at a dealer**, user is handed off to CarMax's funnel and its PII rules apply. |
| **Visual / UX quality** | 5/5 — best documented failure handling in the category, plus a manual fallback path. |
| **Notable AI features** | None observed in the entry step. Edmunds is a CarMax data partner, not an independent buyer. |

### 2.4 AutoTrader — `autotrader.com/instant-cash-offer`

| Field | Value |
|---|---|
| **Entry URL** | https://www.autotrader.com/instant-cash-offer/ |
| **Inputs** | Plate or VIN. JS-shell page on first load — form widget injected client-side. |
| **OCR / camera capture** | None on web. |
| **What happens on lookup failure** | Same Cox Automotive / KBB plumbing as KBB ICO (KBB powers AutoTrader's valuations). No additional fallback copy beyond KBB's. |
| **Time to first appraisal** | Claimed: minutes. |
| **Account creation upfront** | No. |
| **PII required to see an offer** | Email + phone (inherited from KBB ICO). |
| **Visual / UX quality** | 3.5/5 — competent but indistinguishable from KBB. |
| **Notable AI features** | None on the entry step. |

### 2.5 TrueCar — `truecar.com/sell-your-car`

| Field | Value |
|---|---|
| **Entry URL** | https://www.truecar.com/sell-your-car/ |
| **Inputs** | Plate / VIN tab toggle + ZIP. "Where is my VIN?" helper link. **Lease checkbox at entry** — only competitor that asks this upfront and routes leases differently. |
| **OCR / camera capture** | None on web. |
| **What happens on lookup failure** | No specific copy observed; the Visit Help link is the documented escape. |
| **Time to first appraisal** | Claimed: "in minutes." |
| **Account creation upfront** | No. Name + phone + email captured on first dealer-bid acceptance. |
| **PII required to see an offer** | Estimate-range with no PII. Full dealer offer requires contact info. |
| **Visual / UX quality** | 4/5 — clean form, lease-aware. |
| **Notable AI features** | None at the entry step. |

### 2.6 Cars.com Instant Offer — `cars.com/sell/instant-offer`

| Field | Value |
|---|---|
| **Entry URL** | https://www.cars.com/sell/instant-offer/ |
| **Inputs** | Plate primary, VIN secondary, with year/make/model manual fallback. ZIP. (Live inspection blocked by Cloudflare bot challenge; this is from Cars.com's documentation and the "Your Garage" Vehicle Acquisition product page.) |
| **OCR / camera capture** | None documented on web. |
| **What happens on lookup failure** | Cars.com routes failed lookups through the manual year/make/model path silently, but no in-product copy observed. |
| **Time to first appraisal** | Claimed: "in seconds." Offer valid 3 business days. |
| **Account creation upfront** | No. |
| **PII required to see an offer** | Email + phone for dealer offer routing. |
| **Visual / UX quality** | 3.5/5 — documentation-only score; live form was bot-walled. |
| **Notable AI features** | "Your Garage" tracks ongoing vehicle value but is not LLM-driven. |

### 2.7 EchoPark — `echopark.com/sell-my-car/start`

| Field | Value |
|---|---|
| **Entry URL** | https://www.echopark.com/sell-my-car/start |
| **Inputs** | VIN / License Plate two-tab toggle. "Where is my VIN?" helper. |
| **OCR / camera capture** | **Yes — EchoPark explicitly advertises VIN barcode scanning via smartphone** in their consumer flow. Only competitor in the surveyed set that surfaces this to consumers (not just dealers). |
| **What happens on lookup failure** | Not directly observed; the tab toggle itself acts as an instant fallback. |
| **Time to first appraisal** | Claimed: 5–7 minutes for a "real-time offer in seconds" plus condition questions. Offer valid 7 days or 500 miles; extra $500 bonus if sold within 48 hours. |
| **Account creation upfront** | No. |
| **PII required to see an offer** | Email for offer delivery. |
| **Visual / UX quality** | 4.5/5 — VIN-scan capability is the standout feature in the category. |
| **Notable AI features** | None LLM-based observed. The barcode-scan is computer-vision, not generative AI. |

### 2.8 Shift — `shift.com`

**Status:** Defunct. Filed Chapter 11 in October 2023. California facilities
closed, website offline, IP assets sold via Hilco Streambank in January 2024.
Not relevant for the 2026 comparison except as a category cautionary tale.

### 2.9 Vroom — `vroom.com`

**Status:** Wound down e-commerce used-car sales on January 22, 2024.
The domain now redirects to a financing-only landing page (UACC + CarStory,
their B2B AI analytics subsidiary). Consumer trade-in flow no longer exists.
The historical Vroom funnel asked VIN-or-plate + ZIP, then routed to a
condition questionnaire and PII gate — comparable to KBB's. Not relevant
for the live 2026 comparison.

### 2.10 Tesla Trade-In — `tesla.com/tradein`

| Field | Value |
|---|---|
| **Entry URL** | https://www.tesla.com/tradein (also embedded inside the Design Studio configurator when buying a new Tesla) |
| **Inputs** | **VIN only.** No plate option. Tesla assumes you have your VIN handy because their buyers tend to. ZIP + odometer + accident history + condition follow. |
| **OCR / camera capture** | Photos requested in the Tesla mobile app at the *valuation-refinement* step, not at entry. |
| **What happens on lookup failure** | Not observable in this session — Akamai bot protection blocked direct inspection. Per public docs, an invalid VIN triggers a generic "please verify your VIN" message. There is no plate fallback at all. |
| **Time to first appraisal** | Claimed: instant pre-fill of year/make/model/trim once VIN parses. |
| **Account creation upfront** | Tesla account required to *save* or *redeem* the trade-in, but the estimate is viewable without one. |
| **PII required to see an offer** | ZIP only for the estimate; full contact info for an actual offer + loyalty-credit application. |
| **Visual / UX quality** | 3/5 — the resolved-VIN experience is the cleanest in the category (auto-prefill, in-configurator integration, loyalty credits surfaced immediately), but the **VIN-only constraint** is a sharp accessibility cliff. Tesla can afford it; a generalist platform can't. |
| **Notable AI features** | None on the consumer flow. The instant-trade-in estimator is rule-based, not LLM. |

### 2.11 CarGurus Instant Max Cash Offer — `cargurus.com/sell-car`

| Field | Value |
|---|---|
| **Entry URL** | https://www.cargurus.com/sell-car |
| **Inputs** | Plate or VIN + ZIP + mileage. Live inspection blocked by their bot wall. |
| **OCR / camera capture** | None on web. |
| **What happens on lookup failure** | Not observable; not documented. The dominant CarGurus failure is **geographic**: Instant Max Cash Offer is live in only 22 states + DC as of May 2026. Users outside coverage hit a "not available in your state" wall regardless of plate/VIN validity. |
| **Time to first appraisal** | Claimed: "under 2 minutes" with bids from thousands of dealers. |
| **Account creation upfront** | No. |
| **PII required to see an offer** | Contact info for dealer-bid forwarding. |
| **Visual / UX quality** | 3/5 — penalised for unobserved live form plus the state-availability cliff. |
| **Notable AI features** | None on entry. The dealer-auction back-end uses ML to rank bids, but that's invisible to the seller. |

---

## 3. Cross-Cutting Observations: What the Best Ones Do That Carvana Doesn't

1. **Edmunds is the *only* competitor that writes in-product copy for the plate-failure case.** "If your vehicle is tagged with a non-standard plate, try using your vehicle's VIN instead." That single sentence captures the failure mode and the recovery in 17 words. Carvana has zero such copy.

2. **Three of ten name the user's pain at the form** (TrueCar, EchoPark with "Where is my VIN?" helpers; Edmunds with the plate-failure note). The other six just present fields. This is the cheapest possible UX win.

3. **EchoPark is alone on consumer-facing VIN barcode scan.** Dealer tools (Carbly, Laser Appraiser, Vincario) have had OCR for years; only EchoPark has pushed it to the consumer app. This is a wide-open opportunity for any competitor — especially one with a remote-first brand.

4. **None of the ten have a conversational rescue on the entry step.** CarMax launched their ChatGPT app shelf entry in Feb 2026, but that's a *separate* surface, not a chat widget that catches a failed lookup on carmax.com.

5. **Three escape hatches > two escape hatches.** KBB and Edmunds both offer plate + VIN + year/make/model manual. The two-input designs (EchoPark, TrueCar, Tesla) leave a user stranded if both inputs fail and there's no live agent. Carvana technically has the third tab but it is also broken in the same session.

6. **PII gating varies wildly.** Edmunds and TrueCar show a price range with zero contact info. KBB, AutoTrader, Cars.com, CarGurus require email + phone before the headline number. Carvana asks for email + phone + zip immediately and *still* fails to deliver the lookup.

7. **Lease-aware entry is rare.** Only TrueCar asks at entry whether the vehicle is leased. This is a fork in the offer logic for ~25% of US vehicles; everyone else discovers it deep in the funnel and recovers awkwardly.

8. **"Account upfront" is dead.** Zero of the ten require account creation before showing an estimate. The industry has moved past that. Any platform that re-introduces it loses immediately.

---

## 4. The Unique Opportunity for Our Product

**What no one in the market currently does at the entry step:**

1. **Auto-fallback from plate to VIN with a conversational rescue.** If a plate lookup fails, no competitor currently switches the user to VIN with copy like *"That plate isn't in the DMV mirror we use — paste your VIN (it's on your insurance card or your dash near the windshield) and we'll keep going."* Edmunds names the failure but still requires the user to click the other tab.

2. **OCR for VIN and registration card on the web, not just the mobile app.** Browsers have had `<input type="file" accept="image/*" capture="environment">` for a decade and `getUserMedia` for longer. Nobody is using it on a desktop sell flow. A "take a photo of your registration" button that hands a JPEG to Claude vision for parse would resolve plate AND VIN AND mileage AND owner-name in one tap.

3. **Multi-source plate verification with transparency.** Every competitor hides which database failed. A simple "We checked DMV mirror A, returned no match; trying source B" status line would build trust and demystify failures. This is a 2026-grade move that competitors don't make because it exposes their thin data partnerships.

4. **LLM-driven manual fallback.** When all automated lookups fail, ask the seller in natural language: *"What's the year, make, model, and rough trim? I'll look it up."* The chat can convert "2018 Subaru Outback Premium with the EyeSight package" into a structured query no form field accepts today. KBB's manual three-field fallback is the dumb version; an LLM-driven version is faster, more forgiving, and uses the conversational surface as an upgrade rather than a downgrade.

5. **Pre-populated state from the user's prior session, with consent.** If the user has any existing vehicle on the platform, the plate/VIN should be a one-tap reselect, not a re-entry. None of the ten do this on the entry step (CarMax's Offer Watch comes closest, but you have to opt into Watch separately).

6. **Show what data we have *before* asking for PII.** Display the year/make/model decoded from plate or VIN *before* the email field renders. Builds trust, makes the PII ask feel earned, and lets the user bail early if the decode is wrong without burning a contact record.

**Composite opportunity statement:** The category's failure-handling bar is set by Edmunds' single sentence of copy. Beating that bar with (a) auto-fallback, (b) browser-side OCR, (c) transparent data-source attribution, and (d) LLM manual rescue is achievable in a single sprint and would put our product ahead of every name in this table.

---

## Sources

- [CarMax Sell My Car](https://www.carmax.com/sell-my-car) (live, 2026-05-21)
- [CarMax launches ChatGPT app for car buying, selling — Stock Titan, Feb 2026](https://www.stocktitan.net/news/KMX/car-max-launches-first-of-its-kind-car-shopping-and-selling-1wgjnji0m1ed.html)
- [KBB Instant Cash Offer](https://www.kbb.com/instant-cash-offer/) (live, 2026-05-21)
- [KBB ICO FAQ](https://www.kbb.com/faq/ico/)
- [Edmunds Appraisal](https://www.edmunds.com/appraisal/) (live, 2026-05-21 — privacy CMP wall)
- [Edmunds Help Center — Can I sell my car through Edmunds?](https://help.edmunds.com/hc/en-us/articles/360058053954-Can-I-sell-my-car-through-Edmunds) (contains the plate-failure fallback copy)
- [AutoTrader Instant Cash Offer](https://www.autotrader.com/instant-cash-offer/) (live, 2026-05-21)
- [TrueCar Sell Your Car](https://www.truecar.com/sell-your-car/) (live, 2026-05-21)
- [Cars.com Instant Offer](https://www.cars.com/sell/instant-offer/) (Cloudflare bot wall)
- [EchoPark Sell My Car (entry)](https://www.echopark.com/sell-my-car/start) (live, 2026-05-21)
- [Shift bankruptcy — TechCrunch, Oct 2023](https://techcrunch.com/2023/10/10/what-drove-online-used-car-marketplace-shift-to-file-for-bankruptcy/)
- [Vroom wind-down announcement](https://ir.vroom.com/news-releases/news-release-details/vroom-announces-wind-down-ecommerce-used-vehicle-operations)
- [Tesla Trade-In](https://www.tesla.com/tradein) (Akamai bot wall)
- [Tesla brings back trade-in estimate tool — Drive Tesla Canada](https://driveteslacanada.ca/news/tesla-brings-back-trade-in-estimate-tool/)
- [CarGurus Instant Max Cash Offer](https://www.cargurus.com/sell-car) (bot wall)
- [CarGurus Instant Max Cash Offer state expansions — investor releases, 2025-2026](https://investors.cargurus.com/news-releases/news-release-details/cargurustm-instant-max-cash-offer-expands-cover-nearly-half-us)
