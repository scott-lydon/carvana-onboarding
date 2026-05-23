/**
 * SQLite schema + singleton DB instance for the v2 scheduler.
 *
 * Storage: a single file on disk (default ./data/scheduler.db; override
 * via SCHEDULER_DB_PATH). Tests pass ":memory:" so each suite gets a
 * clean isolated database. Render free-tier disks are ephemeral, which
 * is fine for the demo — the v2 PRD says "demo concurrency is low" and
 * we are not promising persistence across redeploys.
 *
 * Schema decisions:
 *   - `appointments(slot_start, scope, ...)` with UNIQUE(slot_start, scope)
 *     so a single SQL constraint enforces no-double-booking. Combined
 *     with BEGIN IMMEDIATE in atomicity.ts, this is the simplest correct
 *     atomic-slot-allocation pattern available in SQLite.
 *   - `scope` is either the seller's zip (home pickup) or the hub code
 *     (e.g. "carvana_hub_austin"). Independent dimensions can book the
 *     same wall-clock slot.
 *   - `slot_start` stored as ISO 8601 string (TEXT) because SQLite has no
 *     native TIMESTAMP and stringy ISO 8601 sorts correctly.
 */
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export type SchedulerDb = Database.Database;

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS appointments (
     slot_start TEXT NOT NULL,
     scope TEXT NOT NULL,
     user_id TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'booked',
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (slot_start, scope)
   );`,
  `CREATE INDEX IF NOT EXISTS idx_appointments_scope_day
     ON appointments(scope, slot_start);`,
];

/**
 * Apply schema patches that ALTER an existing table. SQLite doesn't
 * support `ADD COLUMN IF NOT EXISTS`, so we check PRAGMA table_info
 * and run ALTER only when the column is missing. Idempotent.
 */
function applyPostMigrations(db: SchedulerDb): void {
  const cols = db
    .prepare<[], { name: string }>("PRAGMA table_info(appointments)")
    .all();
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("address_json")) {
    db.exec("ALTER TABLE appointments ADD COLUMN address_json TEXT");
  }
}

/**
 * Open or create the scheduler DB. Idempotent — safe to call multiple
 * times from tests. Migrations run on every call so the schema is
 * guaranteed-current.
 */
export function openSchedulerDb(dbPath: string): SchedulerDb {
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  for (const sql of MIGRATIONS) db.exec(sql);
  applyPostMigrations(db);
  return db;
}

let DEFAULT_DB: SchedulerDb | null = null;

/**
 * Get the process-wide default scheduler DB (lazy). Server callers use
 * this; tests construct their own via openSchedulerDb(":memory:").
 */
export function getDefaultSchedulerDb(): SchedulerDb {
  if (DEFAULT_DB === null) {
    const fromEnv = process.env.SCHEDULER_DB_PATH;
    const dbPath =
      fromEnv !== undefined && fromEnv !== ""
        ? fromEnv
        : path.join(process.cwd(), "data", "scheduler.db");
    DEFAULT_DB = openSchedulerDb(dbPath);
  }
  return DEFAULT_DB;
}
