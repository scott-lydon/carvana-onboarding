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
 * The KB. Populated from a live fetch of carvana.com / carvana.com help
 * articles on 2026-05-24. Bodies paraphrase tightly from the source
 * pages cited in `sourceUrl`; numbers (dollar amounts, day windows,
 * coverage percentages, mileage caps) are quoted verbatim from those
 * pages. Re-fetch and bump `fetchedAt` whenever Carvana updates a
 * policy page so a stale fact does not surface to a real seller.
 *
 * Sourced via Chrome navigating to each carvana.com URL because the
 * page bodies are React-rendered (raw HTML is a Cloudflare challenge
 * shell). `lookup_carvana_facts` calls return these entries as
 * structured tool_results with a clickable Source: link in the UI.
 */
const FETCHED_AT = "2026-05-24";

export const CARVANA_FACTS: Readonly<Record<CarvanaFactTopic, CarvanaFact>> = {
  how_selling_works: {
    topic: "how_selling_works",
    title: "How selling to Carvana works",
    body:
      "To make an offer, Carvana asks for the license plate or vehicle " +
      "identification number, the car's overall condition, mileage, and " +
      "features. The VIN is used to look up vehicle-specific details, and " +
      "Carvana commits to an instant, accurate offer based on the answers " +
      "you provide. After accepting, you upload documents to verify you " +
      "can sell the car, choose how you want to be paid, and schedule the " +
      "appointment. Depending on your location, Carvana picks the car up, " +
      "meets at an agreed location, or has you drop it off; a pickup fee " +
      "may apply.",
    sourceUrl: "https://www.carvana.com/help/sell-or-trade/how-do-i-sell-my-car/",
    fetchedAt: FETCHED_AT,
  },
  offer_validity_window: {
    topic: "offer_validity_window",
    title: "How long the sale takes from offer to payment",
    body:
      "Carvana states that in some locations they can buy your vehicle on " +
      "the same day you get your offer, and that on average it takes about " +
      "3 to 10 days to complete the sale, though unique situations can run " +
      "longer. Entering vehicle details produces an offer in under 2 " +
      "minutes; then you upload required documentation (specifically a " +
      "photo of the title and a photo of the odometer), wait for Carvana " +
      "to review, schedule pickup or drop-off, and choose a payment method.",
    sourceUrl:
      "https://www.carvana.com/help/sell-or-trade/how-long-does-the-entire-selling-process-take/",
    fetchedAt: FETCHED_AT,
  },
  what_documents_are_needed_at_pickup: {
    topic: "what_documents_are_needed_at_pickup",
    title: "Documents needed at the sell appointment",
    body:
      "At the pickup or drop-off appointment, Carvana confirms vehicle " +
      "details, you sign documents, and Carvana pays you for the vehicle. " +
      "Pickup availability depends on your location and may carry a fee; " +
      "the fee is disclosed before you schedule. In the steps leading up " +
      "to the appointment Carvana requires you to upload documentation " +
      "to verify ownership — specifically a photo of your title and a " +
      "photo of your odometer — so the sale can be approved before you " +
      "arrive.",
    sourceUrl:
      "https://www.carvana.com/help/sell-or-trade/how-do-pickup-and-drop-off-appointments-work-when-selling-my-car/",
    fetchedAt: FETCHED_AT,
  },
  title_transfer_responsibility: {
    topic: "title_transfer_responsibility",
    title: "Who reports the sale to the DMV",
    body:
      "After you sell to Carvana, if your state DMV later mails you a " +
      "renewal or lapsed-registration notice for the car you sold, you " +
      "need to report the sale to the DMV yourself — Carvana is not able " +
      "to file the release of liability on your behalf. The report can " +
      "usually be completed on the DMV website; if the form asks for the " +
      "buyer's address, Carvana's published address is 300 E. Rio Salado " +
      "Parkway, Bldg 1, Tempe, AZ 85281.",
    sourceUrl:
      "https://www.carvana.com/help/sell-or-trade/why-did-i-receive-notice-from-the-dmv/",
    fetchedAt: FETCHED_AT,
  },
  loan_payoff_process: {
    topic: "loan_payoff_process",
    title: "Selling a car that still has a loan",
    body:
      "Yes — you can sell to Carvana even if your vehicle still has an " +
      "active loan. You provide loan-payoff information up front, and in " +
      "some cases Carvana can help collect it directly from your lender. " +
      "After the sale, Carvana pays the lien off directly. Until the " +
      "payoff completes you should keep paying your loan to avoid late " +
      "fees; any overpayment is reimbursed to you by the lender.",
    sourceUrl:
      "https://www.carvana.com/help/sell-or-trade/can-i-sell-my-car-to-carvana-even-if-i-still-have-a-loan-on-my-vehicle/",
    fetchedAt: FETCHED_AT,
  },
  negative_equity_handling: {
    topic: "negative_equity_handling",
    title: "What happens with positive or negative equity",
    body:
      "Carvana's loan-payoff article addresses the positive-equity case " +
      "directly: if your vehicle is worth more than you owe, you receive " +
      "the difference at sale, or you can apply it toward a Carvana " +
      "purchase. The page does not state that Carvana covers a shortfall " +
      "when you owe more than the offer, so sellers with negative equity " +
      "should plan to cover the gap themselves and confirm the exact " +
      "difference with Carvana before scheduling the appointment.",
    sourceUrl:
      "https://www.carvana.com/help/sell-or-trade/can-i-sell-my-car-to-carvana-even-if-i-still-have-a-loan-on-my-vehicle/",
    fetchedAt: FETCHED_AT,
  },
  pickup_service_area: {
    topic: "pickup_service_area",
    title: "Where Carvana picks up vehicles",
    body:
      "Carvana offers in-home vehicle pickup, but availability depends on " +
      "your location and is confirmed only after your sale is approved. " +
      "Carvana publishes that 81% of the U.S. population is within their " +
      "delivery area and 94.4% of the population is within 200 miles of a " +
      "Carvana facility. If pickup is available a fee may apply; Carvana " +
      "discloses any charge before you schedule, and you can drop off at " +
      "a Carvana hub or Car Vending Machine instead.",
    sourceUrl:
      "https://www.carvana.com/help/sell-or-trade/will-carvana-pick-up-my-vehicle-from-my-home/",
    fetchedAt: FETCHED_AT,
  },
  trade_in_credit_versus_cash_offer: {
    topic: "trade_in_credit_versus_cash_offer",
    title: "Tax effect of trade-in credit vs. cash offer",
    body:
      "In most states, applying your offer toward a Carvana purchase as " +
      "a trade-in (instead of taking cash) lowers your taxable amount: " +
      "you pay sales tax only on the difference between the new vehicle's " +
      "price and the trade-in value. Carvana's example: a $5,000 trade " +
      "against an $8,000 purchase means tax on the $3,000 difference, " +
      "versus tax on the full $8,000 without a trade. The tax advantage " +
      "applies only when the trade and Carvana purchase happen on the " +
      "same transaction. States where this does not apply: CA, DC, OH, " +
      "OK, OR, VA.",
    sourceUrl:
      "https://www.carvana.com/help/sell-or-trade/are-there-tax-savings-to-trading-in-my-car/",
    fetchedAt: FETCHED_AT,
  },
  buyer_seven_day_return_policy: {
    topic: "buyer_seven_day_return_policy",
    title: "7-Day Money Back Guarantee limits",
    body:
      "The 7-Day Money Back Guarantee starts on the day you receive the " +
      "vehicle. You must notify Carvana before 8:00 p.m. EST on the 7th " +
      "day to return or exchange. You can exchange up to two times for a " +
      "total of three vehicles, but the third does not come with the " +
      "guarantee. You may drive up to 400 miles within the window; miles " +
      "over 400 are billed at $1.00 per additional mile. A vehicle is " +
      "not eligible for return if it was in an accident, altered from " +
      "its sold condition, or subject to a lien other than the purchase " +
      "lien.",
    sourceUrl:
      "https://www.carvana.com/help/purchasing-a-car/what-are-the-limits-of-the-7-day-money-back-guarantee/",
    fetchedAt: FETCHED_AT,
  },
  buyer_carvana_certified_process: {
    topic: "buyer_carvana_certified_process",
    title: "What Carvana Certified means",
    body:
      "Carvana Certified vehicles earn Carvana's highest quality standard. " +
      "They have no reported accidents, fire, flood, or frame damage " +
      "according to CARFAX and AutoCheck, and every Certified car goes " +
      "through a 150-point inspection. Carvana notes vehicle history " +
      "reports rely on reported information; unreported incidents may " +
      "exist. Certified purchases also include the 7-Day Money Back " +
      "Guarantee (return for any reason within 7 days of delivery, less " +
      "shipping fees), a free CARFAX vehicle history report, a free oil " +
      "change, and the owner's manual.",
    sourceUrl: "https://www.carvana.com/certified-program",
    fetchedAt: FETCHED_AT,
  },
  buyer_financing_options: {
    topic: "buyer_financing_options",
    title: "Financing a Carvana purchase",
    body:
      "Carvana lets buyers pre-qualify for an auto loan in about 2 minutes " +
      "with no hit to credit; pre-qualifying shows real monthly and down " +
      "payment terms on every vehicle, but is not full approval. To be " +
      "approved for the loan you must complete underwriting after placing " +
      "an order, which includes identity and income verification. Carvana " +
      "welcomes all credit types and publishes a 99% approval rate for " +
      "customers who meet eligibility, accurately represent income, and " +
      "fully participate in underwriting. Buyers can also pay with their " +
      "own bank financing or a secure electronic payment.",
    sourceUrl: "https://www.carvana.com/financing",
    fetchedAt: FETCHED_AT,
  },
  company_mission_and_values: {
    topic: "company_mission_and_values",
    title: "Carvana's brand promise",
    body:
      "Carvana's about page frames the brand as \"Get the car without the " +
      "car salesman\" — a 100% online used-car experience with no " +
      "haggling and what the company describes as no bogus fees. Buyers " +
      "can have a vehicle delivered to their driveway or pick it up from " +
      "a Car Vending Machine. Every used Carvana vehicle comes standard " +
      "with a limited 100-day / 4,189-mile warranty, and inventory " +
      "(including partner inventory) is inspected and reconditioned, with " +
      "no reported frame damage on listed Certified cars.",
    sourceUrl: "https://www.carvana.com/about-us",
    fetchedAt: FETCHED_AT,
  },
  company_no_haggle_promise: {
    topic: "company_no_haggle_promise",
    title: "Carvana's no-haggle offer commitment",
    body:
      "On the sell side, Carvana's headline is \"Get a real offer in 2 " +
      "minutes. Sell or trade your car 100% online. No haggling, no " +
      "headaches.\" The offer flow takes either a license plate plus " +
      "state or a VIN, then walks the seller through condition, mileage, " +
      "and features, and produces an instant offer. The no-haggle " +
      "commitment means the offer shown is what Carvana pays at the " +
      "appointment, subject to the on-site review of the vehicle's " +
      "condition.",
    sourceUrl: "https://www.carvana.com/sell-my-car",
    fetchedAt: FETCHED_AT,
  },
  recent_policy_changes: {
    topic: "recent_policy_changes",
    title: "Recent Carvana operational updates",
    body:
      "The Carvana newsroom is the canonical record of recent operational " +
      "updates. As of late May 2026, recent items include Carvana bringing " +
      "inspection-and-reconditioning capabilities to its ADESA Chicago " +
      "site (May 6, 2026) and announcing an investor tour at the Elyria, " +
      "Ohio inspection-and-reconditioning center (May 5, 2026). For " +
      "policy-specific changes (return window, fee structures, service " +
      "area expansion), check the latest dated press entries and the " +
      "help-center article matching your topic.",
    sourceUrl: "https://www.carvana.com/press",
    fetchedAt: FETCHED_AT,
  },
};

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
