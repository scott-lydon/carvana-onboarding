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
import {
  generateConfusablePermutations,
  type PlatePermutation,
} from "../../src/lookup/confusables.js";

/**
 * One interpretation we surface in the not-found response when the
 * primary plate lookup misses. The widget on the client renders these
 * as a ranked list of "did you mean" candidate cards, with the swapped
 * characters diff-highlighted from the original.
 *
 * `kind` is always `"resolved_alternative"` so the client can ignore
 * stray entries without a vehicle. Future variants (e.g. fuzzy DB
 * matches that did NOT resolve in the vendor cascade but might still be
 * worth offering as a typed-correction hint) will land here as new
 * discriminator values.
 */
interface InterpretationCandidate {
  readonly kind: "resolved_alternative";
  readonly plate: string;
  readonly vehicle: unknown;
  readonly viaVendor: string;
  readonly editCount: number;
  readonly swaps: PlatePermutation["swaps"];
}

/**
 * Bounds the worst-case vendor cost when a plate has many confusable
 * positions. Even with MAX_PERMUTATIONS = 24 candidate plates, we cap
 * the parallel fan-out at 8 in flight at a time so a slow vendor does
 * not block 23 other requests behind it. The number is also low enough
 * that the cascade-side rate limits (CarsXE: 60/min on sandbox tier)
 * do not get hit by a single miss-recovery.
 */
const PERMUTATION_PARALLELISM = 8;

/**
 * Limit on number of resolved alternatives we'll attach to the response.
 * The widget renders up to 6 candidate cards; emitting more is wasted
 * vendor cost and wasted bytes on the wire. 6 chosen to match the
 * client's render cap so the contract is symmetric.
 */
const MAX_INTERPRETATIONS = 6;

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

/**
 * Walk the OCR-confusable permutations of `originalPlate` and probe each
 * one through the vendor cascade. Returns the resolved alternatives in
 * the same rank order the permuter emitted.
 *
 * Bounded concurrency: at most PERMUTATION_PARALLELISM probes in flight
 * at a time, so a slow vendor does not stall the whole fan-out.
 *
 * Soft-cap on resolved hits at MAX_INTERPRETATIONS: as soon as we have
 * that many, we stop firing new probes. In-flight probes still resolve
 * but their results are not added. The fan-out is best-effort; vendor
 * errors on individual permutations are logged and swallowed so one
 * vendor hiccup does not prevent surfacing the OTHER candidates.
 *
 * Returns the empty list when no permutations resolved — the route still
 * emits the not_found response (the widget always renders when
 * `interpretations` is present in the response, even if empty, so the
 * client can show "no close matches" alongside the retake/retype
 * affordances).
 */
async function probePermutations(
  cascade: VendorCascade,
  originalPlate: Plate,
  state: ReturnType<typeof parseStateCode>,
): Promise<readonly InterpretationCandidate[]> {
  const permutations = generateConfusablePermutations(originalPlate.normalized);
  if (permutations.length === 0) return [];

  const resolved: InterpretationCandidate[] = [];
  let index = 0;
  let stop = false;

  async function worker(): Promise<void> {
    while (!stop) {
      const i = index++;
      if (i >= permutations.length) return;
      const perm = permutations[i];
      if (perm === undefined) return;
      let alternatePlate: Plate;
      try {
        alternatePlate = new Plate(perm.plate);
      } catch (err) {
        // A permutation that violates the Plate constructor's length /
        // alphabet rules cannot be looked up. Log so the operator can
        // tune the confusable set if a particular permutation always
        // bounces, then skip.
        console.warn(
          `[probePermutations] permutation ${perm.plate} rejected by Plate constructor:`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }
      try {
        const result = await cascade.lookupByPlate(alternatePlate, state);
        if (result.kind === "resolved") {
          // Re-check the cap BEFORE pushing. Without this guard,
          // PARALLELISM-1 workers in flight at the moment `stop` flips
          // would each still push their resolved candidate, taking the
          // final length up to MAX_INTERPRETATIONS + (PARALLELISM - 1).
          // Harmless downstream (the widget slices to 6) but a contract
          // violation of the "soft cap at MAX_INTERPRETATIONS" promise
          // documented above. Caught in the qa-adversary pass on
          // commit 214fc16.
          if (resolved.length >= MAX_INTERPRETATIONS) {
            stop = true;
            return;
          }
          resolved.push({
            kind: "resolved_alternative",
            plate: perm.plate,
            vehicle: result.vehicle,
            viaVendor: result.viaVendor,
            editCount: perm.editCount,
            swaps: perm.swaps,
          });
          if (resolved.length >= MAX_INTERPRETATIONS) {
            stop = true;
            return;
          }
        }
        // Non-resolved permutation results (not_found, transient_error,
        // bot_detected, format_error) are expected and silently ignored.
        // We only care about hits during recovery; the original lookup's
        // failure mode is what the user-facing response already carries.
      } catch (err) {
        console.warn(
          `[probePermutations] cascade threw on permutation ${perm.plate}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  const workerCount = Math.min(PERMUTATION_PARALLELISM, permutations.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  // Preserve the permuter's rank order. Workers race so insertion order
  // in `resolved` is non-deterministic; sort back to the input order
  // (lower index in permutations[] = higher rank).
  const permIndexByPlate = new Map<string, number>();
  permutations.forEach((p, i) => permIndexByPlate.set(p.plate, i));
  return resolved.sort(
    (l, r) =>
      (permIndexByPlate.get(l.plate) ?? Number.MAX_SAFE_INTEGER) -
      (permIndexByPlate.get(r.plate) ?? Number.MAX_SAFE_INTEGER),
  );
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
      case "not_found": {
        // OCR-confusable recovery. Fan out the permutations of the
        // normalized plate through the cascade and attach any hits as
        // `interpretations` so the client renders the
        // PlateInterpretationsWidget with "did you mean" cards.
        //
        // The widget renders even when zero permutations resolved (to
        // surface retake/retype affordances), so we always include the
        // `interpretations` field on a plate not_found — empty array
        // when nothing came back. The presence of the field is the
        // client-side trigger; its emptiness is a UX, not an error.
        //
        // We swallow probePermutations throws entirely: a failure of
        // the recovery layer must not block the primary not_found
        // response. The original miss is the user-actionable fact.
        let interpretations: readonly InterpretationCandidate[] = [];
        try {
          interpretations = await probePermutations(cascade, plate, state);
        } catch (err) {
          console.error(
            "[lookup/plate] probePermutations threw — recovery layer failed; " +
              "original not_found will still surface without alternatives:",
            err,
          );
        }
        res.status(404).json({
          ...result,
          origin: "plate",
          originalPlate: plate.normalized,
          interpretations,
        });
        return;
      }
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
