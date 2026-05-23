/**
 * /api/schedule/slots (GET)  — return the next-14-days slot grid for a scope.
 * /api/schedule/book  (POST) — atomic booking with BEGIN IMMEDIATE.
 *
 * Scope shape:
 *   - "zip:78701" for home pickup at a 5-digit zip
 *   - "hub:austin", "hub:houston", "hub:dallas" for Carvana hub dropoff
 *
 * Per the constitution, errors flow as structured JSON bodies, not as
 * exception messages. The atomic-booking conflict is its own discriminated
 * kind so the client can render the right copy ("that slot just got taken").
 */
import type { Request, Response } from "express";
import type { SchedulerDb } from "../scheduler/db.js";
import { availableSlots } from "../scheduler/slots.js";
import { bookSlot, type BookingAddress } from "../scheduler/atomicity.js";

export function makeSlotsHandler(db: SchedulerDb) {
  return (req: Request, res: Response): void => {
    const scope = typeof req.query.scope === "string" ? req.query.scope : "";
    if (!isValidScope(scope)) {
      res.status(400).json({
        kind: "format_error",
        field: "scope",
        reason:
          'scope must be of the form "zip:<5 digits>" or "hub:<location>"',
      });
      return;
    }
    const slots = availableSlots(db, scope);
    res.status(200).json({ kind: "ok", scope, slots });
  };
}

export function makeBookHandler(db: SchedulerDb) {
  return (req: Request, res: Response): void => {
    const rawBody = req.body as unknown;
    if (typeof rawBody !== "object" || rawBody === null) {
      res.status(400).json({
        kind: "format_error",
        field: "body",
        reason: "body must be a JSON object with slotStart, scope, userId",
      });
      return;
    }
    const body = rawBody as Record<string, unknown>;
    const slotStart = body.slotStart;
    const scope = body.scope;
    const userId = body.userId;
    if (typeof slotStart !== "string" || !isIsoTimestamp(slotStart)) {
      res.status(400).json({
        kind: "format_error",
        field: "slotStart",
        reason: "slotStart must be an ISO 8601 timestamp like 2026-05-23T15:00:00.000Z",
      });
      return;
    }
    if (typeof scope !== "string" || !isValidScope(scope)) {
      res.status(400).json({
        kind: "format_error",
        field: "scope",
        reason: 'scope must be "zip:<5 digits>" or "hub:<location>"',
      });
      return;
    }
    if (typeof userId !== "string" || userId.trim() === "") {
      res.status(400).json({
        kind: "format_error",
        field: "userId",
        reason: "userId must be a non-empty string (session id or chat id)",
      });
      return;
    }
    // Address is optional at the wire level for back-compat with the
    // legacy bookSlot tests; when present it must be a complete object.
    let address: BookingAddress | undefined;
    if (body.address !== undefined) {
      const parsed = parseAddress(body.address);
      if (parsed === null) {
        res.status(400).json({
          kind: "format_error",
          field: "address",
          reason:
            "address must be {street, city, state(2 letters), zip(5 digits)} with non-empty strings",
        });
        return;
      }
      address = parsed;
    }
    const result = bookSlot(db, {
      slotStart,
      scope,
      userId,
      ...(address !== undefined ? { address } : {}),
    });
    res.status(result.kind === "booked" ? 200 : 409).json(result);
  };
}

/**
 * Narrow an unknown wire payload to a BookingAddress with strict
 * field-level validation. Returns null on any failure; the route handler
 * surfaces a 400 with a single named reason.
 */
function parseAddress(input: unknown): BookingAddress | null {
  if (typeof input !== "object" || input === null) return null;
  const obj = input as Record<string, unknown>;
  const street = obj.street;
  const city = obj.city;
  const state = obj.state;
  const zip = obj.zip;
  if (
    typeof street !== "string" ||
    typeof city !== "string" ||
    typeof state !== "string" ||
    typeof zip !== "string"
  ) {
    return null;
  }
  const streetT = street.trim();
  const cityT = city.trim();
  const stateT = state.trim().toUpperCase();
  const zipT = zip.trim();
  if (streetT === "" || cityT === "") return null;
  if (!/^[A-Z]{2}$/.test(stateT)) return null;
  if (!/^\d{5}$/.test(zipT)) return null;
  return { street: streetT, city: cityT, state: stateT, zip: zipT };
}

function isValidScope(value: string): boolean {
  return /^zip:\d{5}$/.test(value) || /^hub:[a-z_]+$/.test(value);
}

function isIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}T/.test(value);
}
