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
import {
  compressImageIfNeeded,
  EncodeError,
  ImageDecodeError,
  StillTooLargeError,
} from "./imageCompression.ts";

export interface OcrCaptureProps {
  /** Called with the recognized 17-char VIN when extraction succeeds. */
  onVinScanned: (vin: string) => void;
  /**
   * Called when the vision model detected a license plate instead of (or
   * in addition to) a VIN. The state is forwarded when the model could
   * read it from the photo (e.g. "TEXAS" above the plate); when not, the
   * caller is expected to ask the user for the state to complete the
   * plate lookup. Optional so existing callers that only consume VINs
   * keep compiling.
   */
  onPlateScanned?: (args: { plate: string; state?: string }) => void;
}

/**
 * Backend response shape from /api/ocr/recognize. The legacy `vin_sticker`
 * target returns kind=resolved / not_found / low_confidence with `vin?`.
 * The newer `vin_or_plate` target returns kind=resolved_vin / resolved_plate
 * / not_found / low_confidence with `vin?` or `plate?`+`state?`.
 *
 * Both shapes share a common error / not_found envelope (`reason` string),
 * so the discriminator does the routing and the rest of the field set is
 * just optional.
 */
type OcrResponseBody =
  | { kind: "resolved"; vin: string; confidence?: number }
  | { kind: "resolved_vin"; vin: string; confidence?: number; alsoSawPlate?: string; alsoSawState?: string }
  | { kind: "resolved_plate"; plate: string; state?: string; confidence?: number }
  | { kind: "not_found"; reason?: string; rawPrefix?: string }
  | { kind: "low_confidence"; reason?: string; confidence?: number }
  | { kind: "transient_error" | "format_error"; reason?: string; detail?: string; cause?: string };

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
 *
 * Both VIN and license plate recognition flow through the same backend
 * call (target=vin_or_plate). The hook routes the response to either
 * `onVinScanned` or `onPlateScanned` based on the discriminator. If the
 * caller has not provided `onPlateScanned`, a detected plate surfaces as
 * an inline error rather than being silently dropped.
 */
export function useOcrCapture(
  onVinScanned: (vin: string) => void,
  onPlateScanned?: (args: { plate: string; state?: string }) => void,
): OcrCaptureBundle {
  const [status, setStatus] = useState<CaptureStatus>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Imperative submit — used by drag-drop, file-picker, and clipboard
  // paths. Wraps the upload with phased progress and named errors at
  // every step where an empty payload could leak through.
  const submitImageFile = useCallback(
    async (rawFile: File): Promise<void> => {
      if (rawFile.size === 0) {
        setStatus({
          kind: "error",
          message: `Picked image is 0 bytes (${rawFile.name || "unnamed"}). Try a different photo.`,
        });
        return;
      }
      setStatus({ kind: "uploading", phase: "compress" });
      // Browser-side downscale BEFORE encoding. Anthropic's vision API
      // rejects images > 5 MB; iPhone JPEGs are routinely 5-8 MB straight
      // off the camera and our server's "Anthropic native" passthrough
      // doesn't re-encode JPEG/PNG/WebP. This is the root-cause fix; the
      // previous failure mode was the cryptic 400 from the server route
      // surfacing the literal Anthropic message.
      let file = rawFile;
      try {
        file = await compressImageIfNeeded(rawFile);
      } catch (err) {
        if (
          err instanceof StillTooLargeError ||
          err instanceof ImageDecodeError ||
          err instanceof EncodeError
        ) {
          setStatus({
            kind: "error",
            message: err.message,
          });
          if (fileInputRef.current !== null) fileInputRef.current.value = "";
          return;
        }
        // Unknown compression failure — log but continue with the
        // original file; the server has its own resample stage as
        // defense in depth and will surface a specific error if it
        // can't handle the upload either.
        console.warn(
          "[OcrCapture] compressImageIfNeeded threw an unexpected error; falling back to original file. Error:",
          err,
        );
      }
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
        const result = await postOcrRequest({
          base64,
          mediaType: file.type || "image/jpeg",
          target: "vin_or_plate",
          onPhase: (phase) => {
            setStatus((prev) =>
              prev.kind === "uploading" ? { ...prev, phase } : prev,
            );
          },
        });
        routeOcrResult(result, onVinScanned, onPlateScanned);
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
    [onVinScanned, onPlateScanned],
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
  //
  // IMPORTANT — strobe-prevention contract.
  // This effect MUST depend only on the stream identity (`cameraStream`),
  // never on the full `status` object. If it depended on `status`, every
  // setStatus inside the effect (e.g. flipping `ready` to true) would
  // create a new status reference, fire this effect's cleanup, re-attach
  // srcObject, restart play(), and spawn a fresh RAF loop. That loop
  // would call setStatus again, and so on, many times per second. The
  // result was a seizure-inducing strobe on the camera preview (Capture
  // button rapidly toggling between "Starting preview..." and "Capture",
  // dark blue video tile flickering on each srcObject reassignment).
  // The `setStatus` updater below ALSO guards against this by returning
  // `prev` unchanged when `ready` is already true, so even if the effect
  // were to re-run by accident it would not produce a new object.
  const cameraStream =
    status.kind === "camera_open" ? status.stream : null;
  useEffect(() => {
    if (cameraStream === null) return;
    const video = videoRef.current;
    if (video === null) return;
    // Re-assigning srcObject to the same MediaStream can briefly reload
    // the frame buffer on some browsers, so guard against it explicitly.
    if (video.srcObject !== cameraStream) {
      video.srcObject = cameraStream;
    }
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
                // Return the SAME reference when there is nothing to
                // change. React bails on identical state and skips the
                // re-render — which is what stops the strobe loop dead.
                prev.kind !== "camera_open" || prev.ready
                  ? prev
                  : { ...prev, ready: true },
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
  }, [cameraStream]);

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
      const result = await postOcrRequest({
        base64,
        mediaType: "image/jpeg",
        target: "vin_or_plate",
        onPhase: (phase) => {
          setStatus((prev) =>
            prev.kind === "uploading" ? { ...prev, phase } : prev,
          );
        },
      });
      routeOcrResult(result, onVinScanned, onPlateScanned);
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
  }, [onVinScanned, onPlateScanned, status]);

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
 * POST the base64 image to /api/ocr/recognize and return the parsed
 * response. Phases reported via onPhase as real milestones in the
 * request lifecycle.
 *
 * **Cold-start retry.** Render's free tier sleeps after ~15 min idle.
 * The first request after wake usually fails at the TCP / TLS layer
 * (Safari surfaces this as `TypeError: Load failed`, Chrome / Firefox
 * as `TypeError: Failed to fetch`). Without retry the user sees a
 * useless "Load failed" panel and has to manually retry. We retry the
 * initial fetch on TypeError only — once we have ANY HTTP response,
 * we surface the body verbatim, because retrying 4xx/5xx would mask
 * real backend errors.
 *
 * **Specific error mapping.** The thrown Error always names the failure
 * category: configuration_missing, validation, vision_auth_error,
 * vision_rate_limited, vision_rejected_image, not_found, low_confidence,
 * unexpected_shape, network_after_retries. Every category carries a
 * one-sentence recovery instruction so the user knows what to do.
 */
async function postOcrRequest(args: {
  base64: string;
  mediaType: string;
  target: "vin_sticker" | "vin_or_plate" | "registration_card" | "insurance_card" | "driver_license";
  onPhase?: (phase: ProgressPhase["id"]) => void;
}): Promise<OcrResponseBody> {
  const { base64, mediaType, target, onPhase } = args;
  onPhase?.("upload");

  // Cold-start retry. Mirror the pattern in ChatbotShell.streamChatResponse
  // so /api/ocr/recognize gets the same forgiveness as /api/chat on a
  // post-sleep wake. Total extra wait: ≤11s before giving up.
  const RETRY_DELAYS_MS = [1000, 3000, 7000];
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch("/api/ocr/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mediaType, target }),
      });
      break;
    } catch (err) {
      const isNetworkError = err instanceof TypeError;
      const delay = RETRY_DELAYS_MS[attempt];
      if (!isNetworkError || delay === undefined) {
        const baseMessage = err instanceof Error ? err.message : String(err);
        // Safari raises "Load failed" verbatim; rewrite into a user-
        // actionable message that names the cold-start hypothesis and
        // the only thing the user can do (wait, then try again).
        const friendly =
          baseMessage === "Load failed" || baseMessage === "Failed to fetch"
            ? `Could not reach the recognition service (${baseMessage}). The server may be cold-starting — wait 30 seconds and tap the upload button again. If it keeps failing, check your internet connection.`
            : `Network request to the recognition service failed (${baseMessage}). The server may be cold-starting — wait 30 seconds and tap the upload button again.`;
        throw new Error(friendly);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  onPhase?.("extract");
  // The vision call dominates wall-clock time; the JSON parse below is
  // effectively instant. We surface "validate" right before it to keep
  // the progress bar honest.
  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Recognition service returned a response that wasn't valid JSON (${detail}). This is usually transient — try again.`,
    );
  }
  onPhase?.("validate");

  if (response.status === 503) {
    // Either configuration_missing (no API key) or transient_error
    // (auth / rate-limit / generic vision error). Either way the body
    // carries the user-facing message; surface it verbatim.
    const message =
      typeof body.message === "string"
        ? body.message
        : typeof body.detail === "string"
          ? body.detail
          : typeof body.reason === "string"
            ? body.reason
            : "OCR service is temporarily unavailable. Try again in a minute, or type the VIN or plate manually.";
    throw new Error(message);
  }
  if (response.status === 400) {
    const reason =
      typeof body.reason === "string"
        ? body.reason
        : typeof body.detail === "string"
          ? body.detail
          : "Server rejected the upload (HTTP 400). Try a different photo.";
    throw new Error(`Server validation failed: ${reason}`);
  }
  if (response.status !== 200) {
    throw new Error(
      typeof body.reason === "string"
        ? body.reason
        : `OCR failed (HTTP ${String(response.status)}). Try again, or type the VIN or plate manually.`,
    );
  }

  // 200 OK — return the parsed body to the caller, which routes by kind.
  const kind = body.kind;
  if (
    kind === "resolved" ||
    kind === "resolved_vin" ||
    kind === "resolved_plate" ||
    kind === "not_found" ||
    kind === "low_confidence"
  ) {
    return body as unknown as OcrResponseBody;
  }
  throw new Error(
    `Unexpected OCR response shape (kind=${String(kind)}). Try again, or type the VIN or plate manually.`,
  );
}

/**
 * Route a successful OCR response to the right callback. Throws when the
 * response is a soft failure (not_found, low_confidence) — the caller
 * catches and renders the message in the inline error panel.
 *
 * Plate detected but no `onPlateScanned` callback wired: throws a clear
 * developer-facing error rather than silently dropping the plate so the
 * bug surfaces immediately during integration rather than as a missing-
 * feature complaint from a user.
 */
function routeOcrResult(
  result: OcrResponseBody,
  onVinScanned: (vin: string) => void,
  onPlateScanned?: (args: { plate: string; state?: string }) => void,
): void {
  if (result.kind === "resolved" || result.kind === "resolved_vin") {
    onVinScanned(result.vin);
    return;
  }
  if (result.kind === "resolved_plate") {
    if (onPlateScanned === undefined) {
      throw new Error(
        "Vision detected a license plate but no plate handler is wired. This is a wiring bug — the parent component should pass onPlateScanned to useOcrCapture.",
      );
    }
    const args: { plate: string; state?: string } =
      result.state !== undefined
        ? { plate: result.plate, state: result.state }
        : { plate: result.plate };
    onPlateScanned(args);
    return;
  }
  if (result.kind === "not_found" || result.kind === "low_confidence") {
    throw new Error(
      result.reason ??
        "Vision model could not read a VIN or plate from this image. Try again with better lighting, or type the VIN or plate manually.",
    );
  }
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
