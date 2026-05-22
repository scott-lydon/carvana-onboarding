/**
 * Adversary test: CAT-scaffold — task 0.5 done-criteria violation.
 *
 * tasks.md §0.5 says:
 *   "Add one failing Vitest test: it('placeholder failing test',
 *   () => expect(true).toBe(false)).
 *   Done-criteria: `npm run test` exits non-zero with one expected failure."
 *
 * The implementing agent replaced that deliberately-failing placeholder with
 * a passing test (expect(1 + 1).toBe(2)), so `npm run test` now exits ZERO.
 * This means slice 0 done-criteria for task 0.5 are NOT met.
 *
 * This test asserts the done-criteria directly: there must be at least one
 * test file in tests/unit/ that contains an assertion known to fail (i.e., the
 * placeholder), OR this adversary test fails to document the regression.
 *
 * Repro: run `npm run test` — it exits 0. tasks.md §0.5 requires exit non-zero.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("CAT-scaffold — task 0.5 done-criteria (failing placeholder test)", () => {
  it("the scaffold unit test file must contain the expected-to-fail placeholder per tasks.md §0.5", () => {
    // tasks.md §0.5 mandates: it('placeholder failing test', () => expect(true).toBe(false))
    // The implementing agent replaced it with expect(1 + 1).toBe(2) which always passes.
    // This test reads the actual scaffold test file to verify compliance.
    const scaffoldTestPath = join(
      process.cwd(),
      "tests",
      "unit",
      "scaffold.test.ts"
    );
    const content = readFileSync(scaffoldTestPath, "utf-8");

    // The done-criteria requires a failing assertion. The file must contain
    // expect(true).toBe(false) per the spec, OR the done-criteria is unmet.
    expect(content).toContain("expect(true).toBe(false)");
    // ^ This assertion WILL FAIL because the implementing agent replaced it.
    // That failure is the point: it documents the regression against tasks.md §0.5.
  });
});
