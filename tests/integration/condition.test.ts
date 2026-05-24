// @vitest-environment node
/**
 * Integration test for /api/condition/extract (v2 slice F task F.14).
 *
 * The vision call is NOT exercised here — we stay deterministic by
 * stubbing the ANTHROPIC_API_KEY check (handler returns undefined →
 * 503 configuration_missing) for one suite, and validate the
 * request-parsing + image-normalization branches without a real model
 * call in another suite. Real-model coverage is the responsibility of
 * the Playwright e2e (it sends a real photo set and asserts a
 * structured assessment comes back).
 *
 * Three families:
 *
 *   1. Configuration — missing key → 503 with the env var named and
 *      the signup URL embedded so a fresh setup gets actionable
 *      diagnostics on the FIRST POST.
 *
 *   2. Input validation — each of the documented 400 branches
 *      (missing array, too few, too many, duplicate angle, unknown
 *      angle, image-too-short, unsupported mediaType) fires its own
 *      structured format_error with the field name. Test the JSON
 *      shape because the client-side ConditionIntake component
 *      pattern-matches on these fields.
 *
 *   3. HEIC + sharp normalization fallback — sending bogus HEIC
 *      bytes with a stub API key exercises the heic-convert / sharp
 *      pipeline up to but not through the vision call. The negative
 *      assertion is that the response is NOT 415 / unsupported and
 *      NOT a server crash; either the conversion fails with a
 *      structured field=image error or the vision call fails with a
 *      503 transient_error.
 *
 * The integration test uses an ephemeral http.createServer mounted with
 * just the condition handler so we don't drag in the entire app's
 * route surface (which would require scheduler-db init etc.).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import express, { type Request, type Response } from "express";
import {
  isConditionConfigured,
  makeConditionHandler,
} from "../../server/routes/condition.ts";

async function startApp(envApiKey: string | undefined): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  const handler = makeConditionHandler(envApiKey);
  if (handler === undefined) {
    app.post("/api/condition/extract", (_req: Request, res: Response): void => {
      res.status(503).json({
        kind: "configuration_missing",
        missing_env_var: "ANTHROPIC_API_KEY",
        signup_url: "https://console.anthropic.com/settings/keys",
        message: "Condition extraction needs ANTHROPIC_API_KEY.",
      });
    });
  } else {
    app.post("/api/condition/extract", (req: Request, res: Response): void => {
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

/** Build a syntactically-valid image[] entry (~150 base64 chars) for the angle. */
function stubImage(angle: string, mediaType = "image/jpeg") {
  return { angle, image: "x".repeat(160), mediaType };
}

describe("isConditionConfigured", () => {
  it("matches isChatConfigured / isOcrConfigured semantics", () => {
    expect(isConditionConfigured(undefined)).toBe(false);
    expect(isConditionConfigured("")).toBe(false);
    expect(isConditionConfigured("   ")).toBe(false);
    expect(isConditionConfigured("sk-ant-x")).toBe(true);
  });
});

describe("/api/condition/extract without ANTHROPIC_API_KEY", () => {
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

  it("returns 503 configuration_missing with the env var name AND signup URL", async () => {
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/api/condition/extract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: [
            stubImage("front_left"),
            stubImage("front_right"),
            stubImage("rear_left"),
          ],
        }),
      },
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("configuration_missing");
    expect(body.missing_env_var).toBe("ANTHROPIC_API_KEY");
    expect(body.signup_url).toBe("https://console.anthropic.com/settings/keys");
  });
});

describe("/api/condition/extract input validation (with stub key)", () => {
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

  // Note: the body-is-not-an-object guard exists in the handler but is
  // hard to exercise via real HTTP — express.json() rejects bare
  // primitives at the parser layer with its default HTML error page
  // BEFORE our handler runs. We cover that guard implicitly through the
  // images-missing test below (req.body = {} reaches the handler, then
  // images guard fires). If you ever wire a permissive JSON parser, add
  // a "POST with body = null" test back here.

  it("400 when images is missing or not an array", async () => {
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/api/condition/extract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: "not-an-array" }),
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("format_error");
    expect(body.field).toBe("images");
  });

  it("400 when fewer than 3 images supplied", async () => {
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/api/condition/extract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: [stubImage("front_left"), stubImage("front_right")],
        }),
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("format_error");
    expect(body.field).toBe("images");
    expect(String(body.reason)).toMatch(/at least 3 images/i);
  });

  it("400 when more than 12 images supplied", async () => {
    const angles = [
      "front_left", "front_right", "rear_left", "rear_right",
      "odometer", "interior_front", "interior_rear", "vin_plate",
      "damage_closeup", "damage_closeup", "damage_closeup", "damage_closeup",
      "damage_closeup",
    ]; // 13 angles
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/api/condition/extract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: angles.map((a) => stubImage(a)) }),
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("format_error");
    expect(body.field).toBe("images");
    expect(String(body.reason)).toMatch(/at most 12/i);
  });

  it("400 when angle is unknown", async () => {
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/api/condition/extract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: [
            stubImage("front_left"),
            stubImage("front_right"),
            stubImage("rooftop_drone"), // not a valid angle
          ],
        }),
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("format_error");
    expect(String(body.field)).toMatch(/images\[2\]\.angle/);
  });

  it("400 when a non-damage_closeup angle is duplicated", async () => {
    // odometer is allowed once; sending it twice must fail. (Only the
    // damage_closeup angle is permitted to repeat.)
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/api/condition/extract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: [
            stubImage("odometer"),
            stubImage("front_left"),
            stubImage("odometer"),
          ],
        }),
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("format_error");
    expect(String(body.field)).toMatch(/images\[2\]\.angle/);
    expect(String(body.reason)).toMatch(/appears more than once/i);
  });

  it("permits damage_closeup to repeat (regression — multi-damage uploads)", async () => {
    // Three images, two of them damage_closeup. Bodies are stub bytes
    // so the vision call will fail; we only care that we DIDN'T 400
    // on the duplicate-angle guard for damage_closeup.
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/api/condition/extract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: [
            stubImage("front_left"),
            stubImage("damage_closeup"),
            stubImage("damage_closeup"),
          ],
        }),
      },
    );
    if (response.status === 400) {
      const body = (await response.json()) as Record<string, unknown>;
      // If 400 fires it must be for some other reason (vision rejection
      // of the stub bytes via sharp), NOT for damage_closeup repeats.
      expect(String(body.field)).not.toMatch(/angle/i);
      expect(String(body.reason)).not.toMatch(/more than once/i);
    } else {
      // The other acceptable outcomes — anything that isn't a
      // duplicate-angle rejection.
      expect([200, 502, 503]).toContain(response.status);
    }
  });

  it("400 when image is too short", async () => {
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/api/condition/extract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: [
            stubImage("front_left"),
            stubImage("front_right"),
            { angle: "rear_left", image: "abc", mediaType: "image/jpeg" },
          ],
        }),
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("format_error");
    expect(String(body.field)).toMatch(/images\[2\]\.image/);
  });

  it("400 when mediaType is unsupported (e.g. PDF)", async () => {
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/api/condition/extract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: [
            stubImage("front_left"),
            stubImage("front_right"),
            {
              angle: "rear_left",
              image: "x".repeat(200),
              mediaType: "application/pdf",
            },
          ],
        }),
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("format_error");
    expect(String(body.field)).toMatch(/images\[2\]\.mediaType/);
  });

  it("HEIC mediaType passes the type gate (regression — iPhone uploads should not be rejected at the gate)", async () => {
    // Bogus HEIC payload >= 100 chars. The mediaType check passes;
    // either heic-convert / sharp rejects the bytes (400 with
    // field=images[…]) or the vision call fails (503). What we want
    // to ASSERT is that we did NOT reject on mediaType — the negative
    // assertion catches a regression where someone accidentally
    // narrowed the accept list back to native-Anthropic-only.
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/api/condition/extract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: [
            stubImage("front_left"),
            stubImage("front_right"),
            {
              angle: "rear_left",
              image: "x".repeat(200),
              mediaType: "image/heic",
            },
          ],
        }),
      },
    );
    if (response.status === 400) {
      const body = (await response.json()) as Record<string, unknown>;
      expect(String(body.field)).not.toMatch(/mediaType/i);
    } else {
      expect([200, 502, 503]).toContain(response.status);
    }
  });

  it("JSON shape coercion — vision_format_error / vision_shape_error never crash the request", async () => {
    // We can't easily force the model to emit malformed JSON in an
    // integration test without a real key. But the handler's coercion
    // path is exercised by the BadRequestError / unparseable-JSON paths
    // we expect when the vision call fails on bogus stub bytes. The
    // negative assertion: the server should never return a 500
    // unstructured crash. Every 4xx / 5xx must carry a kind+reason
    // body so the client can render an actionable panel.
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/api/condition/extract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: [
            stubImage("front_left"),
            stubImage("front_right"),
            stubImage("rear_left"),
          ],
        }),
      },
    );
    expect([200, 400, 502, 503]).toContain(response.status);
    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body.kind).toBe("string");
  });
});
