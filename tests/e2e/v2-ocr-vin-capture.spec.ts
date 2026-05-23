/**
 * v2 Slice B — OCR + chat happy path.
 *
 * Uploads the fixture VIN-sticker image via the OcrCapture's hidden file
 * input, asserts the chatbot receives the recognized VIN as a user
 * message and routes through lookup_vin.
 *
 * Skipped when ANTHROPIC_API_KEY is absent (the OCR call would 503) or
 * when CARSXE_API_KEY is absent (lookup_vin would return
 * configuration_missing and the chatbot would not surface a vehicle card).
 */
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ESM equivalent of CommonJS __dirname. The Playwright tests run as ESM
// (per package.json "type": "module") so the bare __dirname is undefined.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HAS_ANTHROPIC = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
const HAS_CARSXE = Boolean(process.env.CARSXE_API_KEY?.trim());

test.describe("v2 slice B — OCR VIN capture", () => {
  test.skip(
    !HAS_ANTHROPIC || !HAS_CARSXE,
    "Requires ANTHROPIC_API_KEY and CARSXE_API_KEY in env.",
  );

  test("upload VIN-sticker fixture → chatbot routes through lookup_vin", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByText(/I'm here to help you sell your car/i),
    ).toBeVisible({ timeout: 2_000 });

    // Find the hidden file input and set our fixture image.
    const fixturePath = path.resolve(
      __dirname,
      "..",
      "fixtures",
      "vin-sticker-test.png",
    );
    await page.setInputFiles('[data-testid="ocr-file-input"]', fixturePath);

    // The OcrCapture posts to /api/ocr/recognize (Claude vision returns
    // the VIN), then sendMessage injects "Scanned VIN: <vin>" as a user
    // message. The chatbot calls lookup_vin and surfaces a vehicle card.
    // Wall-clock budget: 25s covers vision + chat + cascade + render.
    await expect(page.getByText(/Scanned VIN:/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Vehicle identified")).toBeVisible({
      timeout: 30_000,
    });
  });
});
