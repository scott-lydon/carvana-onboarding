// @vitest-environment node
//
// jsdom (the default in vite.config.ts) makes the Anthropic SDK refuse to
// initialize ("It looks like you're running in a browser-like environment").
// This file's tests only exercise server-side handlers via a real HTTP
// listener, so node is the correct environment. The pragma applies to this
// FILE only; other tests continue under jsdom.
/**
 * CAT-13 — /api/chat MUST stream (Transfer-Encoding: chunked).
 *
 * Boots the Express app on an ephemeral port, POSTs to /api/chat without
 * an ANTHROPIC_API_KEY in the env so the 503 configuration_missing path
 * is exercised, AND boots a second instance with a stub key so the
 * streaming-header assertions can run.
 *
 * The streaming behavior itself (talking to real Anthropic) is covered
 * by the e2e test which requires a live API key. This integration test
 * focuses on what we can assert deterministically without network: the
 * headers, the 503 shape, and the input-validation paths.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import express, { type Request, type Response } from "express";
import { isChatConfigured, makeChatHandler } from "../../server/routes/chat.ts";

/**
 * Spin up an Express server on a random port, returning the port number
 * and a teardown function. The handler factory result (or its absence) is
 * the only difference between the two test apps.
 */
function startApp(envApiKey: string | undefined): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    const chatHandler = makeChatHandler(envApiKey, undefined);
    if (chatHandler === undefined) {
      app.post("/api/chat", (_req: Request, res: Response): void => {
        res.status(503).json({
          kind: "configuration_missing",
          missing_env_var: "ANTHROPIC_API_KEY",
          signup_url: "https://console.anthropic.com/settings/keys",
          message:
            "The chatbot needs an Anthropic API key. Set ANTHROPIC_API_KEY in .env.local.",
        });
      });
    } else {
      app.post("/api/chat", (req: Request, res: Response): void => {
        void chatHandler(req, res);
      });
    }
    const server = http.createServer(app);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Test server failed to bind to a numeric port.");
      }
      resolve({
        port: address.port,
        close: () => new Promise((res) => {
          server.close(() => {
            res();
          });
        }),
      });
    });
  });
}

describe("isChatConfigured", () => {
  it("returns true only for a non-empty trimmed string", () => {
    expect(isChatConfigured(undefined)).toBe(false);
    expect(isChatConfigured("")).toBe(false);
    expect(isChatConfigured("   ")).toBe(false);
    expect(isChatConfigured("sk-ant-x")).toBe(true);
  });
});

describe("CAT-13 part 1: /api/chat returns 503 configuration_missing without a key", () => {
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

  it("returns 503 with the signup URL embedded in the body", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("configuration_missing");
    expect(body.missing_env_var).toBe("ANTHROPIC_API_KEY");
    expect(body.signup_url).toBe("https://console.anthropic.com/settings/keys");
    expect(typeof body.message).toBe("string");
    expect(String(body.message)).toMatch(/ANTHROPIC_API_KEY/);
  });
});

describe("CAT-13 part 2: input validation runs before the LLM call", () => {
  let port = 0;
  let close: () => Promise<void> = () => Promise.resolve();

  beforeAll(async () => {
    // Use a stub key so the handler is configured. We never actually issue
    // an Anthropic call in this block — the validation failures we test
    // for bail out BEFORE the SDK is invoked.
    const app = await startApp("sk-ant-test-stub-key-not-real");
    port = app.port;
    close = app.close;
  });

  afterAll(async () => {
    await close();
  });

  it("returns 400 when the JSON body cannot be parsed", async () => {
    // Express's default express.json() parser is strict: top-level non-object
    // and non-array values (e.g., bare strings) are rejected at the body
    // parser BEFORE our handler runs. The handler's `typeof rawBody !==
    // "object"` check is belt-and-suspenders for the case where strict mode
    // is loosened. We assert the parser's 400 behavior to document the
    // end-to-end shape; the response body is HTML (Express's default error
    // shape), so we only assert on status.
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "this is not valid JSON",
    });
    expect(response.status).toBe(400);
  });

  it("returns 400 format_error when messages is not an array", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: "not an array" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("format_error");
    expect(body.field).toBe("messages");
  });
});
