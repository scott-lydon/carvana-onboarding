import { describe, expect, it } from "vitest";
import { VendorCascade } from "../../src/lookup/VendorCascade.ts";
import { Plate, type LookupResult, type StateCode, type VendorAdapter, type Vin } from "../../src/lookup/types.ts";

const fakePlate = new Plate("XRJ4041");
const fakeState: StateCode = "TX";

const fakeVehicle = {
  year: 2008,
  make: "Toyota",
  model: "Highlander",
  trim: undefined,
  bodyStyle: undefined,
} as const;

function makeAdapter(
  name: string,
  behavior: () => Promise<LookupResult> | LookupResult,
): VendorAdapter {
  return {
    name,
    async lookupByPlate(_p: Plate, _s: StateCode): Promise<LookupResult> {
      return behavior();
    },
    async lookupByVin(_v: Vin): Promise<LookupResult> {
      return behavior();
    },
  };
}

describe("VendorCascade", () => {
  it("returns Resolved from the first adapter that resolves", async () => {
    const cascade = new VendorCascade([
      makeAdapter("primary", () => ({
        kind: "resolved",
        vehicle: fakeVehicle,
        viaVendor: "primary",
        latencyMs: 100,
      })),
      makeAdapter("fallback", () => {
        throw new Error("should not be called");
      }),
    ]);
    const result = await cascade.lookupByPlate(fakePlate, fakeState);
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.viaVendor).toBe("primary");
      expect(result.vehicle.make).toBe("Toyota");
    }
  });

  it("falls through to the fallback adapter on NotFound from primary", async () => {
    const cascade = new VendorCascade([
      makeAdapter("primary", () => ({
        kind: "not_found",
        attemptedVendors: ["primary"],
        lastVendorTried: "primary",
      })),
      makeAdapter("fallback", () => ({
        kind: "resolved",
        vehicle: fakeVehicle,
        viaVendor: "fallback",
        latencyMs: 200,
      })),
    ]);
    const result = await cascade.lookupByPlate(fakePlate, fakeState);
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.viaVendor).toBe("fallback");
    }
  });

  it("returns aggregate NotFound when every adapter misses", async () => {
    const cascade = new VendorCascade([
      makeAdapter("v1", () => ({
        kind: "not_found",
        attemptedVendors: ["v1"],
        lastVendorTried: "v1",
      })),
      makeAdapter("v2", () => ({
        kind: "not_found",
        attemptedVendors: ["v2"],
        lastVendorTried: "v2",
      })),
    ]);
    const result = await cascade.lookupByPlate(fakePlate, fakeState);
    expect(result.kind).toBe("not_found");
    if (result.kind === "not_found") {
      expect(result.attemptedVendors).toEqual(["v1", "v2"]);
      expect(result.lastVendorTried).toBe("v2");
    }
  });

  it("falls through on a thrown error and continues to the next adapter", async () => {
    const cascade = new VendorCascade([
      makeAdapter("flaky", () => {
        throw new Error("network down");
      }),
      makeAdapter("backup", () => ({
        kind: "resolved",
        vehicle: fakeVehicle,
        viaVendor: "backup",
        latencyMs: 150,
      })),
    ]);
    const result = await cascade.lookupByPlate(fakePlate, fakeState);
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.viaVendor).toBe("backup");
    }
  });

  it("returns TransientError when every adapter throws", async () => {
    const cascade = new VendorCascade([
      makeAdapter("v1", () => {
        throw new Error("boom1");
      }),
      makeAdapter("v2", () => {
        throw new Error("boom2");
      }),
    ]);
    const result = await cascade.lookupByPlate(fakePlate, fakeState);
    expect(result.kind).toBe("transient_error");
    if (result.kind === "transient_error") {
      expect(result.retryable).toBe(true);
      expect(result.attemptedVendors).toEqual(["v1", "v2"]);
      expect(result.cause).toContain("boom1");
      expect(result.cause).toContain("boom2");
    }
  });

  it("treats a slow adapter as a timeout and falls through", async () => {
    const cascade = new VendorCascade(
      [
        makeAdapter("slow", () => new Promise(() => { /* never resolves */ })),
        makeAdapter("fast", () => ({
          kind: "resolved",
          vehicle: fakeVehicle,
          viaVendor: "fast",
          latencyMs: 10,
        })),
      ],
      50, // 50ms timeout
    );
    const result = await cascade.lookupByPlate(fakePlate, fakeState);
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.viaVendor).toBe("fast");
    }
  });

  it("bubbles BotDetected up without trying further adapters", async () => {
    const cascade = new VendorCascade([
      makeAdapter("v1", () => ({
        kind: "bot_detected",
        advisedAction: "use_different_session",
      })),
      makeAdapter("v2", () => {
        throw new Error("should not be called");
      }),
    ]);
    const result = await cascade.lookupByPlate(fakePlate, fakeState);
    expect(result.kind).toBe("bot_detected");
  });

  it("throws on construction with zero adapters (factory contract)", () => {
    expect(() => new VendorCascade([])).toThrow(
      /requires at least one VendorAdapter/,
    );
  });
});
