/**
 * PayoffForm — capture the seller's lender + 10-day payoff amount.
 *
 * The OfferEngine subtracts payoff from the gross offer so the user
 * sees the actual cash-to-them number. We need just two fields: the
 * lender name (so we can show "Carvana will wire <lender> the offer
 * amount" copy) and the 10-day payoff in dollars. Both are required;
 * any invalid input surfaces a specific, actionable message naming
 * the field and the fix.
 *
 * Pattern mirrors `useScheduler` / `useOcrCapture`: hook returns
 * { controls, panel }, inline panel (no modal), close-on-success.
 *
 * No demo data: leaving "lender" blank or entering 0 / non-numeric
 * payoff blocks submission rather than silently defaulting.
 */
import { useCallback, useMemo, useState } from "react";
import type { ChangeEvent, JSX } from "react";

interface PayoffFormProps {
  /** Called with the validated payoff after the user confirms. */
  onPayoffRecorded: (payoff: { lender: string; payoffAmount: number }) => void;
}

export interface PayoffControls {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

export interface PayoffBundle {
  controls: PayoffControls;
  panel: JSX.Element | null;
}

interface FormState {
  lender: string;
  payoffAmount: string;
  error: string | null;
}

const INITIAL_FORM: FormState = {
  lender: "",
  payoffAmount: "",
  error: null,
};

export function usePayoff(props: PayoffFormProps): PayoffBundle {
  const { onPayoffRecorded } = props;
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  const open = useCallback((): void => {
    setForm(INITIAL_FORM);
    setIsOpen(true);
  }, []);
  const close = useCallback((): void => {
    setIsOpen(false);
    setForm(INITIAL_FORM);
  }, []);

  const setLender = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const value = event.target.value;
      setForm((prev) => ({ ...prev, lender: value, error: null }));
    },
    [],
  );

  const setPayoff = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const value = event.target.value;
      setForm((prev) => ({ ...prev, payoffAmount: value, error: null }));
    },
    [],
  );

  const handleSubmit = useCallback((): void => {
    const lender = form.lender.trim();
    if (lender === "") {
      setForm((prev) => ({
        ...prev,
        error: "Lender is required — enter the name of your loan servicer (e.g., Chase Auto, Capital One Auto, GM Financial).",
      }));
      return;
    }
    const raw = form.payoffAmount.trim();
    if (raw === "") {
      setForm((prev) => ({
        ...prev,
        error: "10-day payoff amount is required — call your lender or check your most recent statement.",
      }));
      return;
    }
    // Accept "$1,234.56" / "1234" / "1234.56" — strip the symbols first.
    const cleaned = raw.replace(/[$,\s]/g, "");
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) {
      setForm((prev) => ({
        ...prev,
        error: `Payoff "${raw}" is not a number. Enter dollars (e.g., 18750 or 18,750.00).`,
      }));
      return;
    }
    if (parsed <= 0) {
      setForm((prev) => ({
        ...prev,
        error: "Payoff must be greater than 0. If you don't have a loan, skip this step instead.",
      }));
      return;
    }
    onPayoffRecorded({ lender, payoffAmount: Math.round(parsed * 100) / 100 });
    close();
  }, [close, form.lender, form.payoffAmount, onPayoffRecorded]);

  const panel = useMemo<JSX.Element | null>(() => {
    if (!isOpen) return null;
    return (
      <div style={panelStyle}>
        <div style={panelHeaderStyle}>
          <strong>Loan payoff</strong>
          <button type="button" onClick={close} style={closeButtonStyle}>
            close
          </button>
        </div>
        <div style={panelSubStyle}>
          Carvana wires your lender directly at pickup. Both fields below
          are required.
        </div>
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>
            <span style={labelTextStyle}>Lender</span>
            <input
              type="text"
              value={form.lender}
              onChange={setLender}
              placeholder="Chase Auto, Capital One Auto, GM Financial…"
              autoComplete="off"
              style={inputStyle}
              required
            />
          </label>
          <label style={labelStyle}>
            <span style={labelTextStyle}>10-day payoff amount (USD)</span>
            <input
              type="text"
              inputMode="decimal"
              value={form.payoffAmount}
              onChange={setPayoff}
              placeholder="18750"
              autoComplete="off"
              style={inputStyle}
              required
            />
          </label>
        </div>
        {form.error !== null ? (
          <div style={errorStyle} role="alert">
            {form.error}
          </div>
        ) : null}
        <div style={actionsStyle}>
          <button
            type="button"
            onClick={close}
            style={secondaryButtonStyle}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            style={primaryButtonStyle}
          >
            Save payoff
          </button>
        </div>
      </div>
    );
  }, [close, form, handleSubmit, isOpen, setLender, setPayoff]);

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
const fieldGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  marginBottom: 10,
};
const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
const labelTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const inputStyle: React.CSSProperties = {
  fontSize: 14,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  color: "#0f2747",
  background: "#ffffff",
  fontFamily: "inherit",
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
const secondaryButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#2563eb",
  border: "1px solid #2563eb",
  padding: "10px 16px",
  borderRadius: 8,
  fontSize: 14,
  cursor: "pointer",
};
