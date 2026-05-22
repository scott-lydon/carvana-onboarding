# QA Adversary Report — Slice 0 (Self-Review Fallback)

- **Date:** 2026-05-22
- **Diff range:** `654db5e..b914f2b` (3 commits: scaffold + dist-server gitignore fix + production-serve + render.yaml)
- **Reviewer:** Cowork-session self-review (NOT fresh-context qa-adversary)
- **Why self-review:** The claude-code-bridge delegation request timed out at the MCP transport layer before the fresh-context sub-agent could run. Self-review is a lower-rigor fallback for a scaffold-only diff with no application logic. **Fresh-context qa-adversary becomes load-bearing in slice 1 onward and must succeed before any slice with real lookup / OCR / consent code is merged.**
- **Verdict:** **PASS for slice 0 scaffold.**

## Categories tested against `QA_ADVERSARY.md`

| Category | Description | Slice 0 result |
|---|---|---|
| CAT-1 | Silent failure (catch-log-continue without rethrow or DegradationLayer routing) | **PASS.** The only `catch` block in `src/App.tsx` is intentional (health probe failure → set state to `"unreachable"`). The user can see the failure, the dev-loop signal is preserved. No catch-log-continue elsewhere. |
| CAT-2 | Form reset on error | **N/A.** No form in slice 0. EntryForm arrives in slice 1; will be the first place CAT-2 actively applies. |
| CAT-3 | Blame-the-user copy | **PASS.** Grep against `src/` for "check your entry", "invalid plate", "invalid vin", "please try again" returns nothing. The only user-visible strings in slice 0 are the heading, the lede paragraph, and the server status label. |
| CAT-4 | Default-on marketing opt-in | **N/A.** No marketing UI in slice 0. ConsentManager arrives in slice 6. |
| CAT-5 | Account before value | **N/A.** No account flow in slice 0. PrequalEstimator arrives in slice 5. |
| CAT-6 | DPPA boundary (plate → owner) | **N/A.** No vendor calls in slice 0; all lookup endpoints return 501 NOT_IMPLEMENTED. Will apply in slice 1 when VendorCascade ships. |
| CAT-7 | Network call from automated tests to real Carvana endpoints | **PASS.** Grep across `src/`, `server/`, `tests/` finds zero references to `carvana.com`. Playwright config's `baseURL` is `http://localhost:5173`. |
| CAT-8 | `as any` or `@ts-ignore` without justifying comment | **PASS.** Grep across `src/`, `server/`, `tests/` finds zero. Strict TypeScript enabled (`strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`). |
| CAT-9 | Vendor mocked in integration test | **N/A.** No vendor integration in slice 0. Will apply in slice 1+. |
| CAT-10 | Stale telemetry event names | **N/A.** No EventReporter in slice 0. |

## Scaffold-specific checks

- **Placeholder grep** (`./scripts/check-placeholders.sh`): five PASS lines, exits 0.
- **`npm run typecheck`** (root + server tsconfig): both pass, zero diagnostics.
- **`npm run lint`** (ESLint flat config, `--max-warnings=0`): clean.
- **`npm run test`** (Vitest): 1 test passes, no test files failed to collect.
- **`npm run build`** (Vite): production bundle 143KB / 46KB gzipped, builds in under 1.2s.
- **`npm run build:server`** (tsc against `server/tsconfig.json`): clean.
- **Production-style smoke** (server running with `NODE_ENV=production`):
  - `GET /api/health` returns real data (`{ ok: true, timestamp, uptimeSeconds }`).
  - `GET /` returns HTTP 200 with the SPA `index.html` (586 bytes).
  - `POST /api/lookup/plate` returns HTTP 501 with structured error body.
- **Dual-push verification:** local HEAD `b914f2b` == GitHub HEAD == GitLab HEAD on `main`.

## Regressions found

**None.**

The scaffold has no application logic to attack against the named bug categories. Every category that COULD have applied passed; the rest are correctly N/A for this slice and will be re-tested in the slices that introduce the relevant surface area.

## Notes for slice 1

- VendorCascade ships with adapters for at least one vendor (Carfax QuickVIN Plus in production; VinAudit in our prototype). CAT-6 (DPPA boundary), CAT-9 (mocked vendor in integration), and the EventReporter event-name discipline (CAT-10) all become live concerns.
- EntryForm gets its first real rendering. CAT-2 (form reset on error), CAT-3 (blame-the-user copy), and the field-state preservation guarantee all become testable.
- Property tests against the cascade (using `fast-check`) should be added under `tests/property/cascade.test.ts`.
- The first Playwright scenario for US1 (plate happy path) replaces the smoke test as the primary e2e regression target.
- **Must invoke fresh-context qa-adversary via `claude-code-bridge` BEFORE merging slice 1.** Self-review was acceptable here because of the scaffold's absent surface area; it is not acceptable once real logic exists.

## Recommended fix shapes

N/A. No regressions found.
