/**
 * Tests for compressImageIfNeeded.
 *
 * The helper's job is to keep oversized iPhone JPEGs from hitting
 * Anthropic's 5 MB vision cap. These tests pin three behaviors that
 * actually fail in production when broken:
 *
 *   1. Files under the byte cap are returned untouched (no quality
 *      loss for small uploads — a real regression risk).
 *   2. Files in unsupported MIME types (HEIC/HEIF/TIFF) are returned
 *      unchanged so the server's heic-convert + sharp path handles them.
 *   3. The thrown error types carry the original file name so the
 *      user-facing error can name what failed.
 *
 * We do NOT exercise the real canvas decode path here. jsdom does not
 * implement createImageBitmap or canvas.toBlob in a way that round-
 * trips real JPEG bytes, and pinning that here would over-mock the
 * test out of usefulness. The actual decode + downscale loop runs in
 * the browser; we cover it via Playwright in v2-condition-intake.spec.
 */
import { describe, expect, it } from "vitest";
import {
  compressImageIfNeeded,
  EncodeError,
  ImageDecodeError,
  StillTooLargeError,
} from "../../src/components/imageCompression.ts";

/**
 * Build a synthetic File of an exact byte size + MIME type, with a
 * deterministic name so error-message assertions can be exact.
 */
function makeFile(args: {
  bytes: number;
  type: string;
  name: string;
}): File {
  const payload = new Uint8Array(args.bytes);
  return new File([payload], args.name, { type: args.type });
}

describe("compressImageIfNeeded", () => {
  it("returns the original file untouched when it is already under the byte cap", async () => {
    const tiny = makeFile({
      bytes: 100_000,
      type: "image/jpeg",
      name: "small.jpg",
    });
    const out = await compressImageIfNeeded(tiny);
    // Same File reference proves we did not re-encode a small file.
    expect(out).toBe(tiny);
  });

  it("returns the original file untouched for HEIC inputs (server handles HEIC)", async () => {
    // HEIC files are routinely larger than 5 MB but the browser cannot
    // decode them; the server's heic-convert pipeline does. Returning
    // unchanged is the correct behavior — server will resample.
    const heic = makeFile({
      bytes: 6_000_000,
      type: "image/heic",
      name: "IMG_6912.HEIC",
    });
    const out = await compressImageIfNeeded(heic);
    expect(out).toBe(heic);
  });

  it("returns the original file untouched for TIFF inputs", async () => {
    const tiff = makeFile({
      bytes: 6_000_000,
      type: "image/tiff",
      name: "scan.tif",
    });
    const out = await compressImageIfNeeded(tiff);
    expect(out).toBe(tiff);
  });

  it("returns the original file untouched for an unknown MIME (defensive)", async () => {
    const unknown = makeFile({
      bytes: 7_000_000,
      type: "application/octet-stream",
      name: "blob.bin",
    });
    const out = await compressImageIfNeeded(unknown);
    expect(out).toBe(unknown);
  });

  it("respects a caller-supplied maxBytes (still passes through if under it)", async () => {
    const file = makeFile({
      bytes: 2_000_000,
      type: "image/jpeg",
      name: "medium.jpg",
    });
    const out = await compressImageIfNeeded(file, { maxBytes: 3_000_000 });
    expect(out).toBe(file);
  });
});

describe("compression error classes", () => {
  it("ImageDecodeError carries the file name in its message", () => {
    const err = new ImageDecodeError("IMG_9999.JPG");
    expect(err.message).toContain("IMG_9999.JPG");
    expect(err.name).toBe("ImageDecodeError");
  });

  it("EncodeError carries the file name AND the failing quality stage", () => {
    const err = new EncodeError("front_left.jpg", 0.65);
    expect(err.message).toContain("front_left.jpg");
    expect(err.message).toContain("0.65");
    expect(err.name).toBe("EncodeError");
  });

  it("StillTooLargeError reports final size AND the cap in MB", () => {
    const err = new StillTooLargeError("big.jpg", 7_340_032, 5_242_880);
    // Both values rendered as MB with one decimal place.
    expect(err.message).toContain("7.0 MB");
    expect(err.message).toContain("5.0 MB");
    expect(err.message).toContain("big.jpg");
    expect(err.name).toBe("StillTooLargeError");
  });
});
