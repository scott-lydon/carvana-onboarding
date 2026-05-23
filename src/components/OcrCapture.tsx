/**
 * OcrCapture — camera + file-upload UI for VIN extraction.
 *
 * Exports both the legacy `OcrCapture` component (kept for the
 * tests/e2e harness and any callers that want the all-in-one widget)
 * AND a `useOcrCapture(onVinScanned)` hook that splits the controls
 * (Scan / Upload buttons + hidden file input) from the active panel
 * (camera viewfinder, status, error, progress). The hook lets the
 * parent host the three CTAs in a unified row while keeping the
 * expanded panel below.
 *
 * Three async paths flow into the same /api/ocr/recognize backend:
 *   1. "Scan with camera"  → getUserMedia → canvas snapshot → POST
 *   2. "Upload photo"      → file picker  → POST
 *   3. Drag-and-drop image → handed in via submitImageFile(file) → POST
 *
 * Each path runs through phased progress: "Compressing photo", "Uploading",
 * "Extracting text", "Validating VIN", driven by real milestones in the
 * fetch lifecycle rather than wall-clock timers.
 *
 * Failure messages are SPECIFIC: empty canvas, zero-byte file, server
 * rejected base64 prefix, vision model returned nothing, etc., each
 * surface as a named error rather than a generic "OCR failed".
 *
 * Camera permission UX: getUserMedia only fires on user tap. The Capture
 * button stays disabled until the video element has fired
 * `loadedmetadata` AND `play()` has resolved AND videoWidth/Height > 0.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { ChangeEvent, JSX } from "react";
import { ProgressBar, type ProgressPhase } from "./ProgressBar.tsx";

export interface OcrCaptureProps {
  /** Called with the recognized 17-char VIN when extraction succeeds. */
  onVinScanned: (vin: string) => void;
}

/** Phases the OCR pipeline can be in. Drives the progress bar. */
const OCR_PHASES: readonly ProgressPhase[] = [
  { id: "compress", label: "Compressing photo" },
  { id: "upload", label: "Uploading" },
  { id: "extract", label: "Extracting text" },
  { id: "validate", label: "Validating VIN" },
];

type CaptureStatus =
  | { kind: "idle" }
  | { kind: "permission_pending" }
  | { kind: "camera_open"; stream: MediaStream; ready: boolean }
  | { kind: "uploading"; phase: ProgressPhase["id"] }
  | { kind: "error"; message: string }
  | { kind: "info"; message: string };

/**
 * Allowed file-input MIME list. Covers ~99% of real phone uploads:
 * JPEG/PNG plus modern iPhone HEIC/HEIF, AVIF, plus legacy BMP/TIFF
 * and animated GIF. Non-Anthropic-supported formats are converted to
 * JPEG server-side via `sharp` (see server/routes/ocr.ts).
 */
const ACCEPT_MIME = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/bmp",
  "image/tiff",
].join(",");

export interface OcrCaptureControls {
  /** "Scan VIN with camera" handler — opens getUserMedia. */
  openCamera: () => void;
  /** "Upload a photo" handler — opens the OS file picker. */
  openFilePicker: () => void;
  /** Imperative entry for drag-and-drop or paste; submits a single File. */
  submitImageFile: (file: File) => void;
}

export interface OcrCaptureBundle {
  controls: OcrCaptureControls;
  panel: JSX.Element | null;
  /** ref the parent must attach to the hidden <input type="file"> sink. */
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  /** True when any of the three paths is mid-flight. */
  busy: boolean;
}

/**
 * Hook-shaped OCR capture. The parent renders `controls.*` wherever it
 * wants the CTA buttons, mounts `<HiddenFileInput inputRef={fileInputRef}/>`
 * somewhere in the tree, and renders `panel` for camera/progress/error.
 */
export function useOcrCapture(
  onVinScanned: (vin: string) => void,
): OcrCaptureBundle {
  const [status, setStatus] = useState<CaptureStatus>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Imperative submit — used by drag-drop, file-picker, and clipboard
  // paths. Wraps the upload with phased progress and named errors at
  // every step where an empty payload could leak through.
  const submitImageFile = useCallback(
    async (file: File): Promise<void> => {
      if (file.size === 0) {
        setStatus({
          kind: "error",
          message: `Picked image is 0 bytes (${file.name || "unnamed"}). Try a different photo.`,
        });
        return;
      }
      setStatus({ kind: "uploading", phase: "compress" });
      try {
        const base64 = await fileToBase64(file);
        if (base64.length < 100) {
          // The base64 alphabet expands 1 byte → ~1.37 chars; anything
          // shorter than 100 chars is sub-100-byte input which can't be
          // a real image. Bail with a specific message rather than
          // letting the server reject with the generic 100-chars rule.
          throw new Error(
            `Image encoded to only ${String(base64.length)} base64 characters, which means the file was effectively empty. Try a different photo.`,
          );
        }
        setStatus({ kind: "uploading", phase: "upload" });
        const vin = await postOcrRequest({
          base64,
          mediaType: file.type || "image/jpeg",
          onPhase: (phase) => {
            setStatus((prev) =>
              prev.kind === "uploading" ? { ...prev, phase } : prev,
            );
          },
        });
        onVinScanned(vin);
        setStatus({ kind: "idle" });
      } catch (err) {
        setStatus({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : `OCR failed for ${file.name || "the picked image"}.`,
        });
      } finally {
        if (fileInputRef.current !== null) fileInputRef.current.value = "";
      }
    },
    [onVinScanned],
  );

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file === undefined) return;
      await submitImageFile(file);
    },
    [submitImageFile],
  );

  const openFilePicker = useCallback((): void => {
    // Surface a visible hint synchronously so model-based test agents
    // (and screen readers) see a state change before the native file
    // picker takes focus. The hint clears on file selection (status →
    // uploading) or after 4s if the user cancels.
    setStatus({
      kind: "info",
      message:
        "Pick a VIN photo from your library — drag and drop also works.",
    });
    window.setTimeout(() => {
      setStatus((prev) =>
        prev.kind === "info" &&
        prev.message.startsWith("Pick a VIN photo")
          ? { kind: "idle" }
          : prev,
      );
    }, 4000);
    fileInputRef.current?.click();
  }, []);

  const openCamera = useCallback(() => {
    void (async () => {
      // Synchronous hint so the inline status changes BEFORE the browser's
      // native permission prompt appears.
      setStatus({ kind: "permission_pending" });
      if (
        (navigator.mediaDevices as MediaDevices | undefined) === undefined ||
        typeof navigator.mediaDevices.getUserMedia !== "function"
      ) {
        setStatus({
          kind: "error",
          message:
            "Camera isn't supported in this browser — use the upload button to pick a VIN photo instead.",
        });
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        setStatus({ kind: "camera_open", stream, ready: false });
      } catch (err) {
        setStatus({
          kind: "error",
          message:
            err instanceof Error && err.name === "NotAllowedError"
              ? "Camera permission denied. Use the upload button instead."
              : err instanceof Error
                ? `Could not open the camera: ${err.message}`
                : "Could not access the camera. Try the upload button instead.",
        });
      }
    })();
  }, []);

  // When the stream attaches, wire it to the <video> and wait for the
  // first frame BEFORE allowing capture. play() can be rejected (autoplay
  // policy) — surface that as a specific error rather than a black box.
  useEffect(() => {
    if (status.kind !== "camera_open") return;
    const video = videoRef.current;
    if (video === null) return;
    video.srcObject = status.stream;
    let cancelled = false;
    const onLoaded = (): void => {
      void video
        .play()
        .then(() => {
          if (cancelled) return;
          // videoWidth/Height stays at 0 until the first frame has actually
          // decoded. Capture stays disabled until both > 0.
          const tick = (): void => {
            if (cancelled) return;
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              setStatus((prev) =>
                prev.kind === "camera_open" ? { ...prev, ready: true } : prev,
              );
            } else {
              window.requestAnimationFrame(tick);
            }
          };
          tick();
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setStatus({
            kind: "error",
            message: `Camera preview failed to start (${err instanceof Error ? err.message : "unknown error"}). Try the upload button.`,
          });
        });
    };
    if (video.readyState >= 1) onLoaded();
    else video.addEventListener("loadedmetadata", onLoaded);
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", onLoaded);
    };
  }, [status]);

  const handleCameraCapture = useCallback(async () => {
    if (status.kind !== "camera_open" || !status.ready) return;
    const video = videoRef.current;
    if (video === null) {
      setStatus({
        kind: "error",
        message: "Camera preview element missing. Reload and try again.",
      });
      return;
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      setStatus({
        kind: "error",
        message:
          "Camera preview hasn't produced a frame yet — wait for the preview to fill, then tap Capture again.",
      });
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      setStatus({
        kind: "error",
        message: "Canvas 2D context unavailable in this browser.",
      });
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    status.stream.getTracks().forEach((t) => {
      t.stop();
    });
    // JPEG (not PNG) — JPEG is dramatically smaller for camera frames
    // and Anthropic vision handles it natively.
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    // STRIP the data URL prefix — the server validator rejects payloads
    // that still carry "data:image/...;base64," (a real bug surfaced by
    // the user walking the live app).
    const base64 = stripDataUrlPrefix(dataUrl);
    if (base64.length < 100) {
      setStatus({
        kind: "error",
        message: `Captured frame encoded to ${String(base64.length)} base64 characters, which means the preview produced an empty image. Try Capture again or use the upload button.`,
      });
      return;
    }
    setStatus({ kind: "uploading", phase: "upload" });
    try {
      const vin = await postOcrRequest({
        base64,
        mediaType: "image/jpeg",
        onPhase: (phase) => {
          setStatus((prev) =>
            prev.kind === "uploading" ? { ...prev, phase } : prev,
          );
        },
      });
      onVinScanned(vin);
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "OCR failed reading the captured frame.",
      });
    }
  }, [onVinScanned, status]);

  const handleCancelCamera = useCallback(() => {
    if (status.kind === "camera_open") {
      status.stream.getTracks().forEach((t) => {
        t.stop();
      });
    }
    setStatus({ kind: "idle" });
  }, [status]);

  const dismissError = useCallback(() => {
    setStatus({ kind: "idle" });
  }, []);

  const panel = useMemo<JSX.Element | null>(() => {
    if (status.kind === "idle") return null;
    return (
      <div style={panelWrapStyle}>
        {status.kind === "permission_pending" ? (
          <div style={infoStyle}>
            <span className="spinner" /> Camera permission requested — accept
            the browser prompt to scan.
          </div>
        ) : null}
        {status.kind === "info" ? (
          <div style={infoStyle}>{status.message}</div>
        ) : null}
        {status.kind === "camera_open" ? (
          <div style={cameraContainerStyle}>
            <video
              ref={videoRef}
              style={videoStyle}
              playsInline
              muted
              aria-label="Camera viewfinder"
            />
            <div style={cameraButtonsStyle}>
              <button
                type="button"
                onClick={() => {
                  void handleCameraCapture();
                }}
                disabled={!status.ready}
                style={
                  status.ready ? primaryActionStyle : disabledActionStyle
                }
                aria-label="Capture VIN photo"
                title={
                  status.ready
                    ? "Capture the current frame"
                    : "Waiting for camera preview to start..."
                }
              >
                {status.ready ? (
                  "Capture"
                ) : (
                  <>
                    <span className="spinner" /> Starting preview...
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleCancelCamera}
                style={secondaryActionStyle}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {status.kind === "uploading" ? (
          <ProgressBar
            phases={OCR_PHASES}
            activePhaseId={status.phase}
            ariaLabel="OCR progress"
          />
        ) : null}
        {status.kind === "error" ? (
          <div style={errorStyle} role="alert">
            <span style={{ flex: 1 }}>{status.message}</span>
            <button
              type="button"
              onClick={dismissError}
              style={dismissButtonStyle}
            >
              dismiss
            </button>
          </div>
        ) : null}
      </div>
    );
  }, [dismissError, handleCameraCapture, handleCancelCamera, status]);

  // Hidden file input. Parent must render it inside the tree so the
  // openFilePicker() call actually triggers a click.
  useEffect(() => {
    const input = fileInputRef.current;
    if (input === null) return;
    const onChange = (e: Event): void => {
      void handleFileChange(
        e as unknown as ChangeEvent<HTMLInputElement>,
      );
    };
    input.addEventListener("change", onChange);
    return () => {
      input.removeEventListener("change", onChange);
    };
  }, [handleFileChange]);

  // The controls.submitImageFile contract returns void to callers (drag
  // handlers etc.). The internal implementation returns Promise<void>;
  // we wrap with void to satisfy no-misused-promises at the boundary.
  const submitImageFileVoid = useCallback(
    (file: File): void => {
      void submitImageFile(file);
    },
    [submitImageFile],
  );
  return {
    controls: {
      openCamera,
      openFilePicker,
      submitImageFile: submitImageFileVoid,
    },
    panel,
    fileInputRef,
    busy:
      status.kind === "uploading" ||
      status.kind === "permission_pending" ||
      status.kind === "camera_open",
  };
}

/**
 * Hidden file input the parent must render somewhere in the tree. The
 * `accept` list mirrors ACCEPT_MIME so the native picker filters to the
 * same set the server accepts. capture="environment" hints mobile
 * browsers toward the rear camera but still lets the user pick a saved
 * photo.
 */
export function HiddenOcrFileInput(props: {
  inputRef: MutableRefObject<HTMLInputElement | null>;
}): JSX.Element {
  return (
    <input
      ref={props.inputRef}
      type="file"
      accept={ACCEPT_MIME}
      capture="environment"
      style={{ display: "none" }}
      data-testid="ocr-file-input"
    />
  );
}

/**
 * Backwards-compatible all-in-one widget — renders its own CTA buttons
 * and panel together. Kept so the e2e tests that locate the hidden file
 * input by data-testid still work, and any future caller can opt into
 * the simple drop-in form instead of the hook.
 */
export function OcrCapture({ onVinScanned }: OcrCaptureProps): JSX.Element {
  const { controls, panel, fileInputRef, busy } = useOcrCapture(onVinScanned);
  return (
    <div>
      <HiddenOcrFileInput inputRef={fileInputRef} />
      <div className="cta-row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="cta cta-primary"
          onClick={controls.openCamera}
          disabled={busy}
          aria-label="Scan VIN with camera"
        >
          Scan VIN with camera
        </button>
        <button
          type="button"
          className="cta cta-ghost"
          onClick={controls.openFilePicker}
          disabled={busy}
          aria-label="Upload photo of VIN"
        >
          or upload a photo
        </button>
      </div>
      {panel}
    </div>
  );
}

/**
 * Read a File and return its base64-encoded bytes without the
 * `data:...;base64,` prefix. Throws a NAMED error if the FileReader
 * returns a non-string result (rare; surfaces if the OS blob is wedged).
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
      resolve(stripDataUrlPrefix(result));
    };
    reader.onerror = () => {
      reject(
        reader.error ??
          new Error(`FileReader failed reading ${file.name || "the picked image"}.`),
      );
    };
    reader.readAsDataURL(file);
  });
}

/** Strip the data URL prefix safely. Idempotent on already-stripped strings. */
function stripDataUrlPrefix(input: string): string {
  const idx = input.indexOf(",");
  return idx === -1 ? input : input.slice(idx + 1);
}

/**
 * POST the base64 image to /api/ocr/recognize and return the extracted
 * VIN on a kind="resolved" response. Phases reported via onPhase as
 * real milestones in the request lifecycle.
 */
async function postOcrRequest(args: {
  base64: string;
  mediaType: string;
  onPhase?: (phase: ProgressPhase["id"]) => void;
}): Promise<string> {
  const { base64, mediaType, onPhase } = args;
  onPhase?.("upload");
  const response = await fetch("/api/ocr/recognize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: base64,
      mediaType,
      target: "vin_sticker",
    }),
  });
  onPhase?.("extract");
  const body = (await response.json()) as Record<string, unknown>;
  onPhase?.("validate");
  if (response.status === 503) {
    throw new Error(
      typeof body.message === "string"
        ? body.message
        : "OCR service isn't configured. Ask the operator to set ANTHROPIC_API_KEY.",
    );
  }
  if (response.status === 400) {
    const reason =
      typeof body.reason === "string"
        ? body.reason
        : "Server rejected the upload (400). Try a different photo.";
    throw new Error(`Server validation failed: ${reason}`);
  }
  if (response.status !== 200) {
    throw new Error(
      typeof body.reason === "string"
        ? body.reason
        : `OCR failed (HTTP ${String(response.status)}). Try again or use a different photo.`,
    );
  }
  const kind = body.kind;
  if (kind === "resolved" && typeof body.vin === "string") {
    return body.vin;
  }
  if (kind === "not_found" || kind === "low_confidence") {
    throw new Error(
      typeof body.reason === "string"
        ? body.reason
        : "Vision model could not read a VIN from this image — re-take in better lighting.",
    );
  }
  throw new Error(
    `Unexpected OCR response shape (kind=${String(kind)}). Try again or use a different photo.`,
  );
}

const panelWrapStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 8,
};
const cameraContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  width: "100%",
};
const videoStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 240,
  maxHeight: 360,
  background: "#0f172a",
  borderRadius: 8,
  objectFit: "cover",
};
const cameraButtonsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
};
const primaryActionStyle: React.CSSProperties = {
  background: "#2563eb",
  color: "white",
  border: "none",
  padding: "10px 16px",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};
const disabledActionStyle: React.CSSProperties = {
  background: "#cbd5e1",
  color: "#475569",
  border: "none",
  padding: "10px 16px",
  borderRadius: 8,
  fontSize: 13,
  cursor: "not-allowed",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};
const secondaryActionStyle: React.CSSProperties = {
  background: "transparent",
  color: "#2563eb",
  border: "1px solid #2563eb",
  padding: "10px 16px",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
};
const dismissButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#991b1b",
  border: "none",
  padding: "0 0 0 8px",
  fontSize: 13,
  cursor: "pointer",
  textDecoration: "underline",
};
const infoStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#475569",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};
const errorStyle: React.CSSProperties = {
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 13,
  display: "flex",
  alignItems: "center",
};
