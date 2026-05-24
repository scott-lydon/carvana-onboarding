/**
 * CAT-17 adversary test — slice A.
 *
 * The existing tool-schema test at tests/integration/tool-schema.test.ts
 * has a structural gap: it tests lookup_plate/lookup_vin with cascade=undefined.
 * When cascade is undefined, the function returns configuration_missing BEFORE
 * it checks whether `plate` is a number, a null, or any other non-string.
 *
 * This means the format_error guards in runLookupPlate and runLookupVin have
 * NEVER been exercised by any passing test with a real cascade.
 *
 * This test fixes that gap by injecting a fixture cascade that returns a
 * not_found result (simulating a real cascade that runs) and verifying that
 * malformed tool inputs are caught and returned as format_error BEFORE the
 * cascade is invoked.
 *
 * Bug surface: if the type-guard at tools.ts:222 or 233 has a regression
 * (e.g., someone removes the `typeof plateInput !== "string"` check), a
 * non-string plate would reach `new Plate(plateInput)` and throw, which
 * would propagate as an uncaught exception through `cascade.lookupByPlate`
 * and surface as an error event in the SSE stream rather than a structured
 * format_error that Claude can reason about.
 */
import { describe, expect, it } from "vitest";
import { dispatchTool, TOOLS } from "../../server/chat/tools.ts";
import type { LookupResult, Plate, Vin } from "../../src/lookup/types.js";
import type { StateCode } from "../../src/lookup/types.js";
import type { VendorCascade } from "../../src/lookup/VendorCascade.js";

/**
 * Minimal fixture VendorCascade that records whether it was invoked.
 * Returns not_found so the tool result is a structured not_found rather
 * than configuration_missing. We only care about whether lookup was called
 * at all; the format_error guard should prevent the call.
 *
 * Methods return Promise.resolve() directly (no async keyword) to satisfy
 * the @typescript-eslint/require-await rule — the methods are synchronous
 * internally but must satisfy the async interface.
 */
class FixtureCascade {
  public readonly name = "FixtureCascade";
  public plateCallCount = 0;
  public vinCallCount = 0;

  public lookupByPlate(_plate: Plate, _state: StateCode): Promise<LookupResult> {
    this.plateCallCount += 1;
    return Promise.resolve({
      kind: "not_found",
      attemptedVendors: ["FixtureCascade"],
      lastVendorTried: "FixtureCascade",
    });
  }

  public lookupByVin(_vin: Vin): Promise<LookupResult> {
    this.vinCallCount += 1;
    return Promise.resolve({
      kind: "not_found",
      attemptedVendors: ["FixtureCascade"],
      lastVendorTried: "FixtureCascade",
    });
  }
}

describe("CAT-17 adversary — format_error guards fire with a real cascade", () => {
  it("lookup_plate: numeric plate returns format_error WITHOUT calling the cascade", async () => {
    const cascade = new FixtureCascade();
    const dispatched = await dispatchTool(
      "lookup_plate",
      "tool_use_id_adversary_1",
      { plate: 12345, state: "TX" }, // plate is a number, not a string
      cascade as unknown as VendorCascade,
    );
    const result = dispatched.result as Record<string, unknown>;
    // Must be format_error, not not_found or configuration_missing.
    expect(result.kind, "A numeric plate should produce format_error").toBe("format_error");
    // The cascade must NOT have been called (format_error is a pre-cascade gate).
    expect(
      cascade.plateCallCount,
      "format_error guard must fire BEFORE the cascade is invoked",
    ).toBe(0);
  });

  it("lookup_plate: null state returns format_error WITHOUT calling the cascade", async () => {
    const cascade = new FixtureCascade();
    const dispatched = await dispatchTool(
      "lookup_plate",
      "tool_use_id_adversary_2",
      { plate: "XRJ4041", state: null }, // state is null, not a string
      cascade as unknown as VendorCascade,
    );
    const result = dispatched.result as Record<string, unknown>;
    expect(result.kind, "A null state should produce format_error").toBe("format_error");
    expect(cascade.plateCallCount).toBe(0);
  });

  it("lookup_vin: numeric vin returns format_error WITHOUT calling the cascade", async () => {
    const cascade = new FixtureCascade();
    const dispatched = await dispatchTool(
      "lookup_vin",
      "tool_use_id_adversary_3",
      { vin: 12345678901234567 }, // vin is a number
      cascade as unknown as VendorCascade,
    );
    const result = dispatched.result as Record<string, unknown>;
    expect(result.kind, "A numeric VIN should produce format_error").toBe("format_error");
    expect(cascade.vinCallCount).toBe(0);
  });

  it("lookup_plate: missing required 'state' field returns format_error", async () => {
    const cascade = new FixtureCascade();
    // Anthropic could send a tool_use block with plate only (schema says state required,
    // but the dispatcher must defend itself regardless).
    const dispatched = await dispatchTool(
      "lookup_plate",
      "tool_use_id_adversary_4",
      { plate: "XRJ4041" }, // state field is absent
      cascade as unknown as VendorCascade,
    );
    const result = dispatched.result as Record<string, unknown>;
    expect(result.kind, "Missing state field should produce format_error").toBe("format_error");
    expect(cascade.plateCallCount).toBe(0);
  });

  it("TOOLS array contains every expected named tool for slices A + F", () => {
    const toolNames = TOOLS.map((t) => t.name);
    // Slice A (lookup + recovery + scheduling + support).
    expect(toolNames).toContain("lookup_plate");
    expect(toolNames).toContain("lookup_vin");
    expect(toolNames).toContain("ocr_recognize");
    expect(toolNames).toContain("schedule_pickup");
    expect(toolNames).toContain("get_support_content");
    // Slice F (full post-VIN sell flow: condition → loan → offer → payment → contract).
    expect(toolNames).toContain("start_condition_intake");
    expect(toolNames).toContain("record_loan_status");
    expect(toolNames).toContain("generate_offer");
    expect(toolNames).toContain("select_payment_method");
    expect(toolNames).toContain("acknowledge_contract");
    // Verify exact count — a tool added without a dispatcher case silently breaks
    // (CAT-17). Bump this number AND add the dispatcher case AND add the tool to
    // the slice-naming groups above in the SAME commit when a new tool ships.
    expect(TOOLS.length).toBe(10);
  });
});
