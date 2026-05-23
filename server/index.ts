/**
 * Express server scaffold for slice 0. Exposes /api/health for the client's
 * dev-loop sanity check and returns 501 NOT_IMPLEMENTED for the lookup and
 * OCR endpoints until slice 1 onward wires them up.
 *
 * In production (NODE_ENV=production) the same process also serves the Vite
 * build output (dist/) as static files, so Render can run this as a single
 * web service rather than two.
 *
 * The 501 responses are intentional: this is the dev-time placeholder that
 * the constitution's no-stub-data rule allows (it is not user-facing aggregate
 * data, it is an explicit "not implemented yet" signal to the client and to
 * qa-adversary).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { createCascade } from "../src/lookup/createCascade.js";
import {
  makePlateLookupHandler,
  makeVinLookupHandler,
} from "./routes/lookup.js";
import { isChatConfigured, makeChatHandler } from "./routes/chat.js";
import { isOcrConfigured, makeOcrHandler } from "./routes/ocr.js";
import { getDefaultSchedulerDb } from "./scheduler/db.js";
import { makeBookHandler, makeSlotsHandler } from "./routes/schedule.js";
import { makeNpsSubmitHandler, makeNpsSummaryHandler } from "./routes/nps.js";

const PORT = Number(process.env.PORT ?? 3001);
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Resolve the repo root from this file's location. The path differs between
// dev and prod because of how tsc emits relative to the rootDir setting:
//   - dev:  tsx runs server/index.ts directly; __dirname is .../server,
//     so `..` is the repo root.
//   - prod: tsc emits to dist-server/server/index.js with rootDir set to
//     the repo root (so src/ stays addressable); __dirname is
//     .../dist-server/server, so we need TWO levels up to reach the repo
//     root, which is where dist/ (the Vite output) lives.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = IS_PRODUCTION
  ? path.resolve(__dirname, "..", "..")
  : path.resolve(__dirname, "..");
const FRONTEND_DIST = path.join(REPO_ROOT, "dist");

// CORS in dev: allow Vite's dev server origin so the proxy works.
// CORS in prod: same-origin (the SPA is served by Express itself), so a strict
// allowlist with the canonical Render URL or no CORS at all is the right move.
// For slice 0 the prod deploy URL is not finalized; lock down to same-origin
// only (no Access-Control-Allow-Origin headers emitted for cross-origin).
const corsOrigin = IS_PRODUCTION ? false : "http://localhost:5173";
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors({ origin: corsOrigin }));

app.get("/api/health", (_req: Request, res: Response): void => {
  res.json({
    ok: true,
    service: "carvana-onboarding-recovery-layer",
    slice: 0,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// Slice 1.2: VendorCascade wired here. CarsXE is primary (self-service
// signup, sandbox tier 100 calls/lifetime); VinAudit is secondary (B2B sales
// gate pending). If neither key is set the cascade is undefined and the
// route handlers return 503 configuration_missing.
const cascade = createCascade({
  CARSXE_API_KEY: process.env.CARSXE_API_KEY,
  CARSXE_BASE_URL: process.env.CARSXE_BASE_URL,
  VINAUDIT_API_KEY: process.env.VINAUDIT_API_KEY,
  VINAUDIT_BASE_URL: process.env.VINAUDIT_BASE_URL,
});
// Wrap async handlers so Express's void-return contract is satisfied
// (no-misused-promises rule). Errors inside the async handler are already
// caught by the route logic and mapped to structured 5xx bodies.
const plateHandler = makePlateLookupHandler(cascade);
const vinHandler = makeVinLookupHandler(cascade);
app.post("/api/lookup/plate", (req: Request, res: Response): void => {
  void plateHandler(req, res);
});
app.post("/api/lookup/vin", (req: Request, res: Response): void => {
  void vinHandler(req, res);
});

// v2 Slice A: chatbot orchestrator via Anthropic Messages API streaming.
// If ANTHROPIC_API_KEY is not set, the handler factory returns undefined
// and we register a 503 configuration_missing handler that names the env
// var AND the signup URL — so a fresh setup gets actionable diagnostics
// the first time someone POSTs to /api/chat.
const chatHandler = makeChatHandler(process.env.ANTHROPIC_API_KEY, cascade);
if (chatHandler === undefined) {
  console.warn(
    "[server] ANTHROPIC_API_KEY not set; /api/chat returns 503 configuration_missing. " +
      "Get a key at https://console.anthropic.com/settings/keys and add it to .env.local.",
  );
  app.post("/api/chat", (_req: Request, res: Response): void => {
    res.status(503).json({
      kind: "configuration_missing",
      missing_env_var: "ANTHROPIC_API_KEY",
      signup_url: "https://console.anthropic.com/settings/keys",
      message:
        "The chatbot needs an Anthropic API key. Set ANTHROPIC_API_KEY " +
        "in .env.local (or in the Render dashboard for the deployed " +
        "instance) and restart. The key is free to create at the signup URL " +
        "above; pay-as-you-go billing starts only after the first call.",
    });
  });
} else {
  app.post("/api/chat", (req: Request, res: Response): void => {
    void chatHandler(req, res);
  });
  console.log(
    `[server] /api/chat wired (chat_configured=${String(isChatConfigured(process.env.ANTHROPIC_API_KEY))})`,
  );
}

// v2 Slice B: Claude vision OCR. Same Anthropic key as /api/chat. If the
// key is missing we register a 503 handler so a fresh setup gets the same
// actionable diagnostics as the chat endpoint.
const ocrHandler = makeOcrHandler(process.env.ANTHROPIC_API_KEY);
if (ocrHandler === undefined) {
  app.post("/api/ocr/recognize", (_req: Request, res: Response): void => {
    res.status(503).json({
      kind: "configuration_missing",
      missing_env_var: "ANTHROPIC_API_KEY",
      signup_url: "https://console.anthropic.com/settings/keys",
      message:
        "OCR needs an Anthropic API key (same one /api/chat uses). " +
        "Set ANTHROPIC_API_KEY in .env.local and restart.",
    });
  });
} else {
  app.post("/api/ocr/recognize", (req: Request, res: Response): void => {
    void ocrHandler(req, res);
  });
  console.log(
    `[server] /api/ocr/recognize wired (ocr_configured=${String(isOcrConfigured(process.env.ANTHROPIC_API_KEY))})`,
  );
}

// v2 Slice C: scheduler endpoints backed by SQLite with atomic booking.
// v2 Slice E: NPS micro-survey endpoints share the same SQLite instance.
// REGISTERED BEFORE the SPA wildcard so /api/schedule/slots etc. don't
// get intercepted by the static catch-all (a real bug found by vouch
// depth-2: GET /api/schedule/slots returned index.html in production).
const schedulerDb = getDefaultSchedulerDb();
const slotsHandler = makeSlotsHandler(schedulerDb);
const bookHandler = makeBookHandler(schedulerDb);
const npsSubmitHandler = makeNpsSubmitHandler(schedulerDb);
const npsSummaryHandler = makeNpsSummaryHandler(schedulerDb);
app.get("/api/schedule/slots", (req: Request, res: Response): void => {
  slotsHandler(req, res);
});
app.post("/api/schedule/book", (req: Request, res: Response): void => {
  bookHandler(req, res);
});
app.post("/api/nps/submit", (req: Request, res: Response): void => {
  npsSubmitHandler(req, res);
});
app.get("/api/nps/summary", (req: Request, res: Response): void => {
  npsSummaryHandler(req, res);
});
console.log("[server] /api/schedule/{slots,book} + /api/nps/{submit,summary} wired");

// Static-serve the Vite build in production AFTER the /api routes are
// registered so the API takes precedence over the SPA's index.html fallback.
// The wildcard app.get("*") MUST be the last GET registered or it will
// shadow every API GET that came after it.
if (IS_PRODUCTION) {
  app.use(express.static(FRONTEND_DIST));
  app.get("*", (_req: Request, res: Response): void => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(
    `[server] carvana-onboarding-recovery-layer listening on :${String(PORT)} (production=${String(IS_PRODUCTION)})`,
  );
});
