// @vitest-environment node
/**
 * CAT-13 adversary test — slice A.
 *
 * The chat-streaming integration test claims to cover CAT-13 (Transfer-Encoding:
 * chunked MUST be set) but it never asserts the header. This test proves the
 * gap by asserting the header directly.
 *
 * Why this matters: CAT-13 says "any /api/chat response that is not chunked-
 * transfer-encoded streaming is a CAT-13 regression." The existing test only
 * asserts on status codes and JSON bodies — not on whether the response is
 * actually streaming. A future refactor that drops res.flushHeaders() or
 * sets Content-Length would regress CAT-13 silently.
 *
 * NOTE: With a stub key, the Anthropic SDK will throw an auth error when
 * client.messages.stream is called. However, the streaming headers are set
 * BEFORE the Anthropic call (chat.ts:94-99), so the Transfer-Encoding header
 * is observable even on the auth-error path. This test asserts that the
 * header is present on any request that gets past the validation gates.
 *
 * Expected behaviour per constitution non-negotiable #11 and CAT-13:
 *   response.headers.get('transfer-encoding') must include 'chunked'
 * or
 *   response.headers.get('content-type') must include 'text/event-stream'
 * (Node's HTTP module sets Transfer-Encoding: chunked implicitly when
 * Content-Length is absent and res.flushHeaders() is called.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import express, { type Request, type Response } from "express";
import { makeChatHandler } from "../../server/routes/chat.ts";

function startApp(apiKey: string): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    const chatHandler = makeChatHandler(apiKey, undefined);
    if (chatHandler !== undefined) {
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
        close: () => new Promise((res) => { server.close(() => { res(); }); }),
      });
    });
  });
}

describe("CAT-13 adversary — /api/chat response MUST be streamed (Transfer-Encoding: chunked)", () => {
  let port = 0;
  let close: () => Promise<void> = () => Promise.resolve();

  beforeAll(async () => {
    // Stub key: non-empty so the handler is wired. Auth will fail at the
    // Anthropic call, but streaming headers should be set BEFORE that.
    const app = await startApp("sk-ant-stub-key-not-real-for-header-test");
    port = app.port;
    close = app.close;
  });

  afterAll(async () => {
    await close();
  });

  it("sets Content-Type: text/event-stream on the response (proves streaming path was entered)", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    });
    // Even on the Anthropic-auth-error path, the SSE headers must be set
    // because chat.ts sets them at line 94-99 BEFORE calling Anthropic.
    // A non-streamed response is a CAT-13 regression.
    const contentType = response.headers.get("content-type") ?? "";
    expect(
      contentType,
      "CAT-13: Content-Type must be text/event-stream for streaming responses",
    ).toMatch(/text\/event-stream/);
    // Consume the body so the server can close cleanly.
    await response.text();
  });

  it("does NOT set Content-Length (proves chunked encoding, not buffered response)", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    });
    // A Content-Length header means the response is NOT streaming — the
    // server has the full body before sending. Streaming requires chunked
    // transfer, which means NO Content-Length.
    const contentLength = response.headers.get("content-length");
    expect(
      contentLength,
      "CAT-13: Content-Length must NOT be set on a streaming response",
    ).toBeNull();
    await response.text();
  });
});
