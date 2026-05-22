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
 */
export class Vin {
  public readonly raw: string;
  public readonly normalized: string;

  public constructor(rawInput: string) {
    if (typeof rawInput !== "string") {
      throw new TypeError(
        `Vin constructor requires a string; got ${typeof rawInput}.`,
      );
    }
    this.raw = rawInput;
    const upper = rawInput
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, ""); // strip whitespace, dashes, dots (EC4).
    this.normalized = upper;

    if (this.normalized.length !== 17) {
      throw new Error(
        `VIN must be exactly 17 characters after normalization; ` +
          `got ${JSON.stringify(rawInput)} -> ${this.normalized} ` +
          `(length ${String(this.normalized.length)}). Modern VINs ` +
          `(post-1980) are always 17 characters per ISO 3779.`,
      );
    }
    const forbidden = /[IOQ]/;
    if (forbidden.test(this.normalized)) {
      const positions = Array.from(this.normalized).flatMap((ch, i) =>
        forbidden.test(ch) ? [`${ch}@${String(i)}`] : [],
      );
      throw new Error(
        `VIN contains forbidden characters per ISO 3779 ` +
          `(I, O, Q are not allowed): ${positions.join(", ")} in ` +
          `${this.normalized}. The user likely meant 1, 0, 0 respectively; ` +
          `try character-permutation recovery before surfacing this error.`,
      );
    }
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
