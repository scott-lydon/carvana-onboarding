/**
 * /api/chat — the v2 chatbot endpoint.
 *
 * Receives a POST with `messages` (the full chat history) and streams the
 * assistant's response back as Server-Sent Events. Implements the
 * multi-turn tool-use loop:
 *
 *   1. Stream the assistant turn from Anthropic, re-emitting text deltas
 *      and tool_use blocks as SSE events.
 *   2. If the turn ends with stop_reason="tool_use", dispatch each
 *      tool_use block via dispatchTool, build a follow-up user message
 *      with tool_result content blocks, and loop back to step 1.
 *   3. When stop_reason !== "tool_use", emit a `done` event and end the
 *      response.
 *
 * Streaming uses Express's chunked Transfer-Encoding (achieved by calling
 * res.write without setting Content-Length). Each event line is
 *   `data: {"type":"...","..."}\n\n`
 * which the client parses with a ReadableStream reader and split-on-blank-
 * line buffer.
 *
 * If ANTHROPIC_API_KEY is missing, the route returns 503
 * configuration_missing with a precise message naming the env var and the
 * signup URL. This is the "every failure case throws a clear, comprehensive,
 * specific error" rule from the user's preferences.
 *
 * CAT-13: Transfer-Encoding MUST be chunked. The integration test asserts
 * this on every request.
 * CAT-11: the system prompt + tool-use architecture mean the assistant's
 * text never echoes PII. The dispatcher's tool_result is structured and
 * rendered visually next to the message, not embedded in prose.
 */
import type { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { SYSTEM_PROMPT } from "../chat/system-prompt.js";
import { TOOLS, dispatchTool } from "../chat/tools.js";
import type { VendorCascade } from "../../src/lookup/VendorCascade.js";

/**
 * Default model is Haiku 4.5 — chosen so first-token latency under load is
 * low enough that the chat does NOT need a multi-phase progress bar. Sonnet
 * 4.5 was the previous default and routinely showed a 1.5-3s gap before the
 * first token, which is why the UI had to fall back on a "Reading → Lookup
 * → Drafting → Finalizing" phase indicator. With Haiku 4.5 the first token
 * arrives fast enough that a simple typing indicator (or no indicator at
 * all, just the cursor-style streaming text) is enough.
 *
 * If a future regression demands Sonnet for a specific deployment, set
 * ANTHROPIC_MODEL in the environment. The env var is read at handler
 * construction time, so changing it requires a server restart — that's
 * deliberate so we never silently swap models mid-request.
 *
 * Why we don't use the dated alias ("claude-haiku-4-5-20251001"): the
 * unversioned id auto-tracks the latest Haiku 4.5 point release. If a
 * particular evaluation requires reproducibility, pin via env.
 */
const ANTHROPIC_MODEL: string = ((): string => {
  const fromEnv = process.env.ANTHROPIC_MODEL?.trim() ?? "";
  return fromEnv !== "" ? fromEnv : "claude-haiku-4-5";
})();
const MAX_TOKENS = 2048;
// Bound the tool-dispatch loop so a runaway model can't burn unlimited
// turns. Realistic happy path is 1-2 turns (initial → tool_use → final).
// 5 is generous headroom for a complex multi-tool conversation.
const MAX_TOOL_TURNS = 5;

/**
 * Public factory for the chat handler. Takes the VendorCascade by
 * dependency injection so tests can pass a fixture cascade.
 *
 * Returns undefined when ANTHROPIC_API_KEY is not set. Caller wires up a
 * 503 configuration_missing handler in that case.
 */
export function makeChatHandler(
  apiKey: string | undefined,
  cascade: VendorCascade | undefined,
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
        reason: "request body must be a JSON object with `messages: MessageParam[]`",
      });
      return;
    }
    const body = rawBody as Record<string, unknown>;
    const messagesInput = body.messages;
    if (!Array.isArray(messagesInput)) {
      sendJsonError(res, 400, {
        kind: "format_error",
        field: "messages",
        reason: "messages must be an array of {role, content} objects",
      });
      return;
    }
    // Coerce to the SDK's MessageParam[] type. The SDK validates structure
    // when the request goes out; we are deliberately not re-validating
    // here to avoid drift between our validator and the SDK's.
    const messages: MessageParam[] = messagesInput as MessageParam[];

    // Set streaming headers BEFORE first write. Chunked Transfer-Encoding
    // is implied by writing without Content-Length. CAT-13.
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // X-Accel-Buffering disables nginx buffering when this sits behind one.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    try {
      await runChatLoop(client, messages, cascade, res);
    } catch (err) {
      console.error("[chat] uncaught error in chat loop:", err);
      // We are already mid-stream; send an error event the client can render.
      writeSseEvent(res, {
        type: "error",
        message:
          "The chat service hit an unexpected error. Please retry. " +
          "If this persists, check the server logs.",
      });
    } finally {
      res.end();
    }
  };
}

/**
 * Run the multi-turn tool-use loop. Each iteration streams one assistant
 * turn from Anthropic. If the turn ends in tool_use, dispatches the tools
 * and continues. Hard-bounded by MAX_TOOL_TURNS.
 */
async function runChatLoop(
  client: Anthropic,
  messages: MessageParam[],
  cascade: VendorCascade | undefined,
  res: Response,
): Promise<void> {
  for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
    const stream = client.messages.stream({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [...TOOLS],
      messages,
    });

    // Re-emit text deltas + tool_use starts to the client as SSE.
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        writeSseEvent(res, { type: "text_delta", text: event.delta.text });
      } else if (
        event.type === "content_block_start" &&
        event.content_block.type === "tool_use"
      ) {
        writeSseEvent(res, {
          type: "tool_use_start",
          tool_use_id: event.content_block.id,
          name: event.content_block.name,
        });
      }
    }

    const finalMessage = await stream.finalMessage();
    // Push the assistant turn into history for the next iteration (only
    // matters if we loop back for tool_result).
    messages.push({ role: "assistant", content: finalMessage.content });

    if (finalMessage.stop_reason !== "tool_use") {
      // Emit the full assistant history so the client can preserve it for
      // the next user turn. Without this, the client only sees text deltas
      // and tool_result events, and cannot reconstruct the Anthropic-shaped
      // assistant message needed for multi-turn conversation. The server
      // is stateless; the client owns the conversation history.
      writeSseEvent(res, {
        type: "history_sync",
        messages,
      });
      writeSseEvent(res, {
        type: "done",
        stop_reason: finalMessage.stop_reason ?? "end_turn",
      });
      return;
    }

    // Dispatch every tool_use block in the final message and assemble
    // tool_result content blocks for the next user turn. The SDK's
    // Message.content is a union wider than text|tool_use (it also includes
    // ThinkingBlock, ServerToolUseBlock, etc.); inline narrow keeps us
    // forward-compatible with future block kinds without listing them all.
    const toolUseBlocks = finalMessage.content.filter(
      (block): block is ToolUseBlock => block.type === "tool_use",
    );
    const toolResultBlocks: ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const dispatched = await dispatchTool(block.name, block.id, block.input, cascade);
      // Emit the full structured result to the client so the UI can render
      // a vehicle card, scheduler, etc. — this is how the assistant's text
      // stays PII-free (CAT-11) while the user still sees their vehicle.
      writeSseEvent(res, {
        type: "tool_result",
        tool_use_id: dispatched.toolUseId,
        name: dispatched.toolName,
        result: dispatched.result,
      });
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: dispatched.toolUseId,
        content: JSON.stringify(dispatched.result),
      });
    }
    messages.push({ role: "user", content: toolResultBlocks });
  }
  // Tool-use loop exhausted without natural stop. Emit a done event so the
  // client doesn't hang, and surface a diagnostic in the server log.
  console.warn(
    `[chat] tool-use loop hit MAX_TOOL_TURNS=${String(MAX_TOOL_TURNS)} without end_turn. ` +
      "Check the system prompt for a runaway pattern.",
  );
  writeSseEvent(res, { type: "done", stop_reason: "max_tool_turns" });
}

/**
 * Write one SSE event line. The double-newline at the end is the SSE
 * record separator; clients use it to know one event is complete.
 */
function writeSseEvent(res: Response, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Send a non-streamed JSON error response. Used for input-validation
 * failures BEFORE we start streaming.
 */
function sendJsonError(
  res: Response,
  status: number,
  body: Record<string, unknown>,
): void {
  res.status(status).json(body);
}

/**
 * The factory above is the public surface, but tests sometimes want the
 * tool-dispatch loop in isolation. Re-export for that. Acceptable as
 * package-private; callers outside the test suite should use makeChatHandler.
 */
export { runChatLoop };

/**
 * Convenience for callers that need to know whether the chat handler is
 * available without trying to construct it. Mirrors the cascade-undefined
 * pattern in /api/lookup/*.
 */
export function isChatConfigured(apiKey: string | undefined): boolean {
  return apiKey !== undefined && apiKey.trim() !== "";
}

// Re-export ContentBlockParam so server/index.ts can build the
// configuration_missing fallback handler without a deeper SDK import.
export type { ContentBlockParam, MessageParam };
