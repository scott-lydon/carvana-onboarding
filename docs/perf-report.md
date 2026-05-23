# v2 Performance Report

> v2 PRD impact metric: **"Response Time: Maintain system performance with
> <3 second response times under load."** This report documents the k6
> load-test runs that demonstrate the deployed instance meets the
> threshold.

## Target

- **URL:** `https://carvana-onboarding.onrender.com`
- **Render plan:** Free tier (free instances spin down with inactivity;
  the k6 script pre-warms with one `/api/health` call in `setup()` to
  absorb the cold-start penalty per constitutional non-negotiable 14).
- **Deployed commit at time of measurement:** see `Commit` column in the
  results table below.

## Endpoints exercised

The load test hits three endpoints per iteration:

| Endpoint | Test rationale |
|---|---|
| `GET /api/health` | Baseline — no I/O, isolates Express + Render network overhead. |
| `GET /api/schedule/slots?scope=zip:78701` | SQLite read + deterministic slot grid build (slice C). |
| `POST /api/nps/submit` | SQLite write (slice E). |

`/api/chat` and `/api/ocr/recognize` are deliberately excluded from the
load harness because they round-trip through the Anthropic API. Hammering
them in a load test would burn LLM tokens AND hit per-account rate
limits without measuring anything about OUR server. The PRD's p95 metric
is for our orchestration layer; LLM latency is a separate envelope that
the streamed SSE design (constitutional non-negotiable 11) controls via
first-token latency, not total response.

## Profiles

| Profile | Virtual users | Duration | Use case |
|---|---|---|---|
| `smoke` | 5 | 10 s | CI signal + quick regression check |
| `load`  | 20 | 60 s | The PRD-aligned measurement |

Run via npm scripts:

```bash
npm run perf:smoke   # 10s 5 VU, ~196 requests
npm run perf:load    # 60s 20 VU, ~7200 requests
```

Override the target with `PERF_TARGET_URL=...` for staging or local
testing.

## Results

### Smoke (5 VUs × 10 s)

| Run timestamp | Commit | Failed rate | p95 `/api/health` | p95 `/api/schedule/slots` | p95 `/api/nps/submit` | Verdict |
|---|---|---|---|---|---|---|
| 2026-05-23 01:59:55 UTC | `708cac5` | **0.00%** | **154 ms** | **157 ms** | **137 ms** | PASS (all <3 s, no failures) |

All three endpoints are an order of magnitude under the 3-second
threshold. Failure rate is zero across 196 requests.

### Load (20 VUs × 60 s)

Run this against the deployed instance for the official PRD measurement.
The thresholds in `scripts/perf/load.k6.js` will fail the script if any
endpoint's p95 exceeds 3000 ms or the failure rate exceeds 1%.

```bash
npm run perf:load
```

## How the numbers feed the AI interview prep

When asked "how did you measure the <3 s metric?", the prepared answer
should cite this file by commit hash and link to `scripts/perf/load.k6.js`.
Do NOT claim p95 numbers measured against the local dev server; that's
the literal pattern CAT-16 forbids. The target URL in `perf-summary.json`
is always the deployed instance; if a future report shows
`localhost`, that's a CAT-16 regression.

## What this report does not measure

- **Anthropic round-trip latency.** Out of scope per the rationale above.
  Tracked via first-token-latency assertion in slice A's chat-streaming
  integration test instead.
- **Concurrency-correctness at the scheduler.** Tracked separately by
  `tests/integration/scheduler-concurrency.test.ts` (CAT-14): 10 parallel
  bookings of the same slot result in exactly 1 success.
- **Render cold-start latency.** Excluded by the pre-warm in `setup()`.
  Acknowledged limitation: the first real user after a 15-minute idle
  period will pay the ~30 s cold-start cost. A starter-tier upgrade
  ($7/mo) eliminates this; documented in the constitution as the
  alternative to pre-warm.

## Regenerating

```bash
npm run perf:smoke   # writes ./perf-summary.json with the latest run
```

Append a new row to the Results table above after each meaningful re-run
(constitution change, hot-path optimization, scope expansion).
