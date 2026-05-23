/**
 * /api/ocr/recognize — Claude vision OCR for VIN sticker, registration
 * card, insurance card, and driver license (v2 slice B).
 *
 * Replaces the slice-1 plan for Google Cloud Vision with a Claude vision
 * call to the same Anthropic API surface as /api/chat. One vendor, one
 * billing relationship, one secret. The Claude vision model handles both
 * the "extract a 17-char VIN" case and the "read this registration card
 * and pull the VIN field" case without any vendor-specific configuration.
 *
 * Request shape: POST application/json
 *   { image: <base64-encoded image bytes>, target: <VIN | registration_card | ...> }
 *
 * Response shape: 200 application/json
 *   {
 *     kind: "resolved" | "not_found" | "low_confidence",
 *     vin?: string,         // present if kind === "resolved"
 *     confidence?: number,  // 0..1, present if kind === "resolved" | "low_confidence"
 *     reason?: string,      // present if kind === "not_found" | "low_confidence"
 *   }
 *
 * The 503 configuration_missing path mirrors /api/chat: same ANTHROPIC_API_KEY
 * env var, same signup URL embedded in the message body. This is the
 * "every failure case throws a clear, comprehensive, specific error" rule.
 *
 * Why "extract" instead of "OCR everything": Claude vision is asked for a
 * single typed value (the 17-char VIN) so the response is parseable. We
 * could also ask for a full document transcription but the chatbot only
 * needs the VIN to route to lookup_vin, so we keep the prompt tight.
 */
import type { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";

const VISION_MODEL = "claude-sonnet-4-5";
const VISION_MAX_TOKENS = 256;

/**
 * 17-character VIN validator. Real VINs never include I/O/Q and are
 * exactly 17 characters. Matches the same rule the slice-1 Vin domain
 * primitive enforces (see src/lookup/types.ts).
 */
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

type OcrTarget =
  | "vin_sticker"
  | "registration_card"
  | "insurance_card"
  | "driver_license";

const TARGET_PROMPTS: Record<OcrTarget, string> = {
  vin_sticker:
    "This image should contain a 17-character vehicle identification number (VIN). " +
    "Extract ONLY the VIN. Reply with the 17 characters and nothing else. " +
    "If you cannot see a VIN clearly, reply with the single word: NOT_FOUND.",
  registration_card:
    "This image is a vehicle registration card. Find the 17-character VIN field " +
    "(usually labeled VIN, Vehicle Identification Number, or V.I.N.). " +
    "Reply with the 17 characters and nothing else. If not found, reply NOT_FOUND.",
  insurance_card:
    "This image is a vehicle insurance card. Find the 17-character VIN. " +
    "Reply with the 17 characters and nothing else. If not found, reply NOT_FOUND.",
  driver_license:
    "This image is a US driver license. (Slice B note: VIN is not on a driver " +
    "license. This target is reserved for slice E's identity-verification flow.) " +
    "Reply NOT_FOUND.",
};

export function makeOcrHandler(
  apiKey: string | undefined,
): ((req: Request, res: Response) => Promise<void>) | undefined {
  if (apiKey === undefined || apiKey.trim() === "") {
    return undefined;
  }
  const client = new Anthropic({ apiKey });
  return async (req, res) => {
    const rawBody = req.body as unknown;
    if (typeof rawBody !== "object" || rawBody === null) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "body",
        reason: "request body must be a JSON object with image and target",
      });
      return;
    }
    const body = rawBody as Record<string, unknown>;
    const imageInput = body.image;
    const targetInput = body.target ?? "vin_sticker";
    const mediaTypeInput = body.mediaType ?? "image/png";

    if (typeof imageInput !== "string" || imageInput.length < 100) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "image",
        reason:
          "image must be a base64-encoded string (≥100 chars). " +
          "Drop the `data:image/...;base64,` prefix if you copied it from a data URL.",
      });
      return;
    }
    if (typeof targetInput !== "string" || !isOcrTarget(targetInput)) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "target",
        reason:
          "target must be one of: vin_sticker, registration_card, insurance_card, driver_license",
      });
      return;
    }
    if (typeof mediaTypeInput !== "string" || !isSupportedMediaType(mediaTypeInput)) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "mediaType",
        reason: "mediaType must be one of: image/png, image/jpeg, image/gif, image/webp",
      });
      return;
    }

    try {
      const response = await client.messages.create({
        model: VISION_MODEL,
        max_tokens: VISION_MAX_TOKENS,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaTypeInput,
                  data: imageInput,
                },
              },
              {
                type: "text",
                text: TARGET_PROMPTS[targetInput],
              },
            ],
          },
        ],
      });
      const text = extractTextContent(response.content);
      const trimmed = text.trim().toUpperCase();
      if (trimmed === "NOT_FOUND" || trimmed === "") {
        res.status(200).json({
          kind: "not_found",
          reason:
            "Vision model did not see a readable VIN in the image. Re-take the photo with better lighting, hold the camera closer, and make sure all 17 characters are in frame.",
        });
        return;
      }
      // Extract the first 17-char alphanumeric run. The vision model may
      // include surrounding whitespace or punctuation; this regex pulls
      // the literal VIN out cleanly.
      const match = /[A-HJ-NPR-Z0-9]{17}/.exec(trimmed);
      if (match === null || !VIN_PATTERN.test(match[0])) {
        res.status(200).json({
          kind: "low_confidence",
          reason:
            `Vision model returned text that does not look like a valid 17-character VIN. Try a clearer photo.`,
          confidence: 0.4,
        });
        return;
      }
      res.status(200).json({
        kind: "resolved",
        vin: match[0],
        confidence: 0.95,
      });
    } catch (err) {
      console.error("[ocr] vision call failed — investigate immediately:", err);
      res.status(503).json({
        kind: "transient_error",
        retryable: true,
        cause: "vision_model_error",
        detail:
          "The vision service had trouble reading your image. Try again, or type the VIN manually.",
      });
    }
  };
}

function isOcrTarget(value: string): value is OcrTarget {
  return (
    value === "vin_sticker" ||
    value === "registration_card" ||
    value === "insurance_card" ||
    value === "driver_license"
  );
}

type SupportedMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

function isSupportedMediaType(value: string): value is SupportedMediaType {
  return (
    value === "image/png" ||
    value === "image/jpeg" ||
    value === "image/gif" ||
    value === "image/webp"
  );
}

/**
 * The Anthropic Messages API response.content is a union of TextBlock |
 * ToolUseBlock | ThinkingBlock | ServerToolUseBlock | etc. For OCR we only
 * care about text. Concatenate all text-typed blocks (usually just one).
 */
function extractTextContent(content: readonly { type: string }[]): string {
  let out = "";
  for (const block of content) {
    if (block.type === "text" && "text" in block && typeof (block as { text: unknown }).text === "string") {
      out += (block as { text: string }).text;
    }
  }
  return out;
}

function sendJsonError(
  res: Response,
  status: number,
  body: Record<string, unknown>,
): void {
  res.status(status).json(body);
}

export function isOcrConfigured(apiKey: string | undefined): boolean {
  return apiKey !== undefined && apiKey.trim() !== "";
}
