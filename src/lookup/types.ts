/**
 * Domain primitives for the entry-step lookup. Strict validation in
 * constructors so downstream code can rely on the type system instead of
 * re-checking. Wrap primitive types per the constitution's domain-primitive
 * rule so a `Plate` cannot be confused with a `Vin` at any call site.
 *
 * No `as` casts. No `any`. No silent coercion. Throws on construction with
 * named error messages so a regression in the call site surfaces immediately.
 */

const STATE_CODES = [
  "AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL",
  "GA", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA",
  "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE",
  "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "PR",
  "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI",
  "WV", "WY",
] as const;

export type StateCode = (typeof STATE_CODES)[number];

const STATE_CODE_SET: ReadonlySet<string> = new Set(STATE_CODES);

/**
 * Throws if the value is not a recognized US state postal code. Use this at
 * input boundaries (form submission, URL query parsing) and never trust an
 * upstream `string` that has not been parsed through this function.
 */
export function parseStateCode(input: string): StateCode {
  const upper = input.trim().toUpperCase();
  if (!STATE_CODE_SET.has(upper)) {
    throw new Error(
      `Invalid US state code: ${JSON.stringify(input)}. ` +
        `Expected one of the 50 states, DC, or PR.`,
    );
  }
  return upper as StateCode;
}

/**
 * Map of full state name (uppercased) → postal code. Used by
 * {@link toStateCodeOrEmpty} to convert user-typed prose like "Texas"
 * into the lookup-API contract's two-letter code. Covers all 50 states
 * plus DC and PR.
 *
 * Kept here next to `STATE_CODES` so future state-list edits update
 * both surfaces in one place. If you ever add Guam or another US
 * territory to STATE_CODES, add it here too.
 */
const STATE_NAME_TO_CODE: ReadonlyMap<string, StateCode> = new Map([
  ["ALABAMA", "AL"], ["ALASKA", "AK"], ["ARIZONA", "AZ"], ["ARKANSAS", "AR"],
  ["CALIFORNIA", "CA"], ["COLORADO", "CO"], ["CONNECTICUT", "CT"],
  ["DELAWARE", "DE"], ["DISTRICT OF COLUMBIA", "DC"], ["FLORIDA", "FL"],
  ["GEORGIA", "GA"], ["HAWAII", "HI"], ["IDAHO", "ID"], ["ILLINOIS", "IL"],
  ["INDIANA", "IN"], ["IOWA", "IA"], ["KANSAS", "KS"], ["KENTUCKY", "KY"],
  ["LOUISIANA", "LA"], ["MAINE", "ME"], ["MARYLAND", "MD"],
  ["MASSACHUSETTS", "MA"], ["MICHIGAN", "MI"], ["MINNESOTA", "MN"],
  ["MISSISSIPPI", "MS"], ["MISSOURI", "MO"], ["MONTANA", "MT"],
  ["NEBRASKA", "NE"], ["NEVADA", "NV"], ["NEW HAMPSHIRE", "NH"],
  ["NEW JERSEY", "NJ"], ["NEW MEXICO", "NM"], ["NEW YORK", "NY"],
  ["NORTH CAROLINA", "NC"], ["NORTH DAKOTA", "ND"], ["OHIO", "OH"],
  ["OKLAHOMA", "OK"], ["OREGON", "OR"], ["PENNSYLVANIA", "PA"],
  ["PUERTO RICO", "PR"], ["RHODE ISLAND", "RI"], ["SOUTH CAROLINA", "SC"],
  ["SOUTH DAKOTA", "SD"], ["TENNESSEE", "TN"], ["TEXAS", "TX"],
  ["UTAH", "UT"], ["VERMONT", "VT"], ["VIRGINIA", "VA"],
  ["WASHINGTON", "WA"], ["WEST VIRGINIA", "WV"], ["WISCONSIN", "WI"],
  ["WYOMING", "WY"],
]);

/**
 * Best-effort conversion of free-text state mention to a postal code.
 * Returns "" (empty string, NOT a StateCode) when the input is not a
 * recognized two-letter code AND not a recognized full state name.
 *
 * Use this when parsing prose like "my plate is XRJ4041 in Texas":
 * the caller already knows the value is best-effort and falls back to
 * prompting the user when this returns empty.
 *
 * Non-throwing on purpose. Callers that need a guaranteed-valid code
 * should use {@link parseStateCode} instead.
 *
 * Accepts inputs with surrounding whitespace and any case.
 */
export function toStateCodeOrEmpty(input: string): StateCode | "" {
  if (typeof input !== "string") return "";
  const trimmed = input.trim();
  if (trimmed.length === 0) return "";
  const upper = trimmed.toUpperCase();
  if (STATE_CODE_SET.has(upper)) return upper as StateCode;
  const fromName = STATE_NAME_TO_CODE.get(upper);
  if (fromName !== undefined) return fromName;
  return "";
}

/**
 * License plate, normalized to alphanumeric uppercase. The normalization
 * layer is the FIRST line of defense against the Texas asterisk bug (EC1)
 * and the whitespace / dash issues (EC4). Constructor strips all non-
 * alphanumeric characters; if the result is too short or too long for any
 * US state's format, throws.
 */
export class Plate {
  public readonly raw: string;
  public readonly normalized: string;
  public readonly removedCharacters: readonly string[];

  public constructor(rawInput: string) {
    if (typeof rawInput !== "string") {
      throw new TypeError(
        `Plate constructor requires a string; got ${typeof rawInput}.`,
      );
    }
    this.raw = rawInput;
    const upper = rawInput.toUpperCase();
    const stripped: string[] = [];
    const removed: string[] = [];
    for (const ch of upper) {
      if (/[A-Z0-9]/.test(ch)) {
        stripped.push(ch);
      } else {
        removed.push(ch);
      }
    }
    this.normalized = stripped.join("");
    this.removedCharacters = removed;

    if (this.normalized.length === 0) {
      throw new Error(
        `Plate must contain at least one alphanumeric character; ` +
          `got ${JSON.stringify(rawInput)} (all characters removed by ` +
          `normalization).`,
      );
    }
    if (this.normalized.length > 8) {
      throw new Error(
        `Plate is longer than the 8-character upper bound across US states; ` +
          `got ${JSON.stringify(rawInput)} -> ${this.normalized} ` +
          `(length ${String(this.normalized.length)}).`,
      );
    }
  }

  /** True when the original input contained characters that were stripped. */
  public wasNormalized(): boolean {
    return this.removedCharacters.length > 0;
  }
}

/**
 * Vehicle Identification Number. Per ISO 3779, a modern VIN is exactly 17
 * alphanumeric characters and never contains the letters I, O, or Q (to
 * prevent confusion with 1 and 0). Constructor enforces both.
 *
 * If the user input contains I, O, or Q, the error suggests substitution
 * (constitution non-negotiable: never blame the user when we know the
 * recovery path).
 *
 * Prefix labels: real-world OCR (VIN sticker, registration card, even
 * voice-to-text) frequently bleeds the literal label "VIN", "VIN:",
 * "VIN -", "V.I.N.", "Vehicle Identification Number" through alongside
 * the 17 characters. Without label-stripping, the normalizer would
 * concatenate "VIN" + the actual characters and reject the result as
 * length-mismatch. We strip a short list of well-known label words
 * BEFORE the alphanumeric pass so the user never sees a length error
 * caused by a label they did not type.
 */
export class Vin {
  public readonly raw: string;
  public readonly normalized: string;
  /**
   * Whether the constructor stripped a label like "VIN:" before
   * normalization. Surfaced so callers can show a calm "we stripped the
   * label" affordance instead of silently mutating user input.
   */
  public readonly strippedLabels: readonly string[];

  public constructor(rawInput: string) {
    if (typeof rawInput !== "string") {
      throw new TypeError(
        `Vin constructor requires a string; got ${typeof rawInput}.`,
      );
    }
    this.raw = rawInput;
    const { withoutLabels, stripped } = stripVinLabels(rawInput);
    this.strippedLabels = stripped;
    const upper = withoutLabels
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, ""); // strip whitespace, dashes, dots (EC4).
    this.normalized = upper;

    if (this.normalized.length !== 17) {
      const labelHint =
        stripped.length > 0
          ? ` (stripped label prefixes: ${stripped.join(", ")})`
          : "";
      throw new Error(
        `VIN must be exactly 17 characters after normalization; ` +
          `got ${JSON.stringify(rawInput)} -> ${this.normalized} ` +
          `(length ${String(this.normalized.length)})${labelHint}. ` +
          `Modern VINs (post-1980) are always 17 characters per ISO 3779.`,
      );
    }
    const forbidden = /[IOQ]/;
    if (forbidden.test(this.normalized)) {
      const positions = Array.from(this.normalized).flatMap((ch, i) =>
        forbidden.test(ch) ? [`${ch}@${String(i)}`] : [],
      );
      // The route handler runs `tryParseVinWithPermutation` first; if it
      // reaches this throw, the substitution attempt already failed. So we
      // do NOT instruct callers to "try character-permutation recovery" — by
      // the time this fires, that was tried and didn't help. The message is
      // pure diagnostics for server logs and tests.
      throw new Error(
        `VIN contains forbidden characters per ISO 3779 ` +
          `(I, O, Q are not allowed): ${positions.join(", ")} in ` +
          `${this.normalized}.`,
      );
    }
  }

  /**
   * ISO 3779 / FMVSS 115 check-digit validation. Position 9 is a single
   * character (0-9 or X meaning 10) computed from a transliteration table
   * applied to the other 16 characters and a fixed weight vector.
   *
   * Returns { ok: true } when the check digit matches the computed digit.
   * Returns { ok: false, expected, actual, reason } when it does not.
   *
   * **Warn, don't block.** Per the project's "warn-don't-block" rule, a
   * check-digit mismatch is surfaced as a warning next to the lookup, not
   * an error that blocks the lookup. Many region-specific VINs and some
   * pre-2010 imports do not strictly follow the check digit rule; we
   * never want to refuse a real vehicle because of a numerical quirk.
   */
  public validateCheckDigit(): VinChecksumResult {
    // VIN_TRANSLITERATION + VIN_WEIGHTS are the ISO 3779 published tables.
    // Documented inline so a future reader does not have to chase a spec.
    const transliteration: Record<string, number> = {
      "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
      "8": 8, "9": 9,
      A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
      J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
      S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
    };
    const weights: readonly number[] = [
      8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2,
    ];
    let sum = 0;
    for (let i = 0; i < 17; i += 1) {
      const ch = this.normalized.charAt(i);
      const value = transliteration[ch];
      if (value === undefined) {
        return {
          ok: false,
          expected: "?",
          actual: this.normalized.charAt(8),
          reason:
            `Position ${String(i + 1)} character "${ch}" is not in the ISO 3779 ` +
            `transliteration table. Cannot compute check digit.`,
        };
      }
      sum += value * (weights[i] ?? 0);
    }
    const remainder = sum % 11;
    const expected = remainder === 10 ? "X" : String(remainder);
    const actual = this.normalized.charAt(8);
    if (expected === actual) {
      return { ok: true };
    }
    return {
      ok: false,
      expected,
      actual,
      reason:
        `Position 9 check digit is "${actual}" but ISO 3779 expects ` +
        `"${expected}" for this VIN. The lookup will still proceed; this ` +
        `is a calm warning, not a block. Common causes: an OCR misread on ` +
        `another character (the check digit only fails when SOMETHING ` +
        `upstream is off), a non-North-American import that does not use ` +
        `the check digit rule, or a transcription error.`,
    };
  }
}

/**
 * Result of {@link Vin.validateCheckDigit}. Discriminated union so callers
 * pattern-match on `ok` rather than dereferencing optional fields.
 */
export type VinChecksumResult =
  | { ok: true }
  | { ok: false; expected: string; actual: string; reason: string };

/**
 * Known VIN label prefixes the OCR + voice paths bleed through. Anchored
 * at the start of the string only; we never strip an embedded "VIN" that
 * happens to land inside the actual characters (e.g. a Subaru VIN with
 * adjacent V/I/N is impossible since I is forbidden, but we anchor anyway
 * out of caution).
 *
 * Order matters: longer phrases first so "Vehicle Identification Number"
 * is removed before its substrings.
 */
const VIN_LABEL_PATTERNS: readonly RegExp[] = [
  /^\s*vehicle\s*identification\s*number\s*[:.\-#]?\s*/i,
  /^\s*v\.?\s*i\.?\s*n\.?\s*[:.\-#]?\s*/i,
];

interface StrippedLabelResult {
  readonly withoutLabels: string;
  readonly stripped: readonly string[];
}

/**
 * Strip any of the known VIN label patterns from the front of `raw`.
 * Returns the cleaned string AND the literal text we removed (for
 * surfacing as a warning so the user sees we did this transparently).
 *
 * Idempotent: a string with no recognized label passes through unchanged.
 */
function stripVinLabels(raw: string): StrippedLabelResult {
  const stripped: string[] = [];
  let working = raw;
  // Apply each pattern up to once per call. We do NOT loop because a label
  // appearing multiple times at the front would almost certainly be a sign
  // of corrupt input we want to error on, not silently eat.
  for (const pattern of VIN_LABEL_PATTERNS) {
    const match = pattern.exec(working);
    if (match !== null && match.index === 0) {
      stripped.push(match[0].trim());
      working = working.slice(match[0].length);
      break; // one label prefix max; second label would be suspicious
    }
  }
  return { withoutLabels: working, stripped };
}

/**
 * Substitute the forbidden ISO 3779 letters (I, O, Q) with their numeric
 * look-alikes (1, 0, 0). The two letters whose numeric pair is canonical
 * (I→1, O→0) are well-attested in real OCR/handwriting confusion; Q→0 is
 * the conservative fallback because Q rarely appears even in confusion sets.
 */
function permuteForbiddenLetters(raw: string): string {
  const subs: Record<string, string> = { I: "1", O: "0", Q: "0" };
  return raw
    .toUpperCase()
    .split("")
    .map((ch) => subs[ch] ?? ch)
    .join("");
}

/**
 * Result of attempting to parse a VIN with optional auto-permutation
 * recovery. The route handler uses this so the user never has to manually
 * fix I/O/Q — we try the substitution first and surface a heads-up.
 *
 * Shape:
 *   - `vin`: the successfully-constructed Vin (validated, 17 chars, no I/O/Q)
 *   - `corrected`: present only if permutation was applied. Carries the
 *     original raw input and the corrected normalized form, so the client
 *     can display a calm "we corrected your VIN" banner with both values.
 *   - `failure`: present only when even permutation failed; carries the
 *     ORIGINAL constructor error (not the permuted one) so the user sees
 *     diagnostics referencing what they typed, not what we tried.
 */
export type VinParseAttempt =
  | { kind: "ok"; vin: Vin; corrected?: { original: string; normalized: string } }
  | { kind: "failed"; failure: Error };

/**
 * Try to construct a Vin. If the raw input has I/O/Q and the strict
 * constructor rejects it, try ONCE more with I→1, O→0, Q→0. If THAT also
 * fails (wrong length, etc.), return the ORIGINAL failure so error messages
 * reference what the user typed.
 *
 * This is the function the route handler should call instead of
 * `new Vin(input)` directly, so the auto-permutation flow is centralized
 * and testable in isolation.
 */
export function tryParseVinWithPermutation(rawInput: string): VinParseAttempt {
  let originalFailure: Error;
  try {
    return { kind: "ok", vin: new Vin(rawInput) };
  } catch (err) {
    originalFailure = err instanceof Error
      ? err
      : new Error(`Vin constructor rejected input: ${String(err)}`);
  }

  // Only attempt permutation if the input actually contains forbidden chars.
  // Otherwise permutation can't help (the failure is length, type, or empty).
  const upper = typeof rawInput === "string" ? rawInput.toUpperCase() : "";
  if (!/[IOQ]/.test(upper)) {
    return { kind: "failed", failure: originalFailure };
  }

  const permuted = permuteForbiddenLetters(rawInput);
  try {
    const vin = new Vin(permuted);
    return {
      kind: "ok",
      vin,
      corrected: { original: rawInput, normalized: vin.normalized },
    };
  } catch {
    // Permutation didn't help; surface the original failure so the user
    // sees an error referencing their literal input, not the permuted one.
    return { kind: "failed", failure: originalFailure };
  }
}

/**
 * Vehicle data returned by a lookup. Intentionally minimal in slice 1; we
 * grow the shape only as new fields are read from real vendor responses.
 */
export interface Vehicle {
  readonly year: number;
  readonly make: string;
  readonly model: string;
  readonly trim?: string | undefined;
  readonly bodyStyle?: string | undefined;
}

/**
 * Discriminated union for vendor lookup results. The cascade returns one of
 * these; the DegradationLayer pattern-matches to render the appropriate
 * user-facing copy.
 *
 * Critical: no member is a string. The named-mode discrimination is the
 * literal fix for finding S6 (where Carvana collapses all failure modes
 * into one copy string).
 */
export type LookupResult =
  | {
      readonly kind: "resolved";
      readonly vehicle: Vehicle;
      readonly viaVendor: string;
      readonly latencyMs: number;
      /**
       * Present only when the input was auto-corrected before lookup. The
       * client renders a calm "we corrected your VIN" banner showing both
       * the original and the corrected form. Absent means the input was
       * accepted as-typed.
       */
      readonly correction?: {
        readonly original: string;
        readonly normalized: string;
        readonly reason: string;
      };
    }
  | {
      readonly kind: "not_found";
      readonly attemptedVendors: readonly string[];
      readonly lastVendorTried: string;
    }
  | {
      readonly kind: "transient_error";
      readonly retryable: true;
      readonly cause: string;
      readonly attemptedVendors: readonly string[];
    }
  | {
      readonly kind: "bot_detected";
      readonly advisedAction: "use_different_session" | "contact_support";
    }
  | {
      readonly kind: "format_error";
      readonly field: "plate" | "vin";
      readonly reason: string;
    };

/**
 * Vendor adapter interface. Each concrete adapter (VinAudit, Carfax,
 * DataOne) implements this. The cascade is constructed from a list of
 * adapters and tries them in order until one resolves.
 *
 * Adapters MUST NOT throw on a missing-plate response; that is `not_found`,
 * not an error. They MUST throw on infrastructure-level failures (timeout,
 * 5xx, malformed JSON) so the cascade can decide whether to try the next
 * vendor or surface a transient error.
 */
export interface VendorAdapter {
  readonly name: string;
  lookupByPlate(plate: Plate, state: StateCode): Promise<LookupResult>;
  lookupByVin(vin: Vin): Promise<LookupResult>;
}
