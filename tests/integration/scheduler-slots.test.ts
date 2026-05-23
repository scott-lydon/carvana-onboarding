/**
 * Slot generation tests — the deterministic grid drops past times today,
 * generates 8 slots per future day, and excludes already-booked slots.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { openSchedulerDb, type SchedulerDb } from "../../server/scheduler/db.ts";
import { availableSlots } from "../../server/scheduler/slots.ts";
import { bookSlot } from "../../server/scheduler/atomicity.ts";

describe("availableSlots", () => {
  let db: SchedulerDb;
  beforeEach(() => {
    db = openSchedulerDb(":memory:");
  });

  it("generates 8 slots per day across the horizon for a fresh DB", () => {
    // Anchor "now" at midnight so today's 8 slots all count as future.
    const now = new Date("2026-05-22T00:00:00.000Z");
    const slots = availableSlots(db, "zip:78701", { horizonDays: 7, now });
    expect(slots.length).toBe(7 * 8);
  });

  it("drops past times today", () => {
    const now = new Date("2026-05-22T14:30:00.000Z"); // 2:30pm — slots at 9-14 are past
    const slots = availableSlots(db, "zip:78701", { horizonDays: 1, now });
    // Today: 15, 16 are future (2 slots).
    expect(slots.length).toBe(2);
  });

  it("excludes already-booked slots", () => {
    const now = new Date("2026-05-22T00:00:00.000Z");
    const before = availableSlots(db, "zip:78701", { horizonDays: 1, now });
    expect(before.length).toBe(8);
    const firstSlot = before[0];
    if (firstSlot === undefined) throw new Error("expected at least one slot");
    bookSlot(db, {
      slotStart: firstSlot.slotStart,
      scope: "zip:78701",
      userId: "u1",
    });
    const after = availableSlots(db, "zip:78701", { horizonDays: 1, now });
    expect(after.length).toBe(7);
    expect(after.find((s) => s.slotStart === firstSlot.slotStart)).toBeUndefined();
  });

  it("scopes are independent — booking at zip:X does not affect hub:Y", () => {
    const now = new Date("2026-05-22T00:00:00.000Z");
    // Book a slot in the grid (the 09:00 UTC slot, deterministic in
    // UTC-anchored slot generation) for zip:78701.
    bookSlot(db, {
      slotStart: "2026-05-22T09:00:00.000Z",
      scope: "zip:78701",
      userId: "u1",
    });
    const hubSlots = availableSlots(db, "hub:austin", { horizonDays: 1, now });
    expect(hubSlots.length).toBe(8);
  });
});
