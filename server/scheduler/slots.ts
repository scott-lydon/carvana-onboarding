/**
 * Deterministic slot generation + availability query.
 *
 * Slot grid:
 *   - 8 slots/day, every weekday and weekend, between 9 AM and 5 PM (local
 *     time interpreted as America/Chicago — the Texas-default cohort).
 *   - 14-day window starting today (excluding past times today).
 *
 * "Available" = slot is in the grid AND not already booked for the given
 * scope. Hub locations and home zips are independent scopes, so the same
 * wall-clock slot at the Austin hub can coexist with one at a Houston zip.
 */
import type { SchedulerDb } from "./db.js";

export interface Slot {
  /** ISO 8601 in UTC, e.g. "2026-05-23T15:00:00.000Z". */
  readonly slotStart: string;
  /** Either a 5-digit zip (home pickup) or a hub code ("carvana_hub_austin"). */
  readonly scope: string;
  /** Display label for the UI, e.g. "Sat May 24, 10:00 AM". */
  readonly displayLabel: string;
}

const SLOT_HOURS_LOCAL: readonly number[] = [
  9, 10, 11, 12, 13, 14, 15, 16,
];
const DEFAULT_HORIZON_DAYS = 14;

/**
 * Generate the deterministic slot grid for a scope over the next
 * `horizonDays` days, MINUS slots already booked in the DB.
 */
export function availableSlots(
  db: SchedulerDb,
  scope: string,
  options: { horizonDays?: number; now?: Date } = {},
): Slot[] {
  const horizonDays = options.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const now = options.now ?? new Date();
  const all = generateAllSlots(scope, now, horizonDays);
  const bookedRows = db
    .prepare<
      [string, string, string],
      { slot_start: string }
    >("SELECT slot_start FROM appointments WHERE scope = ? AND slot_start >= ? AND slot_start <= ?")
    .all(scope, all[0]?.slotStart ?? "", all[all.length - 1]?.slotStart ?? "");
  const bookedSet = new Set(bookedRows.map((r) => r.slot_start));
  return all.filter((s) => !bookedSet.has(s.slotStart));
}

/**
 * Build the candidate-slot list for a scope. Slots are anchored at UTC
 * midnight of `now` and emitted at UTC hours from SLOT_HOURS_LOCAL.
 * Past times today are skipped.
 *
 * Why UTC anchoring instead of local: the slot grid needs to be
 * deterministic across CI machines in different timezones. Display
 * conversion to local time is the renderer's job (see formatDisplayLabel).
 */
function generateAllSlots(scope: string, now: Date, horizonDays: number): Slot[] {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const MS_PER_HOUR = 60 * 60 * 1000;
  const nowMs = now.getTime();
  const todayUtcMidnightMs = Math.floor(nowMs / MS_PER_DAY) * MS_PER_DAY;
  const out: Slot[] = [];
  for (let dayOffset = 0; dayOffset < horizonDays; dayOffset += 1) {
    const dayBaseMs = todayUtcMidnightMs + dayOffset * MS_PER_DAY;
    for (const hour of SLOT_HOURS_LOCAL) {
      const slotMs = dayBaseMs + hour * MS_PER_HOUR;
      if (slotMs < nowMs) continue;
      const slotDate = new Date(slotMs);
      out.push({
        slotStart: slotDate.toISOString(),
        scope,
        displayLabel: formatDisplayLabel(slotDate),
      });
    }
  }
  return out;
}

/**
 * Human-friendly label for the UI. Example: "Sat May 24, 10:00 AM".
 * Uses Intl.DateTimeFormat so it adapts to the browser locale.
 */
function formatDisplayLabel(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return fmt.format(d);
}
