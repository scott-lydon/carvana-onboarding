/**
 * k6 load test for the v2 PRD "<3 s response time under load" metric.
 *
 * Usage:
 *   k6 run scripts/perf/load.k6.js                    # default: 20 VU 60 s, deployed
 *   PERF_TARGET_URL=http://localhost:3001 k6 run ...  # override target
 *   PERF_PROFILE=smoke k6 run ...                     # 5 VU 10 s (CI)
 *
 * Endpoints under test (excluding /api/chat and /api/ocr/recognize because
 * those round-trip through Anthropic and would burn tokens + hit rate
 * limits; the PRD's p95 metric measures OUR server under load, not the
 * LLM's):
 *   - GET /api/health           (baseline, no I/O)
 *   - GET /api/schedule/slots?scope=zip:78701  (SQLite query + grid build)
 *   - POST /api/nps/submit      (SQLite write)
 *
 * Thresholds: PRD requires p95 < 3 s. We assert p95 < 3000 ms per
 * endpoint group. The bench also asserts http_req_failed < 1% so a
 * silently 500-ing endpoint fails the test even if latency looks fine.
 *
 * Constitutional non-negotiable 14: this script targets the DEPLOYED
 * instance (default https://carvana-onboarding.onrender.com), pre-warmed
 * via a single /api/health call in setup(). The script reports the
 * target URL in the JSON summary so docs/perf-report.md can cite it.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const TARGET_URL = __ENV.PERF_TARGET_URL || "https://carvana-onboarding.onrender.com";
const PROFILE = __ENV.PERF_PROFILE || "load";

const PROFILES = {
  smoke: { vus: 5, duration: "10s" },
  load: { vus: 20, duration: "60s" },
};

export const options = {
  vus: PROFILES[PROFILE].vus,
  duration: PROFILES[PROFILE].duration,
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{endpoint:health}": ["p(95)<3000"],
    "http_req_duration{endpoint:slots}": ["p(95)<3000"],
    "http_req_duration{endpoint:nps_submit}": ["p(95)<3000"],
  },
  summaryTrendStats: ["min", "med", "avg", "p(90)", "p(95)", "p(99)", "max"],
};

// Custom per-endpoint trends so the summary JSON is grouped legibly.
const healthLatency = new Trend("p95_health");
const slotsLatency = new Trend("p95_slots");
const npsLatency = new Trend("p95_nps_submit");

export function setup() {
  // Pre-warm. Render free tier spins down after 15 min idle; the first
  // request after a spin-down takes ~30 s. The pre-warm absorbs that
  // penalty so the test measures steady-state behavior.
  const warmupRes = http.get(`${TARGET_URL}/api/health`, { timeout: "60s" });
  return { target: TARGET_URL, prewarm_status: warmupRes.status };
}

export default function () {
  const r1 = http.get(`${TARGET_URL}/api/health`, {
    tags: { endpoint: "health" },
  });
  check(r1, { "health 200": (r) => r.status === 200 });
  healthLatency.add(r1.timings.duration);

  const r2 = http.get(`${TARGET_URL}/api/schedule/slots?scope=zip:78701`, {
    tags: { endpoint: "slots" },
  });
  check(r2, { "slots 200": (r) => r.status === 200 });
  slotsLatency.add(r2.timings.duration);

  // NPS submit hits SQLite (write). Use a unique sessionId per request so
  // we don't conflict with previous runs' rows (the schema allows multi-
  // row per session but the unique sessionId keeps the dataset readable).
  const npsBody = JSON.stringify({
    sessionId: `perf-${__VU}-${__ITER}-${Date.now()}`,
    score: (__ITER % 11),
    elapsedSeconds: 30 + __ITER,
    comment: "k6 perf run",
  });
  const r3 = http.post(`${TARGET_URL}/api/nps/submit`, npsBody, {
    headers: { "Content-Type": "application/json" },
    tags: { endpoint: "nps_submit" },
  });
  check(r3, { "nps 200": (r) => r.status === 200 });
  npsLatency.add(r3.timings.duration);

  sleep(0.5);
}

export function handleSummary(data) {
  const summary = {
    profile: PROFILE,
    target: TARGET_URL,
    duration: PROFILES[PROFILE].duration,
    vus: PROFILES[PROFILE].vus,
    timestamp: new Date().toISOString(),
    requests_total: data.metrics.http_reqs.values.count,
    requests_failed_rate: data.metrics.http_req_failed.values.rate,
    p95: {
      health: data.metrics.p95_health?.values["p(95)"],
      slots: data.metrics.p95_slots?.values["p(95)"],
      nps_submit: data.metrics.p95_nps_submit?.values["p(95)"],
    },
    thresholds_passed: !Object.values(data.thresholds || {}).some(
      (t) => Object.values(t).some((v) => v),
    ),
  };
  return {
    "stdout": textSummary(data, summary),
    "perf-summary.json": JSON.stringify(summary, null, 2),
  };
}

function textSummary(data, summary) {
  const lines = [];
  lines.push("");
  lines.push(`=== k6 perf summary (${summary.profile}) ===`);
  lines.push(`target:       ${summary.target}`);
  lines.push(`duration:     ${summary.duration}`);
  lines.push(`vus:          ${summary.vus}`);
  lines.push(`total reqs:   ${summary.requests_total}`);
  lines.push(`failed rate:  ${(summary.requests_failed_rate * 100).toFixed(2)}%`);
  lines.push(`p95 health:       ${formatMs(summary.p95.health)}`);
  lines.push(`p95 slots:        ${formatMs(summary.p95.slots)}`);
  lines.push(`p95 nps_submit:   ${formatMs(summary.p95.nps_submit)}`);
  lines.push("");
  return lines.join("\n");
}

function formatMs(v) {
  if (v === undefined || v === null) return "n/a";
  return `${v.toFixed(0)} ms`;
}
