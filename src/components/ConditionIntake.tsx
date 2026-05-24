/**
 * ConditionIntake — multi-photo uploader for AI condition assessment.
 *
 * This is the user-facing front-half of the "skip the 6-10 condition
 * questions" feature. The user fills a small grid of angle-labeled
 * photo slots (front_left, front_right, rear_left, rear_right,
 * odometer, interior_front, interior_rear, vin_plate, damage_closeup);
 * we base64-encode every filled slot client-side and POST the bundle
 * to /api/condition/extract. The server runs all the images through a
 * single Claude vision call so it can REASON ACROSS images (e.g. the
 * bumper alignment differs between front-left and rear-right → likely
 * prior collision) before returning a structured ConditionExtractionResult
 * the chatbot uses to skip questions it can answer from sight alone.
 *
 * Pattern mirrors `useScheduler` / `useOcrCapture`:
 *   - hook returns { controls, panel } so the parent renders the CTA
 *     wherever it wants and drops the panel below.
 *   - panel opens inline (no modal/dialog), expands the chat area.
 *   - all error states render a specific, actionable message that names
 *     the field + reason + suggested fix; no "something went wrong" prose.
 *   - no demo data: a missing field stays missing; we don't invent angles
 *     the user didn't upload.
 *
 * Constraints (from server/routes/condition.ts):
 *   - min 3 filled slots, max 12 images.
 *   - each angle except `damage_closeup` may appear at most once.
 *   - mediaType drawn from the accepted list. We default to the File's
 *     `.type` and surface a specific error if the browser hands us a
 *     blank type or an unsupported one.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { ChangeEvent, JSX, MutableRefObject } from "react";

/**
 * Re-exported here so callers can `import type { ConditionExtractionResult }
 * from "./ConditionIntake.tsx"` without reaching into server code.
 * Shape mirrors the server response in server/routes/condition.ts; keep
 * them in sync if either side changes.
 */
export interface ConditionExtractionResult {
  readonly kind: "condition_extracted";
  readonly extractedMileage?: number;
  readonly odometerConfidence?: number;
  readonly visibleDamage: readonly {
    readonly panel: string;
    readonly severity: "minor" | "moderate" | "severe";
    readonly note: string;
  }[];
  readonly suggestedTier: "Excellent" | "Good" | "Fair" | "Rough";
  readonly followupQuestions: readonly {
    readonly id: string;
    readonly prompt: string;
    readonly why: string;
  }[];
  readonly rawNotes: string;
}

/** The nine angles the server accepts, in display order. */
export type ConditionAngle =
  | "front_left"
  | "front_right"
  | "rear_left"
  | "rear_right"
  | "odometer"
  | "interior_front"
  | "interior_rear"
  | "vin_plate"
  | "damage_closeup";

const ANGLE_ORDER: readonly ConditionAngle[] = [
  "front_left",
  "front_right",
  "rear_left",
  "rear_right",
  "odometer",
  "interior_front",
  "interior_rear",
  "vin_plate",
  "damage_closeup",
];

const ANGLE_LABEL: Record<ConditionAngle, string> = {
  front_left: "Front left",
  front_right: "Front right",
  rear_left: "Rear left",
  rear_right: "Rear right",
  odometer: "Odometer",
  interior_front: "Interior front",
  interior_rear: "Interior rear",
  vin_plate: "VIN plate",
  damage_closeup: "Damage close-up",
};

/** Glyph for each slot. Plain unicode so we don't bring in an icon dep. */
const ANGLE_ICON: Record<ConditionAngle, string> = {
  front_left: "◤", // upper-left triangle
  front_right: "◥", // upper-right triangle
  rear_left: "◣", // lower-left triangle
  rear_right: "◢", // lower-right triangle
  odometer: "⏱", // stopwatch
  interior_front: "ὋA".length === 1 ? "ὋA" : "⌂", // house fallback
  interior_rear: "⌂",
  vin_plate: "▣", // bordered square
  damage_closeup: "⚠", // warning
};

const ACCEPTED_MIME = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/bmp",
  "image/tiff",
];

const MIN_FILLED = 3;
const MAX_FILLED = 12;

/** A filled slot: original File + a stable preview URL + the user's stated angle. */
interface SlotFile {
  readonly file: File;
  readonly previewUrl: string;
  readonly mediaType: string;
}

type Slots = Partial<Record<ConditionAngle, SlotFile>>;

interface ConditionIntakeProps {
  /** Called with the parsed server response on success. The panel closes itself. */
  onConditionExtracted: (result: ConditionExtractionResult) => void;
}

export interface ConditionIntakeControls {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

export interface ConditionIntakeBundle {
  controls: ConditionIntakeControls;
  panel: JSX.Element | null;
}

type ServerStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

export function useConditionIntake(
  props: ConditionIntakeProps,
): ConditionIntakeBundle {
  const { onConditionExtracted } = props;
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [slots, setSlots] = useState<Slots>({});
  const [status, setStatus] = useState<ServerStatus>({ kind: "idle" });
  // One hidden input PER angle so each tap goes to the right slot without
  // a separate "which slot did you tap?" state machine.
  const inputRefs = useRef<
    Record<ConditionAngle, HTMLInputElement | null>
  >({
    front_left: null,
    front_right: null,
    rear_left: null,
    rear_right: null,
    odometer: null,
    interior_front: null,
    interior_rear: null,
    vin_plate: null,
    damage_closeup: null,
  });

  const open = useCallback((): void => {
    setIsOpen(true);
    setStatus({ kind: "idle" });
  }, []);

  const close = useCallback((): void => {
    // Revoke preview URLs we created so they don't pin blob memory.
    setSlots((prev) => {
      for (const k of Object.keys(prev) as ConditionAngle[]) {
        const slot = prev[k];
        if (slot !== undefined) URL.revokeObjectURL(slot.previewUrl);
      }
      return {};
    });
    setStatus({ kind: "idle" });
    setIsOpen(false);
  }, []);

  const handleFilePicked = useCallback(
    (angle: ConditionAngle) =>
      (event: ChangeEvent<HTMLInputElement>): void => {
        const file = event.target.files?.[0];
        if (file === undefined) return;
        if (file.size === 0) {
          setStatus({
            kind: "error",
            message: `${ANGLE_LABEL[angle]} photo is 0 bytes (${file.name || "unnamed"}). Pick a different photo for that slot.`,
          });
          // Reset the input so the same file can be re-picked after the
          // user takes a different photo with the same camera app.
          event.target.value = "";
          return;
        }
        const mediaType = file.type;
        if (mediaType === "" || !ACCEPTED_MIME.includes(mediaType)) {
          setStatus({
            kind: "error",
            message: `${ANGLE_LABEL[angle]} photo has unsupported type "${mediaType || "(blank)"}". Re-take or pick a JPEG, PNG, HEIC, or WebP.`,
          });
          event.target.value = "";
          return;
        }
        const previewUrl = URL.createObjectURL(file);
        setSlots((prev) => {
          // Replace any existing slot at this angle (revoke its preview).
          const existing = prev[angle];
          if (existing !== undefined) URL.revokeObjectURL(existing.previewUrl);
          return { ...prev, [angle]: { file, previewUrl, mediaType } };
        });
        // Clear any prior error once the user makes progress.
        setStatus((prev) => (prev.kind === "error" ? { kind: "idle" } : prev));
        event.target.value = "";
      },
    [],
  );

  const handleClearSlot = useCallback((angle: ConditionAngle): void => {
    setSlots((prev) => {
      const existing = prev[angle];
      if (existing === undefined) return prev;
      URL.revokeObjectURL(existing.previewUrl);
      // Build the next state without the cleared slot. Object spread
      // with a key omission via destructuring keeps the lint rule
      // against dynamic delete happy and is referentially safer than
      // mutating a spread copy.
      const { [angle]: _removed, ...rest } = prev;
      void _removed;
      return rest;
    });
  }, []);

  const filled = useMemo<readonly ConditionAngle[]>(
    () => ANGLE_ORDER.filter((a) => slots[a] !== undefined),
    [slots],
  );
  const canSubmit = filled.length >= MIN_FILLED && filled.length <= MAX_FILLED;

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!canSubmit) {
      setStatus({
        kind: "error",
        message: `Need at least ${String(MIN_FILLED)} photos to run the assessment (you have ${String(filled.length)}).`,
      });
      return;
    }
    setStatus({ kind: "submitting" });
    try {
      const images: {
        angle: ConditionAngle;
        image: string;
        mediaType: string;
      }[] = [];
      for (const angle of filled) {
        const slot = slots[angle];
        if (slot === undefined) continue; // unreachable; tightens types.
        const base64 = await fileToBase64(slot.file);
        if (base64.length < 100) {
          throw new Error(
            `${ANGLE_LABEL[angle]} photo encoded to only ${String(base64.length)} base64 characters (effectively empty). Re-take that photo.`,
          );
        }
        images.push({ angle, image: base64, mediaType: slot.mediaType });
      }
      const response = await fetch("/api/condition/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (response.status === 503) {
        throw new Error(
          typeof body.detail === "string"
            ? body.detail
            : "Condition assessment service is temporarily unavailable. Try again in a moment.",
        );
      }
      if (response.status === 400) {
        const field =
          typeof body.field === "string" ? body.field : "request";
        const reason =
          typeof body.reason === "string"
            ? body.reason
            : "the server rejected the upload.";
        throw new Error(`${field}: ${reason}`);
      }
      if (response.status !== 200) {
        throw new Error(
          typeof body.reason === "string"
            ? body.reason
            : `Condition assessment failed (HTTP ${String(response.status)}). Try again with the same photos.`,
        );
      }
      if (body.kind !== "condition_extracted") {
        throw new Error(
          `Unexpected response shape (kind=${String(body.kind)}). Retry the assessment.`,
        );
      }
      onConditionExtracted(body as unknown as ConditionExtractionResult);
      // Close on success — same pattern as Scheduler's confirmed state.
      close();
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "Condition assessment failed. Try again or remove any large photos.",
      });
    }
  }, [canSubmit, close, filled, onConditionExtracted, slots]);

  const panel = useMemo<JSX.Element | null>(() => {
    if (!isOpen) return null;
    return (
      <div style={panelStyle}>
        <div style={panelHeaderStyle}>
          <strong>Photo your car for an instant assessment</strong>
          <button
            type="button"
            onClick={close}
            style={closeButtonStyle}
            disabled={status.kind === "submitting"}
          >
            close
          </button>
        </div>
        <div style={panelSubStyle}>
          Tap any tile to add a photo. {String(MIN_FILLED)} or more unlocks
          the assessment ({String(filled.length)} so far). The four exterior
          corners + the odometer are the most useful.
        </div>
        <div style={slotGridStyle}>
          {ANGLE_ORDER.map((angle) => {
            const slot = slots[angle];
            return (
              <SlotTile
                key={angle}
                angle={angle}
                slot={slot}
                disabled={status.kind === "submitting"}
                inputRefs={inputRefs}
                onFilePicked={handleFilePicked}
                onClear={handleClearSlot}
              />
            );
          })}
        </div>
        {status.kind === "submitting" ? (
          <div style={analyzingStyle} role="status" aria-live="polite">
            <span className="chatbot-typing-dots">
              <span />
              <span />
              <span />
            </span>
            <span>Analyzing your photos&hellip;</span>
          </div>
        ) : null}
        {status.kind === "error" ? (
          <div style={errorStyle} role="alert">
            {status.message}
          </div>
        ) : null}
        <div style={actionsStyle}>
          <button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!canSubmit || status.kind === "submitting"}
            style={
              canSubmit && status.kind !== "submitting"
                ? primaryButtonStyle
                : disabledButtonStyle
            }
          >
            Get instant assessment
          </button>
        </div>
      </div>
    );
  }, [
    canSubmit,
    close,
    filled.length,
    handleClearSlot,
    handleFilePicked,
    handleSubmit,
    isOpen,
    slots,
    status,
  ]);

  return {
    controls: { open, close, isOpen },
    panel,
  };
}

/**
 * One slot in the grid. Renders either an "add photo" tile or the
 * already-picked thumbnail with a clear button. The hidden file input
 * is owned per-slot so the OS picker remembers nothing between angles.
 */
function SlotTile(props: {
  angle: ConditionAngle;
  slot: SlotFile | undefined;
  disabled: boolean;
  inputRefs: MutableRefObject<Record<ConditionAngle, HTMLInputElement | null>>;
  onFilePicked: (
    angle: ConditionAngle,
  ) => (event: ChangeEvent<HTMLInputElement>) => void;
  onClear: (angle: ConditionAngle) => void;
}): JSX.Element {
  const { angle, slot, disabled, inputRefs, onFilePicked, onClear } = props;
  const label = ANGLE_LABEL[angle];
  const icon = ANGLE_ICON[angle];
  const handleTileClick = (): void => {
    if (disabled) return;
    inputRefs.current[angle]?.click();
  };
  return (
    <div style={slotWrapStyle}>
      <button
        type="button"
        onClick={handleTileClick}
        disabled={disabled}
        style={slot === undefined ? emptyTileStyle : filledTileStyle}
        aria-label={
          slot === undefined
            ? `Add ${label} photo`
            : `Replace ${label} photo`
        }
      >
        {slot === undefined ? (
          <>
            <span style={tileIconStyle} aria-hidden="true">
              {icon}
            </span>
            <span style={tileLabelStyle}>{label}</span>
            <span style={tileHintStyle}>tap to add</span>
          </>
        ) : (
          <>
            <img
              src={slot.previewUrl}
              alt={`${label} preview`}
              style={thumbnailStyle}
            />
            <span style={tileLabelOverlayStyle}>{label}</span>
          </>
        )}
      </button>
      {slot !== undefined ? (
        <button
          type="button"
          onClick={() => {
            onClear(angle);
          }}
          disabled={disabled}
          style={clearButtonStyle}
          aria-label={`Clear ${label} photo`}
          title={`Clear ${label} photo`}
        >
          {"×"}
        </button>
      ) : null}
      <input
        ref={(el) => {
          inputRefs.current[angle] = el;
        }}
        type="file"
        accept={ACCEPTED_MIME.join(",")}
        capture="environment"
        onChange={onFilePicked(angle)}
        style={{ display: "none" }}
        data-testid={`condition-input-${angle}`}
      />
    </div>
  );
}

/**
 * Read a File and return its base64 bytes WITHOUT the `data:` prefix.
 * Mirrors the helper inside OcrCapture so behavior matches across the
 * two flows (server validators expect identical input).
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(
          new Error(
            `FileReader returned a non-string result for ${file.name || "the picked image"}.`,
          ),
        );
        return;
      }
      const idx = result.indexOf(",");
      resolve(idx === -1 ? result : result.slice(idx + 1));
    };
    reader.onerror = () => {
      reject(
        reader.error ??
          new Error(
            `FileReader failed reading ${file.name || "the picked image"}.`,
          ),
      );
    };
    reader.readAsDataURL(file);
  });
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
const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 6,
};
const panelSubStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
  marginBottom: 12,
};
const closeButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#475569",
  border: "none",
  cursor: "pointer",
  fontSize: 12,
};
const slotGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
  gap: 8,
  marginBottom: 12,
};
const slotWrapStyle: React.CSSProperties = {
  position: "relative",
};
const emptyTileStyle: React.CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  background: "#f8fafc",
  border: "1px dashed #cbd5e1",
  borderRadius: 10,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  color: "#475569",
  cursor: "pointer",
  padding: 6,
};
const filledTileStyle: React.CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  background: "#0f172a",
  border: "1px solid #2563eb",
  borderRadius: 10,
  padding: 0,
  overflow: "hidden",
  position: "relative",
  cursor: "pointer",
};
const tileIconStyle: React.CSSProperties = {
  fontSize: 22,
  lineHeight: 1,
};
const tileLabelStyle: React.CSSProperties = {
  fontSize: 12,
  textAlign: "center",
  fontWeight: 600,
};
const tileHintStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#64748b",
};
const thumbnailStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};
const tileLabelOverlayStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(15,23,42,0.65)",
  color: "#ffffff",
  fontSize: 11,
  padding: "2px 4px",
  textAlign: "center",
};
const clearButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 4,
  right: 4,
  width: 22,
  height: 22,
  borderRadius: 11,
  border: "none",
  background: "rgba(15,23,42,0.85)",
  color: "#ffffff",
  fontSize: 14,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  lineHeight: 1,
};
const analyzingStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  color: "#475569",
  marginBottom: 10,
};
const errorStyle: React.CSSProperties = {
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 13,
  marginBottom: 10,
};
const actionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};
const primaryButtonStyle: React.CSSProperties = {
  background: "#2563eb",
  color: "white",
  border: "none",
  padding: "10px 16px",
  borderRadius: 8,
  fontSize: 14,
  cursor: "pointer",
};
const disabledButtonStyle: React.CSSProperties = {
  background: "#cbd5e1",
  color: "#475569",
  border: "none",
  padding: "10px 16px",
  borderRadius: 8,
  fontSize: 14,
  cursor: "not-allowed",
};
