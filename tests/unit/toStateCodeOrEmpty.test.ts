/**
 * Unit tests for the lenient state-name parser.
 *
 * This helper exists so chat-side prose like "my plate is X in Texas"
 * can be coerced to a postal code without bouncing off the strict
 * parseStateCode that requires a 2-letter input. The earlier bug it
 * fixes was extractStateFromUserText returning "TE" for "Texas".
 */
import { describe, expect, it } from "vitest";
import { toStateCodeOrEmpty } from "../../src/lookup/types.ts";

describe("toStateCodeOrEmpty", () => {
  it("returns the canonical code for a valid two-letter input", () => {
    expect(toStateCodeOrEmpty("TX")).toBe("TX");
    expect(toStateCodeOrEmpty("tx")).toBe("TX");
    expect(toStateCodeOrEmpty(" CA ")).toBe("CA");
  });

  it("maps full state names (any case) to the postal code", () => {
    expect(toStateCodeOrEmpty("Texas")).toBe("TX");
    expect(toStateCodeOrEmpty("california")).toBe("CA");
    expect(toStateCodeOrEmpty("NEW YORK")).toBe("NY");
    expect(toStateCodeOrEmpty("North Carolina")).toBe("NC");
    expect(toStateCodeOrEmpty("District of Columbia")).toBe("DC");
    expect(toStateCodeOrEmpty("Puerto Rico")).toBe("PR");
  });

  it("returns empty string for unrecognized input — never throws", () => {
    expect(toStateCodeOrEmpty("")).toBe("");
    expect(toStateCodeOrEmpty("not a state")).toBe("");
    expect(toStateCodeOrEmpty("Austin")).toBe("");
    expect(toStateCodeOrEmpty("ZZ")).toBe("");
    expect(toStateCodeOrEmpty("Mexico")).toBe("");
  });

  it("returns empty string for non-string input", () => {
    // @ts-expect-error — intentionally violating the type for the test
    expect(toStateCodeOrEmpty(undefined)).toBe("");
    // @ts-expect-error — intentionally violating the type for the test
    expect(toStateCodeOrEmpty(null)).toBe("");
    // @ts-expect-error — intentionally violating the type for the test
    expect(toStateCodeOrEmpty(42)).toBe("");
  });
});
