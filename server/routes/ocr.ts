/**
 * /api/ocr/recognize — Claude vision OCR for VIN sticker, registration
 * card, insurance card, and driver license.
 *
 * Request shape (POST application/json):
 *   { image: <base64 image bytes, no data: prefix>,
 *     mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" |
 *                "image/heic" | "image/heif" | "image/avif" |
 *                "image/bmp"  | "image/tiff",
 *     target: "vin_sticker" | "registration_card" | "insurance_card" | "driver_license" }
 *
 * Response shape (200 application/json):
 *   { kind: "resolved" | "not_found" | "low_confidence",
 *     vin?, confidence?, reason? }
 *
 * Anthropic vision only accepts a small subset (jpeg/png/gif/webp). For
 * any other supported input (HEIC from iPhone, AVIF from Android, BMP /
 * TIFF legacy) we transcode to JPEG via `sharp` before the API call.
 *
 * Every failure case throws a CLEAR, SPECIFIC error message naming the
 * failed step + expected vs received values + a fix.
 */
import type { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
// heic-convert is a pure-JS HEIC decoder (libheif compiled to WASM). We
// need it because sharp's prebuilt binary on Render's linux-x64 runtime
// DOES NOT include libheif (Pixelplumbing strips HEIF/AVIF from the
// prebuilt because libheif's upstream is GPL-tainted). Without this,
// every iPhone photo (HEIC by default) failed conversion server-side and
// the user saw the unhelpful "save as JPG/PNG and try again" message.
// See https://sharp.pixelplumbing.com/install#prebuilt-binaries.
import convertHeic from "heic-convert";

const VISION_MODEL = "claude-sonnet-4-5";
const VISION_MAX_TOKENS = 256;
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
    "This image is a US driver license. VIN is not on a driver license. Reply NOT_FOUND.",
};

/**
 * Accept list at the server boundary. Mirrors what the client picker
 * advertises in <input accept>. Anything else is rejected with a
 * format_error naming the actual received MIME and the accept list.
 */
type AcceptedMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "image/heic"
  | "image/heif"
  | "image/avif"
  | "image/bmp"
  | "image/tiff";

const ACCEPTED: readonly AcceptedMediaType[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/bmp",
  "image/tiff",
];

/**
 * Anthropic vision only accepts these natively. Everything else gets
 * transcoded to JPEG via sharp before the call.
 */
type AnthropicMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
const ANTHROPIC_NATIVE: readonly AnthropicMediaType[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

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
    if (typeof mediaTypeInput !== "string" || !isAcceptedMediaType(mediaTypeInput)) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "mediaType",
        reason: `mediaType must be one of: ${ACCEPTED.join(", ")}`,
      });
      return;
    }

    // Transcode anything Anthropic vision can't handle natively.
    //
    // Two-stage conversion:
    //   1. If HEIC/HEIF → decode with heic-convert (pure-WASM libheif).
    //      The prebuilt sharp on Render Linux has no libheif support.
    //      The decoded JPEG buffer is then fed to sharp for stage 2.
    //   2. Everything else (or the heic-convert output) → sharp .rotate()
    //      honors EXIF orientation and .jpeg() bounds file size for the
    //      vision call.
    //
    // Failure messages name the EXACT stage that broke and the underlying
    // error class, so the user sees something actionable instead of a
    // generic "save as JPG/PNG and try again".
    let payloadData: string;
    let payloadMediaType: AnthropicMediaType;
    if (isAnthropicNative(mediaTypeInput)) {
      payloadData = imageInput;
      payloadMediaType = mediaTypeInput;
    } else {
      let stageBuffer: Buffer;
      try {
        stageBuffer = Buffer.from(imageInput, "base64");
        if (stageBuffer.byteLength === 0) {
          throw new Error("decoded image buffer is 0 bytes");
        }
      } catch (err) {
        console.error("[ocr] base64 decode failed — investigate:", err);
        sendJsonError(res, 400, {
          kind: "format_error",
          field: "image",
          reason:
            "Could not decode the base64 image payload. The upload was empty or corrupted in transit. Try again.",
        });
        return;
      }

      const isHeic =
        mediaTypeInput === "image/heic" || mediaTypeInput === "image/heif";
      if (isHeic) {
        try {
          // convertHeic returns an ArrayBuffer-like; wrap in Buffer.
          const jpegFromHeic = await convertHeic({
            buffer: stageBuffer as unknown as ArrayBufferLike,
            format: "JPEG",
            quality: 0.92,
          });
          stageBuffer = Buffer.from(jpegFromHeic);
        } catch (err) {
          const detail =
            err instanceof Error
              ? `${err.name}: ${err.message}`
              : "unknown error";
          console.error(
            `[ocr] heic-convert failed for ${mediaTypeInput} — investigate (size=${String(stageBuffer.byteLength)}B):`,
            err,
          );
          sendJsonError(res, 400, {
            kind: "format_error",
            field: "image",
            reason:
              `HEIC decode failed (${detail}). The file may not be a valid HEIC/HEIF image, or the encoder is one we have not seen yet. ` +
              `As a workaround you can email the photo to yourself — Mail auto-converts HEIC to JPEG — and re-upload it.`,
          });
          return;
        }
      }

      try {
        const converted = await sharp(stageBuffer)
          .rotate() // honor EXIF orientation
          .jpeg({ quality: 88 }) // good vision quality, modest file size
          .toBuffer();
        payloadData = converted.toString("base64");
        payloadMediaType = "image/jpeg";
      } catch (err) {
        const detail =
          err instanceof Error ? `${err.name}: ${err.message}` : "unknown error";
        console.error(
          `[ocr] sharp transcode failed for ${mediaTypeInput} — investigate (stage buffer size=${String(stageBuffer.byteLength)}B):`,
          err,
        );
        sendJsonError(res, 400, {
          kind: "format_error",
          field: "image",
          reason:
            `Image re-encode to JPEG failed at the sharp stage (${detail}). The source file (${mediaTypeInput}) decoded ` +
            `but could not be normalized for the vision call. Try a different photo.`,
        });
        return;
      }
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
                  media_type: payloadMediaType,
                  data: payloadData,
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

function isAcceptedMediaType(value: string): value is AcceptedMediaType {
  return (ACCEPTED as readonly string[]).includes(value);
}

function isAnthropicNative(
  value: AcceptedMediaType,
): value is AnthropicMediaType {
  return (ANTHROPIC_NATIVE as readonly string[]).includes(value);
}

function extractTextContent(content: readonly { type: string }[]): string {
  let out = "";
  for (const block of content) {
    if (
      block.type === "text" &&
      "text" in block &&
      typeof (block as { text: unknown }).text === "string"
    ) {
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
