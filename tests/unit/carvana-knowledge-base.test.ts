// @vitest-environment node
/**
 * Carvana knowledge base — gating tests.
 *
 * These tests are intentionally STRICT and will FAIL while the KB
 * carries the PENDING_FETCH placeholders. That failure is the gating
 * signal: do NOT ship the lookup_carvana_facts tool until every
 * declared topic has a body sourced from a real carvana.com page.
 *
 * What we enforce per entry:
 *   - body must NOT be the literal "PENDING_FETCH" placeholder
 *   - body must be at least 40 characters (i.e. a real sentence,
 *     not a one-word stub)
 *   - sourceUrl must match ^https://([a-z]+\.)?carvana\.com/<non-empty>
 *   - fetchedAt must be a valid ISO date (YYYY-MM-DD)
 *
 * What we enforce KB-wide:
 *   - every declared CarvanaFactTopic has an entry (TypeScript already
 *     guarantees this, but we re-check at runtime so an `as` cast in
 *     a future edit does not silently break the invariant)
 *   - listPopulatedCarvanaTopics() returns ALL topics (not a subset)
 *     once the KB is complete
 *
 * Why a strict gate instead of "warn and pass":
 *   The whole point of this tool is to STOP the bot from inventing
 *   Carvana facts. An unpopulated KB combined with a passing test
 *   would let the tool ship empty, the dispatcher would fall through
 *   to the format_error path on every call, and the user experience
 *   would be "the bot says it does not know" for every Carvana-specific
 *   question. Better to fail the build and force the population.
 */
import { describe, expect, it } from "vitest";
import {
  CARVANA_FACTS,
  isCarvanaFactPopulated,
  isKnownCarvanaFactTopic,
  listPopulatedCarvanaTopics,
  type CarvanaFactTopic,
} from "../../src/carvana-content/carvana-knowledge-base.ts";

const REQUIRED_TOPICS: readonly CarvanaFactTopic[] = [
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

const CARVANA_URL_PATTERN = /^https:\/\/([a-z]+\.)?carvana\.com\/.+/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

describe("CARVANA_FACTS — structural completeness", () => {
  it("declares an entry for every required topic", () => {
    for (const topic of REQUIRED_TOPICS) {
      expect(CARVANA_FACTS[topic], `missing entry for topic "${topic}"`).toBeDefined();
      expect(CARVANA_FACTS[topic].topic).toBe(topic);
    }
  });

  it("isKnownCarvanaFactTopic returns true for declared topics and false for others", () => {
    for (const topic of REQUIRED_TOPICS) {
      expect(isKnownCarvanaFactTopic(topic)).toBe(true);
    }
    expect(isKnownCarvanaFactTopic("not_a_real_topic")).toBe(false);
    expect(isKnownCarvanaFactTopic("")).toBe(false);
  });
});

describe("CARVANA_FACTS — gating: every entry is populated from a real source", () => {
  /**
   * One it() per topic so a failure reports the specific topic that is
   * not yet populated, rather than one big "KB has placeholders" message.
   * Makes the population pass much easier to debug as it lights up.
   */
  for (const topic of REQUIRED_TOPICS) {
    it(`"${topic}" has a real body (not PENDING_FETCH, >= 40 chars)`, () => {
      const fact = CARVANA_FACTS[topic];
      expect(fact.body, `topic "${topic}" still has PENDING_FETCH placeholder`).not.toBe(
        "PENDING_FETCH",
      );
      expect(
        fact.body.length,
        `topic "${topic}" body is only ${String(fact.body.length)} chars; needs >= 40`,
      ).toBeGreaterThanOrEqual(40);
    });

    it(`"${topic}" cites a real carvana.com URL`, () => {
      const fact = CARVANA_FACTS[topic];
      expect(
        fact.sourceUrl,
        `topic "${topic}" sourceUrl ${JSON.stringify(fact.sourceUrl)} does not match a carvana.com URL pattern`,
      ).toMatch(CARVANA_URL_PATTERN);
    });

    it(`"${topic}" has a valid ISO fetchedAt date`, () => {
      const fact = CARVANA_FACTS[topic];
      expect(
        fact.fetchedAt,
        `topic "${topic}" fetchedAt ${JSON.stringify(fact.fetchedAt)} is not a valid ISO date`,
      ).toMatch(ISO_DATE_PATTERN);
    });

    it(`"${topic}" has a non-trivial title`, () => {
      const fact = CARVANA_FACTS[topic];
      expect(fact.title.length).toBeGreaterThanOrEqual(5);
      expect(fact.title.toLowerCase()).not.toContain("(pending fetch)");
    });
  }
});

describe("isCarvanaFactPopulated + listPopulatedCarvanaTopics", () => {
  it("isCarvanaFactPopulated returns true for every populated entry", () => {
    // Once the KB is fully populated this will hold for ALL entries.
    // While the KB is empty, this test fails alongside the per-topic
    // tests above, making the gating obvious.
    for (const topic of REQUIRED_TOPICS) {
      expect(
        isCarvanaFactPopulated(CARVANA_FACTS[topic]),
        `topic "${topic}" is not yet populated`,
      ).toBe(true);
    }
  });

  it("listPopulatedCarvanaTopics returns all declared topics when KB is complete", () => {
    const populated = listPopulatedCarvanaTopics();
    expect(populated.length).toBe(REQUIRED_TOPICS.length);
    for (const topic of REQUIRED_TOPICS) {
      expect(populated).toContain(topic);
    }
  });
});
