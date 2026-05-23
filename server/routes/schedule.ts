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
import { bookSlot } from "../scheduler/atomicity.js";

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
    const result = bookSlot(db, { slotStart, scope, userId });
    res.status(result.kind === "booked" ? 200 : 409).json(result);
  };
}

function isValidScope(value: string): boolean {
  return /^zip:\d{5}$/.test(value) || /^hub:[a-z_]+$/.test(value);
}

function isIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}T/.test(value);
}
