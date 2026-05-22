/**
 * /api/lookup/plate and /api/lookup/vin route handlers.
 *
 * Responsibilities:
 *   - Parse the request body into typed domain primitives (Plate, StateCode,
 *     Vin) at the input boundary. Constructor throws → 400 format_error.
 *   - Route through the VendorCascade.
 *   - Map the discriminated-union LookupResult to HTTP status + structured
 *     body. Each named failure mode gets its own status and body shape so
 *     the DegradationLayer on the client can pattern-match.
 *   - Never embed raw error messages from caught exceptions in user-facing
 *     responses (constitution rule). Errors are mapped to format_error or
 *     transient_error structured bodies.
 *
 * If the cascade is `undefined` (no vendor credentials configured), we
 * return 503 with a clear `configuration_missing` error body. The client
 * can render a "service not yet configured" message — distinct from any
 * data-availability or bot-detection condition.
 */
import type { Request, Response } from "express";
import { Plate, Vin, parseStateCode } from "../../src/lookup/types.js";
import type { VendorCascade } from "../../src/lookup/VendorCascade.js";

export function makePlateLookupHandler(cascade: VendorCascade | undefined) {
  return async (req: Request, res: Response): Promise<void> => {
    if (cascade === undefined) {
      res.status(503).json({
        kind: "configuration_missing",
        message:
          "Vendor credentials are not configured for this deployment. " +
          "Set VINAUDIT_API_KEY in the Render dashboard and redeploy.",
      });
      return;
    }

    const rawBody = req.body as unknown;
    if (typeof rawBody !== "object" || rawBody === null) {
      res.status(400).json({
        kind: "format_error",
        field: "body",
        reason: "Request body must be a JSON object with `plate` and `state`.",
      });
      return;
    }
    const body = rawBody as Record<string, unknown>;

    let plate: Plate;
    try {
      const plateInput = body.plate;
      if (typeof plateInput !== "string") {
        throw new Error("plate must be a string");
      }
      plate = new Plate(plateInput);
    } catch (err) {
      res.status(400).json({
        kind: "format_error",
        field: "plate",
        reason: err instanceof Error ? err.message : "invalid plate input",
      });
      return;
    }

    let state;
    try {
      const stateInput = body.state;
      if (typeof stateInput !== "string") {
        throw new Error("state must be a string");
      }
      state = parseStateCode(stateInput);
    } catch (err) {
      res.status(400).json({
        kind: "format_error",
        field: "state",
        reason: err instanceof Error ? err.message : "invalid state input",
      });
      return;
    }

    let result;
    try {
      result = await cascade.lookupByPlate(plate, state);
    } catch (err) {
      // Cascade is documented to NEVER throw. If it does, that's a bug we
      // want to surface, not silently swallow. We still return a structured
      // 500 to the client.
      res.status(500).json({
        kind: "transient_error",
        retryable: true,
        cause: "unexpected_cascade_throw",
        detail:
          err instanceof Error
            ? err.message
            : "unknown cascade error",
      });
      return;
    }

    // Map LookupResult to HTTP response.
    switch (result.kind) {
      case "resolved":
        res.status(200).json(result);
        return;
      case "not_found":
        res.status(404).json(result);
        return;
      case "transient_error":
        res.status(503).json(result);
        return;
      case "bot_detected":
        res.status(429).json(result);
        return;
      case "format_error":
        res.status(400).json(result);
        return;
    }
  };
}

export function makeVinLookupHandler(cascade: VendorCascade | undefined) {
  return async (req: Request, res: Response): Promise<void> => {
    if (cascade === undefined) {
      res.status(503).json({
        kind: "configuration_missing",
        message:
          "Vendor credentials are not configured for this deployment. " +
          "Set VINAUDIT_API_KEY in the Render dashboard and redeploy.",
      });
      return;
    }

    const rawBody = req.body as unknown;
    if (typeof rawBody !== "object" || rawBody === null) {
      res.status(400).json({
        kind: "format_error",
        field: "body",
        reason: "Request body must be a JSON object with `vin`.",
      });
      return;
    }
    const body = rawBody as Record<string, unknown>;

    let vin: Vin;
    try {
      const vinInput = body.vin;
      if (typeof vinInput !== "string") {
        throw new Error("vin must be a string");
      }
      vin = new Vin(vinInput);
    } catch (err) {
      res.status(400).json({
        kind: "format_error",
        field: "vin",
        reason: err instanceof Error ? err.message : "invalid vin input",
      });
      return;
    }

    let result;
    try {
      result = await cascade.lookupByVin(vin);
    } catch (err) {
      res.status(500).json({
        kind: "transient_error",
        retryable: true,
        cause: "unexpected_cascade_throw",
        detail: err instanceof Error ? err.message : "unknown cascade error",
      });
      return;
    }

    switch (result.kind) {
      case "resolved":
        res.status(200).json(result);
        return;
      case "not_found":
        res.status(404).json(result);
        return;
      case "transient_error":
        res.status(503).json(result);
        return;
      case "bot_detected":
        res.status(429).json(result);
        return;
      case "format_error":
        res.status(400).json(result);
        return;
    }
  };
}
