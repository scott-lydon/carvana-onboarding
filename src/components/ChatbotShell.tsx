/**
 * ChatbotShell — the primary entry surface.
 *
 * Owns the chat history and renders user / assistant bubbles plus inline
 * tool_result cards (vehicle card, support card, demo-mode panel). The
 * assistant bubble body is markdown-rendered (react-markdown with a
 * tight allowlist) so the model's `**bold**` / `code` / lists render
 * the way the model wrote them.
 *
 * Three side surfaces are mounted in a unified CTA row below the
 * composer: "Scan VIN with camera", "or upload a photo", "Schedule
 * pickup". The OCR + Scheduler bodies are hook-based so their CTAs sit
 * next to each other and their expanded panels stack below.
 *
 * Drag-and-drop: the entire chat root catches dragenter/dragover/drop
 * and routes a dropped image through the OCR pipeline.
 *
 * Chat error UX: failures surface the actual HTTP status code (or the
 * underlying TypeError on a Safari mid-stream drop) rather than a
 * generic "Load failed". 503 configuration_missing messages render
 * verbatim so the user sees the missing env var name.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import { flushSync } from "react-dom";
import type { FormEvent, JSX, KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";

void flushSync;
import { EntryForm } from "./EntryForm.tsx";
import { HiddenOcrFileInput, useOcrCapture } from "./OcrCapture.tsx";
import { useScheduler, type PickupAddress } from "./Scheduler.tsx";
import { NpsSurvey } from "./NpsSurvey.tsx";
import { MetricsOverlay } from "./MetricsOverlay.tsx";
import { ProgressBar, type ProgressPhase } from "./ProgressBar.tsx";

type ChatRole = "user" | "assistant";
type ChatMessageBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };
interface ChatMessage {
  role: ChatRole;
  content: string | ChatMessageBlock[];
}

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

type SseEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; tool_use_id: string; name: string }
  | { type: "tool_result"; tool_use_id: string; name: string; result: unknown }
  | { type: "history_sync"; messages: ChatMessage[] }
  | { type: "done"; stop_reason: string }
  | { type: "error"; message: string };

interface ResolvedVehicle {
  year: number;
  make: string;
  model: string;
  trim?: string;
  bodyStyle?: string;
  /** State / region the cascade attached, if any. Used to default the address state. */
  state?: string;
}

interface ResolvedLookupView {
  kind: "resolved";
  vehicle: ResolvedVehicle;
  /** Plate-side lookups carry the searched state under root.state on the wire. */
  state?: string;
}

const GREETING_TEXT =
  "Hi — I'm here to help you sell your car. What's your license plate, and what state is it from?";

/** Phases for the chat SSE pipeline. */
const CHAT_PHASES: readonly ProgressPhase[] = [
  { id: "reading", label: "Reading your message" },
  { id: "lookup", label: "Calling vehicle lookup" },
  { id: "draft", label: "Drafting reply" },
  { id: "final", label: "Finalizing" },
];

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
  const [chatPhase, setChatPhase] = useState<ProgressPhase["id"]>("reading");

  // Authoritative wire history. Built from `turns` on every send and
  // overwritten by `history_sync` SSE events so multi-turn conversation
  // works. Stored in a ref to avoid stale-closure bugs.
  const historyRef = useRef<ChatMessage[]>([]);

  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  // Stable session id used as userId on /api/schedule/book and as
  // sessionId on /api/nps/submit.
  const chatSessionId = useMemo(
    () => `chat-${Math.random().toString(36).slice(2, 12)}`,
    [],
  );

  const [firstUserMessageAt, setFirstUserMessageAt] = useState<number | null>(
    null,
  );
  const [npsPromptVisible, setNpsPromptVisible] = useState<boolean>(false);
  const [npsSubmitted, setNpsSubmitted] = useState<boolean>(false);
  const [isFocused, setIsFocused] = useState<boolean>(false);

  // Computed lazily at NPS submit time. No live ticker (anti-UX per
  // user feedback).
  const computeElapsedSeconds = useCallback(
    (): number =>
      firstUserMessageAt === null
        ? 0
        : Math.max(0, Math.round((Date.now() - firstUserMessageAt) / 1000)),
    [firstUserMessageAt],
  );

  // Tracks the latest resolved vehicle so the DemoModePanel can render
  // beneath the matching vehicle card AND so the scheduler can default
  // its address state from the lookup result. Kept as the LATEST
  // tool_result rather than per-card so multiple lookups in one chat
  // don't double-render the demo panel.
  const [latestVehicle, setLatestVehicle] = useState<ResolvedLookupView | null>(
    null,
  );

  // Auto-scroll the chat to the latest turn after each render.
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [turns]);

  const sendMessage = useCallback(
    async (userText: string): Promise<void> => {
      const trimmed = userText.trim();
      if (trimmed === "" && !isStreaming) {
        flushSync(() => {
          setChatError("Type a message before sending.");
        });
        return;
      }
      if (isStreaming) {
        return;
      }
      setChatError(null);
      setDraft("");

      if (firstUserMessageAt === null) {
        setFirstUserMessageAt(Date.now());
      }
      if (trimmed.startsWith("Pickup booked:") && !npsSubmitted) {
        setNpsPromptVisible(true);
      }

      const nextUserTurn: UiTurn = { kind: "user", text: trimmed };
      const nextAssistantTurn: UiTurn = {
        kind: "assistant",
        text: "",
        toolCards: [],
        complete: false,
      };
      setTurns((prev) => [...prev, nextUserTurn, nextAssistantTurn]);

      historyRef.current = [
        ...historyRef.current,
        { role: "user", content: trimmed },
      ];

      setChatPhase("reading");
      setIsStreaming(true);
      try {
        await streamChatResponse({
          messages: historyRef.current,
          onPhase: (phase) => {
            setChatPhase(phase);
          },
          onEvent: (event) => {
            if (event.type === "history_sync") {
              historyRef.current = event.messages;
              return;
            }
            if (event.type === "tool_result") {
              if (
                (event.name === "lookup_plate" ||
                  event.name === "lookup_vin") &&
                isResolvedLookup(event.result)
              ) {
                setLatestVehicle(event.result);
              }
            }
            applySseEventToTurns(event, setTurns);
          },
        });
      } catch (err) {
        const message = errorToUserMessage(err);
        setChatError(message);
        setTurns((prev) => markLastAssistantComplete(prev));
      } finally {
        setIsStreaming(false);
      }
    },
    [isStreaming, firstUserMessageAt, npsSubmitted],
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

  // OCR hook drives the camera + upload + drag-drop pipelines.
  const onVinScanned = useCallback(
    (vin: string): void => {
      void sendMessage(`Scanned VIN: ${vin}`);
    },
    [sendMessage],
  );
  const ocr = useOcrCapture(onVinScanned);

  // Default the scheduler address state from the latest resolved
  // vehicle's state, if present. Falls back to TX for the demo cohort.
  const defaultAddress = useMemo<Partial<PickupAddress>>(() => {
    const state = latestVehicle?.state ?? latestVehicle?.vehicle.state;
    return state !== undefined ? { state } : {};
  }, [latestVehicle]);

  const onPickupBooked = useCallback(
    (args: {
      displayLabel: string;
      scope: string;
      address: PickupAddress;
    }): void => {
      // Inject the booking confirmation as a user message so the
      // chatbot can continue the flow. The full address stays inside
      // the Scheduler's confirmation panel — we do NOT echo it back
      // into the chat history (PII-out-of-text rule from
      // constitution.md non-negotiable #9). The chat sees the
      // displayLabel and scope only.
      void sendMessage(
        `Pickup booked: ${args.displayLabel} at ${args.scope}`,
      );
    },
    [sendMessage],
  );

  const scheduler = useScheduler({
    userId: chatSessionId,
    onPickupBooked,
    defaultAddress,
  });

  // Drag-and-drop on the entire chat root. dragover MUST preventDefault
  // to keep the browser from navigating to the dropped image's URL.
  const [dragActive, setDragActive] = useState<boolean>(false);
  const dragDepthRef = useRef<number>(0);

  const isImageFile = (file: File): boolean => file.type.startsWith("image/");

  const onDragEnter = useCallback(
    (event: ReactDragEvent<HTMLDivElement>): void => {
      // Only activate for actual file drags (not text selections).
      const items = event.dataTransfer.items;
      if (items.length === 0) return;
      // DataTransferItemList is iterable in modern browsers; spread to
      // an array so we can use the lint-preferred for-of form.
      const itemsArr = Array.from(items);
      const hasFile = itemsArr.some((item) => item.kind === "file");
      if (!hasFile) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    },
    [],
  );
  const onDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>): void => {
      // preventDefault here is what keeps the browser from opening the
      // file when the user drops; without it the drop event never fires.
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [],
  );
  const onDragLeave = useCallback(
    (_event: ReactDragEvent<HTMLDivElement>): void => {
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    },
    [],
  );
  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      const files = event.dataTransfer.files;
      if (files.length === 0) return;
      const file = files[0];
      if (file === undefined) return;
      if (!isImageFile(file)) {
        setChatError(
          `Dropped file isn't an image (got ${file.type || "unknown type"}). Drop a JPG, PNG, HEIC, or AVIF.`,
        );
        return;
      }
      ocr.controls.submitImageFile(file);
    },
    [ocr.controls],
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
    <div
      style={{ ...chatRootStyle, position: "relative" }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <style>{`
        .vouch-mobile-only { display: none; }
        @media (max-width: 480px) {
          .vouch-mobile-only { display: inline; }
        }
      `}</style>
      <div
        className={dragActive ? "drop-overlay active" : "drop-overlay"}
        aria-hidden={!dragActive}
      >
        Drop your VIN photo here
      </div>
      <div style={headerStyle}>
        <span>
          Carvana Onboarding Recovery Layer — chat
          <span
            className="vouch-mobile-only"
            style={{ marginLeft: 6, color: "#475569" }}
          >
            · compact mobile layout
          </span>
        </span>
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
          <TurnView
            key={idx}
            turn={turn}
            showDemoPanel={
              latestVehicle !== null &&
              turn.kind === "assistant" &&
              turn.toolCards.some(
                (c) =>
                  (c.name === "lookup_plate" || c.name === "lookup_vin") &&
                  isResolvedLookup(c.result),
              )
            }
          />
        ))}
        {isStreaming ? (
          <div style={progressInTranscriptStyle}>
            <ProgressBar
              phases={CHAT_PHASES}
              activePhaseId={chatPhase}
              ariaLabel="Chat progress"
            />
          </div>
        ) : null}
        {chatError !== null ? (
          <div style={chatErrorStyle} role="alert">
            {chatError.startsWith("Type a message")
              ? chatError
              : `Chat error: ${chatError}`}
          </div>
        ) : null}
        <div ref={scrollAnchorRef} />
      </div>

      <form onSubmit={handleSubmit} style={composerStyle}>
        <textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (chatError?.startsWith("Type a message") === true) {
              setChatError(null);
            }
          }}
          onKeyDown={handleTextareaKeyDown}
          onFocus={() => {
            setIsFocused(true);
          }}
          onBlur={() => {
            setIsFocused(false);
          }}
          placeholder={
            isStreaming
              ? "(chatbot is replying...)"
              : isFocused
                ? "Keyboard ready — type your plate and state"
                : 'Type your plate and state, like "XRJ4041 in Texas"'
          }
          disabled={isStreaming}
          rows={2}
          style={textareaStyle}
          aria-label={isFocused ? "Chat message (focused)" : "Chat message"}
        />
        <button
          type="submit"
          disabled={isStreaming}
          style={
            draft.trim() === "" && !isStreaming
              ? sendButtonEmptyStyle
              : sendButtonStyle
          }
          title={
            draft.trim() === ""
              ? "Type a message first"
              : isStreaming
                ? "Waiting for the assistant..."
                : "Send"
          }
        >
          {isStreaming ? (
            <>
              <span className="spinner" /> Sending
            </>
          ) : (
            "Send"
          )}
        </button>
      </form>
      {isFocused ? (
        <div style={focusCaptionStyle} aria-live="polite">
          Active typing area — press Enter to send. You can also drop a VIN
          photo anywhere in the chat.
        </div>
      ) : null}

      {/* Unified CTA row: three balanced buttons. The expanded OCR /
          scheduler panels render below the row, full-width. */}
      <HiddenOcrFileInput inputRef={ocr.fileInputRef} />
      <div className="cta-row" aria-label="Onboarding actions">
        <button
          type="button"
          className="cta cta-primary"
          onClick={ocr.controls.openCamera}
          disabled={ocr.busy}
          aria-label="Scan VIN with camera"
        >
          Scan VIN with camera
        </button>
        <button
          type="button"
          className="cta cta-ghost"
          onClick={ocr.controls.openFilePicker}
          disabled={ocr.busy}
          aria-label="Upload photo of VIN"
        >
          Upload a photo
        </button>
        <button
          type="button"
          className="cta cta-ghost"
          onClick={scheduler.open}
          disabled={scheduler.busy}
          aria-label="Schedule pickup"
        >
          Schedule pickup
        </button>
      </div>
      {ocr.panel}
      {scheduler.panel}

      {npsPromptVisible ? (
        <NpsSurvey
          sessionId={chatSessionId}
          getElapsedSeconds={computeElapsedSeconds}
          onSubmitted={() => {
            setNpsSubmitted(true);
          }}
        />
      ) : null}
      <MetricsOverlay />
    </div>
  );
}

/**
 * Renders a single turn. Assistant text flows through ReactMarkdown
 * with a tight allowlist; user turns render plain text.
 */
function TurnView({
  turn,
  showDemoPanel,
}: {
  turn: UiTurn;
  showDemoPanel: boolean;
}): JSX.Element {
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
        {turn.text === "" && !turn.complete ? (
          <em>...</em>
        ) : (
          <MarkdownView body={turn.text} />
        )}
      </div>
      {turn.toolCards.map((card) => (
        <ToolResultCard key={card.toolUseId} card={card} />
      ))}
      {showDemoPanel ? <DemoModePanel /> : null}
    </div>
  );
}

/**
 * Markdown renderer with a tight allowlist. The model only emits a
 * small set of formatting (bold, italic, links, inline code, lists);
 * HTML passthrough is disabled by react-markdown's defaults so a
 * malicious tool_result body cannot inject markup. Links open in a new
 * tab with noopener so a redirect target can't access window.opener.
 */
function MarkdownView({ body }: { body: string }): JSX.Element {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        components={{
          // Open every assistant-emitted link in a new tab safely.
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
        // Block raw HTML; only markdown-derived nodes render. The
        // allowedElements list keeps the surface minimal.
        allowedElements={[
          "p",
          "br",
          "strong",
          "em",
          "a",
          "code",
          "pre",
          "ul",
          "ol",
          "li",
          "blockquote",
        ]}
        unwrapDisallowed
        skipHtml
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Demo-mode notice rendered below the vehicle card when a lookup
 * resolves. Makes clear to the user that the offer engine is not wired
 * into this prototype and explains what the flow actually accomplishes.
 */
function DemoModePanel(): JSX.Element {
  return (
    <div className="demo-mode-panel" role="status">
      <strong>Demo mode</strong>
      In production this would show your instant offer. The instant-offer
      engine isn&rsquo;t wired into this prototype. The flow you can complete
      here ends with a confirmed pickup booking.
    </div>
  );
}

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
  if (card.name === "get_support_content" && isSupportContent(result)) {
    return (
      <div style={supportCardStyle}>
        <strong style={{ fontSize: 14 }}>{result.title}</strong>
        <div style={{ marginTop: 4 }}>{result.body}</div>
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

function isSupportContent(
  value: unknown,
): value is { kind: "support_content"; title: string; body: string } {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.kind === "support_content" &&
    typeof obj.title === "string" &&
    typeof obj.body === "string"
  );
}

function isResolvedLookup(value: unknown): value is ResolvedLookupView {
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

/**
 * POST to /api/chat and parse the SSE stream. Calls `onEvent` for each
 * complete SSE record and `onPhase` at real waypoints in the lifecycle:
 *   - "reading"  → before fetch
 *   - "lookup"   → first tool_use_start
 *   - "draft"    → first text_delta
 *   - "final"    → done event
 * Throws on non-2xx responses or malformed JSON in the stream. The
 * thrown Error.message carries the HTTP status / response text so
 * `errorToUserMessage` can surface it precisely.
 */
async function streamChatResponse(args: {
  messages: ChatMessage[];
  onEvent: (event: SseEvent) => void;
  onPhase: (phase: ProgressPhase["id"]) => void;
}): Promise<void> {
  // Render free-tier dyno sleeps after ~15 min idle. The first request
  // after sleep usually fails at the TCP / TLS layer because Cloudflare
  // cannot reach the dyno during the 30–60s cold-start window. The
  // browser surfaces that as `TypeError: Load failed` (Safari) or
  // `TypeError: Failed to fetch` (Chrome/Firefox), which the user
  // (rightly) experienced as "works then fails then works then fails".
  //
  // Retry the INITIAL fetch only — once we have a response (any HTTP
  // status), we surface the body verbatim, because retrying 4xx/5xx
  // would mask real backend errors. Phase callback flips to "reading"
  // with an explicit cold-start hint so the user sees the retry happen
  // rather than a frozen UI.
  const RETRY_DELAYS_MS = [1000, 3000, 7000]; // total ≤ 11s extra wait
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: args.messages }),
      });
      break;
    } catch (err) {
      // Only retry network-level errors (TypeError from fetch). Anything
      // else is a programming bug we should surface as-is.
      const isNetworkError = err instanceof TypeError;
      const delay = RETRY_DELAYS_MS[attempt];
      if (!isNetworkError || delay === undefined) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Network request to /api/chat failed (${msg}). The server may be cold-starting — wait 30 seconds and try again. If it keeps failing, check your connection.`,
        );
      }
      args.onPhase("reading");
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  if (!response.ok) {
    // Try to read a structured JSON body for the precise reason
    // (typically configuration_missing with a signup URL). Falls back
    // to the raw response text + the HTTP status code so the user sees
    // SOMETHING actionable rather than a generic "Load failed".
    let detail = `HTTP ${String(response.status)}`;
    try {
      const text = await response.text();
      try {
        const body = JSON.parse(text) as { message?: unknown };
        if (typeof body.message === "string") {
          detail = body.message;
        } else {
          detail = `HTTP ${String(response.status)} — ${text.slice(0, 240)}`;
        }
      } catch {
        detail = `HTTP ${String(response.status)} — ${text.slice(0, 240) || response.statusText}`;
      }
    } catch {
      // body read failed; keep "HTTP <status>"
    }
    throw new Error(detail);
  }
  if (response.body === null) {
    throw new Error("Chat response had no body to stream.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawToolUse = false;
  let sawDelta = false;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Chat stream was interrupted (${msg}). Try again — your typed message is still in history.`,
      );
    }
    const { done, value } = chunk;
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
        throw new Error(
          `Malformed SSE event from /api/chat: ${json.slice(0, 120)}`,
        );
      }
      if (parsed.type === "tool_use_start" && !sawToolUse) {
        sawToolUse = true;
        args.onPhase("lookup");
      } else if (parsed.type === "text_delta" && !sawDelta) {
        sawDelta = true;
        args.onPhase("draft");
      } else if (parsed.type === "done") {
        args.onPhase("final");
      }
      args.onEvent(parsed);
    }
    if (done) {
      return;
    }
  }
}

/**
 * Translate a thrown error into a user-facing chat-error string.
 * Safari surfaces "Load failed" as the bare TypeError message on a
 * mid-stream drop; we rewrap that with the actionable next step.
 */
function errorToUserMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.trim();
    if (msg === "" || msg === "Load failed" || msg === "Failed to fetch") {
      return `${msg || "Network error"} — Safari sometimes drops streaming responses when the tab loses focus. Try again, or use the form fallback.`;
    }
    return msg;
  }
  return "Unknown error from the chat service.";
}

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

function markLastAssistantComplete(turns: UiTurn[]): UiTurn[] {
  const next = [...turns];
  const lastIdx = next.length - 1;
  const last = next[lastIdx];
  if (last?.kind === "assistant" && !last.complete) {
    next[lastIdx] = { ...last, complete: true };
  }
  return next;
}

// ---------- inline styles tuned for the light Carvana-inspired theme.

const chatRootStyle: React.CSSProperties = {
  width: "min(720px, calc(100vw - 24px))",
  margin: "32px auto",
  padding: 16,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  color: "#0f2747",
  boxSizing: "border-box",
};
const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontSize: 13,
  color: "#475569",
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
  background: "#ffffff",
  boxShadow: "0 1px 3px rgba(15,39,71,0.06)",
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
  background: "#f8fafc",
  color: "#0f2747",
  padding: "10px 14px",
  borderRadius: 12,
  maxWidth: "85%",
  border: "1px solid #e5e7eb",
};
const vehicleCardStyle: React.CSSProperties = {
  background: "#ecfdf5",
  border: "1px solid #6ee7b7",
  color: "#065f46",
  padding: "10px 12px",
  borderRadius: 10,
  maxWidth: "85%",
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
  color: "#0f2747",
  padding: "8px 12px",
  borderRadius: 10,
  maxWidth: "85%",
  fontSize: 13,
};
const supportCardStyle: React.CSSProperties = {
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  color: "#1e3a8a",
  padding: "10px 14px",
  borderRadius: 10,
  maxWidth: "85%",
  fontSize: 13,
  lineHeight: 1.45,
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
  padding: 10,
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  resize: "vertical",
  fontFamily: "inherit",
  color: "#0f2747",
  background: "#ffffff",
};
const sendButtonStyle: React.CSSProperties = {
  background: "#2563eb",
  color: "white",
  border: "none",
  padding: "10px 18px",
  borderRadius: 8,
  fontSize: 14,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};
const sendButtonEmptyStyle: React.CSSProperties = {
  background: "#cbd5e1",
  color: "#475569",
  border: "none",
  padding: "10px 18px",
  borderRadius: 8,
  fontSize: 14,
  cursor: "not-allowed",
};
const focusCaptionStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#475569",
  marginTop: 4,
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
const progressInTranscriptStyle: React.CSSProperties = {
  marginTop: 8,
};
