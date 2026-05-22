# QA Adversary Report — Slice 0 fixes + slice 1 prebake

- Date: 2026-05-22
- Diff: b914f2b..f274d4e (4 commits: self-review report, qa FAIL report, slice-0 fixes + slice-1 prebake, architecture website)
- Reviewer: Fresh-context qa-adversary (claude-opus-4-7) — replaces the prior self-review fallback that ran when the bridge timed out; the self-review itself flagged this fresh-context pass as the required gate.
- Verdict: **PASS**

---

## Categories tested

| Category | Active? | Result |
|---|---|---|
| CAT-1  | Yes | **PASS.** `src/App.tsx:27` catch block discriminates `AbortError` (benign teardown, commented) from real failure (`setServerStatus("unreachable")` — user-visible). No catch-log-continue. `VendorAdapter` JSDoc in `types.ts` mandates throw-on-infra, not-found-on-miss. |
| CAT-2  | N/A | No form yet (slice 1.6). |
| CAT-3  | Yes | **PASS.** Zero blame-the-user phrasing in `src/`, `server/`, or the new docs. `types.ts` errors are format-specific ("plates are ≤8 chars", "VINs are 17 chars per ISO 3779") not "invalid plate". |
| CAT-4  | N/A | No consent UI yet (slice 6). |
| CAT-5  | N/A | No account flow yet (slice 5). |
| CAT-6  | Yes | **PASS.** `VendorAdapter` exposes only `lookupByPlate`/`lookupByVin`; `Vehicle` carries year/make/model/trim/bodyStyle only — no owner/registrant/driver fields. Website trust diagram (`index.html:509`) renders `plate → owner data: FORBIDDEN` as an explicit DPPA node. |
| CAT-7  | Yes | **PASS.** Zero `carvana.com` references in code/tests. Playwright baseURL `localhost:5173`. |
| CAT-8  | Yes | **PASS.** Zero `as any` / `@ts-ignore` / `@ts-expect-error`. Lint runs under `strict-type-checked` (77 rules) with zero warnings. (Note: `types.ts:37` `upper as StateCode` is a union downcast guarded by a same-value `Set.has` check — the canonical validated-parse idiom, not an unjustified escape.) |
| CAT-9  | N/A | No integration tests yet (slice 1.2/1.5). |
| CAT-10 | N/A | No EventReporter yet (slice 7). |

## Verification command outputs

```
./scripts/check-placeholders.sh   # 5 PASS lines, exit 0 ✓
npm run typecheck                 # exit 0 ✓
npm run lint                      # exit 0, zero warnings ✓
npm run test                      # exit 1 ✓ (scaffold.test.ts fails by design, §0.5; 15 pass)
npm run test:property             # exit 0 ✓ (No test files found, --passWithNoTests)
npm run test:e2e                  # exit 0 ✓ (1 passed)
```

## Diff-specific verification

1. **scaffold.test.ts** — contains `expect(true).toBe(false)` (line 15); `npm run test` exits 1. ✓
2. **test:property** — exits 0; invoked in CI (`ci.yml:37-38` "Property-based tests") and in `test:all` (`package.json:21`). ✓
3. **eslint.config.js** — resolves `strict-type-checked` (verified: plugin exports it, 77 rules incl. `no-floating-promises`); `projectService: true` + `tsconfigRootDir` set. ✓
4. **src/lookup/types.ts** — constructors throw named errors (`TypeError` on non-string; `Error` with field-specific guidance). `LookupResult` is an exhaustive `kind`-discriminated union (resolved/not_found/transient_error/bot_detected/format_error). `Vin` flags I/O/Q with positions + "try character-permutation recovery" hint (EC2). ✓
5. **tests/unit/lookup-types.test.ts** — exercises Texas asterisk `★`/`*` (EC1), I/O/Q permutation hint (EC2), whitespace/dash/dot strip (EC4), lowercase (EC5). 14 tests, all pass. ✓
6. **server/index.ts** — CORS restricted: `origin: IS_PRODUCTION ? false : "http://localhost:5173"` (no wildcard). Dead-code `IS_PRODUCTION` ternary on `REPO_ROOT` removed. ✓
7. **website/index.html** — 3 Mermaid diagrams (topology `flowchart LR`, `sequenceDiagram`, trust `flowchart TB`); 16 `cdn.simpleicons.org` logo refs in node labels. ✓

## Regressions found

None blocking. Minor notes (non-blocking, not regressions):

- `src/lookup/types.ts:135` — the I/O/Q error hardcodes "the user likely meant 1, 0, 0 respectively" regardless of which forbidden letters actually appear. The computed `positions` list is correct; only the trailing prose is generic. Cosmetic; the message is intended for DegradationLayer translation, not raw display.
- `src/lookup/types.ts` constructor errors embed `JSON.stringify(rawInput)`. Per constitution ("never embed `getMessage()` in user-facing copy"), these must be caught and mapped to the `format_error` `LookupResult` member — never surfaced raw. The type design supports this; flagged so slice 1.6's EntryForm honors it.

## Prior-report regressions — status

- **R1** (scaffold test weakened to `expect(1+1).toBe(2)`) — **RESOLVED.** `expect(true).toBe(false)` restored; `npm run test` exits 1.
- **R2** (`test:property` exits 1, orphaned from CI/test:all) — **RESOLVED.** `--passWithNoTests` + `tests/property/.gitkeep`; exits 0; wired into `ci.yml` and `test:all`.
- **R3** (ESLint `recommended` not `strict-type-checked`) — **RESOLVED.** Config resolves `strict-type-checked` (77 type-aware rules) with `projectService: true`.

Prior nits also closed: Finding 4 (dead-code ternary removed), Finding 5 (smoke test now asserts `toHaveTitle`), Finding 6 (CORS locked to same-origin in prod).

## Notes for slice 1.2 (VinAudit adapter once credentials arrive)

- `VendorAdapter` JSDoc contract is correct: adapters return `not_found` on a missing plate and **throw** on infra failures (timeout/5xx/malformed JSON). The slice-1.2 adapter must honor this split or the cascade's transient-vs-not-found discrimination breaks.
- CAT-9 becomes active: the integration test must hit the real VinAudit sandbox gated by an env flag — no mocked vendor responses.
- CAT-6 becomes active at request-shape level: audit the actual VinAudit request payload for any owner/registrant field.
- The constitution and `plan.md` decisions table name **Carfax** as the primary vendor; `types.ts` JSDoc and tasks.md §1.2 now reference **VinAudit**. Reconcile this before wiring credentials so the architecture-pillar evidence stays internally consistent.
- `test:property` is green-but-empty; slice 1.4 must add real `fast-check` tests under `tests/property/` (the `.gitkeep` note already says so).
