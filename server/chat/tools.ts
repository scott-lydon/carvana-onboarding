/**
 * Tool definitions for the v2 chatbot.
 *
 * Slice A wires lookup_plate and lookup_vin. The remaining tools
 * (ocr_recognize, schedule_pickup, get_support_content, generate_offer) are
 * declared here so the chatbot KNOWS they exist and can plan around them,
 * but the dispatcher returns a sentinel value ("slice_X_not_wired") that
 * Claude interprets as "this capability is announced but not yet usable" so
 * it does not promise the user a tool result we cannot deliver. The
 * sentinel approach is cheaper than rewriting the system prompt every slice.
 *
 * Tool schemas use the Anthropic JSON schema dialect (per
 * https://docs.claude.com/en/docs/build-with-claude/tool-use). The
 * dispatcher validates inputs at call time so a tool-schema-drift bug
 * (CAT-17) surfaces as a structured error, not a runtime crash.
 */
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import {
  Plate,
  parseStateCode,
  tryParseVinWithPermutation,
} from "../../src/lookup/types.js";
import type { VendorCascade } from "../../src/lookup/VendorCascade.js";
import {
  SUPPORT_CARDS,
  type SupportTopic,
} from "../../src/support-content/cards.js";
// ConditionTier intentionally NOT imported here — it is enforced via
// the inline enum check on `cd` below, and the compiler narrows the
// validated value through the cast in offerInput.
import { generateOffer, type OfferInput } from "../offer/OfferEngine.js";

/**
 * Anthropic Tool definitions. Names must match the dispatcher's switch
 * exactly; the tool-schema integration test enforces this.
 */
export const TOOLS: readonly Tool[] = [
  {
    name: "lookup_plate",
    description:
      "Look up a US license plate via the VendorCascade. Returns the resolved vehicle on hit, " +
      "or a structured failure kind (not_found, transient_error, bot_detected, format_error, " +
      "configuration_missing) the chatbot maps to user-facing copy. Use this tool any time the " +
      "user provides a plate, even if the format looks odd.",
    input_schema: {
      type: "object",
      properties: {
        plate: {
          type: "string",
          description:
            "The license plate as the user typed it. Letters/digits, may include spaces or dashes.",
        },
        state: {
          type: "string",
          description: "Two-letter US state code (CA, TX, NY, etc.).",
        },
      },
      required: ["plate", "state"],
    },
  },
  {
    name: "lookup_vin",
    description:
      "Look up a 17-character VIN via the VendorCascade. I/O/Q auto-substitution is applied " +
      "server-side. Returns the same kind-of-result shape as lookup_plate.",
    input_schema: {
      type: "object",
      properties: {
        vin: {
          type: "string",
          description:
            "The 17-character VIN. May contain I/O/Q which the server will auto-substitute.",
        },
      },
      required: ["vin"],
    },
  },
  // Slices B/C/D/E announce these to the model. The dispatcher returns
  // a "not_wired" sentinel so the chatbot knows not to promise results yet.
  {
    name: "ocr_recognize",
    description:
      "(Wires up in slice B.) Trigger the browser to open the camera and capture a VIN sticker, " +
      "registration card, or insurance card. The image is recognized by Claude vision and the " +
      "extracted VIN flows back as a tool_result. In slice A this returns a not_wired sentinel.",
    input_schema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: ["vin_sticker", "registration_card", "insurance_card", "driver_license"],
          description: "What kind of document to ask the user to capture.",
        },
      },
      required: ["target"],
    },
  },
  {
    name: "schedule_pickup",
    description:
      "(Wires up in slice C.) Open the scheduler so the user can pick a pickup slot. Returns " +
      "available slots for the user's zip and the next 14-day window. In slice A returns not_wired.",
    input_schema: {
      type: "object",
      properties: {
        zip: { type: "string", description: "5-digit US zip code." },
      },
      required: ["zip"],
    },
  },
  {
    name: "get_support_content",
    description:
      "(Wires up in slice D.) Surface a pre-baked empathy / reassurance card by topic. Use when " +
      "the user expresses anxiety. In slice A returns not_wired.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: [
            "offer_drop_anxiety",
            "data_privacy",
            "walk_away_policy",
            "inspection_expectations",
            "payment_timing",
          ],
        },
      },
      required: ["topic"],
    },
  },
  // ─────────────────────────────────────────────────────────────────────
  // Slice F (this commit): the post-VIN flow. Tools added so Haiku 4.5
  // can orchestrate every Carvana sell-side stage, not just lookup +
  // pickup. Each tool either calls a real backend (generate_offer →
  // OfferEngine.generateOffer) or returns user_action_required to open
  // a side-panel; the panel posts a structured chat message back into
  // the conversation, just like the existing OcrCapture / Scheduler
  // pattern. No sentinels — every dispatch path returns a real result.
  // ─────────────────────────────────────────────────────────────────────
  {
    name: "start_condition_intake",
    description:
      "Open the multi-photo condition uploader so the user can upload 3-12 photos of their car " +
      "(four exterior corners, odometer, interior, VIN plate, damage closeups). Server-side Claude " +
      "vision extracts the odometer reading, tags visible damage by panel, suggests a condition " +
      "tier (Excellent/Good/Fair/Rough), and returns 1-4 short follow-up questions for things " +
      "vision cannot see (warning lights, smoke, accidents, mods). Call this RIGHT AFTER the " +
      "vehicle is confirmed by lookup_plate or lookup_vin, before anything else. The user's " +
      "response will arrive as a chat message starting with \"Condition assessment:\".",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "record_loan_status",
    description:
      "Records whether the seller still has a loan on this vehicle. If hasLien=false, no further " +
      "input needed and the offer engine assumes payoffAmount=0. If hasLien=true, the loan-payoff " +
      "panel opens for the user to enter their lender name and 10-day payoff amount; the panel " +
      "posts back as \"Loan payoff recorded: $<amount> owed to <lender>\". Always ask the seller " +
      "explicitly whether they have a loan BEFORE calling this tool — do not assume.",
    input_schema: {
      type: "object",
      properties: {
        hasLien: {
          type: "boolean",
          description: "true if the seller has a loan on the vehicle, false if the title is clean.",
        },
      },
      required: ["hasLien"],
    },
  },
  {
    name: "generate_offer",
    description:
      "Compute the deterministic instant offer using the OfferEngine formula (year + make + model " +
      "+ mileage + condition tier + optional loan payoff). Returns a full line-itemed breakdown the " +
      "UI renders as an OfferCard. The formula is transparent: every line shows the named factor, " +
      "the dollar contribution, and a one-sentence explanation. The offer is valid 7 days or 1,000 " +
      "miles, whichever first. Do NOT call this until you have year, make, model, mileage, " +
      "condition (suggestedTier from the condition assessment OR confirmed by the user), and " +
      "loan-payoff information (the user has told you whether they have a lien).",
    input_schema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Vehicle model year (e.g. 2021)." },
        make: { type: "string", description: "Vehicle make (e.g. 'Toyota')." },
        model: { type: "string", description: "Vehicle model (e.g. 'Camry')." },
        mileage: {
          type: "number",
          description: "Current odometer reading in miles (non-negative).",
        },
        condition: {
          type: "string",
          enum: ["Excellent", "Good", "Fair", "Rough"],
          description: "Condition tier from the condition assessment or user confirmation.",
        },
        payoffAmount: {
          type: "number",
          description:
            "10-day loan payoff in dollars. Omit entirely (do not pass 0 or null) when the seller has confirmed there is no lien.",
        },
      },
      required: ["year", "make", "model", "mileage", "condition"],
    },
  },
  {
    name: "select_payment_method",
    description:
      "Open the payment-method panel so the seller picks how they want to be paid: ACH (direct " +
      "deposit in 1-2 business days), check (physical check at pickup), or trade-in credit (the " +
      "offer amount becomes a credit toward a Carvana purchase). The panel posts back as " +
      "\"Payment method selected: <method>\". Call AFTER the offer is generated and the seller " +
      "has accepted it.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "acknowledge_contract",
    description:
      "Open the single-page contract acknowledgement: Limited Power of Attorney (Carvana signs " +
      "the title on the seller's behalf), Bill of Sale, Federal Odometer Disclosure. One checkbox " +
      "for all three. The panel posts back as \"Contract acknowledged at <ISO time>\". Call " +
      "AFTER payment method is selected and pickup is booked, as the LAST step before closing.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

/**
 * The shape returned to Claude as the tool_result content. We always
 * stringify to JSON because Anthropic's tool_result accepts text content
 * blocks, and Claude reasons better over JSON than over arbitrary text.
 */
export interface ToolDispatchResult {
  readonly toolName: string;
  readonly toolUseId: string;
  readonly result: unknown;
}

/**
 * Dispatch a single tool_use to its handler. Throws ONLY on programmer
 * error (unknown tool name); every other failure mode is returned as a
 * structured result so the chatbot can recover gracefully.
 *
 * Why we don't pass the entire VendorCascade as a closure: the dispatcher
 * is exported for testability; callers (the chat route handler) pass the
 * cascade explicitly so tests can swap in a fixture cascade.
 */
export async function dispatchTool(
  toolName: string,
  toolUseId: string,
  input: unknown,
  cascade: VendorCascade | undefined,
): Promise<ToolDispatchResult> {
  switch (toolName) {
    case "lookup_plate":
      return {
        toolName,
        toolUseId,
        result: await runLookupPlate(input, cascade),
      };
    case "lookup_vin":
      return {
        toolName,
        toolUseId,
        result: await runLookupVin(input, cascade),
      };
    case "ocr_recognize":
      // Slice B reality: the chatbot cannot capture from the user's camera.
      // The OcrCapture component (visible in the chat composer) is the
      // user-initiated path. When the chatbot calls this tool, we return
      // user_action_required with a short instruction the chatbot can
      // paraphrase. The actual OCR result arrives as a "Scanned VIN: ..."
      // user message when OcrCapture posts to /api/ocr/recognize directly.
      return {
        toolName,
        toolUseId,
        result: {
          kind: "user_action_required",
          action: "tap_camera_button",
          note:
            "Tell the user there's a camera button below the chat composer. " +
            "When they tap it, scan the VIN sticker (under the windshield, " +
            "driver-side door jamb) or registration card. The scanned VIN " +
            "will appear as a new user message and you should then call lookup_vin on it.",
        },
      };
    case "schedule_pickup":
      // Slice C reality: the server cannot pick a slot on the user's
      // behalf. The Scheduler component (visible in the chat composer)
      // lets the user pick. When schedule_pickup is called, we return
      // user_action_required so the chatbot tells the user to tap the
      // Schedule button. The booking confirmation comes back as a
      // "Pickup booked: ..." user message.
      return {
        toolName,
        toolUseId,
        result: {
          kind: "user_action_required",
          action: "tap_scheduler_button",
          note:
            "Tell the user there's a Schedule pickup button below the chat composer. " +
            "When they tap it, a calendar grid shows the next 14 days of available slots. " +
            "The confirmed booking will appear as a new user message of the shape " +
            "'Pickup booked: <displayLabel> at <scope>'.",
        },
      };
    case "start_condition_intake":
      // Panel-backed flow. ChatbotShell mounts the ConditionIntake panel
      // when this tool fires (it watches tool_result events for
      // user_action_required.action === "open_condition_intake").
      return {
        toolName,
        toolUseId,
        result: {
          kind: "user_action_required",
          action: "open_condition_intake",
          note:
            "Tell the user the photo uploader has opened below the chat. " +
            "They should upload at least 3 photos: ideally the four exterior corners, the odometer, " +
            "and any visible damage. Vision will extract the mileage, tag any visible damage, " +
            "suggest a condition tier, and surface 1-4 short follow-up questions for things photos " +
            "cannot show. The assessment will arrive as a new user message of the shape " +
            "\"Condition assessment: extracted mileage <N>; <K> damage finding(s); suggested tier <T>\".",
        },
      };
    case "record_loan_status": {
      if (typeof input !== "object" || input === null) {
        return {
          toolName,
          toolUseId,
          result: { kind: "format_error", reason: "input must be an object" },
        };
      }
      const obj = input as Record<string, unknown>;
      const hasLien = obj.hasLien;
      if (typeof hasLien !== "boolean") {
        return {
          toolName,
          toolUseId,
          result: {
            kind: "format_error",
            field: "hasLien",
            reason: "hasLien must be a boolean (true or false)",
          },
        };
      }
      if (!hasLien) {
        // No lien — chatbot can move straight to generate_offer with
        // no payoffAmount input. The "loan status" line in the
        // workspace will read "No lien — title is clean".
        return {
          toolName,
          toolUseId,
          result: {
            kind: "loan_status_recorded",
            hasLien: false,
            note:
              "Acknowledge that the title is clean and tell the user no payoff information is needed. " +
              "Proceed to generate_offer once you have year, make, model, mileage, and condition.",
          },
        };
      }
      return {
        toolName,
        toolUseId,
        result: {
          kind: "user_action_required",
          action: "open_payoff_form",
          note:
            "The payoff form has opened below the chat. The user enters their lender name and " +
            "their 10-day payoff amount. The result will arrive as a chat message of the shape " +
            "\"Loan payoff recorded: $<amount> owed to <lender>\". When you next call " +
            "generate_offer, pass that amount as payoffAmount.",
        },
      };
    }
    case "generate_offer": {
      if (typeof input !== "object" || input === null) {
        return {
          toolName,
          toolUseId,
          result: { kind: "format_error", reason: "input must be an object" },
        };
      }
      const obj = input as Record<string, unknown>;
      // Per-field validation: each error names the field + expected
      // type so the chatbot (and the user) sees exactly what to fix.
      const yr = obj.year;
      if (typeof yr !== "number" || !Number.isFinite(yr) || yr < 1980 || yr > 2027) {
        return {
          toolName,
          toolUseId,
          result: {
            kind: "format_error",
            field: "year",
            reason: "year must be a finite number between 1980 and 2027",
          },
        };
      }
      const mk = obj.make;
      if (typeof mk !== "string" || mk.trim() === "") {
        return {
          toolName,
          toolUseId,
          result: { kind: "format_error", field: "make", reason: "make must be a non-empty string" },
        };
      }
      const md = obj.model;
      if (typeof md !== "string" || md.trim() === "") {
        return {
          toolName,
          toolUseId,
          result: { kind: "format_error", field: "model", reason: "model must be a non-empty string" },
        };
      }
      const mi = obj.mileage;
      if (typeof mi !== "number" || !Number.isFinite(mi) || mi < 0) {
        return {
          toolName,
          toolUseId,
          result: {
            kind: "format_error",
            field: "mileage",
            reason: "mileage must be a non-negative finite number (odometer reading in miles)",
          },
        };
      }
      const cd = obj.condition;
      if (
        cd !== "Excellent" &&
        cd !== "Good" &&
        cd !== "Fair" &&
        cd !== "Rough"
      ) {
        return {
          toolName,
          toolUseId,
          result: {
            kind: "format_error",
            field: "condition",
            reason: "condition must be one of: Excellent, Good, Fair, Rough",
          },
        };
      }
      const payoffRaw = obj.payoffAmount;
      let payoffAmount: number | undefined;
      if (payoffRaw === undefined || payoffRaw === null) {
        payoffAmount = undefined;
      } else if (
        typeof payoffRaw !== "number" ||
        !Number.isFinite(payoffRaw) ||
        payoffRaw < 0
      ) {
        return {
          toolName,
          toolUseId,
          result: {
            kind: "format_error",
            field: "payoffAmount",
            reason:
              "payoffAmount must be a non-negative finite number, OR omitted entirely when there is no lien (do not pass 0 or null)",
          },
        };
      } else {
        payoffAmount = payoffRaw;
      }
      // exactOptionalPropertyTypes: don't materialize payoffAmount as
      // undefined when there's no lien — omit the key entirely so the
      // OfferInput type's optional-property contract is satisfied.
      const offerInput: OfferInput = {
        year: yr,
        make: mk.trim(),
        model: md.trim(),
        mileage: mi,
        condition: cd,
        ...(payoffAmount !== undefined ? { payoffAmount } : {}),
      };
      try {
        return { toolName, toolUseId, result: generateOffer(offerInput) };
      } catch (err) {
        console.error(
          "[chat/tools] generate_offer: OfferEngine threw on validated input — investigate:",
          err,
        );
        return {
          toolName,
          toolUseId,
          result: {
            kind: "internal_error",
            detail:
              "Offer formula raised an internal error. This is a bug — please report the inputs to support.",
          },
        };
      }
    }
    case "select_payment_method":
      return {
        toolName,
        toolUseId,
        result: {
          kind: "user_action_required",
          action: "open_payment_method",
          note:
            "The payment-method picker has opened below the chat. The user picks one of: " +
            "ACH (direct deposit 1-2 business days), check (at pickup), or trade-in credit. " +
            "The result will arrive as a chat message of the shape \"Payment method selected: <method>\".",
        },
      };
    case "acknowledge_contract":
      return {
        toolName,
        toolUseId,
        result: {
          kind: "user_action_required",
          action: "open_contract_consent",
          note:
            "The contract acknowledgement page has opened below the chat. The user reviews three " +
            "plain-English disclosures (Limited Power of Attorney, Bill of Sale, Federal Odometer " +
            "Disclosure) and checks one box. The result will arrive as a chat message of the shape " +
            "\"Contract acknowledged at <ISO time>\".",
        },
      };
    case "get_support_content": {
      // Slice D: surface a pre-baked card. The LLM picks the topic via
      // tool input; the dispatcher returns the literal card body
      // committed at src/support-content/cards.ts. The LLM MUST NOT
      // paraphrase or generate replacement empathy text (constitutional
      // non-negotiable 10 / CAT-12).
      if (typeof input !== "object" || input === null) {
        return {
          toolName,
          toolUseId,
          result: { kind: "format_error", reason: "input must be an object" },
        };
      }
      const obj = input as Record<string, unknown>;
      const topicInput = obj.topic;
      if (typeof topicInput !== "string" || !isKnownSupportTopic(topicInput)) {
        return {
          toolName,
          toolUseId,
          result: {
            kind: "format_error",
            reason: `unknown topic. Known: ${Object.keys(SUPPORT_CARDS).join(", ")}`,
          },
        };
      }
      const card = SUPPORT_CARDS[topicInput];
      return {
        toolName,
        toolUseId,
        result: {
          kind: "support_content",
          topic: card.topic,
          title: card.title,
          body: card.body,
          telemetryEvent: card.telemetryEvent,
        },
      };
    }
    default:
      throw new Error(
        `dispatchTool received unknown tool name "${toolName}". ` +
          `Either the chatbot is calling a tool that has been removed, or a new tool was added ` +
          `to TOOLS without updating the dispatcher. Check server/chat/tools.ts.`,
      );
  }
}

/**
 * Type guard for SupportTopic. Defined here (not in cards.ts) so the
 * domain file stays free of runtime narrowing concerns.
 */
function isKnownSupportTopic(value: string): value is SupportTopic {
  return value in SUPPORT_CARDS;
}

/**
 * lookup_plate dispatcher. Returns the same shape the /api/lookup/plate
 * route returns so the client-side rendering for chat tool_results matches
 * the form-based UI's rendering. If the cascade is undefined (no vendor
 * credentials), returns configuration_missing.
 */
async function runLookupPlate(
  input: unknown,
  cascade: VendorCascade | undefined,
): Promise<unknown> {
  if (cascade === undefined) {
    return {
      kind: "configuration_missing",
      message:
        "Vendor credentials are not configured. Set CARSXE_API_KEY or VINAUDIT_API_KEY in .env.local and restart.",
    };
  }
  if (typeof input !== "object" || input === null) {
    return {
      kind: "format_error",
      field: "input",
      reason: "tool input must be an object",
      userFriendlyReason: "Something went wrong with the lookup. Try again.",
    };
  }
  const obj = input as Record<string, unknown>;
  const plateInput = obj.plate;
  const stateInput = obj.state;
  if (typeof plateInput !== "string" || typeof stateInput !== "string") {
    return {
      kind: "format_error",
      field: typeof plateInput !== "string" ? "plate" : "state",
      reason: "plate and state must both be strings",
      userFriendlyReason:
        "I need both a plate and a US state code (like CA or TX). Could you say them again?",
    };
  }
  let plate: Plate;
  let state: ReturnType<typeof parseStateCode>;
  try {
    plate = new Plate(plateInput);
    state = parseStateCode(stateInput);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "invalid format";
    return {
      kind: "format_error",
      field: "plate_or_state",
      reason,
      userFriendlyReason:
        "That doesn't quite look like a US plate plus state. US plates are 6-8 characters; the state is the two-letter code (CA, TX).",
    };
  }
  try {
    return await cascade.lookupByPlate(plate, state);
  } catch (err) {
    // Constitution: cascade is documented to NEVER throw. If it does, the
    // tool_result must still be structured so Claude can recover gracefully.
    console.error(
      "[chat/tools] lookup_plate cascade threw — investigate immediately:",
      err,
    );
    return {
      kind: "transient_error",
      retryable: true,
      cause: "unexpected_cascade_throw",
      detail: "An unexpected internal error occurred. Please retry shortly.",
    };
  }
}

/**
 * lookup_vin dispatcher. Mirrors runLookupPlate but applies the I/O/Q
 * auto-permutation server-side before the cascade call, and carries a
 * "correction" field on resolved if permutation was applied.
 */
async function runLookupVin(
  input: unknown,
  cascade: VendorCascade | undefined,
): Promise<unknown> {
  if (cascade === undefined) {
    return {
      kind: "configuration_missing",
      message:
        "Vendor credentials are not configured. Set CARSXE_API_KEY or VINAUDIT_API_KEY in .env.local and restart.",
    };
  }
  if (typeof input !== "object" || input === null) {
    return {
      kind: "format_error",
      field: "input",
      reason: "tool input must be an object",
      userFriendlyReason: "Something went wrong with the lookup. Try again.",
    };
  }
  const obj = input as Record<string, unknown>;
  const vinInput = obj.vin;
  if (typeof vinInput !== "string") {
    return {
      kind: "format_error",
      field: "vin",
      reason: "vin must be a string",
      userFriendlyReason:
        "I need a 17-character VIN. You can find it on the driver's-side door jamb or the registration card.",
    };
  }
  const parsed = tryParseVinWithPermutation(vinInput);
  if (parsed.kind === "failed") {
    return {
      kind: "format_error",
      field: "vin",
      reason: parsed.failure.message,
      userFriendlyReason:
        "That doesn't look like a 17-character VIN. Real VINs never include I, O, or Q; we tried correcting those and the result still wasn't 17 characters.",
    };
  }
  const { vin, corrected } = parsed;
  try {
    const result = await cascade.lookupByVin(vin);
    if (result.kind === "resolved" && corrected !== undefined) {
      return {
        ...result,
        correction: {
          original: corrected.original,
          normalized: corrected.normalized,
          reason:
            "Swapped the letters I, O, and Q to 1 and 0 since real VINs never use those letters.",
        },
      };
    }
    return result;
  } catch (err) {
    console.error(
      "[chat/tools] lookup_vin cascade threw — investigate immediately:",
      err,
    );
    return {
      kind: "transient_error",
      retryable: true,
      cause: "unexpected_cascade_throw",
      detail: "An unexpected internal error occurred. Please retry shortly.",
    };
  }
}
