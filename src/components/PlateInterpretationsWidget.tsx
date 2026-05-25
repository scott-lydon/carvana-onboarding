/**
 * PlateInterpretationsWidget — inline recovery UI shown whenever a plate
 * lookup misses. Always rendered when the server returns an
 * `interpretations` field on a `not_found` response (the presence of
 * the field is the trigger; an empty array still renders the widget so
 * the user sees the retake/retype affordances).
 *
 * Design contract (mirrors MANUAL_TEST_WALKTHROUGH side flow G):
 *
 *   1. The widget surfaces up to 6 candidate cards, ranked by edit
 *      distance ascending then by score descending (the same order the
 *      server returns).
 *   2. Each card shows the candidate plate with the swapped characters
 *      visually diff-highlighted from the original, plus the resolved
 *      vehicle (year + make + model + optional trim) and a "Use this
 *      plate" button.
 *   3. Two secondary actions ALWAYS visible regardless of whether any
 *      candidate resolved:
 *        - "Retake photo" — fires the onRetakePhoto callback so the
 *          parent re-opens the OCR camera or file picker.
 *        - "Type the plate myself" — opens an inline text input + state
 *          input so the user can submit the corrected plate manually.
 *   4. Selecting a candidate calls onPlateChosen with the corrected
 *      plate string AND the state, so the parent can drive the next
 *      lookup with both fields populated.
 *   5. Accessible: every button has an aria-label naming the candidate;
 *      the diff-highlighted characters use color + an icon (caret) so
 *      colorblind users still see the swap.
 *
 * This component is pure-render plus local input state for the typed-
 * override path. No network IO; the parent is responsible for invoking
 * the lookup with the chosen plate.
 */
import { useState, type JSX } from "react";

/**
 * One swap descriptor from the server. Mirrors the shape emitted by
 * `src/lookup/confusables.ts:PlatePermutation.swaps`. Kept duplicated
 * here instead of imported so the client bundle does not pull the
 * confusables module (which the client never executes — the server runs
 * it). If the shape drifts, the type guard in the parent component
 * catches the mismatch before it reaches this widget.
 */
export interface InterpretationSwap {
  readonly index: number;
  readonly fromChar: string;
  readonly toChar: string;
}

export interface InterpretationCandidate {
  readonly kind: "resolved_alternative";
  readonly plate: string;
  readonly vehicle: {
    readonly year: number;
    readonly make: string;
    readonly model: string;
    readonly trim?: string;
    readonly bodyStyle?: string;
  };
  readonly viaVendor: string;
  readonly editCount: number;
  readonly swaps: readonly InterpretationSwap[];
}

export interface PlateInterpretationsWidgetProps {
  /** The plate the user originally submitted (normalized, uppercased). */
  readonly originalPlate: string;
  /** The state the user originally submitted with the plate. */
  readonly state: string;
  /** Resolved alternative candidates the server found via confusable swaps. */
  readonly interpretations: readonly InterpretationCandidate[];
  /**
   * User picked one of the candidate cards OR submitted a typed override.
   * The parent should drive the next lookup with these two fields.
   *
   * The plate string passed back is ALREADY normalized (alphanumeric,
   * uppercase) for candidate cards; for the typed-override path the
   * widget normalizes the user's input before invoking this callback.
   */
  readonly onPlateChosen: (plate: string, state: string) => void;
  /**
   * User tapped "Retake photo". Parent re-opens the OCR camera or file
   * picker. Optional so callers that don't have a camera path can omit;
   * when omitted the button is hidden.
   */
  readonly onRetakePhoto?: () => void;
}

/**
 * Maximum cards rendered. Mirrors the server's MAX_INTERPRETATIONS so
 * the widget never out-renders the contract. If the server somehow
 * sends more, we slice; if it sends fewer, we render what came.
 */
const MAX_CARDS = 6;

export function PlateInterpretationsWidget(
  props: PlateInterpretationsWidgetProps,
): JSX.Element {
  const { originalPlate, state, interpretations, onPlateChosen, onRetakePhoto } =
    props;
  const [typedOpen, setTypedOpen] = useState<boolean>(false);
  const [typedPlate, setTypedPlate] = useState<string>("");
  const [typedState, setTypedState] = useState<string>(state);
  const [typedError, setTypedError] = useState<string | null>(null);

  const cards = interpretations.slice(0, MAX_CARDS);

  const handleTypedSubmit = (): void => {
    const normalized = typedPlate.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (normalized.length === 0) {
      setTypedError(
        "Plate must contain at least one letter or number.",
      );
      return;
    }
    if (normalized.length > 8) {
      setTypedError(
        `Plate is longer than the 8-character limit (${String(normalized.length)} after normalization).`,
      );
      return;
    }
    const stateNormalized = typedState.trim().toUpperCase();
    if (stateNormalized.length !== 2) {
      setTypedError("State must be a two-letter US code (TX, CA, etc.).");
      return;
    }
    onPlateChosen(normalized, stateNormalized);
  };

  return (
    <section
      style={widgetStyle}
      role="region"
      aria-label={`Did you mean — alternatives for ${originalPlate}`}
    >
      <header style={headerStyle}>
        <strong style={{ fontSize: 13 }}>
          Did you mean…
        </strong>
        <div style={subheaderStyle}>
          We couldn&rsquo;t find <code>{originalPlate}</code> in our vendor data.
          Cameras misread similar-shaped characters all the time (a 7 reads
          as a 1 in glare; an E reads as an F when the bottom stroke
          washes out). Here&rsquo;s what we found by trying close variants.
        </div>
      </header>

      {cards.length === 0 ? (
        <div style={emptyStateStyle} role="status">
          No close matches resolved in our vendor data. You can retake the
          photo with better lighting, or type the plate yourself below.
        </div>
      ) : (
        <ul style={cardListStyle}>
          {cards.map((candidate) => (
            <li key={candidate.plate} style={{ listStyle: "none" }}>
              <CandidateCard
                candidate={candidate}
                originalPlate={originalPlate}
                onChoose={() => {
                  onPlateChosen(candidate.plate, state);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <div style={secondaryRowStyle}>
        {onRetakePhoto !== undefined ? (
          <button
            type="button"
            onClick={onRetakePhoto}
            style={secondaryButtonStyle}
            aria-label="Retake the plate photo"
          >
            Retake photo
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setTypedOpen((prev) => !prev);
            setTypedError(null);
          }}
          style={secondaryButtonStyle}
          aria-expanded={typedOpen}
          aria-controls="plate-interpretations-typed-input"
        >
          {typedOpen ? "Hide override" : "Type the plate myself"}
        </button>
      </div>

      {typedOpen ? (
        <div
          id="plate-interpretations-typed-input"
          style={typedInputWrapStyle}
        >
          <label style={labelStyle}>
            <span style={labelTextStyle}>Plate</span>
            <input
              type="text"
              value={typedPlate}
              onChange={(e) => {
                setTypedPlate(e.target.value);
                setTypedError(null);
              }}
              placeholder="e.g. XRJ4041"
              autoCapitalize="characters"
              spellCheck={false}
              style={inputStyle}
              aria-label="Corrected plate"
            />
          </label>
          <label style={{ ...labelStyle, maxWidth: 96 }}>
            <span style={labelTextStyle}>State</span>
            <input
              type="text"
              value={typedState}
              onChange={(e) => {
                setTypedState(e.target.value);
                setTypedError(null);
              }}
              placeholder="TX"
              maxLength={2}
              autoCapitalize="characters"
              style={inputStyle}
              aria-label="Plate state"
            />
          </label>
          <button
            type="button"
            onClick={handleTypedSubmit}
            style={primaryButtonStyle}
            aria-label="Submit typed plate override"
          >
            Look up
          </button>
          {typedError !== null ? (
            <div style={errorStyle} role="alert">
              {typedError}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * One candidate card. Diff-highlights the swapped characters from the
 * original so the user sees exactly which positions changed.
 *
 * The diff is computed from `candidate.swaps` directly (rather than
 * re-running a diff at the UI layer) so the highlighted characters
 * always match the server's swap decision. If the server says "we
 * swapped position 5 from 1 to 7", THAT is the character we highlight,
 * even on the off chance the rendered plate string differs from the
 * expectation.
 */
function CandidateCard(props: {
  candidate: InterpretationCandidate;
  originalPlate: string;
  onChoose: () => void;
}): JSX.Element {
  const { candidate, originalPlate, onChoose } = props;
  const swapByIndex = new Map<number, InterpretationSwap>();
  for (const swap of candidate.swaps) {
    swapByIndex.set(swap.index, swap);
  }

  const vehicleLine = (() => {
    const v = candidate.vehicle;
    const trim =
      v.trim !== undefined && v.trim.trim() !== "" ? ` ${v.trim}` : "";
    return `${String(v.year)} ${v.make} ${v.model}${trim}`;
  })();

  const ariaSummary = `Use plate ${candidate.plate}, ${vehicleLine}, ${
    candidate.editCount === 1
      ? "one character swap"
      : `${String(candidate.editCount)} character swaps`
  } from ${originalPlate}`;

  return (
    <div style={cardStyle}>
      <div style={cardPlateRowStyle} aria-hidden="true">
        {Array.from(candidate.plate).map((ch, idx) => {
          const swap = swapByIndex.get(idx);
          if (swap === undefined) {
            return (
              <span key={idx} style={plateCharNeutralStyle}>
                {ch}
              </span>
            );
          }
          return (
            <span key={idx} style={plateCharSwappedStyle}>
              <span style={swapCaretStyle} aria-hidden="true">
                ↓
              </span>
              <span style={swapFromCharStyle}>{swap.fromChar}</span>
              <span style={swapToCharStyle}>{ch}</span>
            </span>
          );
        })}
      </div>
      <div style={cardVehicleStyle}>{vehicleLine}</div>
      <div style={cardMetaStyle}>
        Resolved via <code>{candidate.viaVendor}</code> ·{" "}
        {candidate.editCount === 1
          ? "1 character swap"
          : `${String(candidate.editCount)} character swaps`}
      </div>
      <button
        type="button"
        onClick={onChoose}
        style={cardActionStyle}
        aria-label={ariaSummary}
      >
        Use this plate
      </button>
    </div>
  );
}

/* ─── styles ──────────────────────────────────────────────────────── */

const widgetStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 14,
  border: "1px solid #cbd5e1",
  borderRadius: 12,
  background: "#f8fafc",
  marginTop: 8,
};
const headerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
const subheaderStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
  lineHeight: 1.4,
};
const cardListStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: 8,
  padding: 0,
  margin: 0,
};
const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 12,
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
};
const cardPlateRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 2,
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  fontSize: 16,
  letterSpacing: 1,
  color: "#0f2747",
};
const plateCharNeutralStyle: React.CSSProperties = {
  padding: "0 2px",
  color: "#0f2747",
};
const plateCharSwappedStyle: React.CSSProperties = {
  position: "relative",
  display: "inline-flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "0 2px",
};
const swapCaretStyle: React.CSSProperties = {
  fontSize: 9,
  color: "#b45309",
  lineHeight: 1,
};
const swapFromCharStyle: React.CSSProperties = {
  position: "absolute",
  top: -14,
  fontSize: 10,
  color: "#94a3b8",
  textDecoration: "line-through",
  lineHeight: 1,
};
const swapToCharStyle: React.CSSProperties = {
  color: "#b45309",
  fontWeight: 700,
};
const cardVehicleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#0f2747",
};
const cardMetaStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#64748b",
};
const cardActionStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  background: "#0f2747",
  color: "#ffffff",
  border: "none",
  padding: "6px 12px",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
  marginTop: 4,
};
const emptyStateStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
  padding: "10px 12px",
  background: "#ffffff",
  border: "1px dashed #cbd5e1",
  borderRadius: 8,
};
const secondaryRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};
const secondaryButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#0f2747",
  border: "1px solid #cbd5e1",
  padding: "8px 12px",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
};
const primaryButtonStyle: React.CSSProperties = {
  background: "#0f2747",
  color: "#ffffff",
  border: "none",
  padding: "8px 14px",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
  alignSelf: "flex-end",
};
const typedInputWrapStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "flex-end",
  flexWrap: "wrap",
  padding: "10px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  background: "#ffffff",
};
const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  flex: 1,
  minWidth: 120,
};
const labelTextStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#475569",
  textTransform: "uppercase",
  letterSpacing: 0.6,
};
const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  fontSize: 13,
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
};
const errorStyle: React.CSSProperties = {
  flexBasis: "100%",
  color: "#991b1b",
  fontSize: 12,
  marginTop: 4,
};
