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
  | "driver_license"
  | "vin_or_plate";

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
  // The "upload a photo" / "scan with camera" CTA does NOT know in advance
  // whether the user is showing a VIN sticker or a license plate. The
  // model sees the image and picks. The response shape MUST be machine-
  // parseable so the client can route VIN → lookup_vin and plate → ask
  // the user for the state, then lookup_plate.
  vin_or_plate:
    "This image was uploaded by a US seller of a used car who wants help " +
    "identifying their vehicle. It could be ANY of:\n" +
    "  - a 17-character VIN sticker (door jamb, dash near the windshield, registration card)\n" +
    "  - a US license plate (front or rear of the vehicle)\n" +
    "  - both (a photo that happens to include both)\n" +
    "  - neither\n\n" +
    "Reply with ONE LINE of JSON (no markdown fence, no surrounding prose). " +
    "Use exactly one of these shapes:\n\n" +
    `  {"kind":"vin","vin":"<17 characters, uppercase, no I/O/Q>"}\n` +
    `  {"kind":"plate","plate":"<characters as printed>","state":"<two-letter US state code if visible, else null>"}\n` +
    `  {"kind":"both","vin":"<17 chars>","plate":"<plate chars>","state":"<state or null>"}\n` +
    `  {"kind":"not_found","reason":"<one short sentence of what you DID see, in plain English>"}\n\n` +
    "Rules:\n" +
    "- If a VIN is present and you can read 17 characters, prefer kind=vin (or both).\n" +
    "- A license plate is 5-8 alphanumeric characters, usually inside a rectangular frame, often with the issuing state name above or below.\n" +
    "- For state, return the two-letter postal abbreviation (CA, TX, NY, ...) if you can read it; null if you cannot.\n" +
    "- Do NOT include the word VIN or PLATE inside the value — strip any labels.\n" +
    "- If you can see neither a VIN nor a plate, return kind=not_found with one short sentence describing the actual subject of the photo (e.g. \"a dashboard with a steering wheel, no VIN sticker visible\").",
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
          "target must be one of: vin_sticker, registration_card, insurance_card, driver_license, vin_or_plate",
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
      // Defense-in-depth: the client compresses oversize images before
      // sending, but if a client somehow bypasses that (older bundle
      // cached, custom integration, future regression) we still must
      // not pass an oversized native image to Anthropic — its vision
      // API hard-rejects > 5 MB with a cryptic 400. Resample here when
      // we detect the payload is too large.
      //
      // Threshold: 4 MB raw image bytes (the base64 string is ~33%
      // larger than the decoded bytes). Anthropic measures decoded
      // bytes, so 4 MB raw == ~5.3 MB base64 == safely below the 5 MB
      // decoded cap with margin.
      const decodedBytes = Math.floor((imageInput.length * 3) / 4);
      const NATIVE_RESAMPLE_THRESHOLD_BYTES = 4_000_000;
      if (decodedBytes > NATIVE_RESAMPLE_THRESHOLD_BYTES) {
        try {
          const sourceBuffer = Buffer.from(imageInput, "base64");
          const resampled = await sharp(sourceBuffer)
            .rotate()
            .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();
          payloadData = resampled.toString("base64");
          payloadMediaType = "image/jpeg";
          console.warn(
            `[ocr] native-format image was ${String(decodedBytes)}B (>${String(NATIVE_RESAMPLE_THRESHOLD_BYTES)}B threshold) — resampled to ${String(resampled.byteLength)}B JPEG. Client-side compression should have caught this; check the client bundle version.`,
          );
        } catch (err) {
          const detail =
            err instanceof Error
              ? `${err.name}: ${err.message}`
              : "unknown error";
          console.error(
            `[ocr] native-format resample failed (decoded ${String(decodedBytes)}B, mediaType ${mediaTypeInput}):`,
            err,
          );
          sendJsonError(res, 400, {
            kind: "format_error",
            field: "image",
            reason:
              `Photo is ${String(Math.round(decodedBytes / 1_048_576))} MB which is over the 5 MB vision-API limit, and the server-side resample step also failed (${detail}). Pick a smaller photo or one taken at lower resolution.`,
          });
          return;
        }
      } else {
        payloadData = imageInput;
        payloadMediaType = mediaTypeInput;
      }
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
      // The vin_or_plate target uses a JSON wire shape so the client can
      // route VIN-or-plate without a second parse. All other targets use
      // the legacy bare-VIN response so existing callers keep working.
      if (targetInput === "vin_or_plate") {
        respondVinOrPlate(res, text);
        return;
      }
      respondVinOnly(res, text);
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : "unknown";
      console.error(
        `[ocr] vision call failed (target=${targetInput}, model=${VISION_MODEL}) — investigate immediately:`,
        err,
      );
      // Map common Anthropic SDK error classes to specific user-facing
      // reasons so the user does not see a generic "vision service had
      // trouble" panel. The first matching condition wins. Anything
      // unknown falls through to a generic 503 transient_error.
      const status =
        err instanceof Anthropic.AuthenticationError ? 503
        : err instanceof Anthropic.RateLimitError ? 503
        : err instanceof Anthropic.BadRequestError ? 400
        : 503;
      const cause =
        err instanceof Anthropic.AuthenticationError ? "vision_auth_error"
        : err instanceof Anthropic.RateLimitError ? "vision_rate_limited"
        : err instanceof Anthropic.BadRequestError ? "vision_rejected_image"
        : "vision_model_error";
      const userMessage =
        err instanceof Anthropic.AuthenticationError
          ? "Image recognition is misconfigured on the server. The ANTHROPIC_API_KEY is invalid or expired. Tell the operator — typing the VIN or plate manually still works."
          : err instanceof Anthropic.RateLimitError
            ? "Image recognition is temporarily rate-limited. Wait 60 seconds and try again, or type the VIN or plate manually."
            : err instanceof Anthropic.BadRequestError
              ? `The vision model rejected this image (${detail}). It may be too large, too small, or in a format the model cannot read. Try a different photo, or type the VIN or plate manually.`
              : `The vision service had trouble reading your image (${detail}). Try again, or type the VIN or plate manually.`;
      res.status(status).json({
        kind: status === 400 ? "format_error" : "transient_error",
        retryable: status !== 400,
        cause,
        reason: userMessage,
        detail: userMessage,
      });
    }
  };
}

/**
 * Parse the JSON-shape response for the vin_or_plate target. The model is
 * instructed to return ONE LINE of JSON; we defensively strip a markdown
 * fence in case it adds one anyway, then route by `kind`.
 *
 * Failure modes (each surfaces as a structured response, never a crash):
 *   - empty text                      → not_found
 *   - non-JSON text                   → not_found with rawPrefix for debugging
 *   - JSON without `kind`             → not_found
 *   - VIN-shaped value fails pattern  → low_confidence
 */
function respondVinOrPlate(res: Response, rawText: string): void {
  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  if (stripped === "") {
    res.status(200).json({
      kind: "not_found",
      reason:
        "Vision model returned no text. The image may be too dark or out of focus — try again with more light.",
    });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    res.status(200).json({
      kind: "not_found",
      reason:
        "Vision model did not return JSON. Try a clearer photo, or type the VIN or plate manually.",
      rawPrefix: stripped.slice(0, 240),
    });
    return;
  }
  if (typeof parsed !== "object" || parsed === null) {
    res.status(200).json({
      kind: "not_found",
      reason:
        "Vision model returned non-object JSON. Try a clearer photo, or type the VIN or plate manually.",
    });
    return;
  }
  const obj = parsed as Record<string, unknown>;
  const kind = obj.kind;
  if (kind === "not_found") {
    const reason =
      typeof obj.reason === "string" && obj.reason.trim() !== ""
        ? `${obj.reason.trim()} Try again with better lighting, hold the camera closer, and make sure the VIN sticker or license plate is fully in frame. You can also type the VIN or plate manually.`
        : "Vision model could not see a VIN or license plate in this image. Try again with better lighting and frame the VIN sticker or license plate clearly.";
    res.status(200).json({ kind: "not_found", reason });
    return;
  }
  const vinValue = readVinFrom(obj);
  const plateValue = readPlateFrom(obj);
  const stateValue = readStateFrom(obj);
  if (kind === "vin" || kind === "both") {
    if (vinValue !== undefined) {
      const resolved: Record<string, unknown> = {
        kind: "resolved_vin",
        vin: vinValue,
        confidence: 0.95,
      };
      if (kind === "both" && plateValue !== undefined) {
        resolved.alsoSawPlate = plateValue;
        if (stateValue !== undefined) resolved.alsoSawState = stateValue;
      }
      res.status(200).json(resolved);
      return;
    }
    // Said "vin" but the value didn't pass the 17-char ISO 3779 pattern.
    res.status(200).json({
      kind: "low_confidence",
      reason:
        "Vision model said it saw a VIN but the characters do not look like a valid 17-character VIN. Try a clearer photo, or type the VIN manually.",
      confidence: 0.4,
    });
    return;
  }
  if (kind === "plate") {
    if (plateValue !== undefined) {
      const resolved: Record<string, unknown> = {
        kind: "resolved_plate",
        plate: plateValue,
        confidence: 0.9,
      };
      if (stateValue !== undefined) resolved.state = stateValue;
      res.status(200).json(resolved);
      return;
    }
    res.status(200).json({
      kind: "low_confidence",
      reason:
        "Vision model said it saw a plate but the characters were unreadable. Try a clearer photo, or type the plate manually.",
      confidence: 0.4,
    });
    return;
  }
  // Unknown kind — treat as not_found with the raw payload preserved so
  // operators can debug from server logs without re-running the call.
  res.status(200).json({
    kind: "not_found",
    reason:
      "Vision model returned an unexpected response shape. Try again, or type the VIN or plate manually.",
    rawPrefix: stripped.slice(0, 240),
  });
}

/**
 * Legacy VIN-only response path used by the vin_sticker / registration_card /
 * insurance_card / driver_license targets. Unchanged behavior — kept here so
 * the existing OcrCapture component and its callers still work without
 * having to migrate to the JSON shape.
 */
function respondVinOnly(res: Response, rawText: string): void {
  const trimmed = rawText.trim().toUpperCase();
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
}

/**
 * Extract a VIN from a parsed vision-JSON object. Validates against the
 * ISO 3779 pattern; returns undefined if the value is missing or fails
 * validation. We deliberately do NOT slice a 17-char window out of a
 * longer string here — the model was asked for the bare 17 characters,
 * and if it returned something longer we want the low_confidence branch
 * to fire so the user re-takes the photo rather than us guessing.
 */
function readVinFrom(obj: Record<string, unknown>): string | undefined {
  const raw = obj.vin;
  if (typeof raw !== "string") return undefined;
  const upper = raw.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  return VIN_PATTERN.test(upper) ? upper : undefined;
}

/**
 * Extract a license plate from a parsed vision-JSON object. Real US
 * plates are 5-8 chars after normalization; anything outside that range
 * is treated as missing so the user gets a "try again" affordance.
 */
function readPlateFrom(obj: Record<string, unknown>): string | undefined {
  const raw = obj.plate;
  if (typeof raw !== "string") return undefined;
  const upper = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (upper.length < 5 || upper.length > 8) return undefined;
  return upper;
}

/**
 * Extract a two-letter US state postal code from a parsed vision-JSON
 * object. Returns undefined for null, missing, or non-conforming input.
 * The vision prompt explicitly allows null so the client knows to ask.
 */
function readStateFrom(obj: Record<string, unknown>): string | undefined {
  const raw = obj.state;
  if (typeof raw !== "string") return undefined;
  const upper = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : undefined;
}

function isOcrTarget(value: string): value is OcrTarget {
  return (
    value === "vin_sticker" ||
    value === "registration_card" ||
    value === "insurance_card" ||
    value === "driver_license" ||
    value === "vin_or_plate"
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
