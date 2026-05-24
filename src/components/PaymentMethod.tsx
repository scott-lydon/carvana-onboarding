/**
 * PaymentMethod — three-way radio for how the seller wants paid.
 *
 * After the offer is accepted (and any payoff is recorded), the seller
 * picks one of three payment methods. Each option is a tall card with
 * a title and a one-sentence explanation; the user taps a card to
 * select it, then Confirms. The Confirm button stays disabled until
 * exactly one card is selected — we never auto-default a method.
 *
 * Pattern mirrors `useScheduler` / `useOcrCapture`: hook returns
 * { controls, panel }, inline panel, close-on-success.
 */
import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";

export type PaymentMethod = "ach" | "check" | "trade_credit";

interface PaymentMethodProps {
  onPaymentMethodSelected: (method: PaymentMethod) => void;
}

export interface PaymentMethodControls {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

export interface PaymentMethodBundle {
  controls: PaymentMethodControls;
  panel: JSX.Element | null;
}

interface Option {
  readonly id: PaymentMethod;
  readonly label: string;
  readonly detail: string;
}

const OPTIONS: readonly Option[] = [
  {
    id: "ach",
    label: "Direct deposit (ACH)",
    detail: "1-2 business days to your bank account. Most popular.",
  },
  {
    id: "check",
    label: "Physical check at pickup",
    detail:
      "Driver hands you a cashier's check when they pick up the car. Same day.",
  },
  {
    id: "trade_credit",
    label: "Trade-in credit toward a Carvana purchase",
    detail:
      "Apply the offer amount as a credit toward a vehicle on carvana.com.",
  },
];

export function usePaymentMethod(
  props: PaymentMethodProps,
): PaymentMethodBundle {
  const { onPaymentMethodSelected } = props;
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selected, setSelected] = useState<PaymentMethod | null>(null);

  const open = useCallback((): void => {
    setSelected(null);
    setIsOpen(true);
  }, []);
  const close = useCallback((): void => {
    setIsOpen(false);
    setSelected(null);
  }, []);

  const handleConfirm = useCallback((): void => {
    if (selected === null) return;
    onPaymentMethodSelected(selected);
    close();
  }, [close, onPaymentMethodSelected, selected]);

  const panel = useMemo<JSX.Element | null>(() => {
    if (!isOpen) return null;
    return (
      <div style={panelStyle}>
        <div style={panelHeaderStyle}>
          <strong>How would you like to be paid?</strong>
          <button type="button" onClick={close} style={closeButtonStyle}>
            close
          </button>
        </div>
        <div style={panelSubStyle}>
          Pick one. You can change this any time before pickup.
        </div>
        <div
          style={optionGroupStyle}
          role="radiogroup"
          aria-label="Payment method"
        >
          {OPTIONS.map((opt) => {
            const isSelected = selected === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => {
                  setSelected(opt.id);
                }}
                style={isSelected ? optionSelectedStyle : optionStyle}
              >
                <span
                  style={isSelected ? bulletSelectedStyle : bulletStyle}
                  aria-hidden="true"
                />
                <span style={optionTextStyle}>
                  <span style={optionLabelStyle}>{opt.label}</span>
                  <span style={optionDetailStyle}>{opt.detail}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div style={actionsStyle}>
          <button type="button" onClick={close} style={secondaryButtonStyle}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selected === null}
            style={
              selected === null ? disabledButtonStyle : primaryButtonStyle
            }
          >
            Confirm
          </button>
        </div>
      </div>
    );
  }, [close, handleConfirm, isOpen, selected]);

  return {
    controls: { open, close, isOpen },
    panel,
  };
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
const optionGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginBottom: 12,
};
const optionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "10px 12px",
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  cursor: "pointer",
  textAlign: "left",
  width: "100%",
};
const optionSelectedStyle: React.CSSProperties = {
  ...{
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
  },
  background: "#eff6ff",
  border: "1px solid #2563eb",
};
const bulletStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: 8,
  border: "2px solid #cbd5e1",
  background: "#ffffff",
  marginTop: 2,
  flexShrink: 0,
  display: "inline-block",
};
const bulletSelectedStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: 8,
  border: "5px solid #2563eb",
  background: "#ffffff",
  marginTop: 2,
  flexShrink: 0,
  display: "inline-block",
};
const optionTextStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};
const optionLabelStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#0f2747",
};
const optionDetailStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
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
const secondaryButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#2563eb",
  border: "1px solid #2563eb",
  padding: "10px 16px",
  borderRadius: 8,
  fontSize: 14,
  cursor: "pointer",
};
