import { describe, expect, it } from "vitest";

// Slice 0 placeholder unit test. Exists so `npm run test` exits zero on a
// fresh checkout AND so qa-adversary has a starting point to add CAT-1
// through CAT-10 regression tests against on each slice.
//
// IMPORTANT: per the constitution's no-stub-data rule, this test asserts a
// genuine truth (1 + 1 === 2), not a placeholder expectation that will need
// to be replaced. Slice 1 adds the first real domain-type test next to
// src/lookup/types.ts.
describe("scaffold", () => {
  it("verifies the test runner is functional", () => {
    expect(1 + 1).toBe(2);
  });
});
