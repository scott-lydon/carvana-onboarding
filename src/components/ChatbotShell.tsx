/**
 * ChatbotShell — the v2 primary entry surface.
 *
 * Owns the chat history and renders one of three things per turn:
 *   - A user bubble (right-aligned).
 *   - An assistant bubble (left-aligned) carrying streamed text plus any
 *     tool_use cards (vehicle data, scheduler, support content, etc.).
 *   - An inline tool_result card next to the assistant bubble that
 *     triggered it. The card is the structured rendering of the tool's
 *     output; the assistant's text never repeats PII (constitution
 *     non-negotiable #9, CAT-11).
 *
 * Streaming uses fetch + ReadableStream (no EventSource library, per
 * plan.md v2 decision). Each `data: {...}` line in the response is parsed
 * incrementally; partial lines stay in the buffer until the next `\n\n`.
 *
 * Pre-bake the greeting client-side so the first paint is instant — the
 * server isn't called until the user sends their first message.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, JSX, KeyboardEvent } from "react";
import { EntryForm } from "./EntryForm.tsx";

/**
 * Anthropic message shape that the server expects in the POST body. We
 * mirror the SDK's MessageParam loosely (content can be a string for user
 * turns, or an array of blocks for assistant turns with tool_use).
 */
type ChatRole = "user" | "assistant";
type ChatMessageBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };
interface ChatMessage {
  role: ChatRole;
  content: string | ChatMessageBlock[];
}

/**
 * UI-side view model. We keep this distinct from the wire ChatMessage so
 * the renderer can track per-turn streaming progress without mutating the
 * canonical history.
 */
type UiTurn =
  | { kind: "user"; text: string }
  | {
      kind: "assistant";
      text: string;
      toolCards: ToolCard[];
      complete: boolean;
    };

interface ToolCard {
  toolUseId: string;
  name: string;
  result: unknown;
}

/**
 * Server-Sent-Events shapes emitted by /api/chat. Mirrors the writeSseEvent
 * payloads in server/routes/chat.ts.
 */
type SseEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; tool_use_id: string; name: string }
  | { type: "tool_result"; tool_use_id: string; name: string; result: unknown }
  | { type: "history_sync"; messages: ChatMessage[] }
  | { type: "done"; stop_reason: string }
  | { type: "error"; message: string };

const GREETING_TEXT =
  "Hi — I'm here to help you sell your car. What's your license plate, and what state is it from?";

/**
 * Slice A primary entry surface. Renders the chat by default; offers a
 * "prefer a form?" link that swaps to the EntryForm (slice 1 surface).
 */
export function ChatbotShell(): JSX.Element {
  const [useForm, setUseForm] = useState<boolean>(false);
  const [turns, setTurns] = useState<UiTurn[]>([
    {
      kind: "assistant",
      text: GREETING_TEXT,
      toolCards: [],
      complete: true,
    },
  ]);
  const [draft, setDraft] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Wire history is the authoritative server-facing record. We build it
  // from `turns` on every send. Keeping a parallel ref avoids stale-closure
  // bugs when the streaming callback wants to push the assistant turn back
  // into history at the end of the stream.
  const historyRef = useRef<ChatMessage[]>([]);

  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the chat to the latest turn after each render.
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const sendMessage = useCallback(
    async (userText: string): Promise<void> => {
      const trimmed = userText.trim();
      if (trimmed === "" || isStreaming) {
        return;
      }
      setChatError(null);
      setDraft("");

      // Append the user turn to the UI immediately so the user sees their
      // own message without waiting for the server.
      const nextUserTurn: UiTurn = { kind: "user", text: trimmed };
      // Add a placeholder assistant turn we will mutate as the stream
      // arrives. The `complete: false` flag drives the typing indicator.
      const nextAssistantTurn: UiTurn = {
        kind: "assistant",
        text: "",
        toolCards: [],
        complete: false,
      };
      setTurns((prev) => [...prev, nextUserTurn, nextAssistantTurn]);

      // Build the wire history. The server's system prompt is server-side;
      // we only send role-tagged content.
      historyRef.current = [
        ...historyRef.current,
        { role: "user", content: trimmed },
      ];

      setIsStreaming(true);
      try {
        await streamChatResponse({
          messages: historyRef.current,
          onEvent: (event) => {
            // history_sync carries the FULL Anthropic-shaped messages
            // array from the server (user turn + assistant turn + any
            // tool_result blocks). Replacing historyRef with it is what
            // makes multi-turn conversation work — without this the
            // second user message would be sent without prior-turn
            // context and the chatbot would behave as if turn 1 never
            // happened. (Project CLAUDE.md "chatbot conversational
            // smoke test" rule, QA finding 2 on slice A.)
            if (event.type === "history_sync") {
              historyRef.current = event.messages;
              return;
            }
            applySseEventToTurns(event, setTurns);
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        setChatError(message);
        setTurns((prev) => markLastAssistantComplete(prev));
      } finally {
        setIsStreaming(false);
      }
    },
    [isStreaming],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      void sendMessage(draft);
    },
    [draft, sendMessage],
  );

  const handleTextareaKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void sendMessage(draft);
      }
    },
    [draft, sendMessage],
  );

  if (useForm) {
    return (
      <div style={chatRootStyle}>
        <div style={headerStyle}>
          <span>Carvana Onboarding Recovery Layer — form mode</span>
          <button
            type="button"
            onClick={() => {
              setUseForm(false);
            }}
            style={fallbackLinkStyle}
          >
            ← back to chat
          </button>
        </div>
        <EntryForm />
      </div>
    );
  }

  return (
    <div style={chatRootStyle}>
      <div style={headerStyle}>
        <span>Carvana Onboarding Recovery Layer — chat (v2 slice A)</span>
        <button
          type="button"
          onClick={() => {
            setUseForm(true);
          }}
          style={fallbackLinkStyle}
        >
          prefer a form? →
        </button>
      </div>

      <div style={transcriptStyle} aria-live="polite">
        {turns.map((turn, idx) => (
          <TurnView key={idx} turn={turn} />
        ))}
        {chatError !== null ? (
          <div style={chatErrorStyle} role="alert">
            Chat error: {chatError}. Refresh and try again, or use the form fallback.
          </div>
        ) : null}
        <div ref={scrollAnchorRef} />
      </div>

      <form onSubmit={handleSubmit} style={composerStyle}>
        <textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={handleTextareaKeyDown}
          placeholder={
            isStreaming
              ? "(chatbot is replying...)"
              : "Type your plate and state, like \"XRJ4041 in Texas\""
          }
          disabled={isStreaming}
          rows={2}
          style={textareaStyle}
          aria-label="Chat message"
        />
        <button
          type="submit"
          disabled={isStreaming || draft.trim() === ""}
          style={sendButtonStyle}
        >
          Send
        </button>
      </form>
    </div>
  );
}

/**
 * Renders a single turn (user bubble OR assistant bubble + tool cards).
 */
function TurnView({ turn }: { turn: UiTurn }): JSX.Element {
  if (turn.kind === "user") {
    return (
      <div style={userBubbleWrapStyle}>
        <div style={userBubbleStyle}>{turn.text}</div>
      </div>
    );
  }
  return (
    <div style={assistantBubbleWrapStyle}>
      <div style={assistantBubbleStyle}>
        {turn.text === "" && !turn.complete ? <em>...</em> : turn.text}
      </div>
      {turn.toolCards.map((card) => (
        <ToolResultCard key={card.toolUseId} card={card} />
      ))}
    </div>
  );
}

/**
 * Renders a tool_result inline next to the assistant message that
 * triggered it. lookup_plate / lookup_vin resolved results get a dedicated
 * vehicle card; everything else gets a generic "tool ran" badge with the
 * payload in a <details>.
 */
function ToolResultCard({ card }: { card: ToolCard }): JSX.Element {
  const result = card.result;
  if (
    (card.name === "lookup_plate" || card.name === "lookup_vin") &&
    isResolvedLookup(result)
  ) {
    const vehicle = result.vehicle;
    return (
      <div style={vehicleCardStyle}>
        <strong style={{ fontSize: 14 }}>Vehicle identified</strong>
        <div>
          {vehicle.year} {vehicle.make} {vehicle.model}
          {vehicle.trim !== undefined ? ` (${vehicle.trim})` : ""}
        </div>
        {vehicle.bodyStyle !== undefined ? (
          <div style={vehicleSubStyle}>{vehicle.bodyStyle}</div>
        ) : null}
      </div>
    );
  }
  return (
    <div style={genericToolCardStyle}>
      <strong style={{ fontSize: 13 }}>tool: {card.name}</strong>
      <details>
        <summary>show raw payload</summary>
        <pre style={preStyle}>{JSON.stringify(result, null, 2)}</pre>
      </details>
    </div>
  );
}

/**
 * Type guard for the resolved-lookup tool result. The shape mirrors
 * src/lookup/types.ts LookupResult kind="resolved".
 */
function isResolvedLookup(
  value: unknown,
): value is { kind: "resolved"; vehicle: ResolvedVehicle } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (obj.kind !== "resolved") {
    return false;
  }
  const vehicle = obj.vehicle;
  if (typeof vehicle !== "object" || vehicle === null) {
    return false;
  }
  const v = vehicle as Record<string, unknown>;
  return (
    typeof v.year === "number" &&
    typeof v.make === "string" &&
    typeof v.model === "string"
  );
}

interface ResolvedVehicle {
  year: number;
  make: string;
  model: string;
  trim?: string;
  bodyStyle?: string;
}

/**
 * POST to /api/chat and parse the SSE stream. Calls `onEvent` for each
 * complete SSE record. Throws on non-2xx responses or malformed JSON in
 * the stream so the caller can surface chatError.
 */
async function streamChatResponse(args: {
  messages: ChatMessage[];
  onEvent: (event: SseEvent) => void;
}): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: args.messages }),
  });
  if (!response.ok) {
    // 503 configuration_missing is the most common failure path; surface
    // the message body so the user sees the signup URL.
    let detail = `HTTP ${String(response.status)}`;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === "string") {
        detail = body.message;
      }
    } catch {
      // body wasn't JSON; keep the default detail
    }
    throw new Error(detail);
  }
  if (response.body === null) {
    throw new Error("Chat response had no body to stream.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Read loop. Each `data: {...}` record is separated by a blank line.
  // We accumulate into `buffer` and split on `\n\n`; the last fragment is
  // a (possibly partial) record we keep for the next chunk.
  for (;;) {
    const { done, value } = await reader.read();
    buffer += value !== undefined ? decoder.decode(value, { stream: true }) : "";
    const records = buffer.split("\n\n");
    buffer = records.pop() ?? "";
    for (const record of records) {
      const line = record.trim();
      if (line === "" || !line.startsWith("data:")) {
        continue;
      }
      const json = line.slice("data:".length).trim();
      let parsed: SseEvent;
      try {
        parsed = JSON.parse(json) as SseEvent;
      } catch {
        throw new Error(`Malformed SSE event from /api/chat: ${json.slice(0, 120)}`);
      }
      args.onEvent(parsed);
    }
    if (done) {
      return;
    }
  }
}

/**
 * Apply one SSE event to the rolling assistant turn. Pure-ish: takes the
 * setter and produces the next state from the previous.
 */
function applySseEventToTurns(
  event: SseEvent,
  setTurns: React.Dispatch<React.SetStateAction<UiTurn[]>>,
): void {
  setTurns((prev) => {
    const next = [...prev];
    const lastIdx = next.length - 1;
    const last = next[lastIdx];
    if (last?.kind !== "assistant") {
      return prev;
    }
    switch (event.type) {
      case "text_delta":
        next[lastIdx] = { ...last, text: last.text + event.text };
        return next;
      case "tool_use_start":
        // We don't render a card until the result arrives; the start event
        // is informational. A future slice can render a spinner here.
        return next;
      case "tool_result":
        next[lastIdx] = {
          ...last,
          toolCards: [
            ...last.toolCards,
            {
              toolUseId: event.tool_use_id,
              name: event.name,
              result: event.result,
            },
          ],
        };
        return next;
      case "history_sync":
        // history_sync is handled at the streamChatResponse layer (it
        // updates historyRef); the UI turn list is independent of the
        // wire history. No UI change here.
        return prev;
      case "done":
        next[lastIdx] = { ...last, complete: true };
        return next;
      case "error":
        next[lastIdx] = {
          ...last,
          complete: true,
          text: last.text + `\n\n[chat error: ${event.message}]`,
        };
        return next;
    }
  });
}

/**
 * If the stream errors mid-flight, the placeholder assistant turn stays
 * in `complete: false`. This stamp fixes that so the typing indicator
 * goes away.
 */
function markLastAssistantComplete(turns: UiTurn[]): UiTurn[] {
  const next = [...turns];
  const lastIdx = next.length - 1;
  const last = next[lastIdx];
  if (last?.kind === "assistant" && !last.complete) {
    next[lastIdx] = { ...last, complete: true };
  }
  return next;
}

// ---------- inline styles (we ship plain CSS-in-JS in slice A to avoid a
// theming refactor; a slice G polish pass can migrate to CSS modules or
// a design-system primitive). Colors mirror the existing EntryForm.

const chatRootStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: "32px auto",
  padding: 16,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  color: "#1a1a1a",
};
const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontSize: 13,
  color: "#6b7280",
  marginBottom: 12,
};
const fallbackLinkStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#2563eb",
  cursor: "pointer",
  fontSize: 13,
};
const transcriptStyle: React.CSSProperties = {
  minHeight: 360,
  maxHeight: 540,
  overflowY: "auto",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  background: "#fafafa",
};
const userBubbleWrapStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  margin: "8px 0",
};
const userBubbleStyle: React.CSSProperties = {
  background: "#2563eb",
  color: "white",
  padding: "8px 12px",
  borderRadius: 12,
  maxWidth: "75%",
  whiteSpace: "pre-wrap",
};
const assistantBubbleWrapStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  margin: "8px 0",
  gap: 6,
};
const assistantBubbleStyle: React.CSSProperties = {
  background: "white",
  color: "#1a1a1a",
  padding: "8px 12px",
  borderRadius: 12,
  maxWidth: "75%",
  border: "1px solid #e5e7eb",
  whiteSpace: "pre-wrap",
};
const vehicleCardStyle: React.CSSProperties = {
  background: "#ecfdf5",
  border: "1px solid #6ee7b7",
  color: "#065f46",
  padding: "10px 12px",
  borderRadius: 10,
  maxWidth: "75%",
  fontSize: 14,
};
const vehicleSubStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#047857",
  marginTop: 2,
};
const genericToolCardStyle: React.CSSProperties = {
  background: "#f3f4f6",
  border: "1px solid #d1d5db",
  padding: "8px 12px",
  borderRadius: 10,
  maxWidth: "75%",
  fontSize: 13,
};
const preStyle: React.CSSProperties = {
  fontSize: 11,
  margin: 0,
  whiteSpace: "pre-wrap",
};
const composerStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 12,
};
const textareaStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 14,
  padding: 8,
  borderRadius: 8,
  border: "1px solid #d1d5db",
  resize: "vertical",
  fontFamily: "inherit",
};
const sendButtonStyle: React.CSSProperties = {
  background: "#2563eb",
  color: "white",
  border: "none",
  padding: "8px 16px",
  borderRadius: 8,
  fontSize: 14,
  cursor: "pointer",
};
const chatErrorStyle: React.CSSProperties = {
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  padding: "8px 12px",
  borderRadius: 8,
  marginTop: 8,
  fontSize: 13,
};
