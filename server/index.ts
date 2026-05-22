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

const PORT = Number(process.env.PORT ?? 3001);
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// In production the compiled server lives at dist-server/index.js relative to
// the repo root, while the frontend build lives at dist/. Resolve from this
// file's own location so the server works regardless of where the `node`
// process was launched from. Same parent in both dev and prod because tsx
// runs from server/ and tsc emits to dist-server/ which is a sibling of dist/.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
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

// Slice 1.2: VendorCascade wired here. If VINAUDIT_API_KEY is not set, the
// cascade is undefined and the route handlers return 503 configuration_missing.
const cascade = createCascade({
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

// Slice 4 wires this up against Google Cloud Vision.
app.post("/api/ocr/recognize", (_req: Request, res: Response): void => {
  res.status(501).json({
    error: "NOT_IMPLEMENTED",
    slice: "wires up in slice 4",
    message: "OCR recognition is not yet implemented in this build.",
  });
});

// Static-serve the Vite build in production AFTER the /api routes are
// registered so the API takes precedence over the SPA's index.html fallback.
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
