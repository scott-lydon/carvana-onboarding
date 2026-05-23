/**
 * MetricsOverlay — dev-only on-page metrics panel.
 *
 * Visible only when the URL query string includes `?metrics=1`. NEVER
 * shipped in the production demo bundle by feature flag (visibility is
 * gated by the query param at render time).
 *
 * Shows NPS summary from /api/nps/summary, labeled with n + source per
 * constitutional rule 13 (NPS data is real or labeled). The previous
 * "Flow elapsed" row was removed alongside the live elapsed counter
 * (anti-UX); the elapsed value is still recorded on the server.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";

interface NpsSummary {
  kind: "summary";
  n: number;
  score: number | null;
  averageElapsedSeconds: number | null;
  breakdown: { promoters: number; passives: number; detractors: number };
  labeling: string;
}

export function MetricsOverlay(): JSX.Element | null {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [summary, setSummary] = useState<NpsSummary | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEnabled(params.get("metrics") === "1");
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const response = await fetch("/api/nps/summary");
        if (!response.ok) return;
        const body = (await response.json()) as NpsSummary;
        if (!cancelled) setSummary(body);
      } catch {
        // overlay is best-effort; swallow
      }
    };
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div style={panelStyle} aria-label="Dev metrics overlay" data-testid="metrics-overlay">
      <strong style={{ fontSize: 12 }}>Metrics (dev)</strong>
      <div style={rowStyle}>
        <span>NPS score:</span>
        <strong>
          {summary === null
            ? "..."
            : summary.score === null
              ? "no data"
              : String(summary.score)}
        </strong>
      </div>
      <div style={rowStyle}>
        <span>Sample (n):</span>
        <strong>{summary === null ? "..." : String(summary.n)}</strong>
      </div>
      {summary !== null ? (
        <div style={labelingStyle}>{summary.labeling}</div>
      ) : null}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: 12,
  right: 12,
  width: 220,
  background: "rgba(15, 23, 42, 0.92)",
  color: "#f1f5f9",
  padding: 10,
  borderRadius: 8,
  fontSize: 11,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  zIndex: 9999,
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
};
const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  marginTop: 4,
};
const labelingStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 10,
  color: "#94a3b8",
  lineHeight: 1.3,
};
