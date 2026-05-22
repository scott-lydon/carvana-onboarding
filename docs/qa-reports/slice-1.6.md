# QA Adversary Report — Slice 1.6 (EntryForm on live cascade)

> **Note on provenance:** the global `qa-adversary` sub-agent was supposed to
> run via `claude-code-bridge` in a fresh Claude Code session. The bridge
> transport timed out on a large prompt (no commits landed, no report file
> created). Per the user's standing rule against looping on impediments,
> the implementing session (Cowork) ran the same mechanical attacks directly
> from this session using shell + grep + tsc + npm. The fresh-context value
> is reduced; a follow-up bridge run on the smaller post-fix diff should
> re-validate.

## Verdict

**FAIL on R1**, plus three documented NITs (F1, F2, F3). All other attacks PASS.

Verdict severity is downgradable to PASS if the implementing session fixes R1
in the same response. (The fix is two-line and the lock-in test is one-line.)

## Diff range

`b914f2b..36b179e` on `main`. Contains:

- `src/lookup/adapters/CarsXEAdapter.ts` (new — live primary)
- `src/lookup/adapters/VinAuditAdapter.ts` (new — env-gated fallback)
- `src/lookup/createCascade.ts` (new — adapter factory)
- `src/lookup/VendorCascade.ts` (timeout bumped 2s -> 8s)
- `server/routes/lookup.ts` + `server/index.ts` (route wiring + REPO_ROOT fix)
- `src/App.tsx` + `src/components/EntryForm.tsx` (slice 1.6 — EntryForm + DegradationPanel)
- `src/index.css` (dark theme)
- `render.yaml` (NPM_CONFIG_PRODUCTION fix)
- `plan.md` + `tasks.md` (docs reconciliation)

Live confirmation: `POST https://carvana-onboarding.onrender.com/api/lookup/plate`
with `{plate:"XRJ4041",state:"TX"}` returns
`{kind:"resolved",vehicle:{year:2021,make:"Toyota",model:"Highlander",bodyStyle:"SUV"},viaVendor:"carsxe",latencyMs:459}`
in ~700ms wall-clock (warm).

## Attacks attempted

1. **CORS in production**: does `cors({ origin: false })` actually emit no
   `Access-Control-Allow-Origin` headers (same-origin-only) in cors@2.x?
2. **REPO_ROOT path under prod**: does the production build resolve
   `FRONTEND_DIST` to `<repo>/dist/index.html` after the `rootDir` change
   that moved the emit target to `dist-server/server/index.js`?
3. **Discriminated union exhaustiveness**: does TypeScript flag a missing
   case in `DegradationPanel`'s switch when a new `ApiResponseBody` variant
   is added?
4. **VendorCascade short-circuit on `bot_detected`**: does the cascade stop
   trying further adapters when one returns `bot_detected`, or fall through?
5. **`err.message` leak**: does any response body forward a raw upstream
   exception message into user-facing content?
6. **Cold-start vs 8s timeout**: is the bumped 8s vendor timeout big enough
   for a cold Render free-tier dyno hitting the CarsXE API?
7. **Slice 0.5 failing test invariant**: is `expect(true).toBe(false)` still
   in `tests/unit/scaffold.test.ts`, or has it been silently weakened again?
8. **DPPA boundary**: does any code path return owner / registrant /
   address fields from the vendor response back to the client?
9. **Form-state preservation on error**: does `EntryForm` actually preserve
   the tab + field values across a submission error?
10. **`render.yaml` audit**: are `NPM_CONFIG_PRODUCTION=false`,
    `CARSXE_API_KEY`, and the correct `startCommand` path all present?

## Findings

### R1 (regression, BLOCKING) — `server/routes/lookup.ts:93` and `:168` forward `err.message` on unexpected cascade throw

The cascade is documented to never throw, but if it does (programmer error,
unhandled adapter exception, etc.), the route handler maps the throw to:

```ts
res.status(500).json({
  kind: "transient_error",
  retryable: true,
  cause: "unexpected_cascade_throw",
  detail: err instanceof Error ? err.message : "unknown cascade error",
});
```

The `detail` field is JSON-returned to the client, which means whatever
text `err.message` carries lands in the client's `body.detail`. The
constitution rule (CAT-3, "Never expose `$e->getMessage()` in user-facing
output") forbids this exactly because that message can carry SQL fragments,
file paths, internal stack hints, or secrets.

**Affected paths:** `server/routes/lookup.ts:87-95` (plate handler) and
`server/routes/lookup.ts:163-169` (vin handler).

**Reproduction:**

1. Inject a programmer error into the cascade (e.g., temporarily make
   `VendorCascade.run` throw `new Error("DB password: hunter2")`).
2. POST any valid body to `/api/lookup/plate`.
3. Observe the response body: `detail: "DB password: hunter2"` leaked
   verbatim.

**Fix shape:**

```ts
} catch (err) {
  // Log the actual exception server-side, return a fixed generic detail.
  console.error("[lookup] unexpected cascade throw", err);
  res.status(500).json({
    kind: "transient_error",
    retryable: true,
    cause: "unexpected_cascade_throw",
    detail: "An unexpected internal error occurred; the operator has been notified.",
  });
}
```

The original exception is still available in the server logs via the
console.error call, where the operator (not the user) can inspect it.

A failing test should land at `tests/unit/qa-adversary-slice-1.6.test.ts`
covering: spy the cascade to throw an error containing the literal string
`"hunter2"`, assert the response body does not contain `"hunter2"`.

### F1 (NIT) — `DegradationPanel` switch lacks `assertNever` arm

TypeScript catches a missing variant (verified by adding a synthetic
`rate_limited` arm to `ApiResponseBody`: tsc reports TS2366 "Function
lacks ending return statement"). The catch is correct but the error
message is generic and points at the function header, not at the missing
case.

**Fix:** add a `default` arm:

```ts
default: {
  const _exhaustive: never = body;
  throw new Error(`unhandled ApiResponseBody.kind: ${JSON.stringify(_exhaustive)}`);
}
```

Now tsc reports `TS2322: Type "rate_limited" is not assignable to type "never"`
pointing directly at the missing case.

### F2 (NIT) — `render.yaml` does not declare vendor API keys

The current `render.yaml` envVars list contains only `NODE_ENV`, `PORT`,
and `NPM_CONFIG_PRODUCTION`. `CARSXE_API_KEY` lives only in the Render
dashboard. A blueprint redeploy from a fresh Render account would silently
ship a service that returns 503 `configuration_missing` for every request,
because the cascade factory sees no API keys.

**Fix:** declare with `sync: false` so the blueprint documents the
required dashboard secrets without checking values into git:

```yaml
envVars:
  ...
  - key: CARSXE_API_KEY
    sync: false
  - key: VINAUDIT_API_KEY
    sync: false
```

### F3 (NIT) — Tab switch does not clear `DegradationPanel`

`EntryForm`'s `ui` state is shared across both tabs. If a user submits a
plate, sees a `not_found` or `bot_detected` panel, then clicks the VIN tab
without first clicking "Edit and try again", the plate panel remains
visible below the (now-VIN) form. CAT-2 ("preserve form values across
errors") is honored — but cross-tab cross-contamination of the result
panel is confusing.

**Fix:** either reset `ui` to `idle` in the tab onClick handlers, or scope
`ui` per-tab (`{ plate: UiState; vin: UiState }`).

### F4 (NIT, out-of-scope for this slice) — cascade `cause` field is built from upstream `err.message`

`VendorCascade.run` builds the `transient_error.cause` string from per-attempt
`err.message` values, which include text from the adapter's wrapping of
upstream fetch errors. The text reaches the client only via the explicit
`<details><summary>Technical detail</summary><pre>{body.cause}</pre></details>`
disclosure in `DegradationPanel`. Severity is lower than R1 because the
disclosure is opt-in and progressive, and because the wrapping prefix
(`carsxe:network_error:`) is ours — but the trailing message portion is
still upstream-controlled text. Worth normalizing in a future slice.

## Out-of-scope (deferred)

- **Cold-start latency**: could not trigger a fresh cold-start on the live
  Render instance (it was warm from prior testing). 8s budget against a
  ~500ms warm-call observed latency is comfortable; a fresh cold-start
  measurement should land in slice 2 once the next deploy happens.
- **Playwright scenario for US1**: deferred per `tasks.md` to slice 2
  alongside the bot-detected differentiation E2E test.

## Evidence

### A1 — CORS

```text
$ node -e "const cors = require('cors'); ..."
Headers emitted: {}
Status: 0
```

`cors@2.x` with `origin: false` emits no `Access-Control-Allow-Origin`
header. Same-origin-only confirmed.

### A2 — REPO_ROOT path

```text
$ npm run build && npm run build:server
✓ built in 1.24s
$ ls -la dist/index.html dist-server/server/index.js
-rw-r--r-- ... dist-server/server/index.js
-rw-r--r-- ... dist/index.html
```

From `dist-server/server/index.js`, `path.resolve(__dirname, "..", "..")`
lands at the repo root, where `dist/index.html` lives. Confirmed.

### A3 — Exhaustiveness

Adding `| { kind: "rate_limited"; retryAfterSeconds: number }` to
`ApiResponseBody` produced:

```text
src/components/EntryForm.tsx(249,5): error TS2366: Function lacks ending
return statement and return type does not include 'undefined'.
```

TS catches the missing variant. NIT only on error message clarity (F1).

### A4 — Cascade short-circuit

`src/lookup/VendorCascade.ts:109` — comment + code confirm:

```ts
// Any other kind (transient_error, bot_detected, format_error) bubbles
// up immediately — those are NOT "try the next vendor" situations.
return result;
```

Short-circuit verified. Note: current adapters only return `resolved` /
`not_found`; the bubble-up behavior for `transient_error` returned (not
thrown) by an adapter is theoretical until an adapter starts returning that
kind explicitly. If a future adapter (e.g., a rate-limited Carfax response)
returns a structured `transient_error`, the cascade should arguably
fall through. Mark for design review in slice 2+.

### A5 — `err.message` audit

```text
server/routes/lookup.ts:59  reason: err instanceof Error ? err.message : "invalid plate input"
server/routes/lookup.ts:75  reason: err instanceof Error ? err.message : "invalid state input"
server/routes/lookup.ts:93  detail: err instanceof Error ? err.message : "unknown cascade error"
server/routes/lookup.ts:155 reason: err instanceof Error ? err.message : "invalid vin input"
server/routes/lookup.ts:168 detail: err instanceof Error ? err.message : "unknown cascade error"
src/lookup/adapters/VinAuditAdapter.ts:113  `vinaudit:network_error: ${...err.message}`
src/lookup/adapters/VinAuditAdapter.ts:131  `vinaudit:malformed_json: ${...err.message}`
src/lookup/adapters/CarsXEAdapter.ts:115    `carsxe:network_error: ${...err.message}`
src/lookup/adapters/CarsXEAdapter.ts:139    `carsxe:malformed_json: ${...err.message}`
src/lookup/VendorCascade.ts:119  error: err instanceof Error ? err.message : String(err)
```

- Lines 59 / 75 / 155: **SAFE** — these `err` values are from our domain
  primitive constructors (`Plate`, `Vin`, `parseStateCode`). Verified in
  `src/lookup/types.ts:32,73,80,120,142`. Messages are user-safe by
  construction (no SQL/stack/upstream content).
- Lines 93 / 168: **R1 REGRESSION** — unexpected cascade throw is not a
  controlled domain error; raw `err.message` could be anything. Fix above.
- Adapter `cause` strings: F4 NIT (deferred).

### A6 — Cold start

```text
$ time curl ... /api/lookup/plate ...
{"kind":"resolved","vehicle":{"year":2021,"make":"Toyota","model":"Highlander","bodyStyle":"SUV"},"viaVendor":"carsxe","latencyMs":507}
real 0m0.857s
```

Instance was warm; cold-start measurement deferred.

### A7 — Slice 0.5 invariant

`tests/unit/scaffold.test.ts:15` still reads `expect(true).toBe(false)`.
`npm test -- --run` reports `1 failed | 25 passed` with the failure at the
expected location. Slice 0 spec §0.5 honored.

### A8 — DPPA boundary

`Vehicle` interface (`src/lookup/types.ts`): only `year`, `make`, `model`,
`trim`, `bodyStyle`. `parseCarsXEVehicle` in `CarsXEAdapter.ts:185-200`
extracts only those five fields from the raw vendor response. Owner /
registrant / address fields are not propagated.

### A9 — Form-state preservation

`EntryForm` `useState` atoms are independent: `tab`, `plate`, `state`,
`vin`, `ui`. The submit handler at `:73-98` mutates only `ui`; the
`onRetry` callback at `:208` resets only `ui`. Tab switching at `:125-138`
mutates only `tab`. No code path resets the input atoms on error.
CAT-2 holds. F3 NIT separate.

### A10 — `render.yaml`

`startCommand: node dist-server/server/index.js` — correct after the
`rootDir` change. `NPM_CONFIG_PRODUCTION=false` present. `CARSXE_API_KEY`
absent — F2 NIT.

### npm test / typecheck / lint / property

```text
=== typecheck ===
(no errors)

=== lint ===
(no errors, --max-warnings=0)

=== unit tests ===
Test Files  1 failed | 4 passed (5)
Tests       1 failed | 25 passed (26)
(only failure is the deliberate scaffold §0.5 placeholder)

=== test:property ===
Test Files  1 passed (1)
Tests       2 passed (2)
```

## Reproduction Steps (for R1)

```bash
cd ~/Desktop/Clutter/iOS/carvana-onboarding
git checkout 36b179e
# Temporarily inject a programmer error into the cascade:
node -e "
const { makePlateLookupHandler } = require('./dist-server/server/routes/lookup.js');
const fakeCascade = {
  name: 'fake',
  lookupByPlate: async () => { throw new Error('SECRET_TOKEN=hunter2'); },
  lookupByVin: async () => { throw new Error('not used'); },
};
const handler = makePlateLookupHandler(fakeCascade);
const req = { body: { plate: 'XRJ4041', state: 'TX' } };
const res = {
  _status: 0, _body: null,
  status(s) { this._status = s; return this; },
  json(b) { this._body = b; },
};
handler(req, res).then(() => {
  console.log('status:', res._status);
  console.log('body:', JSON.stringify(res._body));
  console.log('LEAK:', res._body.detail.includes('hunter2') ? 'YES' : 'NO');
});
"
```

Expected after fix: `LEAK: NO`.

---

Report written by Cowork session (bridge transport timed out). Re-validation
by a fresh-context `claude-code-bridge` qa-adversary run on the post-fix
diff is recommended before declaring slice 1 fully closed.
