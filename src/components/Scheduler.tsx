/**
 * Scheduler — calendar UI for pickup booking.
 *
 * Exports both the legacy `Scheduler` component (kept for any caller
 * wanting the all-in-one widget) and a `useScheduler({...})` hook so the
 * parent can render the "Schedule pickup" CTA in a unified row with the
 * OCR CTAs and let the expanded scheduling panel sit below.
 *
 * Flow:
 *   1. closed         → idle, no panel.
 *   2. open           → fetch slots for current scope; user picks one.
 *   3. address        → require pickup address (with city/state/zip)
 *                       before confirming. City/state default from the
 *                       resolved vehicle if available.
 *   4. booking        → POST /api/schedule/book with the slot + scope +
 *                       address; show phased progress (Checking calendar /
 *                       Reserving slot / Confirming).
 *   5. confirmed      → inline confirmation panel showing the booked
 *                       time, scope, and full address.
 *
 * Atomicity unchanged: on 409, refetch and surface the reason so the
 * user sees fresh availability.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, JSX } from "react";
import { ProgressBar, type ProgressPhase } from "./ProgressBar.tsx";

export interface PickupAddress {
  readonly street: string;
  readonly city: string;
  readonly state: string;
  readonly zip: string;
}

export interface SchedulerProps {
  /** Called when a slot is booked successfully. The address is included so the chat injection can confirm it. */
  onPickupBooked: (args: {
    displayLabel: string;
    scope: string;
    address: PickupAddress;
  }) => void;
  /** Identifier for the booking (chat session id; for the demo we use a random id). */
  userId: string;
  /** Optional defaults for city/state/zip pulled from the resolved vehicle's state. */
  defaultAddress?: Partial<PickupAddress>;
}

interface SlotView {
  readonly slotStart: string;
  readonly displayLabel: string;
}

type SchedulerState =
  | { kind: "closed" }
  | { kind: "slots"; slots: SlotView[]; loading: boolean; error: string | null }
  | { kind: "address"; slot: SlotView; error: string | null }
  | { kind: "booking"; slot: SlotView; phase: ProgressPhase["id"] }
  | {
      kind: "confirmed";
      slot: SlotView;
      address: PickupAddress;
      scope: string;
    };

const DEFAULT_ZIP = "78701";
const HUB_OPTIONS: readonly { code: string; label: string }[] = [
  { code: "hub:austin", label: "Carvana hub — Austin" },
  { code: "hub:houston", label: "Carvana hub — Houston" },
  { code: "hub:dallas", label: "Carvana hub — Dallas" },
];

const SCHEDULE_PHASES: readonly ProgressPhase[] = [
  { id: "checking", label: "Checking calendar" },
  { id: "reserving", label: "Reserving slot" },
  { id: "confirming", label: "Confirming" },
];

export interface SchedulerBundle {
  /** "Schedule pickup" CTA handler. */
  open: () => void;
  /** Inline panel for the slot grid / address form / progress / confirmation. */
  panel: JSX.Element | null;
  /** True when the scheduler is mid-open. */
  busy: boolean;
}

/**
 * Hook variant. Parent renders the CTA where it wants (typically in a
 * unified row with the OCR CTAs) and renders `panel` below.
 */
export function useScheduler(props: SchedulerProps): SchedulerBundle {
  const { onPickupBooked, userId, defaultAddress } = props;
  const [state, setState] = useState<SchedulerState>({ kind: "closed" });
  const [scope, setScope] = useState<string>(`zip:${DEFAULT_ZIP}`);

  // Initial address values. defaultAddress can supply city/state from the
  // resolved vehicle; zip defaults from the scope if it's a zip scope.
  const initialAddress: PickupAddress = useMemo(
    () => ({
      street: defaultAddress?.street ?? "",
      city: defaultAddress?.city ?? "",
      state: defaultAddress?.state ?? "TX",
      zip:
        defaultAddress?.zip ??
        (scope.startsWith("zip:") ? scope.slice("zip:".length) : DEFAULT_ZIP),
    }),
    [defaultAddress, scope],
  );
  const [address, setAddress] = useState<PickupAddress>(initialAddress);
  useEffect(() => {
    setAddress((prev) => ({
      ...prev,
      // Only auto-fill empties; don't clobber user input.
      city: prev.city === "" ? initialAddress.city : prev.city,
      state: prev.state === "" ? initialAddress.state : prev.state,
      zip: prev.zip === "" ? initialAddress.zip : prev.zip,
    }));
  }, [initialAddress]);

  const fetchSlots = useCallback(async (scopeToFetch: string) => {
    setState({ kind: "slots", slots: [], loading: true, error: null });
    try {
      const response = await fetch(
        `/api/schedule/slots?scope=${encodeURIComponent(scopeToFetch)}`,
      );
      const body = (await response.json()) as Record<string, unknown>;
      if (response.status !== 200 || body.kind !== "ok") {
        throw new Error(
          typeof body.reason === "string"
            ? body.reason
            : `Could not load slots (status ${String(response.status)})`,
        );
      }
      const slots = body.slots as SlotView[];
      setState({ kind: "slots", slots, loading: false, error: null });
    } catch (err) {
      setState({
        kind: "slots",
        slots: [],
        loading: false,
        error: err instanceof Error ? err.message : "Could not load slots",
      });
    }
  }, []);

  useEffect(() => {
    if (state.kind === "slots") {
      void fetchSlots(scope);
    }
    // We only refetch when the scope changes while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const open = useCallback(() => {
    void fetchSlots(scope);
  }, [fetchSlots, scope]);

  const handleSlotPick = useCallback((slot: SlotView) => {
    setState({ kind: "address", slot, error: null });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (state.kind !== "address") return;
    const err = validateAddress(address);
    if (err !== null) {
      setState({ kind: "address", slot: state.slot, error: err });
      return;
    }
    setState({ kind: "booking", slot: state.slot, phase: "checking" });
    try {
      // small synchronous transition to give the user a visible "checking"
      // beat. The real first network call (book) immediately moves to
      // "reserving"; "confirming" fires after the server returns 200.
      setState((prev) =>
        prev.kind === "booking" ? { ...prev, phase: "reserving" } : prev,
      );
      const response = await fetch("/api/schedule/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotStart: state.slot.slotStart,
          scope,
          userId,
          address,
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (response.status === 200 && body.kind === "booked") {
        setState((prev) =>
          prev.kind === "booking" ? { ...prev, phase: "confirming" } : prev,
        );
        const slot = state.slot;
        setState({ kind: "confirmed", slot, address, scope });
        onPickupBooked({ displayLabel: slot.displayLabel, scope, address });
        return;
      }
      // 409 / other failure: re-show the slot grid with the reason.
      const reason =
        typeof body.reason === "string"
          ? body.reason
          : `Booking failed (status ${String(response.status)})`;
      await fetchSlots(scope);
      setState((prev) =>
        prev.kind === "slots"
          ? { ...prev, error: reason }
          : { kind: "slots", slots: [], loading: false, error: reason },
      );
    } catch (err) {
      setState({
        kind: "slots",
        slots: [],
        loading: false,
        error: err instanceof Error ? err.message : "Booking failed",
      });
    }
  }, [address, fetchSlots, onPickupBooked, scope, state, userId]);

  const close = useCallback(() => {
    setState({ kind: "closed" });
  }, []);

  const updateAddress = useCallback(
    (field: keyof PickupAddress) =>
      (event: ChangeEvent<HTMLInputElement>): void => {
        setAddress((prev) => ({ ...prev, [field]: event.target.value }));
      },
    [],
  );

  const panel = useMemo<JSX.Element | null>(() => {
    if (state.kind === "closed") return null;

    return (
      <div style={panelStyle}>
        <div style={panelHeaderStyle}>
          <strong>
            {state.kind === "address"
              ? "Where should we meet you?"
              : state.kind === "booking"
                ? "Booking your pickup..."
                : state.kind === "confirmed"
                  ? "Pickup confirmed"
                  : "Pick a pickup time"}
          </strong>
          <button type="button" onClick={close} style={closeButtonStyle}>
            close
          </button>
        </div>

        {state.kind === "slots" ? (
          <>
            <div style={scopePickerStyle}>
              <label style={scopeLabelStyle}>
                Where:&nbsp;
                <select
                  value={scope}
                  onChange={(e) => {
                    setScope(e.target.value);
                  }}
                  style={selectStyle}
                  aria-label="Pickup location"
                >
                  <option value={`zip:${DEFAULT_ZIP}`}>
                    Home pickup (zip {DEFAULT_ZIP})
                  </option>
                  {HUB_OPTIONS.map((h) => (
                    <option key={h.code} value={h.code}>
                      {h.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {state.loading ? (
              <div style={messageStyle}>
                <span className="spinner" /> Loading available slots...
              </div>
            ) : null}
            {state.error !== null ? (
              <div style={errorStyle} role="alert">
                {state.error}
              </div>
            ) : null}
            {!state.loading ? (
              <div style={slotGridStyle}>
                {state.slots.length === 0 ? (
                  <div style={messageStyle}>
                    No available slots in the next 14 days.
                  </div>
                ) : (
                  state.slots.slice(0, 24).map((s) => (
                    <button
                      key={s.slotStart}
                      type="button"
                      onClick={() => {
                        handleSlotPick(s);
                      }}
                      style={slotButtonStyle}
                      data-testid="slot-button"
                    >
                      {s.displayLabel}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </>
        ) : null}

        {state.kind === "address" ? (
          <>
            <div style={messageStyle}>
              Picked: <strong>{state.slot.displayLabel}</strong>
            </div>
            <div style={addressGridStyle}>
              <label style={addressLabelStyle}>
                <span style={addressFieldLabelStyle}>Street address</span>
                <input
                  type="text"
                  value={address.street}
                  onChange={updateAddress("street")}
                  placeholder="123 Congress Ave"
                  autoComplete="street-address"
                  style={addressInputStyle}
                  required
                />
              </label>
              <label style={addressLabelStyle}>
                <span style={addressFieldLabelStyle}>City</span>
                <input
                  type="text"
                  value={address.city}
                  onChange={updateAddress("city")}
                  placeholder="Austin"
                  autoComplete="address-level2"
                  style={addressInputStyle}
                  required
                />
              </label>
              <div style={stateZipRowStyle}>
                <label style={addressLabelStyle}>
                  <span style={addressFieldLabelStyle}>State</span>
                  <input
                    type="text"
                    value={address.state}
                    onChange={updateAddress("state")}
                    placeholder="TX"
                    maxLength={2}
                    autoCapitalize="characters"
                    autoComplete="address-level1"
                    style={{ ...addressInputStyle, textTransform: "uppercase" }}
                    required
                  />
                </label>
                <label style={addressLabelStyle}>
                  <span style={addressFieldLabelStyle}>ZIP</span>
                  <input
                    type="text"
                    value={address.zip}
                    onChange={updateAddress("zip")}
                    placeholder="78701"
                    maxLength={5}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    style={addressInputStyle}
                    required
                  />
                </label>
              </div>
            </div>
            {state.error !== null ? (
              <div style={errorStyle} role="alert">
                {state.error}
              </div>
            ) : null}
            <div style={addressButtonsStyle}>
              <button
                type="button"
                onClick={() => {
                  setState({
                    kind: "slots",
                    slots: [],
                    loading: false,
                    error: null,
                  });
                  void fetchSlots(scope);
                }}
                style={secondaryButtonStyle}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleConfirm();
                }}
                style={primaryButtonStyle}
              >
                Confirm pickup
              </button>
            </div>
          </>
        ) : null}

        {state.kind === "booking" ? (
          <ProgressBar
            phases={SCHEDULE_PHASES}
            activePhaseId={state.phase}
            ariaLabel="Scheduling progress"
          />
        ) : null}

        {state.kind === "confirmed" ? (
          <>
            <div style={confirmedStyle}>
              <div>
                <strong>{state.slot.displayLabel}</strong>
              </div>
              <div style={addressBlockStyle}>
                {state.address.street}
                <br />
                {state.address.city}, {state.address.state.toUpperCase()}{" "}
                {state.address.zip}
              </div>
              <div style={confirmedSubStyle}>
                Scope: {state.scope}. You&rsquo;ll get a confirmation by SMS
                in production; in this demo the chat above keeps the record.
              </div>
            </div>
          </>
        ) : null}
      </div>
    );
  }, [
    address,
    close,
    fetchSlots,
    handleConfirm,
    handleSlotPick,
    scope,
    state,
    updateAddress,
  ]);

  return {
    open,
    panel,
    busy: state.kind !== "closed",
  };
}

/**
 * Backwards-compatible all-in-one widget: renders its own CTA button
 * (in a `.cta-row` so it can share visual styling with the OCR CTAs)
 * and the expanded panel together.
 */
export function Scheduler(props: SchedulerProps): JSX.Element {
  const { open, panel, busy } = useScheduler(props);
  return (
    <div>
      <div className="cta-row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="cta cta-ghost"
          onClick={open}
          disabled={busy}
          aria-label="Schedule pickup"
        >
          Schedule pickup
        </button>
      </div>
      {panel}
    </div>
  );
}

/**
 * Validate an address client-side. Returns null on OK, or a calm
 * user-facing message naming the missing/invalid field.
 */
function validateAddress(a: PickupAddress): string | null {
  if (a.street.trim() === "") return "Street address is required.";
  if (a.city.trim() === "") return "City is required.";
  if (!/^[A-Za-z]{2}$/.test(a.state.trim())) {
    return "State must be a 2-letter US code (TX, CA, NY).";
  }
  if (!/^\d{5}$/.test(a.zip.trim())) {
    return "ZIP must be 5 digits.";
  }
  return null;
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
  marginBottom: 10,
};
const closeButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#475569",
  border: "none",
  cursor: "pointer",
  fontSize: 12,
};
const scopePickerStyle: React.CSSProperties = {
  marginBottom: 12,
};
const scopeLabelStyle: React.CSSProperties = {
  fontSize: 13,
};
const selectStyle: React.CSSProperties = {
  fontSize: 13,
  padding: 4,
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f2747",
};
const slotGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap: 6,
};
const slotButtonStyle: React.CSSProperties = {
  background: "#ffffff",
  color: "#0f2747",
  border: "1px solid #cbd5e1",
  padding: "8px 10px",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
  textAlign: "left",
};
const messageStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#475569",
  margin: "6px 0",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};
const errorStyle: React.CSSProperties = {
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  padding: "6px 10px",
  borderRadius: 6,
  fontSize: 13,
  marginBottom: 8,
};
const addressGridStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  margin: "10px 0",
};
const addressLabelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  flex: 1,
};
const addressFieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const addressInputStyle: React.CSSProperties = {
  fontSize: 14,
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  color: "#0f2747",
  background: "#ffffff",
  fontFamily: "inherit",
};
const stateZipRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
};
const addressButtonsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  justifyContent: "flex-end",
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
const confirmedStyle: React.CSSProperties = {
  background: "#ecfdf5",
  border: "1px solid #6ee7b7",
  color: "#065f46",
  padding: "10px 12px",
  borderRadius: 8,
  fontSize: 13,
};
const addressBlockStyle: React.CSSProperties = {
  marginTop: 6,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};
const confirmedSubStyle: React.CSSProperties = {
  marginTop: 6,
  color: "#047857",
  fontSize: 12,
};
