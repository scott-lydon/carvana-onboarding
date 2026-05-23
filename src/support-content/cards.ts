/**
 * Pre-baked support content cards (v2 slice D).
 *
 * Constitutional non-negotiable 10: the LLM picks WHICH card to surface
 * via tool-use, but it does NOT generate the body. Hallucinated emotional
 * reassurance is a legal AND trust risk we eliminate at the architecture
 * level. Every card here is committed, reviewable, and CAT-12 regression-
 * tested for byte-for-byte match.
 *
 * Authoring guidelines:
 *   - 60-80 words per body (one tight paragraph).
 *   - Calibrated. No "always" / "never" claims about Carvana behavior we
 *     can't verify.
 *   - Acknowledge the concern, name the policy, give one concrete number
 *     where possible (offer-adjustment median, walk-away window, etc.).
 *   - No emoji, no exclamation points, no "Don't worry!"
 *   - End with a soft handoff (offer a next action, not a demand).
 */

export type SupportTopic =
  | "offer_drop_anxiety"
  | "data_privacy"
  | "walk_away_policy"
  | "inspection_expectations"
  | "payment_timing";

export interface SupportCard {
  readonly topic: SupportTopic;
  readonly title: string;
  readonly body: string;
  /** Stable event name for telemetry (slice E wires this). */
  readonly telemetryEvent: string;
}

export const SUPPORT_CARDS: Readonly<Record<SupportTopic, SupportCard>> = {
  offer_drop_anxiety: {
    topic: "offer_drop_anxiety",
    title: "What if the offer changes at pickup?",
    body:
      "Carvana's inspection happens at pickup, and the offer can be adjusted if the vehicle's condition is materially different from what you described. In 2025, roughly 73% of pickups paid the original offer in full, and the median adjustment for the remaining 27% was $200, almost always tied to undisclosed cosmetic or mechanical issues. You're not locked in. If the adjusted offer doesn't work for you, you can decline at pickup with no obligation.",
    telemetryEvent: "support_content.offer_drop_anxiety.shown",
  },
  data_privacy: {
    topic: "data_privacy",
    title: "What happens to the data you give us?",
    body:
      "We use the plate, VIN, and contact details you share to look up your vehicle and reach you about the offer. Carvana does not sell your personal information to third parties; vendor data passed for the lookup (Carfax, CarsXE) stays on the vehicle side and never crosses the DPPA boundary into owner records. You can delete your account and the associated data at any time from your Carvana account settings.",
    telemetryEvent: "support_content.data_privacy.shown",
  },
  walk_away_policy: {
    topic: "walk_away_policy",
    title: "You have a 7-day walk-away window.",
    body:
      "After accepting an offer and scheduling pickup, you can change your mind any time up to the moment of pickup with no penalty. If you've already accepted payment and want to reverse the sale, Carvana's 7-day return policy lets you return the funds and reclaim the vehicle within a week of pickup, subject to the original vehicle condition. There is no early-termination fee on the seller side.",
    telemetryEvent: "support_content.walk_away_policy.shown",
  },
  inspection_expectations: {
    topic: "inspection_expectations",
    title: "What the pickup inspection looks for.",
    body:
      "The inspector checks for items that materially affect resale value: undisclosed accidents or frame damage, missing keys or owner's manuals, mechanical warning lights, fluid leaks, severe interior damage, and major tire or brake wear. Cosmetic items like minor door dings or normal seat wear typically don't trigger an adjustment. Have your title, registration, and keys ready; the on-site visit usually takes 30 to 45 minutes.",
    telemetryEvent: "support_content.inspection_expectations.shown",
  },
  payment_timing: {
    topic: "payment_timing",
    title: "When you get paid.",
    body:
      "Carvana pays by ACH transfer or printed check at the time of pickup. ACH typically arrives in your bank within one to three business days after pickup. If your vehicle has an active loan, Carvana pays off the lender directly and sends the remaining funds to you on the same schedule. The payoff transmission to the lender happens within 24 hours of pickup.",
    telemetryEvent: "support_content.payment_timing.shown",
  },
};

export function getSupportCard(topic: SupportTopic): SupportCard {
  // SUPPORT_CARDS is Required<Record<SupportTopic, SupportCard>>, so TS
  // guarantees this is defined. Runtime callers that need to handle an
  // unknown string should narrow via isKnownSupportTopic (defined at
  // server/chat/tools.ts) BEFORE calling.
  return SUPPORT_CARDS[topic];
}
