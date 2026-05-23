/**
 * Atomic slot allocation via BEGIN IMMEDIATE + UNIQUE constraint.
 *
 * This is the load-bearing piece of constitutional non-negotiable 12.
 * Concurrency test in tests/integration/scheduler-concurrency.test.ts
 * fires 10 parallel bookings of the same slot and asserts exactly 1
 * success + 9 conflict errors. CAT-14 regression if more than one wins.
 *
 * Implementation:
 *   - BEGIN IMMEDIATE acquires a RESERVED lock immediately (vs deferred
 *     transactions which only grab the lock at first write). Without
 *     IMMEDIATE, two concurrent INSERTs can each pass the UNIQUE pre-check
 *     and race the actual write — one wins on the write but both can
 *     misreport success.
 *   - The UNIQUE(slot_start, scope) constraint enforces uniqueness at the
 *     storage layer regardless of how the application logic is wired.
 *   - SQLITE_CONSTRAINT_UNIQUE error code 19 maps to BookingConflict.
 */
import type { SchedulerDb } from "./db.js";

export type BookingResult =
  | { kind: "booked"; slotStart: string; scope: string; userId: string }
  | { kind: "conflict"; slotStart: string; scope: string; reason: string };

export function bookSlot(
  db: SchedulerDb,
  args: { slotStart: string; scope: string; userId: string },
): BookingResult {
  const { slotStart, scope, userId } = args;

  // BEGIN IMMEDIATE so the writer lock is acquired before any read in this
  // transaction. Without it, two callers can both observe "slot is open"
  // and then both attempt INSERT — only one wins at the storage layer but
  // both observe a different snapshot, which makes diagnosis hard.
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO appointments (slot_start, scope, user_id) VALUES (?, ?, ?)",
    ).run(slotStart, scope, userId);
    db.exec("COMMIT");
    return { kind: "booked", slotStart, scope, userId };
  } catch (err) {
    db.exec("ROLLBACK");
    // better-sqlite3 throws a SqliteError with .code === "SQLITE_CONSTRAINT_UNIQUE"
    // on UNIQUE violation. Any other error type bubbles up as a real failure.
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      return {
        kind: "conflict",
        slotStart,
        scope,
        reason:
          "That slot was taken in the moment between when you saw it and when you tapped it. Pick one of the next available slots.",
      };
    }
    throw err;
  }
}
