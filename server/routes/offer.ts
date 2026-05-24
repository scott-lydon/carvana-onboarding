/**
 * /api/offer/generate — instant-offer endpoint.
 *
 * Wraps the pure OfferEngine.generateOffer in HTTP. Input shape:
 *
 *   POST application/json
 *   {
 *     year:          number,         // 1980..2027
 *     make:          string,
 *     model:         string,
 *     mileage:       number,         // non-negative
 *     condition:     "Excellent" | "Good" | "Fair" | "Rough",
 *     payoffAmount?: number          // dollars, omit/undef = no lien
 *   }
 *
 * Returns the full OfferResult (see OfferEngine.ts) on 200, including
 * the line-itemed breakdown the UI renders. Every validation failure
 * is a 400 with field + reason, NOT a 500, so the client surfaces
 * actionable copy instead of a generic crash.
 *
 * The endpoint is intentionally synchronous and pure — no Anthropic
 * call, no DB write. The offer is reproducible from inputs alone
 * (formulaVersion is pinned in the response so an old offer can be
 * re-derived from its historical formula if the table changes).
 */
import type { Request, Response } from "express";
import {
  generateOffer,
  type ConditionTier,
  type OfferInput,
} from "../offer/OfferEngine.js";

const CONDITION_TIERS: readonly ConditionTier[] = [
  "Excellent",
  "Good",
  "Fair",
  "Rough",
];

export function makeOfferHandler(): (req: Request, res: Response) => void {
  return (req, res) => {
    const rawBody = req.body as unknown;
    if (typeof rawBody !== "object" || rawBody === null) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "body",
        reason:
          "request body must be a JSON object with {year, make, model, mileage, condition, payoffAmount?}",
      });
      return;
    }
    const body = rawBody as Record<string, unknown>;

    const year = body.year;
    if (typeof year !== "number" || !Number.isFinite(year)) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "year",
        reason: "year must be a finite number (model year, e.g. 2021)",
      });
      return;
    }
    if (year < 1980 || year > 2027) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "year",
        reason: `year ${String(year)} is outside the supported range 1980..2027`,
      });
      return;
    }

    const make = body.make;
    if (typeof make !== "string" || make.trim() === "") {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "make",
        reason: "make must be a non-empty string (e.g. 'Toyota')",
      });
      return;
    }

    const model = body.model;
    if (typeof model !== "string" || model.trim() === "") {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "model",
        reason: "model must be a non-empty string (e.g. 'Camry')",
      });
      return;
    }

    const mileage = body.mileage;
    if (typeof mileage !== "number" || !Number.isFinite(mileage) || mileage < 0) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "mileage",
        reason:
          "mileage must be a non-negative finite number (odometer reading in miles)",
      });
      return;
    }

    const condition = body.condition;
    if (typeof condition !== "string" || !isConditionTier(condition)) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "condition",
        reason: `condition must be one of: ${CONDITION_TIERS.join(", ")}`,
      });
      return;
    }

    const payoffAmountRaw = body.payoffAmount;
    let payoffAmount: number | undefined;
    if (payoffAmountRaw === undefined || payoffAmountRaw === null) {
      payoffAmount = undefined;
    } else if (
      typeof payoffAmountRaw !== "number" ||
      !Number.isFinite(payoffAmountRaw) ||
      payoffAmountRaw < 0
    ) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "payoffAmount",
        reason:
          "payoffAmount must be a non-negative finite number (10-day loan payoff in dollars). " +
          "Omit the field entirely when there is no lien.",
      });
      return;
    } else {
      payoffAmount = payoffAmountRaw;
    }

    // exactOptionalPropertyTypes: omit payoffAmount entirely when the
    // request didn't provide one. Materializing it as undefined would
    // violate OfferInput's optional-property contract.
    const input: OfferInput = {
      year,
      make: make.trim(),
      model: model.trim(),
      mileage,
      condition,
      ...(payoffAmount !== undefined ? { payoffAmount } : {}),
    };
    try {
      const result = generateOffer(input);
      res.status(200).json(result);
    } catch (err) {
      // generateOffer only throws on programmer-error inputs the
      // request validator should have caught above. Surface the
      // detail rather than swallowing it.
      console.error("[offer] generateOffer threw on validated input — investigate:", err);
      const detail = err instanceof Error ? err.message : "unknown";
      res.status(500).json({
        kind: "internal_error",
        detail: `OfferEngine raised after validation: ${detail}`,
      });
    }
  };
}

function isConditionTier(value: string): value is ConditionTier {
  return (CONDITION_TIERS as readonly string[]).includes(value);
}

function sendJsonError(
  res: Response,
  status: number,
  body: Record<string, unknown>,
): void {
  res.status(status).json(body);
}
