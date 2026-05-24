/**
 * /api/condition/extract — multi-image vision endpoint for the
 * AI-powered condition assessment.
 *
 * # Why this is the revolutionary step
 *
 * Carvana's seller flow asks 6-10 typed questions about the car's
 * condition (exterior damage, interior wear, mechanical issues,
 * warning lights, etc.). Most of those answers are visible in a
 * handful of photos. We collect the photos once, run them through
 * Claude vision in a single call, and ASK ONLY the questions vision
 * cannot answer (e.g., warning lights when engine is off, smoke
 * smell, hidden mechanical issues).
 *
 * # Request shape
 *
 *   POST application/json
 *   {
 *     images: Array<{
 *       angle:
 *         | "front_left" | "front_right"
 *         | "rear_left"  | "rear_right"
 *         | "odometer"   | "interior_front" | "interior_rear"
 *         | "vin_plate"  | "damage_closeup",
 *       image: string,        // base64, no data: prefix
 *       mediaType: AcceptedMediaType   // same list as /api/ocr/recognize
 *     }>
 *   }
 *
 * Minimum 3 images, maximum 12. The four exterior corners + odometer
 * is the recommended minimum and unlocks the most extraction (we can
 * read mileage and tag every visible body panel).
 *
 * # Response shape (200 application/json)
 *
 *   {
 *     kind: "condition_extracted",
 *     extractedMileage?:  number,                  // from odometer photo
 *     odometerConfidence?: number,                 // 0..1
 *     visibleDamage:      Array<{ panel: string, severity: "minor"|"moderate"|"severe", note: string }>,
 *     suggestedTier:      "Excellent" | "Good" | "Fair" | "Rough",
 *     followupQuestions:  Array<{ id: string, prompt: string, why: string }>,
 *     rawNotes:           string                   // vision's freeform text, for debugging
 *   }
 *
 * The `followupQuestions` array is the AI's request for clarification
 * on things vision cannot see. The chatbot iterates through them as
 * a SHORT gap-fill Q&A (typically 1-4 questions, never more than 6).
 *
 * # Why all-images-in-one-call instead of per-image
 *
 * Cross-image reasoning. The model can compare the front-left and
 * rear-right photos and notice that the bumper alignment differs,
 * suggesting prior collision repair. It can also reconcile the
 * odometer reading with visible wear (a 200k-mile car with showroom
 * interior gets flagged as suspicious, prompting a follow-up).
 *
 * # Failure modes (every one returns a structured error, never a 500)
 *
 *   - missing/empty images array       → 400 format_error
 *   - too few images (< 3)             → 400 format_error
 *   - too many images (> 12)           → 400 format_error
 *   - duplicate angle                  → 400 format_error
 *   - unsupported mediaType            → 400 format_error
 *   - HEIC decode failure              → 400 format_error
 *   - vision API failure               → 503 transient_error
 */
import type { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import convertHeic from "heic-convert";

/**
 * Vision model for condition extraction. Haiku 4.5 is fast enough that
 * an 8-image call returns in ~3-5s. Override via env if a deployment
 * needs Sonnet for higher-quality damage tagging.
 */
const VISION_MODEL: string = ((): string => {
  const fromEnv = process.env.ANTHROPIC_VISION_MODEL?.trim() ?? "";
  return fromEnv !== "" ? fromEnv : "claude-haiku-4-5";
})();
const VISION_MAX_TOKENS = 1024;

const MIN_IMAGES = 3;
const MAX_IMAGES = 12;

type Angle =
  | "front_left"
  | "front_right"
  | "rear_left"
  | "rear_right"
  | "odometer"
  | "interior_front"
  | "interior_rear"
  | "vin_plate"
  | "damage_closeup";

const VALID_ANGLES: readonly Angle[] = [
  "front_left",
  "front_right",
  "rear_left",
  "rear_right",
  "odometer",
  "interior_front",
  "interior_rear",
  "vin_plate",
  "damage_closeup",
];

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

const ACCEPTED_MEDIA: readonly AcceptedMediaType[] = [
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

type AnthropicMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

interface InboundImage {
  readonly angle: Angle;
  readonly image: string;
  readonly mediaType: AcceptedMediaType;
}

interface ConditionExtractionResult {
  readonly kind: "condition_extracted";
  readonly extractedMileage?: number;
  readonly odometerConfidence?: number;
  readonly visibleDamage: readonly {
    readonly panel: string;
    readonly severity: "minor" | "moderate" | "severe";
    readonly note: string;
  }[];
  readonly suggestedTier: "Excellent" | "Good" | "Fair" | "Rough";
  readonly followupQuestions: readonly {
    readonly id: string;
    readonly prompt: string;
    readonly why: string;
  }[];
  readonly rawNotes: string;
}

const VISION_PROMPT = `You are inspecting a used car for trade-in. The user has uploaded several photos labeled by angle.

For each image, note what you can SEE — exterior damage, interior wear, the odometer reading if shown, the VIN if shown, and anything unusual.

Then return ONLY a JSON object with these exact keys (no prose around it):

{
  "extractedMileage": <number or null — read the odometer photo if present, return integer miles>,
  "odometerConfidence": <number 0-1 — confidence in your mileage reading, or null if no odometer photo>,
  "visibleDamage": [
    { "panel": "<panel name — e.g. 'front bumper', 'driver door', 'rear quarter panel', 'hood'>",
      "severity": "minor" | "moderate" | "severe",
      "note": "<one-sentence description of what you see>" }
  ],
  "suggestedTier": "Excellent" | "Good" | "Fair" | "Rough",
  "followupQuestions": [
    { "id": "<short kebab-case id>",
      "prompt": "<plain-English question the seller can answer in one sentence>",
      "why": "<one sentence explaining why this matters to the offer>" }
  ],
  "rawNotes": "<3-4 sentences summarizing what you observed across all images>"
}

Rules:
- Use "Excellent" only when there is no visible damage and interior wear is minimal for the age.
- Use "Good" for normal wear consistent with age.
- Use "Fair" when there are 1-3 visible cosmetic issues or one moderate damage spot.
- Use "Rough" when there is severe damage, accident evidence, or wear well beyond age-adjusted norms.
- Limit followupQuestions to 1-4 items. Only ask about things you CANNOT see (warning lights when engine is off, smoke/odor, mechanical issues, accident history, modifications).
- If no damage is visible, return an empty visibleDamage array — do not invent damage.
- If the odometer photo is missing or unreadable, set extractedMileage to null and add a followup question asking the seller to read it.

Return ONLY the JSON. No markdown fence. No surrounding prose.`;

export function makeConditionHandler(
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
        reason: "request body must be a JSON object with `images: InboundImage[]`",
      }); return;
    }
    const body = rawBody as Record<string, unknown>;
    const imagesRaw = body.images;
    if (!Array.isArray(imagesRaw)) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "images",
        reason:
          "images must be an array of { angle, image (base64), mediaType } objects",
      }); return;
    }
    if (imagesRaw.length < MIN_IMAGES) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "images",
        reason: `at least ${String(MIN_IMAGES)} images required for a useful condition assessment (got ${String(imagesRaw.length)}). Recommended: 4 exterior corners + odometer.`,
      }); return;
    }
    if (imagesRaw.length > MAX_IMAGES) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "images",
        reason: `at most ${String(MAX_IMAGES)} images supported per request (got ${String(imagesRaw.length)}). Split into multiple calls or drop the extras.`,
      }); return;
    }

    const seenAngles = new Set<string>();
    const validated: InboundImage[] = [];
    // imagesRaw is `unknown[]` after Array.isArray narrowing; treat each
    // element as `unknown` and narrow with the field-by-field checks
    // below rather than letting `any` leak in via index access.
    const imagesArr = imagesRaw as readonly unknown[];
    for (let i = 0; i < imagesArr.length; i += 1) {
      const item: unknown = imagesArr[i];
      if (typeof item !== "object" || item === null) {
        sendJsonError(res, 400, {
          kind: "format_error",
          field: `images[${String(i)}]`,
          reason: "each images[] entry must be an object",
        }); return;
      }
      const obj = item as Record<string, unknown>;
      const angle = obj.angle;
      const image = obj.image;
      const mediaType = obj.mediaType;
      if (typeof angle !== "string" || !isValidAngle(angle)) {
        sendJsonError(res, 400, {
          kind: "format_error",
          field: `images[${String(i)}].angle`,
          reason: `angle must be one of: ${VALID_ANGLES.join(", ")}`,
        }); return;
      }
      if (seenAngles.has(angle) && angle !== "damage_closeup") {
        // damage_closeup may appear multiple times; all other angles
        // must be unique (one front_left, one odometer, etc.).
        sendJsonError(res, 400, {
          kind: "format_error",
          field: `images[${String(i)}].angle`,
          reason: `angle "${angle}" appears more than once. Each angle (except damage_closeup) may appear at most once.`,
        }); return;
      }
      seenAngles.add(angle);
      if (typeof image !== "string" || image.length < 100) {
        sendJsonError(res, 400, {
          kind: "format_error",
          field: `images[${String(i)}].image`,
          reason:
            "image must be a base64 string (≥100 chars). Strip any `data:image/...;base64,` prefix.",
        }); return;
      }
      if (typeof mediaType !== "string" || !isAcceptedMediaType(mediaType)) {
        sendJsonError(res, 400, {
          kind: "format_error",
          field: `images[${String(i)}].mediaType`,
          reason: `mediaType must be one of: ${ACCEPTED_MEDIA.join(", ")}`,
        }); return;
      }
      validated.push({ angle, image, mediaType });
    }

    // Transcode each non-native image to JPEG. Reuses the two-stage
    // HEIC → sharp pipeline from /api/ocr/recognize.
    const visionBlocks: (| {
          type: "image";
          source: {
            type: "base64";
            media_type: AnthropicMediaType;
            data: string;
          };
        }
      | { type: "text"; text: string })[] = [];
    for (let i = 0; i < validated.length; i += 1) {
      const v = validated[i];
      if (v === undefined) continue;
      try {
        const { data, mediaType: outType } = await normalizeForVision(
          v.image,
          v.mediaType,
        );
        visionBlocks.push({
          type: "image",
          source: { type: "base64", media_type: outType, data },
        });
        visionBlocks.push({
          type: "text",
          text: `(image ${String(i + 1)} of ${String(validated.length)}: angle=${v.angle})`,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : "unknown";
        console.error(
          `[condition] normalizeForVision failed for images[${String(i)}] (angle=${v.angle}, type=${v.mediaType}):`,
          err,
        );
        sendJsonError(res, 400, {
          kind: "format_error",
          field: `images[${String(i)}]`,
          reason:
            `Could not normalize image for the vision call (${detail}). ` +
            `Try uploading a different photo for the ${v.angle} angle.`,
        }); return;
      }
    }
    visionBlocks.push({ type: "text", text: VISION_PROMPT });

    try {
      const response = await client.messages.create({
        model: VISION_MODEL,
        max_tokens: VISION_MAX_TOKENS,
        messages: [{ role: "user", content: visionBlocks }],
      });
      const text = extractTextContent(response.content).trim();
      let parsed: unknown;
      try {
        // Defensive — sometimes models wrap JSON in a ```json fence
        // despite the instruction not to. Strip a leading/trailing
        // fence before parsing.
        const stripped = text
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "");
        parsed = JSON.parse(stripped);
      } catch (err) {
        console.error(
          "[condition] vision output was not valid JSON — investigate:",
          err,
          "raw:",
          text.slice(0, 1024),
        );
        res.status(502).json({
          kind: "vision_format_error",
          reason:
            "The vision model returned text that wasn't valid JSON. This is usually transient — retry the request.",
          rawPrefix: text.slice(0, 200),
        });
        return;
      }
      const result = coerceExtractionResult(parsed);
      if (result === null) {
        console.error(
          "[condition] vision JSON did not match expected shape — investigate. raw parsed:",
          parsed,
        );
        res.status(502).json({
          kind: "vision_shape_error",
          reason:
            "The vision model returned JSON that did not match the expected shape. Retry the request.",
        });
        return;
      }
      res.status(200).json(result);
    } catch (err) {
      console.error("[condition] vision call failed — investigate immediately:", err);
      res.status(503).json({
        kind: "transient_error",
        retryable: true,
        cause: "vision_model_error",
        detail:
          "The vision service had trouble processing your photos. Try again with the same images.",
      });
    }
  };
}

/** Decode + transcode one image to Anthropic-native JPEG. */
async function normalizeForVision(
  base64: string,
  mediaType: AcceptedMediaType,
): Promise<{ data: string; mediaType: AnthropicMediaType }> {
  if (isAnthropicNative(mediaType)) {
    return { data: base64, mediaType };
  }
  let buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) {
    throw new Error("decoded image buffer is 0 bytes");
  }
  if (mediaType === "image/heic" || mediaType === "image/heif") {
    const jpegFromHeic = await convertHeic({
      buffer: buffer as unknown as ArrayBufferLike,
      format: "JPEG",
      quality: 0.9,
    });
    buffer = Buffer.from(jpegFromHeic);
  }
  const transcoded = await sharp(buffer).rotate().jpeg({ quality: 86 }).toBuffer();
  return { data: transcoded.toString("base64"), mediaType: "image/jpeg" };
}

/** Coerce arbitrary JSON to ConditionExtractionResult, return null on shape mismatch. */
function coerceExtractionResult(value: unknown): ConditionExtractionResult | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const tier = obj.suggestedTier;
  if (
    tier !== "Excellent" &&
    tier !== "Good" &&
    tier !== "Fair" &&
    tier !== "Rough"
  ) {
    return null;
  }
  const damageRaw = obj.visibleDamage;
  const damage: ConditionExtractionResult["visibleDamage"][number][] = [];
  if (Array.isArray(damageRaw)) {
    for (const d of damageRaw) {
      if (typeof d !== "object" || d === null) continue;
      const dr = d as Record<string, unknown>;
      const panel = dr.panel;
      const severity = dr.severity;
      const note = dr.note;
      if (typeof panel !== "string") continue;
      if (severity !== "minor" && severity !== "moderate" && severity !== "severe") continue;
      if (typeof note !== "string") continue;
      damage.push({ panel, severity, note });
    }
  }
  const followupRaw = obj.followupQuestions;
  const followups: ConditionExtractionResult["followupQuestions"][number][] = [];
  if (Array.isArray(followupRaw)) {
    for (const f of followupRaw) {
      if (typeof f !== "object" || f === null) continue;
      const fr = f as Record<string, unknown>;
      const id = fr.id;
      const prompt = fr.prompt;
      const why = fr.why;
      if (typeof id !== "string" || typeof prompt !== "string" || typeof why !== "string") continue;
      followups.push({ id, prompt, why });
    }
  }
  const mileageRaw = obj.extractedMileage;
  const extractedMileage =
    typeof mileageRaw === "number" && Number.isFinite(mileageRaw) && mileageRaw >= 0
      ? Math.round(mileageRaw)
      : undefined;
  const confidenceRaw = obj.odometerConfidence;
  const odometerConfidence =
    typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : undefined;
  const rawNotes = typeof obj.rawNotes === "string" ? obj.rawNotes : "";
  // exactOptionalPropertyTypes: spread-only when a value is present so
  // the optional-key contract is satisfied (no explicit undefined).
  return {
    kind: "condition_extracted",
    ...(extractedMileage !== undefined ? { extractedMileage } : {}),
    ...(odometerConfidence !== undefined ? { odometerConfidence } : {}),
    visibleDamage: damage,
    suggestedTier: tier,
    followupQuestions: followups,
    rawNotes,
  };
}

function isValidAngle(value: string): value is Angle {
  return (VALID_ANGLES as readonly string[]).includes(value);
}

function isAcceptedMediaType(value: string): value is AcceptedMediaType {
  return (ACCEPTED_MEDIA as readonly string[]).includes(value);
}

function isAnthropicNative(value: AcceptedMediaType): value is AnthropicMediaType {
  return (
    value === "image/jpeg" ||
    value === "image/png" ||
    value === "image/gif" ||
    value === "image/webp"
  );
}

function extractTextContent(content: readonly { type: string }[]): string {
  let out = "";
  for (const block of content) {
    if (block.type === "text" && "text" in block) {
      const t = (block as { text: unknown }).text;
      if (typeof t === "string") out += t;
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

export function isConditionConfigured(apiKey: string | undefined): boolean {
  return apiKey !== undefined && apiKey.trim() !== "";
}
