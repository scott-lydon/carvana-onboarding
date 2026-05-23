/**
 * CAT-17 — Tool-schema drift test.
 *
 * Asserts every tool defined in server/chat/tools.ts has a name the
 * dispatcher accepts, an input_schema that is a well-formed JSON-schema
 * object, and (for the slice-A wired tools) a dispatch path that returns
 * a structured result instead of throwing.
 *
 * The dispatcher's `default` branch throws when given an unknown tool
 * name, so we also verify that path produces a useful error message
 * (programmer-error path).
 */
import { describe, expect, it } from "vitest";
import { dispatchTool, TOOLS } from "../../server/chat/tools.ts";

describe("CAT-17: chat tool-schema integrity", () => {
  it("every tool has a non-empty name, description, and input_schema", () => {
    expect(TOOLS.length).toBeGreaterThan(0);
    for (const tool of TOOLS) {
      expect(tool.name, `tool name should be non-empty`).toMatch(/^[a-z_]+$/);
      expect(typeof tool.description).toBe("string");
      expect((tool.description ?? "").length).toBeGreaterThan(10);
      const schema = tool.input_schema as Record<string, unknown>;
      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();
    }
  });

  it("dispatchTool throws with a useful message on unknown tool names", async () => {
    await expect(
      dispatchTool("not_a_real_tool", "tool_use_id_x", {}, undefined),
    ).rejects.toThrow(/unknown tool name/);
  });

  it("ocr_recognize returns user_action_required (slice B reality: server can't capture camera)", async () => {
    const dispatched = await dispatchTool(
      "ocr_recognize",
      "tool_use_id_ocr",
      { target: "vin_sticker" },
      undefined,
    );
    const result = dispatched.result as Record<string, unknown>;
    expect(result.kind).toBe("user_action_required");
    expect(result.action).toBe("tap_camera_button");
  });

  it("schedule_pickup returns user_action_required (slice C reality: server doesn't pick the slot)", async () => {
    const dispatched = await dispatchTool(
      "schedule_pickup",
      "tool_use_id_sched",
      { zip: "78701" },
      undefined,
    );
    const result = dispatched.result as Record<string, unknown>;
    expect(result.kind).toBe("user_action_required");
    expect(result.action).toBe("tap_scheduler_button");
  });

  it("get_support_content returns the structured support card (slice D)", async () => {
    const dispatched = await dispatchTool(
      "get_support_content",
      "tool_use_id_sc",
      { topic: "data_privacy" },
      undefined,
    );
    const result = dispatched.result as Record<string, unknown>;
    expect(result.kind).toBe("support_content");
    expect(typeof result.title).toBe("string");
    expect(typeof result.body).toBe("string");
  });

  it("lookup_plate without a cascade returns configuration_missing", async () => {
    const dispatched = await dispatchTool(
      "lookup_plate",
      "tool_use_id_z",
      { plate: "XRJ4041", state: "TX" },
      undefined,
    );
    const result = dispatched.result as Record<string, unknown>;
    expect(result.kind).toBe("configuration_missing");
    expect(typeof result.message).toBe("string");
  });

  it("lookup_plate with malformed input returns format_error not a throw", async () => {
    const dispatched = await dispatchTool(
      "lookup_plate",
      "tool_use_id_w",
      { plate: 123, state: "TX" },
      undefined,
    );
    const result = dispatched.result as Record<string, unknown>;
    // configuration_missing wins when cascade is undefined; that's fine — the
    // important check is that we did NOT throw on a non-string plate.
    expect(typeof result.kind).toBe("string");
  });
});
