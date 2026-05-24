/**
 * ContractConsent — three-disclosure acknowledgement block.
 *
 * Before pickup we need the seller to acknowledge three legal items
 * required by every US state for a private→dealer car sale: a Limited
 * Power of Attorney (so Carvana can submit title paperwork on their
 * behalf), a Bill of Sale (the dollar amount, the VIN, the parties),
 * and the federal Odometer Disclosure Statement (49 CFR Part 580). The
 * plain-English blurbs below summarize what each does so the user
 * isn't blind-signing a wall of legal copy.
 *
 * One checkbox covers all three; the "I agree" button stays disabled
 * until the box is checked. On submit we capture an ISO timestamp of
 * the click + the three item ids — that pair becomes the receipt the
 * chatbot logs into the conversation transcript.
 *
 * Pattern mirrors `useScheduler` / `useOcrCapture`: hook returns
 * { controls, panel }, inline panel, close-on-success.
 */
import { useCallback, useMemo, useState } from "react";
import type { ChangeEvent, JSX } from "react";

/** The fixed three items the seller acknowledges in one click. */
export type ContractItem = "poa" | "bos" | "odometer";

export interface ContractAck {
  readonly acknowledgedAt: string;
  readonly items: readonly ["poa", "bos", "odometer"];
}

interface ContractConsentProps {
  onContractAcknowledged: (ack: ContractAck) => void;
}

export interface ContractConsentControls {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

export interface ContractConsentBundle {
  controls: ContractConsentControls;
  panel: JSX.Element | null;
}

interface Disclosure {
  readonly id: ContractItem;
  readonly title: string;
  readonly body: string;
}

const DISCLOSURES: readonly Disclosure[] = [
  {
    id: "poa",
    title: "Limited Power of Attorney",
    body:
      "You authorize Carvana to sign title-transfer paperwork (DMV / state title office) on your behalf for this specific vehicle. This authorization is limited to this sale and expires once title transfer completes.",
  },
  {
    id: "bos",
    title: "Bill of Sale",
    body:
      "Confirms the sale price, the vehicle (year, make, model, VIN), the seller (you), and the buyer (Carvana). A copy is emailed to you and filed with the state.",
  },
  {
    id: "odometer",
    title: "Odometer Disclosure Statement",
    body:
      "Federal law (49 CFR Part 580) requires the seller to certify the odometer reading at sale. The reading we extracted from your photos will be confirmed at pickup before this statement is finalized.",
  },
];

export function useContractConsent(
  props: ContractConsentProps,
): ContractConsentBundle {
  const { onContractAcknowledged } = props;
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [checked, setChecked] = useState<boolean>(false);

  const open = useCallback((): void => {
    setChecked(false);
    setIsOpen(true);
  }, []);
  const close = useCallback((): void => {
    setIsOpen(false);
    setChecked(false);
  }, []);

  const handleCheckChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      setChecked(event.target.checked);
    },
    [],
  );

  const handleSubmit = useCallback((): void => {
    if (!checked) return;
    onContractAcknowledged({
      acknowledgedAt: new Date().toISOString(),
      items: ["poa", "bos", "odometer"],
    });
    close();
  }, [checked, close, onContractAcknowledged]);

  const panel = useMemo<JSX.Element | null>(() => {
    if (!isOpen) return null;
    return (
      <div style={panelStyle}>
        <div style={panelHeaderStyle}>
          <strong>Confirm three disclosures</strong>
          <button type="button" onClick={close} style={closeButtonStyle}>
            close
          </button>
        </div>
        <div style={panelSubStyle}>
          Plain-English summaries below. Full legal copies are emailed
          to you before pickup.
        </div>
        <div style={disclosureGroupStyle}>
          {DISCLOSURES.map((d) => (
            <div key={d.id} style={disclosureCardStyle}>
              <div style={disclosureTitleStyle}>{d.title}</div>
              <div style={disclosureBodyStyle}>{d.body}</div>
            </div>
          ))}
        </div>
        <label style={consentLabelStyle}>
          <input
            type="checkbox"
            checked={checked}
            onChange={handleCheckChange}
            style={checkboxStyle}
          />
          <span style={consentTextStyle}>
            I understand and agree to all three.
          </span>
        </label>
        <div style={actionsStyle}>
          <button type="button" onClick={close} style={secondaryButtonStyle}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!checked}
            style={checked ? primaryButtonStyle : disabledButtonStyle}
          >
            I agree
          </button>
        </div>
      </div>
    );
  }, [checked, close, handleCheckChange, handleSubmit, isOpen]);

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
const disclosureGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginBottom: 12,
};
const disclosureCardStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "10px 12px",
  background: "#f8fafc",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
const disclosureTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#0f2747",
};
const disclosureBodyStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#334155",
  lineHeight: 1.4,
};
const consentLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 12,
  cursor: "pointer",
};
const checkboxStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  cursor: "pointer",
  accentColor: "#2563eb",
};
const consentTextStyle: React.CSSProperties = {
  fontSize: 14,
  color: "#0f2747",
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
