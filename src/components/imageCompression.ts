/**
 * imageCompression — browser-side image downscale + re-encode helper.
 *
 * Anthropic's vision API hard-caps source images at 5 MB. iPhone JPEGs
 * are routinely 4 to 8 MB straight off the camera, and our server's
 * "Anthropic native" passthrough (image/jpeg, image/png, image/webp,
 * image/gif) skips sharp transcoding entirely, so an oversized native
 * file goes straight to the API and gets bounced with the cryptic
 * `messages.0.content.0.image.source.base64: image exceeds 5 MB maximum`
 * error. This helper runs in the browser to bring any oversized image
 * below the cap BEFORE it ever leaves the device.
 *
 * What it does:
 *   1. If the file is already under the byte cap AND its largest edge
 *      is already under the pixel cap, return the original file
 *      untouched (no quality loss for already-small uploads).
 *   2. If the file's MIME type cannot be decoded in the browser
 *      (HEIC, HEIF, TIFF, BMP — browsers handle these unevenly), return
 *      the original file. The server's sharp/heic-convert pipeline will
 *      handle the transcode + resample for those.
 *   3. Otherwise, decode via Image + canvas, scale so the largest edge
 *      fits maxEdgePx, re-encode as JPEG at the requested quality, and
 *      wrap the result back into a File so the rest of the pipeline
 *      (FileReader, base64) is unchanged.
 *
 * What it does NOT do:
 *   - Animated GIF — we re-encode as JPEG (loses animation). Acceptable
 *     because the use case is photos of cars, not animations.
 *   - SVG — also re-encoded to JPEG, which rasterizes the vector. Not
 *     a realistic input for our flows.
 *   - HEIC — left to server-side heic-convert. Caller may pass HEIC in
 *     and will get the original file back.
 *
 * Failure cases each throw a NAMED, ACTIONABLE error so the caller can
 * surface it to the user without a generic "something went wrong":
 *   - Image fails to decode (corrupt, truncated) → ImageDecodeError
 *   - Canvas getContext returns null (extremely rare) → CanvasUnavailableError
 *   - canvas.toBlob returns null (encoder failed) → EncodeError
 *   - After max retries the result still exceeds maxBytes → StillTooLargeError
 *
 * All errors extend Error and carry the original file name so the
 * caller's error UI can say "Front-left photo (IMG_6912.JPG) couldn't
 * be compressed below 5 MB; try a smaller photo from your camera roll."
 */

const BROWSER_DECODABLE_MIME = new Set<string>([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
]);

export interface CompressionOptions {
  /**
   * Maximum allowed byte size of the OUTPUT file. Default 4.5 MB to keep
   * a safety margin below Anthropic's 5 MB hard cap (base64 encoding
   * inflates by ~33%, but Anthropic measures the decoded byte size, not
   * the base64 string length).
   */
  readonly maxBytes?: number;
  /**
   * Maximum pixel length of the longest edge of the OUTPUT image.
   * Default 2400 — keeps fine details readable for OCR (license plates,
   * VIN digits, odometer numbers) while shedding the multi-megapixel
   * detail that iPhones over-capture by default.
   */
  readonly maxEdgePx?: number;
  /**
   * JPEG quality (0..1) for the first compression pass. Default 0.85,
   * which is the sweet spot for vision OCR — visually lossless on most
   * inputs while halving file size vs quality 1.0.
   */
  readonly initialQuality?: number;
  /**
   * Minimum JPEG quality. If the first pass at initialQuality is still
   * over maxBytes, the helper retries at progressively lower quality
   * down to this floor before giving up. Default 0.5.
   */
  readonly minQuality?: number;
}

export class ImageDecodeError extends Error {
  constructor(
    public readonly fileName: string,
    cause?: unknown,
  ) {
    super(
      `Browser could not decode "${fileName || "the photo"}" as an image. ` +
        `The file may be corrupted or in an unsupported format.`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "ImageDecodeError";
  }
}

export class CanvasUnavailableError extends Error {
  constructor(public readonly fileName: string) {
    super(
      `Browser canvas 2D context is unavailable; cannot compress "${fileName || "the photo"}". ` +
        `This usually means a browser extension is blocking canvas. Try in a private window.`,
    );
    this.name = "CanvasUnavailableError";
  }
}

export class EncodeError extends Error {
  constructor(
    public readonly fileName: string,
    public readonly stageQuality: number,
  ) {
    super(
      `Browser failed to JPEG-encode "${fileName || "the photo"}" at quality ${String(stageQuality)}. ` +
        `Try a different photo from your camera roll.`,
    );
    this.name = "EncodeError";
  }
}

export class StillTooLargeError extends Error {
  constructor(
    public readonly fileName: string,
    public readonly finalBytes: number,
    public readonly maxBytes: number,
  ) {
    const finalMb = (finalBytes / 1_048_576).toFixed(1);
    const maxMb = (maxBytes / 1_048_576).toFixed(1);
    super(
      `"${fileName || "The photo"}" is still ${finalMb} MB after maximum compression ` +
        `(limit is ${maxMb} MB). Pick a smaller photo or take a new one at a lower resolution.`,
    );
    this.name = "StillTooLargeError";
  }
}

/**
 * Return a File ready for upload — either the original (if it already
 * fits the byte + pixel caps) or a downscaled JPEG re-encode.
 *
 * Throws ImageDecodeError / CanvasUnavailableError / EncodeError /
 * StillTooLargeError on the failure modes documented above.
 *
 * Side effects: creates a temporary object URL for the decode step and
 * revokes it before returning. Does not mutate the input File.
 */
export async function compressImageIfNeeded(
  file: File,
  options: CompressionOptions = {},
): Promise<File> {
  const maxBytes = options.maxBytes ?? 4_500_000;
  const maxEdgePx = options.maxEdgePx ?? 2400;
  const initialQuality = options.initialQuality ?? 0.85;
  const minQuality = options.minQuality ?? 0.5;
  const fileName = file.name;

  // Skip compression for files the browser can't decode; the server's
  // sharp + heic-convert pipeline handles those.
  if (!BROWSER_DECODABLE_MIME.has(file.type)) {
    return file;
  }

  // Fast path: small file. We still check pixel dimensions below only
  // if the byte size suggests it might be a hi-res shot smuggled in a
  // small file (rare but possible with WebP). For simplicity, the
  // byte-size shortcut wins — pixel-only checks are only worth the
  // decode cost when we already know we need to recompress.
  if (file.size <= maxBytes) {
    return file;
  }

  const bitmap = await decodeImageBitmap(file).catch((cause: unknown) => {
    throw new ImageDecodeError(fileName, cause);
  });

  try {
    const { width: outWidth, height: outHeight } = fitWithinEdge(
      bitmap.width,
      bitmap.height,
      maxEdgePx,
    );

    const canvas = document.createElement("canvas");
    canvas.width = outWidth;
    canvas.height = outHeight;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      throw new CanvasUnavailableError(fileName);
    }
    ctx.drawImage(bitmap, 0, 0, outWidth, outHeight);

    // Try the initial quality first; if the result is still over the
    // byte cap, step quality down by 0.1 until it fits or we hit the
    // floor. Each pass re-encodes from the same canvas (cheap; the
    // decode work is already done).
    let quality = initialQuality;
    let bestBlob: Blob | null = null;
    while (quality >= minQuality - 0.0001) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality).catch(
        () => null,
      );
      if (blob === null) {
        throw new EncodeError(fileName, quality);
      }
      bestBlob = blob;
      if (blob.size <= maxBytes) break;
      quality = Math.max(minQuality, quality - 0.1);
      // Numerical safety: bail when we've already tried the floor.
      if (quality === minQuality && blob.size > maxBytes) {
        // One last attempt at the floor before throwing.
        const finalBlob = await canvasToBlob(
          canvas,
          "image/jpeg",
          minQuality,
        ).catch(() => null);
        if (finalBlob !== null && finalBlob.size <= maxBytes) {
          bestBlob = finalBlob;
          break;
        }
        if (finalBlob !== null) bestBlob = finalBlob;
        break;
      }
    }

    if (bestBlob === null || bestBlob.size > maxBytes) {
      throw new StillTooLargeError(
        fileName,
        bestBlob === null ? file.size : bestBlob.size,
        maxBytes,
      );
    }

    return new File([bestBlob], replaceExtension(fileName, "jpg"), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } finally {
    if ("close" in bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

/**
 * Decode a File into an ImageBitmap. ImageBitmap is preferred over
 * `new Image()` + objectURL because it skips the per-frame layout cost
 * and is supported in every browser our app runs in (Safari 15+,
 * Chrome/Edge/Firefox latest). Falls back to Image-via-objectURL only
 * if createImageBitmap throws (older Safari with HEIC).
 */
async function decodeImageBitmap(
  file: File,
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to Image fallback.
    }
  }
  return await decodeViaImageElement(file);
}

function decodeViaImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = (): void => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (event): void => {
      URL.revokeObjectURL(url);
      reject(
        event instanceof Event
          ? new Error(`Image element rejected ${file.name || "the photo"}.`)
          : new Error(
              typeof event === "string"
                ? event
                : `Image element rejected ${file.name || "the photo"}.`,
            ),
      );
    };
    img.src = url;
  });
}

/**
 * Wrap canvas.toBlob in a Promise. Rejects only on encoder failure
 * (null blob); callers translate that into an EncodeError with the
 * filename + quality stage.
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(
            new Error(
              `canvas.toBlob returned null for ${mimeType} at quality ${String(quality)}.`,
            ),
          );
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

/**
 * Scale (width, height) so the longest edge equals maxEdge while
 * preserving aspect ratio. If both dimensions are already <= maxEdge
 * the input is returned unchanged.
 */
function fitWithinEdge(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longestEdge;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Swap the extension on a filename. Used to rename "IMG_6912.HEIC" to
 * "IMG_6912.jpg" after a JPEG re-encode so the file's name matches its
 * content. Preserves the original name when there is no extension to
 * swap (e.g. "screenshot" → "screenshot.jpg").
 */
function replaceExtension(fileName: string, newExt: string): string {
  if (fileName === "") return `compressed.${newExt}`;
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1) return `${fileName}.${newExt}`;
  return `${fileName.slice(0, lastDot)}.${newExt}`;
}
