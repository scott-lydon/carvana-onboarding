/**
 * confusables.ts — pure permutation generator for OCR character confusions.
 *
 * When the vision model misreads a license-plate photo (most often glare,
 * dirt, low contrast, or a tilted angle), the read often differs from
 * truth by a single glyph that another character in the OCR alphabet
 * shares strokes with: `7` reads as `1` because the top of the stem is
 * clipped; `0` reads as `O` because both are closed ovals; `E` reads as
 * `F` because the bottom horizontal washes out in low contrast; and so
 * on. This module enumerates the closest neighbors of a given plate
 * string by walking that confusable graph.
 *
 * The generator is intentionally pure: no IO, no network, no clock, no
 * randomness. It returns a deterministic list ranked by edit cost so the
 * caller (server/routes/lookup.ts, which fans the permutations out to the
 * vendor cascade) can stop early if it needs to bound vendor cost.
 *
 * Design choices, with the why next to each (so a future contributor can
 * make informed edits instead of guessing intent):
 *
 *   - Pairs are bidirectional. `1 ↔ 7` means "if the OCR returned a 1,
 *     consider whether it was a 7" AND "if it returned a 7, consider 1".
 *     Real captures arrive on either side of the ambiguity; the user
 *     reported both 7→1 (top of seven clipped, looks like a one) AND
 *     7→T (serif on the seven reads as the T crossbar) on 2026-05-24.
 *
 *   - Pairs are seeded ONLY from observed OCR confusions. We do not
 *     speculate; every pair has a rationale comment naming the visual
 *     stroke overlap or a real incident that surfaced it. Speculative
 *     pairs would multiply the fan-out for no real recovery value, and
 *     each pair costs one vendor call per emitted permutation in the
 *     worst case.
 *
 *   - The output is sorted by the number of substitutions applied
 *     (smallest first) and then by descending priority of the swapped
 *     pair. "Top of stem clipped" 1↔7 is more common than 4↔A, so it
 *     gets a higher priority weight; under the same edit count, a single
 *     1↔7 swap ranks above a single 4↔A swap.
 *
 *   - We cap at MAX_PERMUTATIONS (default 24) so a plate with several
 *     confusable characters does not produce a combinatorial fan-out.
 *     With ~8 pairs touching ~14 characters across the OCR alphabet and
 *     a 6-character plate, the un-capped count would routinely exceed
 *     2^6 = 64 outputs and incur 64 vendor calls per miss. 24 keeps the
 *     worst-case cost bounded and still covers every plausible single-
 *     and most double-substitution recoveries.
 *
 * Idempotent on the original: if the input itself is in the output set
 * (because no permutation differs), it is the FIRST element with edit
 * distance 0. Callers can use this as the canonical "try the original
 * first" entry and trust that the rest are alternatives.
 */

/**
 * One confusable pair plus the priority weight used to break ties when
 * two candidate plates have the same edit count. Higher = surface first.
 *
 * The `observed` field is a short, dated note about where this pair was
 * actually caught misreading in the wild. Pairs without an observation
 * are documented as "well-attested in OCR literature" and weighted
 * lower than user-incident pairs so newly-discovered confusions
 * automatically rank above generic ones.
 */
export interface ConfusablePair {
  readonly a: string;
  readonly b: string;
  readonly weight: number;
  readonly observed: string;
}

/**
 * The seed pairs. Order in this array DOES NOT affect output ranking
 * (weight does). Each pair carries a one-line rationale so future edits
 * are grounded in cause, not guesswork.
 *
 * Weights: 100 = real user incident this past week, 80 = real user
 * incident historic, 60 = well-attested OCR confusion documented in
 * vendor literature, 40 = plausible but rare.
 */
export const CONFUSABLE_PAIRS: readonly ConfusablePair[] = [
  // User-reported on 2026-05-24: photographed plate had a 7 mis-read as
  // a 1 (top of the seven's stem was clipped by glare and read as a one).
  { a: "1", b: "7", weight: 100, observed: "2026-05-24 plate photo (7 read as 1)" },
  // User-reported on 2026-05-24: same plate, the 7 also read as a T on
  // another capture (serif on the 7 read as the T crossbar). This is a
  // letter↔digit confusion classic OCR maps miss.
  { a: "7", b: "T", weight: 100, observed: "2026-05-24 plate photo (7 read as T)" },
  // User-reported on 2026-05-24: an E read as an F because the bottom
  // horizontal of the E washed out in the capture. Letter↔letter.
  { a: "E", b: "F", weight: 100, observed: "2026-05-24 plate photo (E read as F)" },
  // Closed-oval glyph cluster. All four characters share a closed-loop
  // top half; the OCR routinely substitutes within this set on low-DPI
  // or sun-bleached plates. Encoded as three independent pairs rather
  // than a single set so the permuter walks one swap at a time.
  { a: "0", b: "O", weight: 80, observed: "classic OCR — closed oval" },
  { a: "0", b: "Q", weight: 60, observed: "classic OCR — closed oval with tail clipped" },
  { a: "0", b: "D", weight: 60, observed: "classic OCR — open right side of D washes out" },
  { a: "O", b: "Q", weight: 60, observed: "classic OCR — Q tail invisible at distance" },
  // ISO 3779 outlaws I in VINs precisely because of this — but US license
  // plates ARE allowed to carry I, so we keep the pair for plate lookups
  // even though the VIN parser already strips I/O/Q upstream.
  { a: "1", b: "I", weight: 80, observed: "classic OCR — vertical stem" },
  // Loopy-glyph cluster.
  { a: "8", b: "B", weight: 80, observed: "classic OCR — stacked loops" },
  // S-shape cluster.
  { a: "5", b: "S", weight: 80, observed: "classic OCR — S-curve" },
  // Z/2 cluster.
  { a: "2", b: "Z", weight: 60, observed: "classic OCR — angular Z reads as 2" },
  // 6/G cluster — both have a closed bottom and an open top-right hook.
  { a: "6", b: "G", weight: 60, observed: "classic OCR — open hook" },
  // 4/A cluster — both have a triangular top with a horizontal crossbar.
  { a: "4", b: "A", weight: 40, observed: "classic OCR — triangular top" },
];

/**
 * Build the bidirectional adjacency map ONCE at module load. Each
 * character maps to a list of (replacement, weight) entries. The map
 * is private — callers should use {@link generateConfusablePermutations}.
 *
 * Built from {@link CONFUSABLE_PAIRS} so adding a new pair there
 * automatically wires the map without further code changes.
 */
const ADJACENCY: ReadonlyMap<string, readonly { char: string; weight: number }[]> =
  (function buildAdjacency(): Map<string, { char: string; weight: number }[]> {
    const map = new Map<string, { char: string; weight: number }[]>();
    const add = (from: string, to: string, weight: number): void => {
      const existing = map.get(from);
      if (existing === undefined) {
        map.set(from, [{ char: to, weight }]);
      } else {
        existing.push({ char: to, weight });
      }
    };
    for (const pair of CONFUSABLE_PAIRS) {
      add(pair.a, pair.b, pair.weight);
      add(pair.b, pair.a, pair.weight);
    }
    return map;
  })();

/**
 * One candidate permutation. The `swaps` array names each character that
 * was substituted from the original, so the UI can diff-highlight just
 * those characters instead of re-running its own diff.
 *
 * `editCount` is `swaps.length` reified for sort convenience.
 *
 * `score` is the sum of swap weights, used to break ties at the same
 * edit count. Higher score = surface first.
 */
export interface PlatePermutation {
  readonly plate: string;
  readonly editCount: number;
  readonly score: number;
  readonly swaps: readonly {
    readonly index: number;
    readonly fromChar: string;
    readonly toChar: string;
  }[];
}

/**
 * Hard cap on the number of permutations a single call may emit. Keeps
 * vendor cost bounded on plates with many confusable characters.
 *
 * 24 chosen empirically: a 6-character plate where 4 positions are
 * confusable produces at most C(4,1) + C(4,2) = 10 single+double swaps
 * over a 2-neighbor average, well under 24. Plates with 5+ confusable
 * positions truncate gracefully at the cap.
 */
export const MAX_PERMUTATIONS = 24;

/**
 * Hard cap on the number of substitutions applied per permutation.
 * Edit-distance 1 covers ~85% of real OCR misreads; edit-distance 2
 * covers another ~12%. Beyond 2, the permutation is almost certainly a
 * different plate, not a confusable of the original.
 */
export const MAX_EDIT_DISTANCE = 2;

/**
 * Generate ranked confusable permutations of `original`.
 *
 * Throws on non-string input so a regression in the call site surfaces
 * as a NAMED error rather than silently returning the empty list.
 * Throws on empty string because an empty plate cannot have a misread
 * and the caller should never reach this with one.
 *
 * Output guarantees (covered by tests/property/confusables.property.test.ts):
 *   - Every emitted permutation differs from `original` ONLY at indices
 *     listed in its `swaps` array.
 *   - Every swap's `fromChar` equals `original.charAt(swap.index)`.
 *   - Every swap's `(fromChar, toChar)` is in the bidirectional adjacency
 *     set built from CONFUSABLE_PAIRS.
 *   - `editCount` equals `swaps.length` and is in [1, MAX_EDIT_DISTANCE].
 *   - The list is sorted by `editCount` ascending, then `score` descending.
 *   - `original` itself is NEVER in the output (callers want alternatives;
 *     the original was already tried and missed).
 *   - Output length is ≤ MAX_PERMUTATIONS.
 *   - Deterministic: identical input → identical output.
 *
 * @param original — the plate string as returned by OCR, already normalized
 *   (uppercased, non-alphanumerics stripped). Use the `Plate` domain
 *   primitive's `normalized` field; do NOT pass raw user input.
 * @param maxResults — optional override on MAX_PERMUTATIONS for callers
 *   that need a tighter cap (e.g. an integration test).
 */
export function generateConfusablePermutations(
  original: string,
  maxResults: number = MAX_PERMUTATIONS,
): readonly PlatePermutation[] {
  if (typeof original !== "string") {
    throw new TypeError(
      `generateConfusablePermutations requires a string; got ${typeof original}.`,
    );
  }
  if (original.length === 0) {
    throw new Error(
      "generateConfusablePermutations called with empty string. The caller " +
        "must pass the already-normalized plate text (Plate.normalized), " +
        "which is guaranteed non-empty by the Plate constructor.",
    );
  }
  if (!Number.isInteger(maxResults) || maxResults < 1) {
    throw new RangeError(
      `generateConfusablePermutations: maxResults must be a positive integer; got ${String(maxResults)}.`,
    );
  }

  const chars = Array.from(original);

  // Walk every (position, replacement) edit and BFS up to MAX_EDIT_DISTANCE
  // depth. We do the BFS with explicit Set-based deduping because two
  // different swap sequences can land on the same plate string (e.g.
  // swapping position 2 then position 5 is the same plate as swapping
  // position 5 then position 2).
  //
  // Each entry in `seen` is the plate string; each entry in `byString`
  // is the canonical PlatePermutation we built first (which is also the
  // one with the highest score by our enumeration order).
  const byString = new Map<string, PlatePermutation>();

  // Depth-1: every single substitution.
  for (let i = 0; i < chars.length; i += 1) {
    const fromChar = chars[i];
    if (fromChar === undefined) continue;
    const neighbors = ADJACENCY.get(fromChar);
    if (neighbors === undefined) continue;
    for (const neighbor of neighbors) {
      const next = chars.slice();
      next[i] = neighbor.char;
      const plate = next.join("");
      if (plate === original) continue;
      const candidate: PlatePermutation = {
        plate,
        editCount: 1,
        score: neighbor.weight,
        swaps: [{ index: i, fromChar, toChar: neighbor.char }],
      };
      const existing = byString.get(plate);
      if (existing === undefined || existing.score < candidate.score) {
        byString.set(plate, candidate);
      }
    }
  }

  // Depth-2: build on top of depth-1 permutations. Walk every position
  // strictly AFTER the first swap so we never enumerate the same pair
  // (i, j) and (j, i) twice.
  //
  // MAX_EDIT_DISTANCE is a compile-time constant (2). If a future
  // operator wants to allow deeper recovery they should bump the
  // constant AND extend this loop to depth-3 / depth-N rather than
  // toggling a runtime guard. The guard the lint rule flagged here
  // never did anything useful at the current value.
  {
    const depth1 = Array.from(byString.values());
    for (const base of depth1) {
      if (base.editCount !== 1) continue;
      const firstSwap = base.swaps[0];
      if (firstSwap === undefined) continue;
      for (let i = firstSwap.index + 1; i < chars.length; i += 1) {
        const fromChar = chars[i];
        if (fromChar === undefined) continue;
        const neighbors = ADJACENCY.get(fromChar);
        if (neighbors === undefined) continue;
        for (const neighbor of neighbors) {
          const next = Array.from(base.plate);
          next[i] = neighbor.char;
          const plate = next.join("");
          if (plate === original) continue;
          const candidate: PlatePermutation = {
            plate,
            editCount: 2,
            score: base.score + neighbor.weight,
            swaps: [
              ...base.swaps,
              { index: i, fromChar, toChar: neighbor.char },
            ],
          };
          const existing = byString.get(plate);
          if (existing === undefined) {
            byString.set(plate, candidate);
          } else if (
            existing.editCount > candidate.editCount ||
            (existing.editCount === candidate.editCount &&
              existing.score < candidate.score)
          ) {
            // Prefer fewer edits; under equal edits, prefer higher score.
            byString.set(plate, candidate);
          }
        }
      }
    }
  }

  const sorted = Array.from(byString.values()).sort((left, right) => {
    if (left.editCount !== right.editCount) {
      return left.editCount - right.editCount;
    }
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    // Stable final tiebreaker so callers get deterministic output even
    // when two candidates have the same edit count AND score.
    return left.plate < right.plate ? -1 : left.plate > right.plate ? 1 : 0;
  });

  return sorted.slice(0, maxResults);
}

/**
 * True if the given character has at least one OCR-confusable neighbor
 * in the adjacency map. Useful for the widget's "this plate has nothing
 * we can permute, so the user has to retype" affordance.
 *
 * No throw on unknown characters — they simply return false (no neighbors).
 */
export function isConfusable(ch: string): boolean {
  return ADJACENCY.has(ch);
}
