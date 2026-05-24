/**
 * OfferCard — pure render of an instant-offer breakdown.
 *
 * The companion to /api/offer/generate (server/offer/OfferEngine.ts).
 * The engine is intentionally deterministic and auditable — every input
 * gets a named line, every multiplier is visible, every dollar is the
 * literal output of the published formula. This component renders that
 * breakdown the same way: the headline `offerUsd` is BIG, every line
 * shows its label + dollar value + the engine's one-sentence
 * explanation, and the negative-equity / direct-deposit callouts are
 * the EXACT plain-English copy the user will see in production-style
 * messaging.
 *
 * No mutation, no fetching, no callbacks — the chatbot owns the offer
 * lifecycle and just hands us a result to render. Re-renders cheap on
 * every parent update.
 *
 * The OfferResult interface is mirrored here (not imported from
 * server/) so the client compiles without depending on server-side
 * types. If the server contract changes, update BOTH copies.
 */
import type { JSX } from "react";

/** Mirror of server/offer/OfferEngine.ts — keep in sync if either changes. */
export interface OfferLine {
  readonly label: string;
  readonly value: number;
  readonly explanation: string;
}

export interface OfferResult {
  readonly kind: "offer";
  readonly offerUsd: number;
  readonly netToSellerUsd: number;
  readonly negativeEquityUsd: number;
  readonly lines: readonly OfferLine[];
  readonly computedAt: string;
  readonly validThroughIso: string;
  readonly validThroughMilesDelta: number;
  readonly formulaVersion: string;
}

interface OfferCardProps {
  result: OfferResult;
}

export function OfferCard({ result }: OfferCardProps): JSX.Element {
  return (
    <div style={cardStyle}>
      <div style={headlineWrapStyle}>
        <div style={headlineLabelStyle}>Instant offer</div>
        <div style={headlineStyle}>{formatUsd(result.offerUsd)}</div>
        <div style={validityStyle}>
          Good through {formatDate(result.validThroughIso)} or{" "}
          {result.validThroughMilesDelta.toLocaleString()} additional miles,
          whichever first.
        </div>
      </div>

      <div style={lineGroupStyle}>
        {result.lines.map((line, idx) => (
          <div key={`${String(idx)}-${line.label}`} style={lineRowStyle}>
            <div style={lineLeadStyle}>
              <div style={lineLabelStyle}>{line.label}</div>
              <div style={lineExplanationStyle}>{line.explanation}</div>
            </div>
            <div
              style={
                line.value < 0
                  ? { ...lineValueStyle, color: "#991b1b" }
                  : lineValueStyle
              }
            >
              {formatSignedUsd(line.value)}
            </div>
          </div>
        ))}
      </div>

      {result.negativeEquityUsd > 0 ? (
        <div style={negativeEquityStyle} role="alert">
          You will owe {formatUsd(result.negativeEquityUsd)} at pickup —
          bring a cashier&rsquo;s check made out to Carvana.
        </div>
      ) : null}

      {result.netToSellerUsd > 0 ? (
        <div style={netToSellerStyle}>
          Direct deposit of {formatUsd(result.netToSellerUsd)} to your bank
          account in 1-2 business days.
        </div>
      ) : null}
    </div>
  );
}

/** Whole-dollar USD formatting; no decimals (offer ends in 00 or 50). */
function formatUsd(value: number): string {
  const safe = Number.isFinite(value) ? Math.round(value) : 0;
  return `$${safe.toLocaleString("en-US")}`;
}

/** Signed USD formatting used inside the per-line breakdown. */
function formatSignedUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  const rounded = Math.round(value);
  if (rounded > 0) return `+$${rounded.toLocaleString("en-US")}`;
  if (rounded < 0) return `-$${Math.abs(rounded).toLocaleString("en-US")}`;
  return "$0";
}

/**
 * Format an ISO timestamp as a human-readable date for the
 * "good through" line. Invalid input falls back to the raw string so
 * we never silently substitute a fake date (no stub data rule).
 */
function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const cardStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#ffffff",
  color: "#0f2747",
  boxShadow: "0 1px 3px rgba(15,39,71,0.06)",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};
const headlineWrapStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  paddingBottom: 12,
  borderBottom: "1px solid #e5e7eb",
};
const headlineLabelStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  color: "#475569",
};
const headlineStyle: React.CSSProperties = {
  fontSize: 40,
  fontWeight: 700,
  letterSpacing: -0.5,
  color: "#0f2747",
  lineHeight: 1.1,
};
const validityStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
};
const lineGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const lineRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
};
const lineLeadStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  flex: 1,
  minWidth: 0,
};
const lineLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#0f2747",
};
const lineExplanationStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
};
const lineValueStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#0f2747",
  whiteSpace: "nowrap",
};
const negativeEquityStyle: React.CSSProperties = {
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  padding: "10px 12px",
  borderRadius: 8,
  fontSize: 13,
};
const netToSellerStyle: React.CSSProperties = {
  background: "#ecfdf5",
  border: "1px solid #6ee7b7",
  color: "#065f46",
  padding: "10px 12px",
  borderRadius: 8,
  fontSize: 13,
};
