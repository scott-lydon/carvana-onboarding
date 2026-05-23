/**
 * NpsSurvey — micro-survey rendered after a pickup booking.
 *
 * 1-5 score tiles (per UX feedback the 0-10 grid felt over-precise and
 * the tiles weren't visually labeled). Thresholds: 1-2 = detractor,
 * 3 = passive, 4-5 = promoter. NPS = ((promoters - detractors) / n) * 100,
 * same shape as the Bain definition — only the scale and bucket cutoffs
 * change.
 *
 * Elapsed wall-clock is computed lazily at submit via the parent's
 * `getElapsedSeconds()` callback so the server still receives the real
 * from-first-message-to-now value, but no live "Elapsed: X min Y s"
 * ticker is rendered to the user (anti-UX).
 */
import { useState } from "react";
import type { JSX } from "react";

export interface NpsSurveyProps {
  sessionId: string;
  /** Returns wall-clock seconds since the chat's first user message at call time. */
  getElapsedSeconds: () => number;
  /** Called after a successful submission. Parent typically hides the survey. */
  onSubmitted: () => void;
}

type SurveyState =
  | { kind: "idle"; score: number | null; comment: string }
  | { kind: "submitting" }
  | { kind: "thanks" }
  | { kind: "error"; message: string };

/** Score range. */
const MIN_SCORE = 1;
const MAX_SCORE = 5;
const SCORES: readonly number[] = Array.from(
  { length: MAX_SCORE - MIN_SCORE + 1 },
  (_, i) => i + MIN_SCORE,
);

export function NpsSurvey({
  sessionId,
  getElapsedSeconds,
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
          elapsedSeconds: getElapsedSeconds(),
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
      </div>
    );
  }

  return (
    <div style={panelStyle} data-testid="nps-survey">
      <strong style={{ fontSize: 14 }}>
        How likely are you to recommend this to a friend?
      </strong>
      <div style={subTextStyle}>
        1 = not at all, 5 = extremely. Your answer helps us improve.
      </div>
      <div
        style={scoreRowStyle}
        role="group"
        aria-label={`NPS score ${String(MIN_SCORE)} to ${String(MAX_SCORE)}`}
      >
        {SCORES.map((n) => {
          const selected = state.kind === "idle" && state.score === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => {
                if (state.kind === "idle") {
                  setState({ ...state, score: n });
                }
              }}
              style={selected ? selectedScoreStyle : scoreButtonStyle}
              aria-pressed={selected}
              aria-label={`Score ${String(n)} of ${String(MAX_SCORE)}`}
              data-testid={`nps-score-${String(n)}`}
            >
              {/* Visible number INSIDE every tile so the score grid is
                  legible at a glance, not only after selection. Selected
                  tiles bump the contrast via selectedScoreStyle. */}
              <span aria-hidden="true">{n}</span>
            </button>
          );
        })}
      </div>
      <div style={endLabelsRowStyle} aria-hidden="true">
        <span>Not at all</span>
        <span>Extremely likely</span>
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
          {state.kind === "submitting" ? (
            <>
              <span className="spinner" /> Submitting...
            </>
          ) : (
            "Submit"
          )}
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

const panelStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 14,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#ffffff",
  color: "#0f2747",
  boxShadow: "0 1px 3px rgba(15,39,71,0.06)",
};
const subTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
  marginTop: 2,
};
const scoreRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  margin: "12px 0 4px",
};
const scoreButtonStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  cursor: "pointer",
  // Muted gray number inside each tile until it's chosen.
  color: "#64748b",
  fontSize: 16,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
const selectedScoreStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 8,
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: 16,
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
const endLabelsRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 11,
  color: "#475569",
  // Width matches the tile row (5 tiles × 44px + 4 gaps × 8px = 252px).
  // Constrain so the end labels sit directly under tile 1 and tile 5.
  width: 252,
  maxWidth: "100%",
  marginBottom: 10,
};
const commentStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 13,
  padding: 8,
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  fontFamily: "inherit",
  boxSizing: "border-box",
  resize: "vertical",
  color: "#0f2747",
  background: "#ffffff",
};
const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  marginTop: 8,
};
const submitButtonStyle: React.CSSProperties = {
  background: "#2563eb",
  color: "white",
  border: "none",
  padding: "8px 16px",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
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
