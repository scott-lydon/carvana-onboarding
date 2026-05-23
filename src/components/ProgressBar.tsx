/**
 * ProgressBar — named-phase progress indicator.
 *
 * Each phase is a real waypoint in the surrounding pipeline (chat SSE
 * tool_use / first delta / done; OCR compress / upload / extract /
 * validate; scheduler calendar / reserve / confirm) rather than a
 * wall-clock animation. The active phase fills the bar to a proportional
 * percentage so the user has a tactile sense of progress without us
 * pretending a deterministic ETA exists.
 */
import type { JSX } from "react";

export interface ProgressPhase {
  /** Stable id used to drive the active phase via prop. */
  readonly id: string;
  /** User-visible label rendered to the right of the bar. */
  readonly label: string;
}

export interface ProgressBarProps {
  readonly phases: readonly ProgressPhase[];
  readonly activePhaseId: ProgressPhase["id"];
  readonly ariaLabel?: string;
}

export function ProgressBar({
  phases,
  activePhaseId,
  ariaLabel,
}: ProgressBarProps): JSX.Element {
  const total = Math.max(1, phases.length);
  const activeIndex = phases.findIndex((p) => p.id === activePhaseId);
  // +1 so the FIRST phase shows partial fill (1/N) rather than 0%.
  const filledRatio = Math.max(
    0.05,
    Math.min(1, (activeIndex + 1) / total),
  );
  const activeLabel =
    activeIndex >= 0
      ? (phases[activeIndex]?.label ?? "Working")
      : (phases[0]?.label ?? "Working");
  const stepLabel = `${String(Math.max(1, activeIndex + 1))} / ${String(total)}`;
  return (
    <div
      className="progress-bar"
      role="progressbar"
      aria-label={ariaLabel ?? "Progress"}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.max(0, activeIndex + 1)}
    >
      <div className="progress-bar-track">
        <div
          className="progress-bar-fill"
          style={{ width: `${String(Math.round(filledRatio * 100))}%` }}
        />
      </div>
      <div className="progress-bar-label">
        <span>
          <span className="spinner" style={{ marginRight: 6 }} />
          {activeLabel}
        </span>
        <span>{stepLabel}</span>
      </div>
    </div>
  );
}
