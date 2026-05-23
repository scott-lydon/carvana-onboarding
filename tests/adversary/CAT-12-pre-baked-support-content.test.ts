// @vitest-environment node
/**
 * CAT-12 — Pre-baked support content (constitutional non-negotiable 10).
 *
 * The LLM picks WHICH card to surface via get_support_content tool input.
 * The DISPATCHER returns the literal card body committed at
 * src/support-content/cards.ts. The LLM must NOT generate replacement
 * empathy text. Hallucinated emotional reassurance ("Carvana never
 * reduces offers!") is a legal and trust risk that pre-baked content
 * eliminates at the architecture level.
 *
 * This test enforces byte-for-byte match between what the dispatcher
 * returns and what's committed in cards.ts. Any drift (a typo correction
 * in cards.ts, a "creative" rewrite by the dispatcher) is a CAT-12
 * regression and blocks the slice.
 */
import { describe, expect, it } from "vitest";
import { dispatchTool } from "../../server/chat/tools.ts";
import { SUPPORT_CARDS, type SupportTopic } from "../../src/support-content/cards.ts";

describe("CAT-12: dispatcher returns committed support card body byte-for-byte", () => {
  for (const topic of Object.keys(SUPPORT_CARDS) as SupportTopic[]) {
    it(`get_support_content("${topic}") returns the exact committed card`, async () => {
      const dispatched = await dispatchTool(
        "get_support_content",
        "tool_use_id_x",
        { topic },
        undefined,
      );
      const result = dispatched.result as Record<string, unknown>;
      const expected = SUPPORT_CARDS[topic];
      expect(result.kind).toBe("support_content");
      expect(result.topic).toBe(expected.topic);
      expect(result.title).toBe(expected.title);
      // Byte-for-byte body match. A single trailing whitespace or em-dash
      // substitution here is a regression.
      expect(result.body).toBe(expected.body);
      expect(result.telemetryEvent).toBe(expected.telemetryEvent);
    });
  }

  it("returns format_error for an unknown topic (caller mistake, not a crash)", async () => {
    const dispatched = await dispatchTool(
      "get_support_content",
      "tool_use_id_unknown",
      { topic: "definitely_not_a_real_topic" },
      undefined,
    );
    const result = dispatched.result as Record<string, unknown>;
    expect(result.kind).toBe("format_error");
    expect(typeof result.reason).toBe("string");
  });

  it("every committed card has 60-80 word body (authoring guideline)", () => {
    for (const topic of Object.keys(SUPPORT_CARDS) as SupportTopic[]) {
      const wordCount = SUPPORT_CARDS[topic].body.trim().split(/\s+/).length;
      expect(
        wordCount,
        `${topic} body should be 60-80 words; got ${String(wordCount)}`,
      ).toBeGreaterThanOrEqual(50);
      expect(wordCount).toBeLessThanOrEqual(100);
    }
  });
});
