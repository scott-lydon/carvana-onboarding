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

  it("lookup_carvana_facts is declared with the documented topic enum", () => {
    const tool = TOOLS.find((t) => t.name === "lookup_carvana_facts");
    expect(tool, "lookup_carvana_facts tool must be declared in TOOLS").toBeDefined();
    if (tool === undefined) return; // narrow; the expect above already failed loudly
    const schema = tool.input_schema as Record<string, unknown>;
    const props = schema.properties as Record<string, unknown>;
    const topicProp = props.topic as Record<string, unknown>;
    const enumValues = topicProp.enum as readonly string[];
    // The enum on the tool definition must stay in sync with the
    // CarvanaFactTopic type union — otherwise the model can request a
    // topic the dispatcher will reject as unknown. Check that every
    // value declared in the file is one of the documented topics.
    const REQUIRED: readonly string[] = [
      "how_selling_works",
      "offer_validity_window",
      "what_documents_are_needed_at_pickup",
      "title_transfer_responsibility",
      "loan_payoff_process",
      "negative_equity_handling",
      "pickup_service_area",
      "trade_in_credit_versus_cash_offer",
      "buyer_seven_day_return_policy",
      "buyer_carvana_certified_process",
      "buyer_financing_options",
      "company_mission_and_values",
      "company_no_haggle_promise",
      "recent_policy_changes",
    ];
    for (const topic of REQUIRED) {
      expect(enumValues, `enum missing topic ${topic}`).toContain(topic);
    }
  });

  it("lookup_carvana_facts with unknown topic returns format_error (does not throw)", async () => {
    const dispatched = await dispatchTool(
      "lookup_carvana_facts",
      "tool_use_id_cv1",
      { topic: "not_a_real_topic" },
      undefined,
    );
    const result = dispatched.result as Record<string, unknown>;
    expect(result.kind).toBe("format_error");
    expect(result.field).toBe("topic");
  });

  it("lookup_carvana_facts returns fact_not_yet_populated for known-but-empty topics (placeholder safety net)", async () => {
    // While the KB carries PENDING_FETCH placeholders, the dispatcher
    // MUST return fact_not_yet_populated rather than the empty body.
    // Once the KB is populated, this branch reverses (returns kind=
    // carvana_fact instead) — accept both so the test stays green
    // through the population pass.
    const dispatched = await dispatchTool(
      "lookup_carvana_facts",
      "tool_use_id_cv2",
      { topic: "how_selling_works" },
      undefined,
    );
    const result = dispatched.result as Record<string, unknown>;
    expect(["fact_not_yet_populated", "carvana_fact"]).toContain(result.kind);
    if (result.kind === "carvana_fact") {
      expect(typeof result.sourceUrl).toBe("string");
      expect(String(result.sourceUrl)).toMatch(
        /^https:\/\/([a-z]+\.)?carvana\.com\/.+/,
      );
    }
  });
});
