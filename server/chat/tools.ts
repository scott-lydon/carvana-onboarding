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
      return {
        toolName,
        toolUseId,
        result: {
          kind: "not_wired",
          slice: "C",
          note: "Pickup scheduling wires up in slice C.",
        },
      };
    case "get_support_content":
      return {
        toolName,
        toolUseId,
        result: {
          kind: "not_wired",
          slice: "D",
          note: "Pre-baked support content wires up in slice D. For now, acknowledge the user's question and offer to come back to it.",
        },
      };
    default:
      throw new Error(
        `dispatchTool received unknown tool name "${toolName}". ` +
          `Either the chatbot is calling a tool that has been removed, or a new tool was added ` +
          `to TOOLS without updating the dispatcher. Check server/chat/tools.ts.`,
      );
  }
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
