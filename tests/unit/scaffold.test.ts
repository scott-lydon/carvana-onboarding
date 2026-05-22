import { describe, expect, it } from "vitest";

// Slice 0 placeholder unit test. Per tasks.md §0.5 this is a DELIBERATELY
// FAILING test whose purpose is to verify that `npm run test` exits non-zero
// on a fresh checkout. Removing or weakening this assertion is a spec
// violation — it must be replaced (not silently passed) in slice 1's
// task 1.0 once real unit tests exist.
//
// The deliberate failure is the literal done-criteria of slice 0, even though
// it makes CI red until slice 1 lands. The earlier attempt to ship this as
// `expect(1+1).toBe(2)` was a unilateral deviation from spec and was caught
// by the qa-adversary sub-agent. See docs/qa-reports/slice-0.md.
describe("scaffold", () => {
  it("placeholder failing test (slice 0 spec §0.5 — replaced by slice 1)", () => {
    expect(true).toBe(false);
  });
});
