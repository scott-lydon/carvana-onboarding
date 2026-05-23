import { describe, expect, it } from "vitest";
import { Plate, Vin, parseStateCode } from "../../src/lookup/types.ts";

describe("parseStateCode", () => {
  it("accepts a known state in any casing with trimming", () => {
    expect(parseStateCode("ca")).toBe("CA");
    expect(parseStateCode("  Tx  ")).toBe("TX");
    expect(parseStateCode("DC")).toBe("DC");
    expect(parseStateCode("PR")).toBe("PR");
  });

  it("throws on an unrecognized code with a descriptive error", () => {
    expect(() => parseStateCode("XX")).toThrow(/Invalid US state code/);
    expect(() => parseStateCode("California")).toThrow(/Invalid US state code/);
  });
});

describe("Plate normalization", () => {
  it("strips the Texas asterisk separator (EC1)", () => {
    const p = new Plate("XRJ ★ 4041");
    expect(p.normalized).toBe("XRJ4041");
    expect(p.wasNormalized()).toBe(true);
    expect(p.removedCharacters).toContain("★");
    expect(p.removedCharacters).toContain(" ");
  });

  it("strips the standard asterisk character variant", () => {
    expect(new Plate("WMC*9381").normalized).toBe("WMC9381");
    expect(new Plate("WMC * 9381").normalized).toBe("WMC9381");
  });

  it("strips whitespace, dashes, dots (EC4)", () => {
    expect(new Plate(" abc-123 ").normalized).toBe("ABC123");
    expect(new Plate("8E.79985").normalized).toBe("8E79985");
  });

  it("uppercases lower-case input (EC5)", () => {
    expect(new Plate("nrm4717").normalized).toBe("NRM4717");
  });

  it("throws on empty or all-non-alphanumeric input", () => {
    expect(() => new Plate("")).toThrow(/at least one alphanumeric/);
    expect(() => new Plate("   ")).toThrow(/at least one alphanumeric/);
    expect(() => new Plate("***")).toThrow(/at least one alphanumeric/);
  });

  it("throws when the normalized result exceeds 8 characters", () => {
    expect(() => new Plate("ABCDEFGHI")).toThrow(/longer than the 8-character/);
  });

  it("preserves the raw input for the trust-signal display", () => {
    const p = new Plate("XRJ ★ 4041");
    expect(p.raw).toBe("XRJ ★ 4041");
  });
});

describe("VIN validation", () => {
  it("accepts a clean 17-character VIN", () => {
    const v = new Vin("1HGCM82633A123456");
    expect(v.normalized).toBe("1HGCM82633A123456");
  });

  it("strips whitespace, dashes, dots", () => {
    expect(new Vin("1HG-CM82633-A123456").normalized).toBe("1HGCM82633A123456");
    expect(new Vin(" 1HGCM82633A123456 ").normalized).toBe(
      "1HGCM82633A123456",
    );
  });

  it("throws on non-17-character input with the expected message", () => {
    expect(() => new Vin("1HG")).toThrow(/17 characters/);
    expect(() => new Vin("1HGCM82633A123456X")).toThrow(/17 characters/);
  });

  it("throws when VIN contains I, O, or Q (forbidden per ISO 3779) with a permutation hint", () => {
    expect(() => new Vin("IHGCM82633A123456")).toThrow(
      /forbidden characters per ISO 3779/,
    );
    expect(() => new Vin("1HGCM82633A12345O")).toThrow(/I, O, Q/);
    expect(() => new Vin("1HGCM82633A12345Q")).toThrow(/I, O, Q/);
  });

  it("error message names the forbidden character AND its position (EC2)", () => {
    // After the tryParseVinWithPermutation helper landed, the Vin constructor
    // no longer suggests "try character-permutation recovery" because by the
    // time the constructor throws, the route handler has already attempted
    // permutation and failed. The message is now pure diagnostics naming the
    // forbidden character(s) and their 0-indexed positions, so server logs
    // and tests can reason about WHICH character offended without a parse.
    const err = (() => {
      try {
        return new Vin("IHGCM82633A123456");
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    })();
    expect(err).toContain("forbidden characters per ISO 3779");
    expect(err).toContain("I@0");
  });
});
