/**
 * Property-based tests for VendorCascade. For any sequence of adapter
 * outcomes drawn from {resolved, not_found, throw, bot_detected}, the
 * cascade's result obeys the documented invariants.
 *
 * Invariants:
 *   1. If any adapter resolves, the result is `resolved`, with `viaVendor`
 *      pointing at the FIRST resolved adapter (cascade short-circuits).
 *   2. If at least one adapter returned `not_found` and none resolved (and
 *      no adapter before the not_found returned bot_detected), the result
 *      is `not_found`.
 *   3. If every adapter threw, the result is `transient_error`.
 *   4. If an adapter returns `bot_detected`, that bubbles up immediately
 *      (no further adapters are tried).
 *
 * fast-check arbitrary generators produce permutations of adapter behaviors;
 * the property runs the cascade and asserts the invariants hold.
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { VendorCascade } from "../../src/lookup/VendorCascade.ts";
import {
  Plate,
  type LookupResult,
  type StateCode,
  type VendorAdapter,
  type Vin,
} from "../../src/lookup/types.ts";

type Behavior =
  | { tag: "resolved" }
  | { tag: "not_found" }
  | { tag: "throws" }
  | { tag: "bot_detected" };

const behaviorArb: fc.Arbitrary<Behavior> = fc.oneof(
  fc.constant<Behavior>({ tag: "resolved" }),
  fc.constant<Behavior>({ tag: "not_found" }),
  fc.constant<Behavior>({ tag: "throws" }),
  fc.constant<Behavior>({ tag: "bot_detected" }),
);

function adapterFor(name: string, behavior: Behavior): VendorAdapter {
  // Synchronous responder; the cascade-facing methods wrap this in async.
  // (require-await rule: async functions must contain await; we keep this
  // sync and let the adapter methods supply the async boundary.)
  const respond = (): LookupResult => {
    switch (behavior.tag) {
      case "resolved":
        return {
          kind: "resolved",
          vehicle: { year: 2020, make: "Test", model: "Car", trim: undefined, bodyStyle: undefined },
          viaVendor: name,
          latencyMs: 1,
        };
      case "not_found":
        return { kind: "not_found", attemptedVendors: [name], lastVendorTried: name };
      case "throws":
        throw new Error(`${name}:simulated`);
      case "bot_detected":
        return { kind: "bot_detected", advisedAction: "use_different_session" };
    }
  };
  return {
    name,
    lookupByPlate(_p: Plate, _s: StateCode): Promise<LookupResult> {
      return Promise.resolve(respond());
    },
    lookupByVin(_v: Vin): Promise<LookupResult> {
      return Promise.resolve(respond());
    },
  };
}

const PLATE = new Plate("XRJ4041");
const STATE: StateCode = "TX";

describe("VendorCascade properties", () => {
  it("first short-circuit terminal outcome dictates the result", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(behaviorArb, { minLength: 1, maxLength: 6 }),
        async (behaviors) => {
          const adapters = behaviors.map((b, i) => adapterFor(`v${String(i)}`, b));
          const cascade = new VendorCascade(adapters);
          const result = await cascade.lookupByPlate(PLATE, STATE);

          // Find the first "terminal" behavior. Resolved and bot_detected are
          // hard stops; not_found and throws are "try the next" outcomes.
          const firstTerminalIdx = behaviors.findIndex(
            (b) => b.tag === "resolved" || b.tag === "bot_detected",
          );

          if (firstTerminalIdx !== -1) {
            const terminal = behaviors[firstTerminalIdx];
            if (terminal?.tag === "resolved") {
              expect(result.kind).toBe("resolved");
              if (result.kind === "resolved") {
                expect(result.viaVendor).toBe(`v${String(firstTerminalIdx)}`);
              }
            } else if (terminal?.tag === "bot_detected") {
              expect(result.kind).toBe("bot_detected");
            }
          } else {
            // No resolved, no bot_detected: result is not_found if any
            // adapter returned not_found, otherwise transient_error.
            const anyNotFound = behaviors.some((b) => b.tag === "not_found");
            expect(result.kind).toBe(anyNotFound ? "not_found" : "transient_error");
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("never returns viaVendor that didn't actually resolve", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(behaviorArb, { minLength: 1, maxLength: 6 }),
        async (behaviors) => {
          const adapters = behaviors.map((b, i) => adapterFor(`v${String(i)}`, b));
          const cascade = new VendorCascade(adapters);
          const result = await cascade.lookupByPlate(PLATE, STATE);
          if (result.kind === "resolved") {
            const matchIdx = adapters.findIndex((a) => a.name === result.viaVendor);
            expect(matchIdx).toBeGreaterThanOrEqual(0);
            expect(behaviors[matchIdx]?.tag).toBe("resolved");
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
