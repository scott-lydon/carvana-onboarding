/**
 * Carvana official knowledge base.
 *
 * Pre-baked facts sourced VERBATIM (or near-verbatim) from carvana.com,
 * the Carvana Help Center, the About / Values pages, and Carvana
 * press releases. Every entry MUST cite a real URL on a carvana.com
 * subdomain — no fabricated quotes, no paraphrasing that drifts from
 * the source, no facts pulled from training data without a citation.
 *
 * This file is the parallel to {@link ../support-content/cards.ts}.
 * SUPPORT_CARDS handles the high-empathy moments where pre-baked
 * tone matters more than literal accuracy; CARVANA_FACTS handles the
 * "what does Carvana actually do" moments where literal accuracy
 * matters more than tone.
 *
 * Constitutional non-negotiable: the LLM picks WHICH fact to surface
 * via tool-use, but it does NOT generate the body. Hallucinated
 * Carvana facts (wrong fee, wrong policy timing, wrong service area)
 * are a legal and trust risk. The unit test for this file enforces
 * that every entry carries a `sourceUrl` matching `^https://([a-z]+\.)?carvana\.com/`
 * AND a non-empty `body`. An empty KB fails the test, which is
 * intentional — populating from a real fetch is a precondition for
 * shipping the tool.
 *
 * Authoring guidelines (when populating each entry):
 *   - 40-100 words per body. Tight, prose-shaped, no bullet points.
 *   - Quote or paraphrase TIGHTLY from the source. If a sentence is
 *     verbatim from carvana.com, leave it verbatim.
 *   - Numbers (dollar amounts, days, percentages) must come from the
 *     source page, not from memory.
 *   - `fetchedAt` is the ISO date of the source fetch. Bump it on
 *     every refresh so a future operator can tell whether a fact is
 *     stale relative to a Carvana policy change.
 *   - No emoji, no exclamation points, no "Carvana is great" framing.
 *     The model adds the warmth; this file provides the substance.
 */

/**
 * Topics the chatbot can fetch. Add a topic here AND populate the
 * matching entry in CARVANA_FACTS in the same commit; the tool-schema
 * test asserts the enum stays in sync with the dispatcher.
 *
 * Topics are intentionally narrow rather than broad ("how_does_the_offer_work"
 * not "selling") so the model picks the right card without ambiguity.
 */
export type CarvanaFactTopic =
  | "how_selling_works"
  | "offer_validity_window"
  | "what_documents_are_needed_at_pickup"
  | "title_transfer_responsibility"
  | "loan_payoff_process"
  | "negative_equity_handling"
  | "pickup_service_area"
  | "trade_in_credit_versus_cash_offer"
  | "buyer_seven_day_return_policy"
  | "buyer_carvana_certified_process"
  | "buyer_financing_options"
  | "company_mission_and_values"
  | "company_no_haggle_promise"
  | "recent_policy_changes";

export interface CarvanaFact {
  readonly topic: CarvanaFactTopic;
  readonly title: string;
  readonly body: string;
  /**
   * Canonical source URL on a carvana.com subdomain. Validated by the
   * unit test: ^https://([a-z]+\.)?carvana\.com/ + non-empty path.
   */
  readonly sourceUrl: string;
  /** ISO-8601 date of the last fetch from sourceUrl. */
  readonly fetchedAt: string;
}

/**
 * The KB. **Empty by design** until the carvana.com egress allowlist
 * is enabled (Cowork Settings → Capabilities → Allowed domains). On
 * populate, every entry must cite a real URL — see the file-header
 * authoring guidelines.
 *
 * Tests in `tests/unit/carvana-knowledge-base.test.ts` will FAIL
 * loudly while this map is empty. That failure is the gating signal
 * that the tool is not yet ready to ship — do NOT relax the test to
 * pass an empty KB.
 */
export const CARVANA_FACTS: Readonly<Record<CarvanaFactTopic, CarvanaFact>> = {
  // TOPICS DECLARED — BODIES POPULATED AFTER FETCH FROM carvana.com.
  // The unit test will fail until each entry below has a sourceUrl on
  // a carvana.com subdomain AND a body of at least 40 characters.
  // Empty values are placeholders; do not deploy until populated.
  how_selling_works: empty("how_selling_works"),
  offer_validity_window: empty("offer_validity_window"),
  what_documents_are_needed_at_pickup: empty("what_documents_are_needed_at_pickup"),
  title_transfer_responsibility: empty("title_transfer_responsibility"),
  loan_payoff_process: empty("loan_payoff_process"),
  negative_equity_handling: empty("negative_equity_handling"),
  pickup_service_area: empty("pickup_service_area"),
  trade_in_credit_versus_cash_offer: empty("trade_in_credit_versus_cash_offer"),
  buyer_seven_day_return_policy: empty("buyer_seven_day_return_policy"),
  buyer_carvana_certified_process: empty("buyer_carvana_certified_process"),
  buyer_financing_options: empty("buyer_financing_options"),
  company_mission_and_values: empty("company_mission_and_values"),
  company_no_haggle_promise: empty("company_no_haggle_promise"),
  recent_policy_changes: empty("recent_policy_changes"),
};

/**
 * Placeholder factory. Returns an entry whose body is the literal
 * string "PENDING_FETCH". The dispatcher's runtime check refuses to
 * surface PENDING_FETCH bodies — instead returning a structured
 * format_error so the chatbot can fall back to "I don't have that
 * information yet — let me have a human get back to you" instead of
 * presenting an empty card to the user.
 */
function empty(topic: CarvanaFactTopic): CarvanaFact {
  return {
    topic,
    title: `(pending fetch) ${topic}`,
    body: "PENDING_FETCH",
    sourceUrl: "",
    fetchedAt: "",
  };
}

/** Type guard. Use BEFORE indexing into CARVANA_FACTS. */
export function isKnownCarvanaFactTopic(
  value: string,
): value is CarvanaFactTopic {
  return value in CARVANA_FACTS;
}

/**
 * True when the entry has been populated with real content (not the
 * PENDING_FETCH placeholder). Used by the dispatcher to decide between
 * surfacing the fact vs. returning a "not yet populated" error.
 */
export function isCarvanaFactPopulated(fact: CarvanaFact): boolean {
  return (
    fact.body !== "PENDING_FETCH" &&
    fact.body.length >= 40 &&
    fact.sourceUrl.startsWith("https://") &&
    fact.fetchedAt !== ""
  );
}

/**
 * List the topics currently populated. Useful for the system prompt
 * (so it knows what it can ask for) and for diagnostics.
 */
export function listPopulatedCarvanaTopics(): readonly CarvanaFactTopic[] {
  return (Object.keys(CARVANA_FACTS) as CarvanaFactTopic[]).filter((t) =>
    isCarvanaFactPopulated(CARVANA_FACTS[t]),
  );
}
