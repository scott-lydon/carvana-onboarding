/**
 * SellWorkspace — right-rail aggregator of the seven onboarding slices.
 *
 * Each slice ("Vehicle", "Condition", "Title & Loan", "Instant Offer",
 * "Pickup", "Payment", "Contract") shows a header + a status pill. The
 * pill is gray "Not started" when the slice is null, green "Complete"
 * when set, plus a one-line preview of the saved fact (mileage + tier,
 * lender + payoff amount, the offer headline, etc.) so the user can
 * see what's already captured without re-opening every panel.
 *
 * Pure render — no state, no fetch, no callbacks. The ChatbotShell
 * (parent) maintains the SellWorkspaceState object and re-renders this
 * component each time a slice flips from null → set.
 *
 * No demo data: when a slice is null we render "Not started"; we do
 * NOT pre-populate from defaults or invent placeholder values.
 */
import type { JSX } from "react";
import type { ConditionExtractionResult } from "./ConditionIntake.tsx";
import type { OfferResult } from "./OfferCard.tsx";

export interface SellWorkspaceState {
  vehicle: {
    year: number;
    make: string;
    model: string;
    trim?: string;
  } | null;
  condition: ConditionExtractionResult | null;
  payoff: { lender: string; payoffAmount: number } | null;
  offer: OfferResult | null;
  pickup: { displayLabel: string; scope: string } | null;
  paymentMethod: "ach" | "check" | "trade_credit" | null;
  contract: { acknowledgedAt: string } | null;
}

interface SellWorkspaceProps {
  state: SellWorkspaceState;
}

export function SellWorkspace({ state }: SellWorkspaceProps): JSX.Element {
  return (
    <aside style={asideStyle} aria-label="Sell workspace">
      <div style={headerStyle}>Sell your car</div>
      <Section
        title="Vehicle"
        isComplete={state.vehicle !== null}
        preview={
          state.vehicle === null
            ? null
            : formatVehicle(state.vehicle)
        }
      />
      <Section
        title="Condition"
        isComplete={state.condition !== null}
        preview={
          state.condition === null
            ? null
            : formatCondition(state.condition)
        }
      />
      <Section
        title="Title & Loan"
        isComplete={state.payoff !== null}
        preview={
          state.payoff === null
            ? null
            : `${state.payoff.lender} — ${formatUsd(state.payoff.payoffAmount)}`
        }
      />
      <Section
        title="Instant Offer"
        isComplete={state.offer !== null}
        preview={
          state.offer === null
            ? null
            : `${formatUsd(state.offer.offerUsd)} • good through ${formatDate(state.offer.validThroughIso)}`
        }
      />
      <Section
        title="Pickup"
        isComplete={state.pickup !== null}
        preview={
          state.pickup === null
            ? null
            : `${state.pickup.displayLabel} (${state.pickup.scope})`
        }
      />
      <Section
        title="Payment"
        isComplete={state.paymentMethod !== null}
        preview={
          state.paymentMethod === null
            ? null
            : formatPayment(state.paymentMethod)
        }
      />
      <Section
        title="Contract"
        isComplete={state.contract !== null}
        preview={
          state.contract === null
            ? null
            : `Acknowledged ${formatDateTime(state.contract.acknowledgedAt)}`
        }
      />
    </aside>
  );
}

function Section(props: {
  title: string;
  isComplete: boolean;
  preview: string | null;
}): JSX.Element {
  const { title, isComplete, preview } = props;
  return (
    <div style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <span style={sectionTitleStyle}>{title}</span>
        <span style={isComplete ? pillCompleteStyle : pillIdleStyle}>
          {isComplete ? "Complete" : "Not started"}
        </span>
      </div>
      {preview !== null ? (
        <div style={previewStyle}>{preview}</div>
      ) : null}
    </div>
  );
}

function formatVehicle(v: NonNullable<SellWorkspaceState["vehicle"]>): string {
  const trim = v.trim !== undefined && v.trim.trim() !== "" ? ` ${v.trim}` : "";
  return `${String(v.year)} ${v.make} ${v.model}${trim}`;
}

function formatCondition(c: ConditionExtractionResult): string {
  const mileagePart =
    c.extractedMileage !== undefined
      ? `${c.extractedMileage.toLocaleString()} mi`
      : "mileage pending";
  const damageCount = c.visibleDamage.length;
  const damagePart =
    damageCount === 0
      ? "no visible damage"
      : `${String(damageCount)} damage ${damageCount === 1 ? "note" : "notes"}`;
  return `${mileagePart} • ${c.suggestedTier} • ${damagePart}`;
}

function formatPayment(
  method: NonNullable<SellWorkspaceState["paymentMethod"]>,
): string {
  switch (method) {
    case "ach":
      return "Direct deposit (ACH)";
    case "check":
      return "Physical check at pickup";
    case "trade_credit":
      return "Trade-in credit";
  }
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const asideStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 14,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#ffffff",
  color: "#0f2747",
  boxShadow: "0 1px 3px rgba(15,39,71,0.06)",
  minWidth: 240,
};
const headerStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: "#0f2747",
  marginBottom: 4,
};
const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  paddingBottom: 8,
  borderBottom: "1px solid #f1f5f9",
};
const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#0f2747",
};
const pillIdleStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 999,
  background: "#f1f5f9",
  color: "#475569",
  border: "1px solid #e2e8f0",
};
const pillCompleteStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 999,
  background: "#ecfdf5",
  color: "#065f46",
  border: "1px solid #6ee7b7",
};
const previewStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
};
