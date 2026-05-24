// @vitest-environment node
/**
 * OfferEngine unit tests (Slice F task F.13).
 *
 * Three test families:
 *
 *   1. Deterministic outputs — fixed inputs map to a known dollar amount,
 *      the right line-item count, and the right validity window. The
 *      formula is the deliverable so the table of golden values is the
 *      contract. A change in any constant (tier base, condition
 *      multiplier, mile rate, depreciation curve) flips one or more
 *      golden cases — that's the desired behavior, not a flaky test.
 *
 *   2. Monotonicity properties — relationships the formula MUST preserve
 *      regardless of specific dollar values. These are the laws of the
 *      offer engine and they catch broken edits (a sign flip on the
 *      mileage adjustment, a swapped condition multiplier) the goldens
 *      would miss because their absolute values still look "reasonable".
 *      Implemented as vitest property tests using fast-check.
 *
 *   3. Payoff edge cases — payoff == subtotal (net zero), payoff > subtotal
 *      (negative equity surfaces), payoff < subtotal (normal net), payoff
 *      omitted entirely (no payoff line). Every branch of the
 *      negativeEquity / netToSeller split is exercised explicitly.
 *
 * Why these matter for THIS project:
 *   The OfferEngine is the formula the demo flow stands on; it is the
 *   only place we make a dollar promise to the seller. The
 *   constitution's "no stub data" rule applies most heavily here. A
 *   silent regression in the formula would shift the headline number
 *   the user sees and undermine the whole "boring AI, transparent
 *   math" thesis from spec.md.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  generateOffer,
  makeTierFor,
  type ConditionTier,
  type OfferInput,
} from "../../server/offer/OfferEngine.ts";

/** Helper for monotonicity tests — non-payoff inputs only. */
function offerUsd(input: OfferInput): number {
  return generateOffer(input).offerUsd;
}

describe("OfferEngine — deterministic outputs", () => {
  it("returns a stable headline + payoff-free shape for a known 2021 Toyota Highlander, Good condition, 40k miles", () => {
    // Hand-derived expected value:
    //   tier = Mainstream → base $18,000
    //   year 2021, age 5  → retained 0.47  → tierBase * 0.47 = $8,460
    //   expectedMiles age 5 = 60,000; mileageDelta = 60k - 40k = +20k
    //   mileageAdj = 20,000 * 0.08 = +$1,600
    //   conditionMultiplier (Good) = 1.00
    //   subtotal = (8,460 + 1,600) * 1.00 = $10,060
    //   round to nearest $50 → $10,050
    const result = generateOffer({
      year: 2021,
      make: "Toyota",
      model: "Highlander",
      mileage: 40_000,
      condition: "Good",
    });
    expect(result.kind).toBe("offer");
    expect(result.offerUsd).toBe(10_050);
    expect(result.netToSellerUsd).toBe(10_050);
    expect(result.negativeEquityUsd).toBe(0);
    // Four lines without a payoff (base, mileage, condition, rounding).
    // A payoff would push the count to five.
    expect(result.lines).toHaveLength(4);
    expect(result.formulaVersion).toBe("2026-05-24.v1");
    expect(result.validThroughMilesDelta).toBe(1_000);
    expect(() => new Date(result.computedAt)).not.toThrow();
    expect(() => new Date(result.validThroughIso)).not.toThrow();
    // validThroughIso == computedAt + 7 days exactly.
    const computedMs = new Date(result.computedAt).getTime();
    const validThroughMs = new Date(result.validThroughIso).getTime();
    expect(validThroughMs - computedMs).toBe(7 * 24 * 60 * 60 * 1_000);
  });

  it("rounds every offer to the nearest $50", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1990, max: 2026 }),
        fc.integer({ min: 0, max: 250_000 }),
        fc.constantFrom<ConditionTier>("Excellent", "Good", "Fair", "Rough"),
        fc.constantFrom("Toyota", "Honda", "Ford", "BMW", "Mitsubishi"),
        (year, mileage, condition, make) => {
          const result = generateOffer({
            year,
            make,
            model: "TestModel",
            mileage,
            condition,
          });
          expect(result.offerUsd % 50).toBe(0);
          // Even rounded to $0, must be non-negative — never write a
          // negative offer (which would imply we're charging the user).
          expect(result.offerUsd).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("maps make to the right tier (luxury vs mainstream vs economy)", () => {
    expect(makeTierFor("Porsche")).toBe("Luxury");
    expect(makeTierFor("PORSCHE")).toBe("Luxury");
    expect(makeTierFor("  bmw ")).toBe("Luxury");
    expect(makeTierFor("Toyota")).toBe("Mainstream");
    expect(makeTierFor("Ford")).toBe("Premium");
    expect(makeTierFor("Mitsubishi")).toBe("Economy");
    expect(makeTierFor("ObscureMake")).toBe("Mainstream"); // safe fallback
  });
});

describe("OfferEngine — monotonicity properties", () => {
  it("more miles → lower (or equal) offer for the same year + make + condition", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2025 }),
        fc.integer({ min: 0, max: 80_000 }),
        fc.integer({ min: 80_001, max: 250_000 }),
        fc.constantFrom<ConditionTier>("Excellent", "Good", "Fair", "Rough"),
        fc.constantFrom("Toyota", "Honda", "BMW", "Ford"),
        (year, fewerMiles, moreMiles, condition, make) => {
          const low = offerUsd({
            year,
            make,
            model: "M",
            mileage: fewerMiles,
            condition,
          });
          const high = offerUsd({
            year,
            make,
            model: "M",
            mileage: moreMiles,
            condition,
          });
          // "Lower OR equal" because both can floor at $0 if the formula
          // would otherwise compute negative for a very high-mileage Fair
          // / Rough beater. Strict-less-than would fail on the floor.
          expect(high).toBeLessThanOrEqual(low);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("better condition → higher (or equal) offer for the same year + make + mileage", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2025 }),
        fc.integer({ min: 0, max: 200_000 }),
        fc.constantFrom("Toyota", "Honda", "BMW", "Ford"),
        (year, mileage, make) => {
          const rough = offerUsd({
            year,
            make,
            model: "M",
            mileage,
            condition: "Rough",
          });
          const fair = offerUsd({
            year,
            make,
            model: "M",
            mileage,
            condition: "Fair",
          });
          const good = offerUsd({
            year,
            make,
            model: "M",
            mileage,
            condition: "Good",
          });
          const excellent = offerUsd({
            year,
            make,
            model: "M",
            mileage,
            condition: "Excellent",
          });
          // Strictly monotonic by tier for the same other inputs (no
          // tied multipliers; Rough 0.65 < Fair 0.85 < Good 1.00 <
          // Excellent 1.05). Allow equality when the formula floors
          // to $0 for very-low-end inputs.
          expect(fair).toBeGreaterThanOrEqual(rough);
          expect(good).toBeGreaterThanOrEqual(fair);
          expect(excellent).toBeGreaterThanOrEqual(good);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Year monotonicity is *not* a global property of the formula and
   * shouldn't be — a low-mileage older car can legitimately outprice
   * a high-mileage newer one, and a very-high-mileage newer car can
   * even floor to $0 before the older equivalent does (the depreciation
   * penalty applied to a higher base is larger in absolute dollars).
   *
   * The narrowest claim we DO want to enforce is the "comparable units"
   * version: when both vehicles have exactly their year-expected miles
   * (mileageAdj = 0 for both), the formula collapses to
   *
   *     tierBase × retainedValue(year) × conditionMultiplier
   *
   * which IS strictly monotone in year because retainedValue is. Tested
   * as a fixed comparison rather than a property so the assertion stays
   * deterministic and easy to debug if a depreciation curve constant
   * shifts.
   */
  it("at year-expected miles, newer year strictly outpriced older year", () => {
    // CURRENT_YEAR is 2026 (per OfferEngine.ts). Expected miles per
    // year = (2026 - year) * 12_000. We give each car its expected
    // miles so the mileage-adjustment line goes to zero, leaving the
    // base + condition multiplier as the only contributors.
    const ages = [1, 3, 5, 8] as const;
    const expectedMiles = ages.map((age) => age * 12_000);
    const offers = ages.map((age, i) =>
      offerUsd({
        year: 2026 - age,
        make: "Toyota",
        model: "Camry",
        mileage: expectedMiles[i] ?? 0,
        condition: "Good",
      }),
    );
    // Strictly decreasing as age goes up (i.e. newer years yield more).
    for (let i = 0; i < offers.length - 1; i += 1) {
      const newer = offers[i] ?? 0;
      const older = offers[i + 1] ?? 0;
      expect(newer).toBeGreaterThan(older);
    }
  });

  it("higher tier (Luxury > Premium > Mainstream > Economy) → higher (or equal) offer for the same year + miles + condition", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2010, max: 2024 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.constantFrom<ConditionTier>("Excellent", "Good", "Fair", "Rough"),
        (year, mileage, condition) => {
          const economy = offerUsd({
            year,
            make: "Mitsubishi",
            model: "M",
            mileage,
            condition,
          });
          const mainstream = offerUsd({
            year,
            make: "Toyota",
            model: "M",
            mileage,
            condition,
          });
          const premium = offerUsd({
            year,
            make: "Ford",
            model: "M",
            mileage,
            condition,
          });
          const luxury = offerUsd({
            year,
            make: "BMW",
            model: "M",
            mileage,
            condition,
          });
          expect(mainstream).toBeGreaterThanOrEqual(economy);
          expect(premium).toBeGreaterThanOrEqual(mainstream);
          expect(luxury).toBeGreaterThanOrEqual(premium);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("is deterministic — same input produces same offerUsd across runs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2025 }),
        fc.integer({ min: 0, max: 200_000 }),
        fc.constantFrom<ConditionTier>("Excellent", "Good", "Fair", "Rough"),
        fc.constantFrom("Toyota", "Honda", "BMW", "Ford", "Mitsubishi"),
        (year, mileage, condition, make) => {
          const a = offerUsd({ year, make, model: "M", mileage, condition });
          const b = offerUsd({ year, make, model: "M", mileage, condition });
          expect(a).toBe(b);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("OfferEngine — payoff edge cases", () => {
  /**
   * A baseline configuration whose computed subtotal we can reason
   * about for the three payoff branches. Re-computed inside each test
   * so a change to the formula constants surfaces as one focused
   * failure instead of a row of cascading goldens.
   */
  function baselineInput(): OfferInput {
    return {
      year: 2021,
      make: "Toyota",
      model: "Highlander",
      mileage: 40_000,
      condition: "Good",
    };
  }

  it("payoff omitted → no payoff line, netToSeller == offer, negativeEquity == 0", () => {
    const r = generateOffer(baselineInput());
    expect(r.lines.some((l) => l.label.includes("Loan payoff"))).toBe(false);
    expect(r.netToSellerUsd).toBe(r.offerUsd);
    expect(r.negativeEquityUsd).toBe(0);
  });

  it("payoff < subtotal → payoff line present, netToSeller == offer - payoff, negativeEquity == 0", () => {
    const base = generateOffer(baselineInput());
    const payoff = Math.floor(base.offerUsd / 2);
    const r = generateOffer({ ...baselineInput(), payoffAmount: payoff });
    expect(r.lines.some((l) => l.label.includes("Loan payoff"))).toBe(true);
    expect(r.offerUsd).toBe(base.offerUsd); // payoff doesn't change the gross
    expect(r.netToSellerUsd).toBe(base.offerUsd - payoff);
    expect(r.negativeEquityUsd).toBe(0);
  });

  it("payoff == offer → netToSeller == 0, negativeEquity == 0, payoff line still rendered", () => {
    const base = generateOffer(baselineInput());
    const r = generateOffer({
      ...baselineInput(),
      payoffAmount: base.offerUsd,
    });
    expect(r.netToSellerUsd).toBe(0);
    expect(r.negativeEquityUsd).toBe(0);
    expect(r.lines.some((l) => l.label.includes("Loan payoff"))).toBe(true);
  });

  it("payoff > offer → negativeEquity == payoff - offer, netToSeller == 0, payoff line surfaces the gap copy", () => {
    const base = generateOffer(baselineInput());
    const payoff = base.offerUsd + 5_000;
    const r = generateOffer({ ...baselineInput(), payoffAmount: payoff });
    expect(r.negativeEquityUsd).toBe(5_000);
    expect(r.netToSellerUsd).toBe(0);
    const payoffLine = r.lines.find((l) => l.label.includes("Loan payoff"));
    expect(payoffLine).toBeDefined();
    expect(payoffLine?.explanation).toMatch(/cashier'?s check/i);
    expect(payoffLine?.explanation).toContain("$5,000");
  });

  it("payoff == 0 (passed explicitly) behaves the same as undefined (no payoff line)", () => {
    const r = generateOffer({ ...baselineInput(), payoffAmount: 0 });
    expect(r.lines.some((l) => l.label.includes("Loan payoff"))).toBe(false);
    expect(r.netToSellerUsd).toBe(r.offerUsd);
    expect(r.negativeEquityUsd).toBe(0);
  });

  it("rejects negative payoff with a clear programmer-error message", () => {
    expect(() =>
      generateOffer({ ...baselineInput(), payoffAmount: -100 }),
    ).toThrowError(/payoffAmount cannot be negative/);
  });

  it("rejects negative mileage with a clear programmer-error message", () => {
    expect(() =>
      generateOffer({ ...baselineInput(), mileage: -1 }),
    ).toThrowError(/mileage must be non-negative/);
  });

  it("rejects year out of supported range with a clear programmer-error message", () => {
    expect(() =>
      generateOffer({ ...baselineInput(), year: 1900 }),
    ).toThrowError(/outside the supported range/);
    expect(() =>
      generateOffer({ ...baselineInput(), year: 2200 }),
    ).toThrowError(/outside the supported range/);
  });
});
