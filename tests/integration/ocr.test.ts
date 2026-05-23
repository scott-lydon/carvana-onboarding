// @vitest-environment node
/**
 * Integration test for /api/ocr/recognize (v2 slice B).
 *
 * Two paths exercised:
 *   1. Missing ANTHROPIC_API_KEY → 503 configuration_missing with the
 *      signup URL embedded.
 *   2. Input validation (image too short / wrong types) → 400 format_error.
 *
 * The real Claude vision call against the fixture image is covered by the
 * e2e Playwright spec (tests/e2e/v2-ocr-vin-capture.spec.ts) so this
 * integration test stays fast and deterministic without burning Anthropic
 * tokens on every CI run.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import express, { type Request, type Response } from "express";
import { isOcrConfigured, makeOcrHandler } from "../../server/routes/ocr.ts";

async function startApp(envApiKey: string | undefined): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  const handler = makeOcrHandler(envApiKey);
  if (handler === undefined) {
    app.post("/api/ocr/recognize", (_req: Request, res: Response): void => {
      res.status(503).json({
        kind: "configuration_missing",
        missing_env_var: "ANTHROPIC_API_KEY",
        signup_url: "https://console.anthropic.com/settings/keys",
        message: "OCR needs ANTHROPIC_API_KEY.",
      });
    });
  } else {
    app.post("/api/ocr/recognize", (req: Request, res: Response): void => {
      void handler(req, res);
    });
  }
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Test server failed to bind.");
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((res) => {
            server.close(() => {
              res();
            });
          }),
      });
    });
  });
}

describe("isOcrConfigured", () => {
  it("matches isChatConfigured semantics (non-empty trimmed string)", () => {
    expect(isOcrConfigured(undefined)).toBe(false);
    expect(isOcrConfigured("")).toBe(false);
    expect(isOcrConfigured("   ")).toBe(false);
    expect(isOcrConfigured("sk-ant-x")).toBe(true);
  });
});

describe("/api/ocr/recognize without ANTHROPIC_API_KEY", () => {
  let port = 0;
  let close: () => Promise<void> = () => Promise.resolve();
  beforeAll(async () => {
    const app = await startApp(undefined);
    port = app.port;
    close = app.close;
  });
  afterAll(async () => {
    await close();
  });
  it("returns 503 configuration_missing with the signup URL", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/ocr/recognize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "x".repeat(120), target: "vin_sticker" }),
    });
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("configuration_missing");
    expect(body.signup_url).toBe("https://console.anthropic.com/settings/keys");
  });
});

describe("/api/ocr/recognize input validation (with stub key)", () => {
  let port = 0;
  let close: () => Promise<void> = () => Promise.resolve();
  beforeAll(async () => {
    const app = await startApp("sk-ant-stub-not-real");
    port = app.port;
    close = app.close;
  });
  afterAll(async () => {
    await close();
  });
  it("400 when image is too short", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/ocr/recognize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "abc", target: "vin_sticker" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("format_error");
    expect(body.field).toBe("image");
  });
  it("400 when target is unknown", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/ocr/recognize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: "x".repeat(120),
        target: "license_plate_decal", // not in the OcrTarget union
      }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("format_error");
    expect(body.field).toBe("target");
  });
  it("400 when mediaType is unsupported", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/ocr/recognize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: "x".repeat(120),
        target: "vin_sticker",
        mediaType: "image/tiff",
      }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("format_error");
    expect(body.field).toBe("mediaType");
  });
});
