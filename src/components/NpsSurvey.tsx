/**
 * NpsSurvey — v2 slice E micro-survey rendered after a pickup booking.
 *
 * 0-10 score buttons (Bain standard: 0-6 detractor, 7-8 passive,
 * 9-10 promoter) + optional free-text "What's the one thing that would
 * make this better?" + submit.
 *
 * Reads `elapsedSeconds` from a prop (ChatbotShell records the time the
 * user sent their first message and computes elapsed on render).
 *
 * On submit, POSTs to /api/nps/submit and renders a thank-you state.
 * The result feeds /api/nps/summary which the MetricsOverlay polls.
 */
import { useState } from "react";
import type { JSX } from "react";

export interface NpsSurveyProps {
  sessionId: string;
  /** Wall-clock seconds since the user sent their first chat message. */
  elapsedSeconds: number;
  /** Called after a successful submission. Parent typically hides the survey. */
  onSubmitted: () => void;
}

type SurveyState =
  | { kind: "idle"; score: number | null; comment: string }
  | { kind: "submitting" }
  | { kind: "thanks" }
  | { kind: "error"; message: string };

export function NpsSurvey({
  sessionId,
  elapsedSeconds,
  onSubmitted,
}: NpsSurveyProps): JSX.Element {
  const [state, setState] = useState<SurveyState>({
    kind: "idle",
    score: null,
    comment: "",
  });

  const handleSubmit = async (): Promise<void> => {
    if (state.kind !== "idle" || state.score === null) return;
    setState({ kind: "submitting" });
    try {
      const response = await fetch("/api/nps/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          score: state.score,
          comment: state.comment.trim(),
          elapsedSeconds,
        }),
      });
      if (response.status !== 200) {
        const body = (await response.json()) as Record<string, unknown>;
        throw new Error(
          typeof body.reason === "string"
            ? body.reason
            : `Submit failed (status ${String(response.status)})`,
        );
      }
      setState({ kind: "thanks" });
      onSubmitted();
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Submit failed",
      });
    }
  };

  if (state.kind === "thanks") {
    return (
      <div style={panelStyle} data-testid="nps-thanks">
        <strong style={{ fontSize: 14 }}>Thanks for the feedback.</strong>
        <div style={subTextStyle}>
          That took {formatElapsed(elapsedSeconds)} from your first message to
          pickup booked.
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle} data-testid="nps-survey">
      <strong style={{ fontSize: 14 }}>
        How likely are you to recommend this to a friend?
      </strong>
      <div style={subTextStyle}>
        0 = not at all, 10 = extremely. Your answer helps us improve.
      </div>
      <div style={scoreRowStyle} role="group" aria-label="NPS score 0 to 10">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            onClick={() => {
              if (state.kind === "idle") {
                setState({ ...state, score: n });
              }
            }}
            style={
              state.kind === "idle" && state.score === n
                ? selectedScoreStyle
                : scoreButtonStyle
            }
            aria-pressed={state.kind === "idle" && state.score === n}
            data-testid={`nps-score-${String(n)}`}
          >
            {n}
          </button>
        ))}
      </div>
      <textarea
        value={state.kind === "idle" ? state.comment : ""}
        onChange={(e) => {
          if (state.kind === "idle") {
            setState({ ...state, comment: e.target.value });
          }
        }}
        placeholder="What's the one thing that would make this better? (optional)"
        rows={2}
        style={commentStyle}
        disabled={state.kind !== "idle"}
        data-testid="nps-comment"
      />
      <div style={footerStyle}>
        <span style={elapsedStyle}>
          Elapsed: {formatElapsed(elapsedSeconds)}
        </span>
        <button
          type="button"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={
            state.kind !== "idle" ||
            state.score === null ||
            state.kind === ("submitting" as SurveyState["kind"])
          }
          style={submitButtonStyle}
          data-testid="nps-submit"
        >
          {state.kind === "submitting" ? "Submitting..." : "Submit"}
        </button>
      </div>
      {state.kind === "error" ? (
        <div style={errorStyle} role="alert">
          {state.message}
        </div>
      ) : null}
    </div>
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${String(Math.round(seconds))} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m)} min ${String(s).padStart(2, "0")} s`;
}

const panelStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 14,
  border: "1px solid #c7d2fe",
  borderRadius: 12,
  background: "#eef2ff",
  color: "#1e1b4b",
};
const subTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
  marginTop: 2,
};
const scoreRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  margin: "10px 0",
};
const scoreButtonStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 6,
  border: "1px solid #c7d2fe",
  background: "white",
  cursor: "pointer",
  fontSize: 13,
};
const selectedScoreStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 6,
  border: "1px solid #4f46e5",
  background: "#4f46e5",
  color: "white",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
};
const commentStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 13,
  padding: 8,
  borderRadius: 8,
  border: "1px solid #c7d2fe",
  fontFamily: "inherit",
  boxSizing: "border-box",
  resize: "vertical",
};
const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginTop: 8,
};
const elapsedStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
};
const submitButtonStyle: React.CSSProperties = {
  background: "#4f46e5",
  color: "white",
  border: "none",
  padding: "8px 14px",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
};
const errorStyle: React.CSSProperties = {
  marginTop: 8,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  padding: "6px 10px",
  borderRadius: 6,
  fontSize: 13,
};
