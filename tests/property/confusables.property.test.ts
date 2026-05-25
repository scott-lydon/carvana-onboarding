/**
 * Property-based tests for generateConfusablePermutations.
 *
 * Invariants checked on random inputs:
 *   1. Every emitted permutation has the same length as the original.
 *   2. Every emitted permutation differs from the original ONLY at
 *      indices listed in its `swaps` array.
 *   3. Every swap's (fromChar, toChar) is in the bidirectional adjacency
 *      set derived from CONFUSABLE_PAIRS.
 *   4. editCount equals swaps.length and is in [1, MAX_EDIT_DISTANCE].
 *   5. The original is NEVER in the output.
 *   6. Output length is ≤ MAX_PERMUTATIONS.
 *   7. The result is sorted by editCount ascending, then score descending.
 *   8. Determinism: identical input → identical output.
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  CONFUSABLE_PAIRS,
  MAX_EDIT_DISTANCE,
  MAX_PERMUTATIONS,
  generateConfusablePermutations,
} from "../../src/lookup/confusables.ts";

/**
 * Build the bidirectional adjacency set ONCE so the property test does
 * not rebuild it on every shrink iteration. The set is keyed
 * `"from→to"` for fast lookup; pairs are bidirectional so we add both
 * directions.
 */
const ADJACENCY_SET: ReadonlySet<string> = (function build(): Set<string> {
  const set = new Set<string>();
  for (const pair of CONFUSABLE_PAIRS) {
    set.add(`${pair.a}→${pair.b}`);
    set.add(`${pair.b}→${pair.a}`);
  }
  return set;
})();

/**
 * Arbitrary that generates plate-like strings: 4-8 characters, drawn
 * from the set of characters that appear in any confusable pair (so we
 * exercise the swap logic on most inputs) plus a few neutral fillers
 * (Y, R) so the empty-output path is also reachable.
 */
const plateCharArb = fc.constantFrom(
  // Characters that appear in confusable pairs
  "0", "1", "2", "4", "5", "6", "7", "8",
  "A", "B", "D", "E", "F", "G", "I", "O", "Q", "S", "T", "Z",
  // Neutral fillers
  "Y", "R", "X", "J",
);

const plateStringArb = fc
  .array(plateCharArb, { minLength: 4, maxLength: 8 })
  .map((chars) => chars.join(""));

describe("confusables — property invariants", () => {
  it("every permutation has the same length as the original", () => {
    fc.assert(
      fc.property(plateStringArb, (original) => {
        const perms = generateConfusablePermutations(original);
        for (const perm of perms) {
          expect(perm.plate).toHaveLength(original.length);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("every permutation differs from original only at indices in swaps", () => {
    fc.assert(
      fc.property(plateStringArb, (original) => {
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
      }),
      { numRuns: 200 },
    );
  });

  it("every swap's (fromChar, toChar) is in the bidirectional adjacency set", () => {
    fc.assert(
      fc.property(plateStringArb, (original) => {
        const perms = generateConfusablePermutations(original);
        for (const perm of perms) {
          for (const swap of perm.swaps) {
            const key = `${swap.fromChar}→${swap.toChar}`;
            expect(ADJACENCY_SET.has(key)).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("editCount equals swaps.length and is in [1, MAX_EDIT_DISTANCE]", () => {
    fc.assert(
      fc.property(plateStringArb, (original) => {
        const perms = generateConfusablePermutations(original);
        for (const perm of perms) {
          expect(perm.editCount).toBe(perm.swaps.length);
          expect(perm.editCount).toBeGreaterThanOrEqual(1);
          expect(perm.editCount).toBeLessThanOrEqual(MAX_EDIT_DISTANCE);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("original is never in the output", () => {
    fc.assert(
      fc.property(plateStringArb, (original) => {
        const perms = generateConfusablePermutations(original);
        for (const perm of perms) {
          expect(perm.plate).not.toBe(original);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("output length is at most MAX_PERMUTATIONS", () => {
    fc.assert(
      fc.property(plateStringArb, (original) => {
        const perms = generateConfusablePermutations(original);
        expect(perms.length).toBeLessThanOrEqual(MAX_PERMUTATIONS);
      }),
      { numRuns: 200 },
    );
  });

  it("output is sorted by editCount ascending then score descending", () => {
    fc.assert(
      fc.property(plateStringArb, (original) => {
        const perms = generateConfusablePermutations(original);
        for (let i = 1; i < perms.length; i += 1) {
          const prev = perms[i - 1];
          const curr = perms[i];
          if (prev === undefined || curr === undefined) {
            throw new Error(
              `Permutation index ${String(i)} or ${String(i - 1)} is undefined; ` +
                `bounds-check bug.`,
            );
          }
          if (prev.editCount === curr.editCount) {
            expect(prev.score).toBeGreaterThanOrEqual(curr.score);
          } else {
            expect(prev.editCount).toBeLessThan(curr.editCount);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("is deterministic on identical input", () => {
    fc.assert(
      fc.property(plateStringArb, (original) => {
        const a = generateConfusablePermutations(original);
        const b = generateConfusablePermutations(original);
        expect(a).toEqual(b);
      }),
      { numRuns: 100 },
    );
  });
});
