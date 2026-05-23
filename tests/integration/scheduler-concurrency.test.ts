/**
 * CAT-14 — Atomic slot allocation (constitutional non-negotiable 12).
 *
 * Fires N parallel bookings of the same (slot_start, scope) and asserts
 * EXACTLY 1 booked + (N-1) conflicts. If any concurrent booking sneaks
 * through, that's a CAT-14 regression and the slot-doubling bug the
 * constitution rules out.
 *
 * Uses ":memory:" SQLite so the test is hermetic.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { openSchedulerDb, type SchedulerDb } from "../../server/scheduler/db.ts";
import { bookSlot } from "../../server/scheduler/atomicity.ts";

describe("CAT-14: atomic slot allocation", () => {
  let db: SchedulerDb;
  beforeEach(() => {
    db = openSchedulerDb(":memory:");
  });

  it("10 parallel bookings of the same slot result in exactly 1 success", async () => {
    const N = 10;
    const slotStart = "2026-05-24T15:00:00.000Z";
    const scope = "zip:78701";

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        Promise.resolve(
          bookSlot(db, { slotStart, scope, userId: `user-${String(i)}` }),
        ),
      ),
    );

    const booked = results.filter((r) => r.kind === "booked");
    const conflicts = results.filter((r) => r.kind === "conflict");
    expect(booked.length, "exactly one booking should succeed").toBe(1);
    expect(conflicts.length, "the other N-1 must be conflicts").toBe(N - 1);
    // Each conflict carries a non-empty user-facing reason. (The filter
    // above narrows the type to the conflict variant; TS knows
    // c.kind is "conflict" so reason is always present.)
    for (const c of conflicts) {
      expect(typeof c.reason).toBe("string");
      expect(c.reason.length).toBeGreaterThan(20);
    }
  });

  it("different scopes at the same slot_start both succeed", () => {
    const slotStart = "2026-05-24T16:00:00.000Z";
    const a = bookSlot(db, { slotStart, scope: "zip:78701", userId: "u1" });
    const b = bookSlot(db, { slotStart, scope: "hub:austin", userId: "u2" });
    expect(a.kind).toBe("booked");
    expect(b.kind).toBe("booked");
  });

  it("re-booking the same (slot_start, scope) by a different user yields conflict", () => {
    const slotStart = "2026-05-25T10:00:00.000Z";
    const scope = "zip:78701";
    const first = bookSlot(db, { slotStart, scope, userId: "u1" });
    const second = bookSlot(db, { slotStart, scope, userId: "u2" });
    expect(first.kind).toBe("booked");
    expect(second.kind).toBe("conflict");
  });
});
