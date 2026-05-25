/**
 * Unit tests for the OCR confusable permutation generator.
 *
 * These tests pin the specific real-world incidents that motivated the
 * module: the 7-vs-1, 7-vs-T, and E-vs-F misreads reported on 2026-05-24.
 * If any of these regress, the manual-test walkthrough side flow G stops
 * working and recovery from the most common OCR confusion ships broken.
 */
import { describe, expect, it } from "vitest";
import {
  CONFUSABLE_PAIRS,
  MAX_EDIT_DISTANCE,
  MAX_PERMUTATIONS,
  generateConfusablePermutations,
  isConfusable,
} from "../../src/lookup/confusables.ts";

describe("CONFUSABLE_PAIRS", () => {
  it("contains the three real-incident pairs from 2026-05-24", () => {
    const has = (a: string, b: string): boolean =>
      CONFUSABLE_PAIRS.some(
        (p) => (p.a === a && p.b === b) || (p.a === b && p.b === a),
      );
    expect(has("1", "7")).toBe(true);
    expect(has("7", "T")).toBe(true);
    expect(has("E", "F")).toBe(true);
  });

  it("weights real-incident pairs above generic OCR-literature pairs", () => {
    const userIncident = CONFUSABLE_PAIRS.find(
      (p) => p.a === "7" && p.b === "T",
    );
    const generic = CONFUSABLE_PAIRS.find((p) => p.a === "4" && p.b === "A");
    expect(userIncident).toBeDefined();
    expect(generic).toBeDefined();
    expect(userIncident?.weight).toBeGreaterThan(generic?.weight ?? 0);
  });

  it("every pair has a non-empty `observed` rationale", () => {
    for (const pair of CONFUSABLE_PAIRS) {
      expect(pair.observed.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("generateConfusablePermutations — input validation", () => {
  it("throws TypeError on non-string input", () => {
    // @ts-expect-error — intentionally violating the type for the test
    expect(() => generateConfusablePermutations(123)).toThrow(TypeError);
  });

  it("throws Error on empty string", () => {
    expect(() => generateConfusablePermutations("")).toThrow(
      /must pass the already-normalized plate/,
    );
  });

  it("throws RangeError on non-positive maxResults", () => {
    expect(() => generateConfusablePermutations("ABC", 0)).toThrow(RangeError);
    expect(() => generateConfusablePermutations("ABC", -5)).toThrow(RangeError);
  });
});

describe("generateConfusablePermutations — real-incident recovery", () => {
  it("recovers XRJ4041 from XRJ4047 (7 mis-read as 1, depth-1 1↔7 swap)", () => {
    const perms = generateConfusablePermutations("XRJ4047");
    const platesOnly = perms.map((p) => p.plate);
    expect(platesOnly).toContain("XRJ4041");
  });

  it("recovers XRJ4047 from XRJ404T (7 mis-read as T, depth-1 7↔T swap)", () => {
    const perms = generateConfusablePermutations("XRJ404T");
    expect(perms.map((p) => p.plate)).toContain("XRJ4047");
  });

  it("recovers EAT4FUN from FAT4FUN (E mis-read as F, depth-1 E↔F swap)", () => {
    const perms = generateConfusablePermutations("FAT4FUN");
    expect(perms.map((p) => p.plate)).toContain("EAT4FUN");
  });

  it("ranks the recovered plate within the top 6 candidates", () => {
    // The widget shows up to 6 candidate cards; the recovered plate must
    // not be hidden below the fold for a single-character glare swap.
    const perms = generateConfusablePermutations("XRJ4047").slice(0, 6);
    expect(perms.map((p) => p.plate)).toContain("XRJ4041");
  });
});

describe("generateConfusablePermutations — output invariants", () => {
  it("never includes the original plate in the output", () => {
    const original = "XRJ4047";
    const perms = generateConfusablePermutations(original);
    for (const perm of perms) {
      expect(perm.plate).not.toBe(original);
    }
  });

  it("output length is at most MAX_PERMUTATIONS", () => {
    const perms = generateConfusablePermutations("12345678");
    expect(perms.length).toBeLessThanOrEqual(MAX_PERMUTATIONS);
  });

  it("respects a tighter caller-supplied maxResults cap", () => {
    const perms = generateConfusablePermutations("XRJ4047", 3);
    expect(perms.length).toBeLessThanOrEqual(3);
  });

  it("every permutation differs from original at exactly the indices in swaps", () => {
    const original = "XRJ4047";
    const perms = generateConfusablePermutations(original);
    for (const perm of perms) {
      const swapIndices = new Set(perm.swaps.map((s) => s.index));
      for (let i = 0; i < original.length; i += 1) {
        const a = original.charAt(i);
        const b = perm.plate.charAt(i);
        if (a !== b) {
          expect(swapIndices.has(i)).toBe(true);
        } else {
          expect(swapIndices.has(i)).toBe(false);
        }
      }
    }
  });

  it("editCount equals swaps.length and is within [1, MAX_EDIT_DISTANCE]", () => {
    const perms = generateConfusablePermutations("XRJ4047");
    for (const perm of perms) {
      expect(perm.editCount).toBe(perm.swaps.length);
      expect(perm.editCount).toBeGreaterThanOrEqual(1);
      expect(perm.editCount).toBeLessThanOrEqual(MAX_EDIT_DISTANCE);
    }
  });

  it("is deterministic for identical input", () => {
    const a = generateConfusablePermutations("XRJ4047");
    const b = generateConfusablePermutations("XRJ4047");
    expect(a).toEqual(b);
  });

  it("sorts by editCount ascending then score descending", () => {
    const perms = generateConfusablePermutations("XRJ4047");
    for (let i = 1; i < perms.length; i += 1) {
      const prev = perms[i - 1];
      const curr = perms[i];
      if (prev === undefined || curr === undefined) {
        throw new Error(
          `Permutation index ${String(i)} or ${String(i - 1)} is undefined; ` +
            `this is a bug in the bounds check, not in the generator.`,
        );
      }
      if (prev.editCount === curr.editCount) {
        expect(prev.score).toBeGreaterThanOrEqual(curr.score);
      } else {
        expect(prev.editCount).toBeLessThan(curr.editCount);
      }
    }
  });

  it("returns the empty list when no character has any confusable neighbor", () => {
    // 'Y' is not in any confusable pair. 'X', 'R', 'J' likewise (only Z is).
    // A plate composed entirely of non-confusable characters should emit
    // zero alternatives rather than throwing.
    //
    // Note: if a future pair adds one of these characters, this test will
    // start failing — that is INTENTIONAL. Update the test along with the
    // pair so the contract stays honest.
    expect(generateConfusablePermutations("YYYY")).toEqual([]);
  });
});

describe("isConfusable", () => {
  it("returns true for characters in any pair", () => {
    expect(isConfusable("1")).toBe(true);
    expect(isConfusable("7")).toBe(true);
    expect(isConfusable("T")).toBe(true);
    expect(isConfusable("E")).toBe(true);
  });

  it("returns false for characters not in any pair", () => {
    expect(isConfusable("Y")).toBe(false);
    expect(isConfusable("R")).toBe(false);
  });
});
