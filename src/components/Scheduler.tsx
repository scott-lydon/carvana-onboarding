/**
 * Scheduler — v2 slice C calendar UI for pickup booking.
 *
 * Three states:
 *   1. closed (idle) → "Schedule pickup" button
 *   2. open → grid of available slots for the selected scope
 *   3. booking → POST /api/schedule/book; on success calls
 *      onPickupBooked(label, scope), parent injects "Pickup booked: ..."
 *      as a new user message.
 *
 * Scope picker: zip (home pickup) defaults to 78701 (Texas baseline for
 * the v2 demo). Hub option offers Austin / Houston / Dallas.
 *
 * Atomicity: on a 409 from /api/schedule/book the UI re-queries
 * /api/schedule/slots so the user sees a fresh availability list (the
 * slot they tapped just got taken — race window between view and click).
 */
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

export interface SchedulerProps {
  /** Called when a slot is booked successfully (passes the human label + scope for the chat injection). */
  onPickupBooked: (displayLabel: string, scope: string) => void;
  /** Identifier for the booking (chat session id; for the demo we use a random id). */
  userId: string;
}

interface SlotView {
  readonly slotStart: string;
  readonly displayLabel: string;
}

type SchedulerState =
  | { kind: "closed" }
  | { kind: "open"; slots: SlotView[]; loading: boolean; error: string | null }
  | { kind: "booking"; slot: SlotView };

const DEFAULT_ZIP = "78701";
const HUB_OPTIONS: readonly { code: string; label: string }[] = [
  { code: "hub:austin", label: "Carvana hub — Austin" },
  { code: "hub:houston", label: "Carvana hub — Houston" },
  { code: "hub:dallas", label: "Carvana hub — Dallas" },
];

export function Scheduler({ onPickupBooked, userId }: SchedulerProps): JSX.Element {
  const [state, setState] = useState<SchedulerState>({ kind: "closed" });
  const [scope, setScope] = useState<string>(`zip:${DEFAULT_ZIP}`);

  const fetchSlots = useCallback(async (scopeToFetch: string) => {
    setState({ kind: "open", slots: [], loading: true, error: null });
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
      setState({ kind: "open", slots, loading: false, error: null });
    } catch (err) {
      setState({
        kind: "open",
        slots: [],
        loading: false,
        error: err instanceof Error ? err.message : "Could not load slots",
      });
    }
  }, []);

  useEffect(() => {
    if (state.kind === "open") {
      void fetchSlots(scope);
    }
    // We only refetch when the scope changes while open. The "open" state
    // change itself fires via handleOpenClick which already fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const handleOpenClick = useCallback(() => {
    void fetchSlots(scope);
  }, [fetchSlots, scope]);

  const handleSlotClick = useCallback(
    async (slot: SlotView) => {
      setState({ kind: "booking", slot });
      try {
        const response = await fetch("/api/schedule/book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slotStart: slot.slotStart,
            scope,
            userId,
          }),
        });
        const body = (await response.json()) as Record<string, unknown>;
        if (response.status === 200 && body.kind === "booked") {
          onPickupBooked(slot.displayLabel, scope);
          setState({ kind: "closed" });
          return;
        }
        // 409 conflict OR any other non-success: refetch slots and surface
        // the reason so the user can pick another.
        const reason =
          typeof body.reason === "string"
            ? body.reason
            : `Booking failed (status ${String(response.status)})`;
        await fetchSlots(scope);
        setState((prev) =>
          prev.kind === "open"
            ? { ...prev, error: reason }
            : { kind: "open", slots: [], loading: false, error: reason },
        );
      } catch (err) {
        setState({
          kind: "open",
          slots: [],
          loading: false,
          error: err instanceof Error ? err.message : "Booking failed",
        });
      }
    },
    [fetchSlots, onPickupBooked, scope, userId],
  );

  if (state.kind === "closed") {
    return (
      <button
        type="button"
        onClick={handleOpenClick}
        style={openButtonStyle}
        aria-label="Schedule pickup"
      >
        Schedule pickup
      </button>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <strong>Pick a pickup time</strong>
        <button
          type="button"
          onClick={() => {
            setState({ kind: "closed" });
          }}
          style={closeButtonStyle}
        >
          close
        </button>
      </div>
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
            <option value={`zip:${DEFAULT_ZIP}`}>Home pickup (zip 78701)</option>
            {HUB_OPTIONS.map((h) => (
              <option key={h.code} value={h.code}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state.kind === "open" && state.loading ? (
        <div style={messageStyle}>Loading available slots...</div>
      ) : null}
      {state.kind === "open" && state.error !== null ? (
        <div style={errorStyle} role="alert">
          {state.error}
        </div>
      ) : null}
      {state.kind === "open" && !state.loading ? (
        <div style={slotGridStyle}>
          {state.slots.length === 0 ? (
            <div style={messageStyle}>No available slots in the next 14 days.</div>
          ) : (
            state.slots.slice(0, 24).map((s) => (
              <button
                key={s.slotStart}
                type="button"
                onClick={() => {
                  void handleSlotClick(s);
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
      {state.kind === "booking" ? (
        <div style={messageStyle}>Booking {state.slot.displayLabel}...</div>
      ) : null}
    </div>
  );
}

const openButtonStyle: React.CSSProperties = {
  background: "#7c3aed",
  color: "white",
  border: "none",
  padding: "8px 14px",
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
  marginTop: 8,
};
const panelStyle: React.CSSProperties = {
  marginTop: 8,
  padding: 12,
  border: "1px solid #d1d5db",
  borderRadius: 10,
  background: "#fafafa",
};
const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 8,
};
const closeButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#6b7280",
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
};
const slotGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap: 6,
};
const slotButtonStyle: React.CSSProperties = {
  background: "white",
  color: "#1a1a1a",
  border: "1px solid #c7d2fe",
  padding: "6px 8px",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
  textAlign: "left",
};
const messageStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
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
