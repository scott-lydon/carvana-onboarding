/**
 * Express server scaffold for slice 0. Exposes /api/health for the client's
 * dev-loop sanity check and returns 501 NOT_IMPLEMENTED for the lookup and
 * OCR endpoints until slice 1 onward wires them up.
 *
 * The 501 responses are intentional: this is the dev-time placeholder that
 * the constitution's no-stub-data rule allows (it is not user-facing aggregate
 * data, it is an explicit "not implemented yet" signal to the client and to
 * qa-adversary).
 */
import express from "express";
import cors from "cors";
const PORT = Number(process.env.PORT ?? 3001);
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(cors());
app.get("/api/health", (_req, res) => {
    res.json({
        ok: true,
        service: "carvana-onboarding-recovery-layer",
        slice: 0,
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
    });
});
// Slice 1 wires this up against the VendorCascade.
app.post("/api/lookup/plate", (_req, res) => {
    res.status(501).json({
        error: "NOT_IMPLEMENTED",
        slice: "wires up in slice 1",
        message: "Plate lookup is not yet implemented in this build.",
    });
});
// Slice 1 also wires this up.
app.post("/api/lookup/vin", (_req, res) => {
    res.status(501).json({
        error: "NOT_IMPLEMENTED",
        slice: "wires up in slice 1",
        message: "VIN lookup is not yet implemented in this build.",
    });
});
// Slice 4 wires this up against Google Cloud Vision.
app.post("/api/ocr/recognize", (_req, res) => {
    res.status(501).json({
        error: "NOT_IMPLEMENTED",
        slice: "wires up in slice 4",
        message: "OCR recognition is not yet implemented in this build.",
    });
});
app.listen(PORT, () => {
    console.log(`[server] carvana-onboarding-recovery-layer listening on :${PORT}`);
});
