/**
 * /api/lookup/plate and /api/lookup/vin route handlers.
 *
 * Responsibilities:
 *   - Parse the request body into typed domain primitives (Plate, StateCode,
 *     Vin) at the input boundary. Constructor throws → 400 format_error.
 *   - For VIN: try `tryParseVinWithPermutation` so I→1, O→0, Q→0 substitution
 *     happens server-side BEFORE we surface an error. If permutation
 *     succeeds, the resolved response carries a `correction` field the
 *     client renders as a calm "we corrected your VIN" banner.
 *   - Route through the VendorCascade.
 *   - Map the discriminated-union LookupResult to HTTP status + structured
 *     body. Each named failure mode gets its own status and body shape so
 *     the DegradationLayer on the client can pattern-match.
 *   - For format_error, include BOTH the technical `reason` (from the domain
 *     constructor) and a `userFriendlyReason` (calm prose). The client
 *     shows userFriendlyReason in the panel and tucks `reason` behind a
 *     "Developer details" accordion.
 *   - For not_found, include an `origin: "plate" | "vin"` field so the
 *     client picks the right next-step advice. Without this field, a VIN
 *     not_found could mistakenly show "switch to VIN entry" — see manual
 *     test docs/qa-reports/manual-tests.md case M3.
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
import { Plate, parseStateCode, tryParseVinWithPermutation } from "../../src/lookup/types.js";
import type { VendorCascade } from "../../src/lookup/VendorCascade.js";

/**
 * Map a thrown Plate-constructor message to user-facing prose. The
 * constructor messages carry diagnostic value for tests and server logs;
 * the user sees the calmer version below. Falls through to a generic
 * "doesn't look like a US plate" so a future constructor message added
 * without updating this mapper still surfaces something polite.
 */
function friendlyPlateReason(technical: string): string {
  if (technical.includes("longer than the 8-character upper bound")) {
    return "That looks too long for a US license plate — most are 6 to 8 characters. Want to recheck?";
  }
  if (technical.includes("at least one alphanumeric character")) {
    return "We need at least one letter or number to look up a plate.";
  }
  if (technical.includes("must be a string")) {
    return "The plate field came through empty. Type the plate as it appears on the car.";
  }
  return "That doesn't quite look like a US license plate. Try again with letters and numbers only.";
}

/**
 * Map a thrown Vin-constructor message to user-facing prose. By the time
 * this fires, `tryParseVinWithPermutation` has already attempted the I→1,
 * O→0, Q→0 substitution and failed, so we do NOT suggest "try replacing the
 * letters" — that's already been done.
 */
function friendlyVinReason(technical: string): string {
  if (technical.includes("must be exactly 17 characters")) {
    return "A modern VIN is exactly 17 characters. Double-check that nothing was missed or doubled.";
  }
  if (technical.includes("forbidden characters per ISO 3779")) {
    return "Real VINs never contain the letters I, O, or Q. We tried correcting them automatically and the result still wasn't a valid VIN — could you double-check the source?";
  }
  if (technical.includes("must be a string")) {
    return "The VIN field came through empty. Find the 17-character VIN on the driver's-side door jamb or registration.";
  }
  return "That doesn't look like a 17-character VIN. The VIN sits on the driver's-side door jamb and on your registration.";
}

function friendlyStateReason(technical: string): string {
  if (technical.includes("Invalid US state code")) {
    return "Use the two-letter US state code (CA, TX, NY, and so on).";
  }
  if (technical.includes("must be a string")) {
    return "Pick a US state from the field next to the plate.";
  }
  return "We need a US state code (two letters) to look up the plate.";
}

export function makePlateLookupHandler(cascade: VendorCascade | undefined) {
  return async (req: Request, res: Response): Promise<void> => {
    if (cascade === undefined) {
      res.status(503).json({
        kind: "configuration_missing",
        message:
          "Vendor credentials are not configured for this deployment. " +
          "Set CARSXE_API_KEY (primary) or VINAUDIT_API_KEY (fallback) " +
          "in the Render dashboard and redeploy.",
      });
      return;
    }

    const rawBody = req.body as unknown;
    if (typeof rawBody !== "object" || rawBody === null) {
      res.status(400).json({
        kind: "format_error",
        field: "body",
        reason: "Request body must be a JSON object with `plate` and `state`.",
        userFriendlyReason:
          "Something went wrong sending your plate — please refresh and try again.",
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
      const technical = err instanceof Error ? err.message : "invalid plate input";
      res.status(400).json({
        kind: "format_error",
        field: "plate",
        reason: technical,
        userFriendlyReason: friendlyPlateReason(technical),
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
      const technical = err instanceof Error ? err.message : "invalid state input";
      res.status(400).json({
        kind: "format_error",
        field: "state",
        reason: technical,
        userFriendlyReason: friendlyStateReason(technical),
      });
      return;
    }

    let result;
    try {
      result = await cascade.lookupByPlate(plate, state);
    } catch (err) {
      // Cascade is documented to NEVER throw. If it does, that's a bug we
      // want to surface in our server logs, not forward into the client
      // response body. Per constitution CAT-3 ("Never expose getMessage()
      // in user-facing output"), the response body carries only a fixed
      // generic detail string; the actual exception goes to stderr where
      // the operator can read it without exposing internals to the client.
      // See docs/qa-reports/slice-1.6.md R1.
      console.error(
        "[lookup/plate] unexpected cascade throw — investigate immediately:",
        err,
      );
      res.status(500).json({
        kind: "transient_error",
        retryable: true,
        cause: "unexpected_cascade_throw",
        detail:
          "An unexpected internal error occurred. The operator has been " +
          "notified; please retry shortly.",
      });
      return;
    }

    // Map LookupResult to HTTP response. The plate route attaches origin
    // so the client renders plate-specific not_found copy.
    switch (result.kind) {
      case "resolved":
        res.status(200).json(result);
        return;
      case "not_found":
        res.status(404).json({ ...result, origin: "plate" });
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
          "Set CARSXE_API_KEY (primary) or VINAUDIT_API_KEY (fallback) " +
          "in the Render dashboard and redeploy.",
      });
      return;
    }

    const rawBody = req.body as unknown;
    if (typeof rawBody !== "object" || rawBody === null) {
      res.status(400).json({
        kind: "format_error",
        field: "body",
        reason: "Request body must be a JSON object with `vin`.",
        userFriendlyReason:
          "Something went wrong sending your VIN — please refresh and try again.",
      });
      return;
    }
    const body = rawBody as Record<string, unknown>;

    const vinInput = body.vin;
    if (typeof vinInput !== "string") {
      res.status(400).json({
        kind: "format_error",
        field: "vin",
        reason: "vin must be a string",
        userFriendlyReason:
          "The VIN field came through empty. Find the 17-character VIN on the driver's-side door jamb.",
      });
      return;
    }

    // Try the auto-permutation parser FIRST so I→1, O→0, Q→0 substitution
    // happens server-side before we surface any error. If the user typed a
    // valid VIN, this is identical to `new Vin(...)`. If they typed one
    // with I/O/Q, we try the correction once. If that also fails (bad
    // length, etc.), we surface the ORIGINAL error so messages reference
    // the user's literal input.
    const parsed = tryParseVinWithPermutation(vinInput);
    if (parsed.kind === "failed") {
      const technical = parsed.failure.message;
      res.status(400).json({
        kind: "format_error",
        field: "vin",
        reason: technical,
        userFriendlyReason: friendlyVinReason(technical),
      });
      return;
    }
    const { vin, corrected } = parsed;

    let result;
    try {
      result = await cascade.lookupByVin(vin);
    } catch (err) {
      // Same constitution rule as the plate handler above. See
      // docs/qa-reports/slice-1.6.md R1.
      console.error(
        "[lookup/vin] unexpected cascade throw — investigate immediately:",
        err,
      );
      res.status(500).json({
        kind: "transient_error",
        retryable: true,
        cause: "unexpected_cascade_throw",
        detail:
          "An unexpected internal error occurred. The operator has been " +
          "notified; please retry shortly.",
      });
      return;
    }

    switch (result.kind) {
      case "resolved": {
        // If permutation was applied, attach the correction so the client
        // shows a "we corrected your VIN" banner above the resolved car.
        const responseBody = corrected !== undefined
          ? {
              ...result,
              correction: {
                original: corrected.original,
                normalized: corrected.normalized,
                reason:
                  "We swapped the letters I, O, and Q to 1 and 0 — real VINs never use those letters.",
              },
            }
          : result;
        res.status(200).json(responseBody);
        return;
      }
      case "not_found":
        // VIN-route not_found: do NOT tell the user to switch to VIN entry
        // (they ARE on VIN entry). Origin field lets the client pick the
        // right next-step advice. See manual test M3.
        res.status(404).json({ ...result, origin: "vin" });
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
