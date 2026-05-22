# Plan — Carvana Onboarding Recovery Layer

> Architecture. Component breakdown. Data flow. Decisions. Trade-offs. Sequencing.
> Last edited 2026-05-22.

## Topology (text)

```
Browser
  ├─ React app (Vite + TypeScript)
  │    ├─ EntryForm (plate / VIN tabs, mirrors Carvana's UX)
  │    ├─ OCRCapture (getUserMedia + crop + send)
  │    ├─ ResultPanel (vehicle data + estimated offer, NO account gate)
  │    └─ DegradationLayer (catches errors, routes to fallbacks, preserves state)
  │
  └─ getUserMedia (camera) ───────┐
                                  │
Server (Express on Node 22)       │
  ├─ /api/lookup/plate ──────────────► VendorCascade
  │                                       ├─ Carfax QuickVIN Plus (primary)
  │                                       └─ DataOne (fallback)
  ├─ /api/lookup/vin    ──────────────► same VendorCascade
  ├─ /api/ocr/recognize ◄────── crop ────┘
  │                            ──────────► Google Cloud Vision (OCR)
  ├─ /api/prequal/estimate (mock soft-pull range, NO real bureau hit)
  ├─ /api/consent/log (TCPA consent audit trail)
  └─ /api/events (telemetry: every failure mode is named and logged)
```

The full polished Mermaid version with Simple Icons logos lives in `website/index.html` per the Gauntlet pattern.

## Component breakdown

### EntryForm
Owns the plate / VIN tab state, the form fields, and the green-check / red-error indicators. Tab state is preserved across submission errors. Field values are preserved across submission errors. **This is the literal fix for finding S6** (Carvana silently resets tab + erases input on backend error).

### VendorCascade
Pure domain module, no I/O of its own (takes vendor adapters as constructor args). Tries the primary vendor with a 2-second timeout. On miss or timeout, falls through to the fallback. On all-vendors-miss, returns a structured `NotFound` result with `lastVendorTried` and `attemptCount`. The DegradationLayer translates that into honest user copy. **This is the literal fix for finding S4** (Carvana blames the user instead of acknowledging a vendor gap).

### OCRService
Two paths. Server path: receives a cropped image from the browser, calls Google Cloud Vision, returns text + confidence. Client iOS path (recorded for the privacy slide): SwiftUI app uses `VNRecognizeTextRequest` on-device, returns text without a network round-trip. Both paths produce the same `OCRResult` shape so the rest of the system is OCR-source-agnostic.

### DegradationLayer
A React context provider that wraps the error boundary. Catches errors from VendorCascade misses, OCRService failures, network timeouts. For each named failure mode, emits the correct user-facing message, preserves form state, and offers the right next-action (retry, switch tab, scan VIN, text-me-a-link). **The single most important component in the system.**

### ConsentManager
Owns the SMS marketing toggle and the User Agreement / Privacy Policy / E-SIGN consent affirmation. Toggle defaults OFF. Each agreement is a separate checkbox (not click-wrap inferred from submit). All consent decisions are written to `/api/consent/log` with a timestamp and the IP / user-agent for the TCPA audit trail. **This is the literal fix for findings B5 and B6.**

### PrequalEstimator (Mock for the demo)
Returns an APR range and monthly payment estimate based on the user's stated income + employment + a publicly-available range table. This is NOT a real soft-pull; it's a demo-only mock that produces a believable range. The real production integration would replace this with the actual soft-pull vendor (Equifax / TransUnion / Experian). **This addresses finding B8** (show prequal range BEFORE account creation).

### EventReporter
Every named failure mode is a stable event name (e.g., `lookup.plate.primary_miss`, `lookup.plate.cascade_exhausted`, `ocr.confidence_low`, `consent.sms_declined`, `prequal.shown_before_account`). Aggregated counts go to a `/api/events` endpoint that writes to a local SQLite for the demo and would be wired to Carvana's existing telemetry in production.

## Data flow (sell-side happy path)

1. User types plate + selects state in EntryForm.
2. Client sends `POST /api/lookup/plate { plate, state }`.
3. Server calls VendorCascade.lookupByPlate(plate, state).
4. Primary vendor returns vehicle (year, make, model, trim).
5. Server returns `{ status: 'resolved', vehicle, estimatedOfferRange }`.
6. ResultPanel renders, NO account gate.
7. EventReporter logs `lookup.plate.primary_hit`.

## Data flow (sell-side cascade-fallback path)

1. Same as steps 1-3.
2. Primary vendor returns null. VendorCascade calls fallback vendor.
3. Fallback returns vehicle. Server returns `{ status: 'resolved', vehicle, viaVendor: 'fallback' }`.
4. ResultPanel renders, NO account gate. DegradationLayer optionally surfaces a one-line "we had to use our backup data source for this plate, results look good" note for transparency.
5. EventReporter logs `lookup.plate.primary_miss` AND `lookup.plate.fallback_hit`.

## Data flow (sell-side cascade-exhausted path)

1. Steps 1-2 same.
2. Both primary and fallback miss. Server returns `{ status: 'not_found', lastVendorTried: 'fallback', attemptCount: 2 }`.
3. DegradationLayer surfaces honest copy ("our partner data does not have this plate, this happens to about X% of plates") and the three fallback options: switch to VIN tab (input preserved), scan VIN with camera, open chat.
4. Form state is preserved. Tab does NOT reset. User input is NOT erased.
5. EventReporter logs `lookup.plate.cascade_exhausted`.

## Decisions table

| Decision | What we chose | Alternative considered | Why |
|---|---|---|---|
| Architecture pattern | Drop-in API gateway (we sit between Carvana's frontend and their vendor) | Front-end overlay (we rewrite their entry component) | Gateway means Carvana keeps their stack; the integration story is "wire your vendor calls through us" which is what a real PM can buy. Overlay is easier to demo but harder to defend as a real integration. |
| Primary vendor | Carfax QuickVIN Plus | DataOne, ClearVIN, VinAudit, PlateToVin | Per `research/plate-api-landscape.md`, Carfax is the industry's most-comprehensive plate-to-VIN data source and any Carvana-scale dealer already has it under their existing contract. The fix is "use the vendor you already pay for, correctly." |
| Fallback vendor | DataOne Software | Carfax-only-with-retry | DataOne has independent coverage of fleet / commercial / specialty plates that Carfax can miss. Independent vendor = independent failure modes = real fallback. |
| OCR primary path | Browser `getUserMedia` + Google Cloud Vision server-side | Tesseract.js client-side | Tesseract.js works but accuracy on plates and VIN stickers is lower than cloud vision; per `research/plate-api-landscape.md` Apple Vision is the iOS gold standard and Google Vision is the web equivalent. Cost is negligible at $1.50 per 1k. |
| iOS OCR demo | SwiftUI + Apple `VNRecognizeTextRequest` | React Native + Tesseract | Privacy story is the differentiator; on-device OCR with no PII leaving the phone is exactly the slide we want. SwiftUI is the user's preferred language. 30-second demo video, not the primary deliverable. |
| Frontend framework | React + Vite + TypeScript | Next.js | Vite is lighter, faster local dev, and matches existing Gauntlet repos (`boxy-fractions`, `adversary`). Next.js would add SSR / SEO that the prototype does not need. |
| Backend framework | Express on Node 22 | Hono, Fastify, Nest | Express is unsurprising and matches existing Gauntlet repos; a Carvana PM reading the code reads it without learning a new framework. |
| Account-creation timing (buy-side) | Show prequal terms first, account creation deferred to "save these terms" | Carvana's current pattern (account-required before terms) | Per finding B8; the entire buy-side pitch is built on this inversion. |
| TCPA SMS opt-in | Default OFF, separate checkbox, not click-wrap | Pre-checked toggle in fine print | Per finding B5; the entire trust pitch is built on this fix. |
| Plate -> Owner lookups | NEVER. Stay on plate -> VIN -> specs only. | Allow plate -> owner for "fraud prevention" use cases | DPPA, Bartholomew v. Parking Concepts CA 1st DCA Feb 2026. $2,500 per violation statutory minimum. Constitutional non-negotiable #6. |

## Trade-offs

- **API gateway architecture: harder to demo standalone.** Mitigated by building our own React frontend on top of the gateway for the demo, with the gateway exposed as a "this is the integration shape" callout.
- **Real vendor integration costs money even in dev.** Mitigated by sandbox accounts (Carfax dealer sandbox, DataOne developer tier) and by demo-time hits only.
- **OCR in browser requires camera permission, which scares some users.** Mitigated by showing the camera request just-in-time (after the user clicks "scan VIN") not on page load, and by an explicit "this image is sent to our server for VIN recognition then discarded" copy.
- **Demo-only mock for prequal soft-pull range.** Mitigated by labeling clearly in the demo and by the fact that a real PM-side integration would swap this for the actual bureau call.

## Sequencing (informs `tasks.md`)

Slice 0 ships the scaffold: empty React app, empty Express server, one failing Vitest test, one Playwright smoke test, dual-push gitflow set up, deployable to Render.

Slice 1 is the load-bearing slice: VendorCascade with Carfax integration and the EntryForm + ResultPanel for the plate happy path. After this slice the demo can show US1.

Slice 2 adds DataOne fallback. After this slice the demo can show US2's cascade-fallback path.

Slice 3 adds the DegradationLayer and honest error copy. After this slice the demo can show US2's cascade-exhausted path.

Slice 4 adds OCR via `getUserMedia` + Google Cloud Vision. After this slice the demo can show US4.

Slice 5 adds the buy-side: PrequalEstimator mock + ResultPanel showing terms before account. After this slice the demo can show US5.

Slice 6 adds ConsentManager with TCPA-compliant toggle. After this slice the demo can show US7.

Slice 7 adds the EventReporter and the "drop-off rate before / after" metrics overlay for the closing slide.

Slice 8 is demo polish + architecture website (`website/index.html`) + defense breakout script + AI interview prep.

Each slice is shippable in isolation and runs through `qa-adversary` before being merged.
