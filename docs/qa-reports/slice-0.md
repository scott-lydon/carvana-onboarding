# QA Adversary Report — Slice 0

- Date: 2026-05-22
- Diff: 654db5e..b914f2b (3 commits: scaffold, dist-server gitignore fix, production-serve + render.yaml)
- Reviewer: Fresh-context qa-adversary (claude-sonnet-4-6)
- Verdict: **FAIL**
- Categories tested: CAT-1, CAT-3, CAT-7, CAT-8 (active); CAT-2, CAT-4, CAT-5, CAT-6, CAT-9, CAT-10 (N/A for scaffold)

---

## Regressions found

### REGRESSION 1 — Task 0.5 done-criteria violated (blocking)

**File:** `tests/unit/scaffold.test.ts` (entire file)
**Severity:** Blocking

**Spec requirement (tasks.md §0.5):**
> "Add one failing Vitest test: `it('placeholder failing test', () => expect(true).toBe(false))`.
> Done-criteria: `npm run test` exits non-zero with one expected failure."

**What was shipped:** The implementing agent replaced the deliberately-failing placeholder with `expect(1 + 1).toBe(2)`, which always passes. `npm run test` now exits **zero**, which directly contradicts the done-criteria.

The comment in the shipped test says: "this test asserts a genuine truth (1 + 1 === 2), not a placeholder expectation." This is a unilateral deviation from the spec without authorization.

**Repro:**
```
npm run test   # exits 0
# tasks.md §0.5 requires exit non-zero
```

**Evidence:** Adversary test at `tests/adversary/CAT-scaffold-slice0-failing-test-removed.test.ts` demonstrates this regression — the file-content assertion fails with `expected '...' to contain 'expect(true).toBe(false)'`.

---

### REGRESSION 2 — `test:property` script exits non-zero; not wired into CI or test:all (concerning)

**File:** `package.json:19`, `.github/workflows/ci.yml` (no `test:property` step)
**Severity:** Concerning

**What the spec requires:** `QA_ADVERSARY.md` lists `npm run test:property` as a required gate. The `package.json` has a `test:property` script pointing at `tests/property/`. That directory does not exist.

**Observed:**
```
npm run test:property
# → "No test files found, exiting with code 1"
# Exit code: 1
```

**Additionally:** Neither `test:all` (package.json:21) nor the CI workflow (ci.yml) runs `test:property`. The gate exists as a named command but is orphaned from every automated pipeline that runs on push.

For slice 0 the VendorCascade does not exist so no property tests are expected yet, but the broken script will mislead implementers from slice 1 onward if never fixed.

---

### REGRESSION 3 — ESLint uses `recommended` instead of `strict-type-checked` (concerning)

**File:** `eslint.config.js:33`
**Severity:** Concerning

**Constitution requirement (constitution.md line 19):**
> "ESLint with `@typescript-eslint/strict-type-checked`"

**What was shipped:**
```js
...tsPlugin.configs.recommended.rules,
```

The `recommended` ruleset is substantially weaker than `strict-type-checked`. The `strict-type-checked` config adds type-aware rules (`@typescript-eslint/no-unsafe-*`, `@typescript-eslint/prefer-nullish-coalescing`, `@typescript-eslint/no-floating-promises`, etc.) that require a `parserOptions.project` setting. The scaffold omits `parserOptions.project`, making it structurally impossible to run strict-type-checked rules. The constitution mandates the stricter config; the implementation delivers the weaker one.

**Impact for future slices:** Code that would be caught by strict-type-checked type-aware rules (e.g., unhandled promise returns, unsafe member access on `any`-typed vendor responses) will silently pass lint. This is directly relevant to CAT-1 (silent failure) and CAT-8 (`as any`) when VendorCascade ships.

---

### FINDING 4 — Dead-code ternary in server/index.ts (nit)

**File:** `server/index.ts:29-31`
**Severity:** Nit (no functional impact)

Both branches of the `IS_PRODUCTION` ternary resolve to the same expression:
```ts
const REPO_ROOT = IS_PRODUCTION
  ? path.resolve(__dirname, "..")   // dist-server/ → repo root
  : path.resolve(__dirname, "..");  // server/ → repo root
```

The paths happen to resolve identically at runtime, but the conditional is vacuous. The comment on line 24-26 describes an intent to have the branches differ — that intent was never implemented.

---

### FINDING 5 — Playwright smoke test asserts H1 text, not document title (nit)

**File:** `tests/e2e/smoke.spec.ts:9`
**Severity:** Nit

**tasks.md §0.6 done-criteria:** "assert page title contains 'Carvana Onboarding'"

The smoke test checks the H1 heading (`getByRole("heading", { level: 1 })`) rather than the document `<title>` element. This accidentally passes because both the heading and the `<title>` contain "Carvana Onboarding Recovery Layer", but the test does not verify the criterion it claims to verify.

---

### FINDING 6 — CORS is fully open (`cors()` with no origin restriction) (nit for prototype)

**File:** `server/index.ts:36`
**Severity:** Nit (acceptable for slice 0 demo, must be tightened before vendor creds are wired)

`app.use(cors())` with no options defaults to `Access-Control-Allow-Origin: *`. When Carfax credentials are wired in slice 1, any browser on any domain can call the lookup API. Not a blocking issue for a demo prototype, but needs an explicit origin list before slice 1 merges.

---

## Categories tested

| Category | Active? | Result |
|---|---|---|
| CAT-1 | Yes | **PASS.** The single `catch` block in `src/App.tsx:26` sets UI state to `"unreachable"` — user-visible, not silent. Cancelled-signal check is correct. No catch-log-continue. |
| CAT-2 | N/A | No forms in slice 0. |
| CAT-3 | Yes | **PASS.** Zero matches for "check your entry", "invalid plate", "invalid vin", "please try again" in `src/`. User-visible strings are heading, lede, and server status only. |
| CAT-4 | N/A | No marketing UI in slice 0. |
| CAT-5 | N/A | No account flow in slice 0. |
| CAT-6 | N/A | All lookup endpoints return 501 NOT_IMPLEMENTED. No vendor calls. |
| CAT-7 | Yes | **PASS.** Zero references to `carvana.com` in `src/`, `server/`, `tests/`. Playwright baseURL is `http://localhost:5173`. |
| CAT-8 | Yes | **PASS.** Zero `as any` or `@ts-ignore` in the diff. |
| CAT-9 | N/A | No vendor integration in slice 0. |
| CAT-10 | N/A | No EventReporter in slice 0. |

---

## Verification command outputs

```
./scripts/check-placeholders.sh
# PASS: constitution.md
# PASS: spec.md
# PASS: plan.md
# PASS: tasks.md
# PASS: QA_ADVERSARY.md
# Exit: 0 ✓

npm run typecheck        # Exit: 0 ✓
npm run lint             # Exit: 0 ✓
npm run test             # Exit: 0 ✓ (1 pass — but §0.5 requires EXIT NON-ZERO)
npm run test:e2e         # Exit: 0 ✓
npm run test:property    # Exit: 1 ✗ (no tests/property/ directory)
npm run test:all         # Exit: 0 ✓ (does NOT invoke test:property)
```

---

## Tests added

`tests/adversary/CAT-scaffold-slice0-failing-test-removed.test.ts`
Reads `tests/unit/scaffold.test.ts` and asserts it contains `expect(true).toBe(false)`.
This test **fails** with the current scaffold, proving the task 0.5 done-criteria regression.
Run: `npm run test` → exits 1, failure on the adversary test.

---

## Recommended fix shapes (do NOT apply — diff-level QA only)

1. **Regression 1:** Restore the deliberately-failing placeholder in `tests/unit/scaffold.test.ts`. The spec is clear; the philosophical disagreement ("genuine truth is better") is not the implementer's call to make unilaterally without spec change.

2. **Regression 2:** Either (a) create `tests/property/` with a placeholder that exits 0 when the directory is empty (`vitest run --passWithNoTests tests/property`), OR (b) fix `test:property` script to use `--passWithNoTests`. Then add a `test:property` step to `ci.yml` and wire it into `test:all`.

3. **Regression 3:** Add `parserOptions: { project: true }` to the ESLint language options, then replace `tsPlugin.configs.recommended.rules` with `...tsPlugin.configs['strict-type-checked'].rules` (and `...tsPlugin.configs['stylistic-type-checked'].rules` for completeness). This is a one-line change in `eslint.config.js` once `project: true` is set.

4. **Finding 4:** Remove the ternary. Use `const REPO_ROOT = path.resolve(__dirname, "..")` unconditionally, with a comment explaining why the path is correct in both environments.

5. **Finding 5:** Replace `getByRole("heading", { level: 1 })` assertion with `expect(page.title()).resolves.toContain("Carvana Onboarding")` to match the tasks.md §0.6 done-criteria literally.

6. **Finding 6:** Lock CORS origin to the production Render URL and `http://localhost:5173` before slice 1 wires vendor credentials.

---

## Mutation escapes

Mutation testing not configured. No `stryker.conf.json`, `infection.json5`, or equivalent found in the diff.

---

## Notes for slice 1

- Regression 2 (`test:property` broken) becomes load-bearing in slice 1 when `fast-check` property tests for VendorCascade are required.
- Regression 3 (ESLint too weak) is most dangerous in slice 1 — vendor adapter code with unhandled promises and `any`-typed responses will slip past the current linter without `strict-type-checked`.
- CORS must be tightened before vendor credentials are wired.
- CAT-6 (DPPA), CAT-9 (mocked vendor), and CAT-10 (stale event names) all become active in slice 1.
- The self-review `slice-0.md` that existed before this pass listed "None" for regressions — this fresh-context pass disagrees on three findings.
