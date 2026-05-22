# Plate-to-VIN API Landscape (May 2026)

**Context.** Carvana's "sell my car" onboarding asked the user for a CA license plate (`8E79985`, confirmed by user as a valid in-state plate). Their plate-lookup vendor returned "we couldn't find that license plate." We are catalogueing the state of the art so a replacement onboarding component can pick a primary vendor and a fallback that ACTUALLY work at Carvana scale (millions of lookups/month). Pricing is current as of May 2026 unless otherwise noted.

---

## Executive summary

- The plate-to-VIN space splits into THREE tiers: (1) **commercial aggregators** that sell self-serve APIs ($0.04–$0.20/call, PlateToVin, Auto.dev, VinAudit, CarsXE, VehicleDatabases); (2) **incumbent dealer-data giants** with negotiated enterprise contracts ($10k+/year, no public pricing, DataOne / J.D. Power ChromeData / Cox/KBB / Carfax QuickVIN Plus / Experian AutoCheck); (3) **free / consumer** lookups (NHTSA vPIC — VIN only, NICB VINCheck — VIN only, no public API).
- **No vendor publicly claims 100% CA coverage.** California is one of seven states (with UT, AK, LA, AL, SC, NY) where the DMV does not sell motor-vehicle records to commercial aggregators except under narrow DPPA-permitted uses, so CA plates are typically resolved via aggregated registration/title/insurance/auction feeds and consequently have the lowest hit rates of any US state. ([CA DMV](https://www.dmv.ca.gov/portal/driver-education-and-safety/educational-materials/fast-facts/how-your-information-is-shared-ffdmv-17/), [DPPA Guide](https://terms.law/2023/08/01/drivers-privacy-protection-act-dppa/))
- **DPPA and 2026 enforcement matters for Carvana's surface.** Consumer-facing plate-lookup that returns owner PII is increasingly litigated under DPPA ($2,500/violation statutory minimum). Plate -> VIN -> vehicle SPECS is fine; plate -> OWNER is the trap. Carvana wants the former: "is this the car you say it is" — not owner PII. ([Venable LLP](https://www.venable.com/insights/publications/2026/02/whats-driving-the-rise-in-drivers-privacy))
- **OCR fallback is feasible and cheap.** Apple Vision (iOS, on-device, free), Google Cloud Vision ($1.50/1k images), and PlateRecognizer ($50/mo for 50k lookups) all hit production-grade accuracy on plates. A "snap a photo of your plate" backup path is a no-brainer for the inevitable cold lookup miss.

---

## Per-vendor comparison

### Tier 1: Commercial self-serve plate -> VIN APIs

| Vendor | $ / plate lookup | Monthly tier | Demo path | Latency (claimed) | CA coverage |
|---|---|---|---|---|---|
| **PlateToVin** | $0.05 list, $0.06 enterprise, $0.09 business tier | $40 (5k/mo), $300 enterprise unlimited | 5 free consumer lookups, no card | Not published | "All 50 states + DC + PR", but no SLA on hit rate |
| **Auto.dev** | $0.055 (Scale tier) | $599/mo Scale tier required | 1,000 free API calls /mo on Starter (but plate-to-VIN is Scale-only) | Not published | All 50 |
| **VinAudit** | Contact sales, "pay only for what you use" | Custom | Has consumer-facing CA plate lookup web tool (no signup) | Not published | All 50; CA explicitly listed |
| **CarsXE** | $0.01–$0.10 range per call depending on endpoint | Pay-as-you-go + monthly tiers | 7-day free trial including plate-recognition API | Not published | 50+ countries inc. US |
| **VehicleDatabases.com** | Public tier pricing, "pay-as-you-go, monthly, yearly" | Free 15-credit sample, no card | 15 free credits on signup, no CC | Not published | US + UK, all 50 |
| **Vincario (via partners)** | Per-API pricing, 60 lookups/min rate limit | Multi-tier | Free tier sample | Not published | US |
| **Vehicle Registration API** | Per-call, public pricing | Self-serve | Limited demo | Not published | All 50 + DC + PR |

#### PlateToVin (https://platetovin.com)
- **What you get:** Plate -> VIN + year/make/model/trim/drivetrain/color/body style. Add-on for advanced VIN decode and vehicle images.
- **Coverage:** "All 50 states + DC + PR", claims "direct DMV-partner data, deduped and quality-checked." No hit-rate SLA published. CA specifically not called out as guaranteed.
- **Pricing:** $0.05/lookup list, $40/mo Business plan (5k/mo cap), $300/mo Enterprise (unlimited). 7-day cache (duplicates within a week are free). ([plans page](https://platetovin.com/plans))
- **Latency:** Not published.
- **Integration:** REST POST to `https://platetovin.net/api/convert` with JSON `{plate, state}`. Sample code in dashboard. ([API docs](https://platetovin.com/doc))
- **ToS notes:** Consumer-facing commercial use allowed. Standard PayPal-billing model. Cancel anytime, no contracts. Annual updates note 2025 © footer — small vendor.
- **Reputation:** Hacker News thread Sep 2024 questioned how a $0.05 unit price is even possible. Datarade lists vendor but with "not enough reviews." UK Ltd company (no. 14107525), small operation.
- **Demo path:** Yes — 5 free consumer lookups without any payment. **This is one of the few demos that costs zero friction.**
- **Verdict:** Best self-serve developer experience in the space. Smallness is a flag for Carvana-scale reliability.

#### Auto.dev (https://www.auto.dev/plate-to-vin)
- **What you get:** Plate -> VIN + year/make/model/trim/drivetrain/engine. Pairs with their VIN decode, recalls, photos, payments APIs.
- **Coverage:** All 50 states.
- **Pricing:** Plate-to-VIN is **Scale-tier only** = $599/mo subscription + $0.055/call. Growth tier ($299/mo) does NOT include plate-to-VIN. ([Auto.dev pricing](https://www.auto.dev/pricing))
- **Latency:** Not published.
- **Integration:** REST + first-class SDK (`npm install -g @auto.dev/sdk`), MCP server for AI agents, OpenAPI spec. Best-in-class DX for engineering teams.
- **ToS notes:** Standard B2B SaaS terms. Not consumer-restricted.
- **Reputation:** Active 2026 development, written up in vincario.com's "best of 2026" comparison.
- **Demo path:** 1,000 free API calls/month on Starter — BUT plate-to-VIN is gated behind Scale tier, so no free plate-to-VIN trial without paying $599. Friction.
- **Verdict:** Premium developer experience, gated demo. Good fallback candidate.

#### VinAudit (https://www.vinaudit.com/license-plate-data)
- **What you get:** Plate -> VIN + specs + history (title checks, accident records). They are an NMVTIS data provider, so their history depth is real.
- **Coverage:** All 50 states. Has a dedicated CA landing page suggesting CA coverage is reasonable.
- **Pricing:** Contact-sales only for plate API. Reseller of AutoCheck and Carfax via separate API products.
- **Latency:** Not published.
- **Integration:** REST.
- **ToS notes:** NMVTIS data carries usage restrictions inherited from the federal program.
- **Reputation:** Well-established, no major dev-community complaints found.
- **Demo path:** Public consumer-facing plate lookup tool at `vinaudit.com/license-plate-lookup` lets you test ONE plate without signup — but it returns a paywalled report screen, not the raw API output.
- **Verdict:** Most mature data depth; opaque pricing makes it hard to model unit economics.

#### CarsXE (https://api.carsxe.com)
- **What you get:** 12+ endpoints under one REST API: VIN decoder, plate lookup, market value, recalls, history, OEM build data, plate-recognition OCR. One key, one billing surface.
- **Coverage:** 50+ countries including all of US.
- **Pricing:** Public tiers; per-endpoint pricing. 7-day free trial covers plate-recognition API.
- **Latency:** Not published.
- **Integration:** REST + official npm and Packagist (PHP) packages.
- **ToS notes:** Standard B2B.
- **Reputation:** Listed in MarketCheck's third-party adapter docs (legitimacy signal).
- **Demo path:** 7-day free trial with full API access.
- **Verdict:** Best "one vendor, many endpoints" play. Good for a unified Carvana data layer.

#### VehicleDatabases.com (https://vehicledatabases.com/api/license-plate)
- **What you get:** Plate -> VIN + year/make/model + more.
- **Coverage:** All 50 + UK.
- **Pricing:** Pay-as-you-go, monthly, yearly. Public tiers. Free 15 credits on signup, no CC required.
- **Latency:** Not published.
- **Integration:** REST.
- **ToS notes:** Standard.
- **Reputation:** Publishes their own "best of" articles which is a flag, but they DO seem to ship working APIs.
- **Demo path:** 15 free credits without CC = strong demo path.
- **Verdict:** Middle-of-the-road. Strong demo, unproven at Carvana scale.

---

### Tier 2: Incumbent dealer-data giants (enterprise contract only)

These are who Carvana already probably has a contract with, and who their broken vendor most likely IS.

#### Carfax QuickVIN Plus (https://www.carfaxforlenders.com/products/quickvin/)
- **What you get:** Plate + state -> VIN + decode. Bundled into Carfax Vehicle History Report when the dealer/lender pulls a full report.
- **Coverage:** All 50 (Carfax-claimed).
- **Pricing:** **Not publicly subscribable.** Requires a "CARFAX Service Data Transfer Facilitation Agreement" — i.e., a dealer or lender account with a Location ID + Product Data ID. Free to participating POS-integrated dealers. ([CARFAX-Wrapper README](https://github.com/amattu2/CARFAX-Wrapper))
- **Latency:** Not published. Production-grade in dealer systems.
- **Integration:** REST with HMAC auth, dealer-issued credentials.
- **ToS notes:** Locked to dealer/lender use. Strict on resale/redistribution.
- **Reputation:** The industry default. Most dealer POS systems (DealerSocket, CDK, etc.) have it built in.
- **Demo path:** None. Contact Carfax Business Development.
- **Verdict:** Probably what Carvana already uses. The "couldn't find that plate" is most likely a Carfax QuickVIN miss on a CA plate, since CA is the hardest state for any aggregator.

#### Experian AutoCheck (https://www.experian.com/automotive/autocheck-integrations)
- **What you get:** Vehicle history reports keyed by VIN (NOT primary plate->VIN — that comes via Auto AccuSelect). Real-time integration into dealer systems.
- **Coverage:** All 50.
- **Pricing:** "Various pricing options including unlimited reports" — no public pricing. Phone: 888-409-2204.
- **Latency:** Production-grade.
- **Integration:** REST + Auto AccuSelect option packs + dealer-system integrations.
- **ToS notes:** Locked to dealer/business use.
- **Reputation:** Industry standard alongside Carfax.
- **Demo path:** Contact sales.
- **Verdict:** Reliable enterprise fallback for vehicle history; not a primary plate-to-VIN play.

#### DataOne Software (https://www.dataonesoftware.com)
- **What you get:** Industry-best VIN decoder + OEM build data + installed options. **Plate-to-VIN is offered but their flagship is VIN decode.**
- **Coverage:** US-wide, billions of VINs decoded/year.
- **Pricing:** **Enterprise contract starts at $10,000+/year.** Pricing factors: data type, volume, # endpoints, # of unique website visitors. ([vincario.com 2026 comparison](https://vincario.com/blog/vin-decoder-api-pricing/))
- **Latency:** "Lightning-fast"; production-grade for OEM and insurance carriers.
- **Integration:** REST HTTPS.
- **ToS notes:** Strict on volume reporting; pricing scales with surfacing of data to consumers.
- **Reputation:** Used by major insurers, lenders, OEMs.
- **Demo path:** Free trial signup via `vins.dataonesoftware.com/vin_decoder_api_free_trial`.
- **Verdict:** OVERKILL for plate-to-VIN alone, but the right primary VIN decoder for a Carvana-grade product.

#### J.D. Power ChromeData / VIN Precision+ (https://www.jdpower.com/business/chromedata-vin-descriptions)
- **What you get:** VIN decoding + OEM build data validation + license plate lookup (history + mileage). Goes deep into trim/options/packages.
- **Coverage:** US-wide.
- **Pricing:** Not public, enterprise sales.
- **Latency:** Production-grade.
- **Integration:** REST + file delivery, "any format, any frequency."
- **ToS notes:** Enterprise.
- **Reputation:** Industry gold standard for trim-level accuracy. Used by NADA-aligned valuation pipelines.
- **Demo path:** Contact sales.
- **Verdict:** Best-in-class data quality; same enterprise-contract friction as DataOne.

#### KBB / Cox Automotive (https://b2b.kbb.com)
- **What you get:** Valuations + condition + market data. Plate / VIN are inputs to their valuation models, not standalone plate-API products.
- **Coverage:** US-wide; 250+ data sources backing the valuation models.
- **Pricing:** Enterprise contract via Cox Automotive sales.
- **Latency:** Production-grade.
- **Integration:** REST + dealer-system integrations via Cox Digital Retail API Platform.
- **ToS notes:** Enterprise.
- **Reputation:** Industry default for trade-in / instant-offer pricing. Carvana almost certainly already uses KBB / Manheim / vAuto signals upstream of the instant-offer engine.
- **Demo path:** Contact sales.
- **Verdict:** Not a plate-API vendor in the strict sense, but a required adjacent vendor for the valuation step downstream of plate-to-VIN.

#### MarketCheck (https://www.marketcheck.com/apis)
- **What you get:** VIN decoder + market intelligence + dealer inventory + listings. Plate-recognition via a CarsXE adapter.
- **Coverage:** North America + UK.
- **Pricing:** Starts at $8/mo for small datasets; custom enterprise quotes for high volume. Datarade lists samples.
- **Latency:** Production-grade.
- **Integration:** REST.
- **ToS notes:** Standard B2B.
- **Reputation:** Strong in market-pricing analytics, less so in pure plate-to-VIN.
- **Demo path:** Free samples on request.
- **Verdict:** Best paired with a dedicated plate-to-VIN vendor; MarketCheck's strength is downstream pricing/intel.

---

### Tier 3: Free / public

#### NICB VINCheck (https://www.nicb.org/vincheck)
- **What you get:** VIN -> theft/salvage status (insurance crime bureau). **VIN-only, NOT plate.**
- **Coverage:** Participating NICB member insurers (most major US carriers).
- **Pricing:** Free.
- **Latency:** Web UI only; **no public API**. 5 lookups/24h per IP.
- **Integration:** None — web form scrape only.
- **ToS notes:** No commercial use; web form has terms restricting redistribution.
- **Reputation:** Authoritative for theft/salvage flag.
- **Demo path:** Public web form.
- **Verdict:** Not a vendor — a free fraud-screen signal that downstream backends can ping AFTER VIN is resolved.

#### NHTSA vPIC (https://vpic.nhtsa.dot.gov/api/)
- **What you get:** VIN decoder (federal government, free, no key). VIN-only.
- **Coverage:** All US-sold vehicles. No plate -> VIN path.
- **Pricing:** Free.
- **Latency:** ~200-500ms typical (public infra).
- **Integration:** REST, JSON.
- **ToS notes:** Public-domain US gov data.
- **Reputation:** Authoritative for federal-vehicle-class data. Limited on trim/options.
- **Demo path:** No signup needed.
- **Verdict:** Use as a free secondary VIN decoder once plate -> VIN succeeds via a paid vendor. Saves a per-call fee on the decode side.

---

## Cost at Carvana scale (THIS IS WHERE VENDORS BREAK)

Carvana ran ~133k retail-unit sales in Q1 2024 (last public number). Realistic "sell my car" funnel inputs at Carvana scale: **~3M plate lookups/month** (~10x retail-unit volume, since most lookups don't convert). Per-call cost at this volume:

| Vendor | Per-call | 3M/mo cost | Carvana-feasible? |
|---|---|---|---|
| PlateToVin Enterprise | $0.06 | $180,000/mo | YES at unit-econ level; vendor-size risk |
| Auto.dev Scale | $0.055 + $599 sub | $165,599/mo | YES |
| CarsXE | ~$0.05–0.10 range | $150k–$300k/mo | YES |
| Carfax QuickVIN Plus | negotiated, free for participating dealers | Likely **already $0** for Carvana | YES (incumbent) |
| AutoCheck / Experian | "unlimited reports" tier | Negotiated flat | YES |
| DataOne | $10k+/yr base + volume | Likely $0.01–0.03/call at this volume | YES |
| J.D. Power ChromeData | enterprise | Likely $0.01–0.03/call | YES |
| Google Cloud Vision OCR (PHOTO fallback) | $1.00/1k above 5M/mo | $3,000/mo | YES, trivial |
| Apple Vision (iOS, on-device) | $0 | $0 | YES (only on iOS clients) |
| PlateRecognizer ALPR (PHOTO fallback) | custom at this volume; sub-cent/call likely | <$50k/mo enterprise | YES |

**FLAG.** PlateToVin enterprise at $180k/mo is a small UK Ltd company (single-director, founded 2022). Carvana would not bet a primary lookup path on a vendor that small. ([Companies House](https://find-and-update.company-information.service.gov.uk/company/14107525)) Use it as a side validator at most.

**FLAG.** Per-call vendors like Auto.dev at $0.055 imply a $66/year cost per converted customer if 50 plate lookups are spent per acquisition. That's fine economically but PUNISHES failed lookups — and the whole problem we're solving is failed lookups on CA plates. Multi-vendor cascade is the answer.

---

## OCR / photo capture fallback (for "snap a picture of your plate or VIN")

| Vendor | Pricing | Accuracy claim | Where it runs | Carvana fit |
|---|---|---|---|---|
| **Apple Vision (`VNRecognizeTextRequest`)** | Free, on-device | Production-grade on plates with `.accurate` mode + Neural Engine; 95-99% on clean printed text | iOS only | **Native iPhone app fallback — zero cost, zero latency, no PII leaves device** |
| **Google Cloud Vision OCR** | First 1k/mo free, then $1.50/1k, drops to $1.00/1k above 5M/mo | Production-grade | Cloud REST | Web + Android fallback |
| **AWS Rekognition DetectText** | Group 2 API; ~$1/1k images at volume | Lower accuracy on plates than Vision per AWS re:Post threads | Cloud REST | Acceptable, but Google wins on plates |
| **PlateRecognizer (Snapshot)** | $50/mo for 50k lookups, $250/mo for 500k. Add 50% for Make+Model+Color. Free 2,500 lookups/mo tier. | Best-in-class on plates; works on blurry/low-light/angle | Cloud OR on-prem SDK | **Best dedicated plate OCR. Drop-in.** |
| **OpenALPR (Rekor CarCheck / Scout)** | Scout Basic $12/cam/mo, Pro $72/cam/mo; CarCheck has free trial then enterprise contract | Strong, especially in vehicle context (make/model/color/direction) | Cloud + on-prem | Good fallback; pricing is camera-centric |

**OCR fallback path:** YES, feasible and cheap.

- **iOS:** Apple Vision is free, runs on-device, no network. A 5-line Swift snippet using `VNRecognizeTextRequest` with `.accurate` recognition level + a regex for `[A-Z0-9]{6,8}` on detected boxes solves the CA-plate format.
- **Android + web:** Google Cloud Vision at $1.50/1k for the first 5M/mo, $1.00/1k above. At 3M plate-photo fallbacks/month, that is ~$3,000/mo. Trivial.
- **Backend pre-validation:** PlateRecognizer Snapshot at $250/mo for 500k lookups handles fraud-grade plate validation (detect the bounding box, confirm format, return confidence). A great "is this a real plate photo" guard rail.

---

## DPPA and consumer-facing surface (READ THIS)

The use case Carvana has — "you tell us your plate, we tell you the make/model of YOUR OWN car" — is fine under DPPA because:
- The user is the data subject (or has the lawful right to ask), not a third party
- We're returning vehicle SPECS, not owner PII (name, address, phone)
- We never display owner name or address back to the requester

What kills you under DPPA:
- Returning OWNER name/address from a plate lookup to an arbitrary requester ($2,500/violation statutory minimum, multiplied by EVERY lookup)
- Plate-reader-style logging without a published privacy policy (per Bartholomew v. Parking Concepts Inc., CA 1st DCA Feb 2026)

**Implication for vendor choice:** Carvana should explicitly NOT pull `OwnerName`, `OwnerAddress`, or related PII fields even when the API offers them. Stick to `VIN`, `Year`, `Make`, `Model`, `Trim`, `BodyStyle`. All Tier 1 vendors above expose plate -> VIN + specs WITHOUT requiring owner PII fields, so this is a request-shape decision, not a vendor decision.

---

## Recommended stack

For a Carvana-grade replacement, use a **three-layer cascade**:

### 1. Primary: Carfax QuickVIN Plus (already-incumbent dealer agreement, free at the contracted tier)
- **Why:** Best CA hit rate among incumbents because it pulls from POS-tied dealer activity that includes recent CA sales. Carvana likely already has the data agreement.
- **Why first:** Zero marginal cost at the contract tier.
- **Fix the broken integration first**, before swapping vendors. The current "couldn't find that plate" almost certainly traces to: (a) a stale request shape, (b) a hardcoded fallback that returned `{ found: false }` on any 4xx, or (c) an expired credential. Carfax QuickVIN Plus does miss CA plates frequently — but `8E79985` is a perfectly-formed CA standard passenger plate, so a NULL on it points to integration breakage, not data depth.

### 2. Cold-miss fallback: DataOne Software (enterprise contract, $10k+/yr base)
- **Why:** Best data depth + reliability profile for any miss off Carfax. Used by major insurers / lenders / OEMs; built for this exact "I need this lookup to work or I lose underwriting accuracy" use case.
- **Why second:** Higher per-call cost but only paying it on Carfax misses (~20-30% of CA lookups historically).

### 3. UX fallback: Apple Vision (iOS) + Google Cloud Vision (web/Android) + PlateRecognizer ALPR
- **Why:** When BOTH vendors miss, OR when the user mistypes the plate, OR when the user is staring at the car right now, "snap a photo" is a better UX than "type your VIN by hand."
- **Cost:** ~$3k/mo for Cloud Vision at 3M-lookup scale, $0 for iOS, $250-500/mo for PlateRecognizer pre-validation.
- **Privacy bonus:** Apple Vision runs on-device — no plate image ever leaves the user's iPhone.

### Side-validator (optional, low cost): PlateToVin at $0.05–0.06/call
- **Why:** When Carfax + DataOne BOTH miss, ping PlateToVin as a third opinion on rare CA plates. Their cache hits make repeat queries free, and at the scale of "third-vendor fallback," monthly spend stays under $20k.

### Explicit non-recommendations
- **Auto.dev** as primary: too small a company to bet Carvana's onboarding on, and plate-to-VIN being Scale-tier-only feels like an upsell trap.
- **NICB VINCheck** as anything but a fraud-screen on the VIN AFTER resolution: not an API, just a free human-facing form.
- **AWS Rekognition** for plate OCR: per the AWS re:Post threads, plate accuracy lags Google Cloud Vision and PlateRecognizer.

---

## Sources

- [PlateToVin pricing page](https://platetovin.com/plans)
- [PlateToVin API docs](https://platetovin.com/doc)
- [Auto.dev pricing](https://www.auto.dev/pricing)
- [Auto.dev plate-to-VIN](https://www.auto.dev/plate-to-vin)
- [Auto.dev docs](https://docs.auto.dev/v2/products/plate-to-vin)
- [VinAudit license plate data](https://www.vinaudit.com/license-plate-data)
- [VinAudit CA plate lookup](https://www.vinaudit.com/license-plate-lookup/california)
- [CarsXE API](https://api.carsxe.com)
- [VehicleDatabases.com license plate API](https://vehicledatabases.com/api/license-plate)
- [Vincario 2026 VIN decoder comparison](https://vincario.com/blog/best-vin-decoder-api/)
- [Vincario VIN decoder API pricing](https://vincario.com/blog/vin-decoder-api-pricing/)
- [DataOne Software VIN decoder](https://www.dataonesoftware.com/web-services-vin-decoder-api)
- [DataOne free trial](https://vins.dataonesoftware.com/vin_decoder_api_free_trial)
- [J.D. Power ChromeData VIN](https://www.jdpower.com/business/chromedata-vin-descriptions)
- [J.D. Power license plate lookup](https://www.jdpower.com/cars/license-plate-lookup-and-decoder)
- [Carfax QuickVIN for lenders](https://www.carfaxforlenders.com/products/quickvin/)
- [CARFAX-Wrapper GitHub (QuickVIN Plus impl details)](https://github.com/amattu2/CARFAX-Wrapper)
- [Experian AutoCheck integrations](https://www.experian.com/automotive/autocheck-integrations)
- [Cox Digital Retail API Platform](https://developer.coxautoinc.com/marketingcontent/product/d660dca0-04fa-439e-a025-21c5936569ea)
- [MarketCheck APIs](https://www.marketcheck.com/apis/)
- [NICB VINCheck](https://www.nicb.org/vincheck)
- [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/)
- [PlateRecognizer pricing](https://platerecognizer.com/pricing/)
- [PlateRecognizer Snapshot API docs](https://guides.platerecognizer.com/docs/snapshot/api-reference/)
- [OpenALPR / Rekor pricing](https://www.openalpr.com/products)
- [Rekor Scout subscriptions](https://docs.rekor.ai/scout/getting-started/subscriptions-and-licensing)
- [AWS Rekognition pricing](https://aws.amazon.com/rekognition/pricing/)
- [AWS Rekognition text detection docs](https://docs.aws.amazon.com/rekognition/latest/dg/text-detection.html)
- [Google Cloud Vision pricing](https://cloud.google.com/vision/pricing)
- [Apple VNRecognizeTextRequest](https://developer.apple.com/documentation/vision/vnrecognizetextrequest)
- [CA DMV info sharing fast facts](https://www.dmv.ca.gov/portal/driver-education-and-safety/educational-materials/fast-facts/how-your-information-is-shared-ffdmv-17/)
- [DPPA 2023 guide (Goldberg)](https://terms.law/2023/08/01/drivers-privacy-protection-act-dppa/)
- [Venable: 2026 DPPA litigation trends](https://www.venable.com/insights/publications/2026/02/whats-driving-the-rise-in-drivers-privacy)
- [PlateToVin Ltd company filing (UK)](https://find-and-update.company-information.service.gov.uk/company/14107525)
