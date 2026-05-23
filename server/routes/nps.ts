/**
 * /api/nps/submit (POST) and /api/nps/summary (GET).
 *
 * Stores NPS responses + completion times in SQLite alongside the
 * scheduler's appointments. Used by:
 *   - NpsSurvey React component, posts on submit
 *   - MetricsOverlay (dev-only ?metrics=1), polls summary for the
 *     on-page metric panel
 *
 * NPS interpretation (scaled to a 1-5 grid per UX feedback that the
 * 0-10 scale felt over-precise):
 *   - 1-2 → detractor
 *   - 3   → passive
 *   - 4-5 → promoter
 *   - score = (% promoters) - (% detractors), same shape as Bain
 */
import type { Request, Response } from "express";
import type { SchedulerDb } from "../scheduler/db.js";

const MIN_SCORE = 1;
const MAX_SCORE = 5;

/**
 * Bootstrap schema. The table was historically defined with a
 * `CHECK (score >= 0 AND score <= 10)` constraint that would reject the
 * new 1-5 inputs on existing instances. SQLite does not support
 * `ALTER TABLE ... DROP CONSTRAINT`, so we detect the legacy schema and
 * rebuild via a copy-into-fresh-table dance. The migration is idempotent
 * and re-entrant — safe to run on every handler-factory call.
 */
const NPS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS nps_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= ${String(MIN_SCORE)} AND score <= ${String(MAX_SCORE)}),
  comment TEXT,
  elapsed_seconds INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

export function ensureNpsSchema(db: SchedulerDb): void {
  db.exec(NPS_TABLE_SQL);
  migrateLegacy0to10ScaleIfPresent(db);
}

/**
 * If a previously-deployed instance has the legacy `CHECK (score >= 0
 * AND score <= 10)` constraint, rebuild the table with the new 1-5
 * constraint. Pre-existing rows with score in [1..5] are preserved;
 * out-of-range rows are clamped to the nearest valid bucket so the
 * summary remains computable. Idempotent.
 */
function migrateLegacy0to10ScaleIfPresent(db: SchedulerDb): void {
  const row = db
    .prepare<[], { sql: string | null }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='nps_responses'",
    )
    .get();
  const sql = row?.sql ?? "";
  // The new schema includes `>= 1 AND score <= 5`; the legacy schema had
  // `>= 0 AND score <= 10`. If the legacy substring is still present we
  // do the rebuild dance.
  if (!sql.includes("score >= 0 AND score <= 10")) {
    return;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(
      `CREATE TABLE nps_responses_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        score INTEGER NOT NULL CHECK (score >= ${String(MIN_SCORE)} AND score <= ${String(MAX_SCORE)}),
        comment TEXT,
        elapsed_seconds INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );`,
    );
    // Down-scale legacy 0-10 rows into 1-5 buckets so they remain in the
    // summary instead of being lost. 0-2 → 1, 3-4 → 2, 5-6 → 3, 7-8 → 4,
    // 9-10 → 5. Clamp to [1..5].
    db.exec(
      `INSERT INTO nps_responses_new (id, session_id, score, comment, elapsed_seconds, created_at)
       SELECT id, session_id,
         CASE
           WHEN score <= 2 THEN 1
           WHEN score <= 4 THEN 2
           WHEN score <= 6 THEN 3
           WHEN score <= 8 THEN 4
           ELSE 5
         END AS score,
         comment, elapsed_seconds, created_at
       FROM nps_responses;`,
    );
    db.exec("DROP TABLE nps_responses;");
    db.exec("ALTER TABLE nps_responses_new RENAME TO nps_responses;");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function makeNpsSubmitHandler(db: SchedulerDb) {
  ensureNpsSchema(db);
  return (req: Request, res: Response): void => {
    const rawBody = req.body as unknown;
    if (typeof rawBody !== "object" || rawBody === null) {
      res.status(400).json({
        kind: "format_error",
        field: "body",
        reason: "body must be a JSON object with score, elapsedSeconds, sessionId",
      });
      return;
    }
    const body = rawBody as Record<string, unknown>;
    const score = body.score;
    const elapsedSeconds = body.elapsedSeconds;
    const sessionId = body.sessionId;
    const comment = body.comment;

    if (
      typeof score !== "number" ||
      !Number.isInteger(score) ||
      score < MIN_SCORE ||
      score > MAX_SCORE
    ) {
      res.status(400).json({
        kind: "format_error",
        field: "score",
        reason: `score must be an integer ${String(MIN_SCORE)}-${String(MAX_SCORE)}`,
      });
      return;
    }
    if (
      typeof elapsedSeconds !== "number" ||
      !Number.isFinite(elapsedSeconds) ||
      elapsedSeconds < 0
    ) {
      res.status(400).json({
        kind: "format_error",
        field: "elapsedSeconds",
        reason: "elapsedSeconds must be a non-negative number",
      });
      return;
    }
    if (typeof sessionId !== "string" || sessionId.trim() === "") {
      res.status(400).json({
        kind: "format_error",
        field: "sessionId",
        reason: "sessionId must be a non-empty string",
      });
      return;
    }
    const commentText =
      typeof comment === "string" && comment.trim() !== "" ? comment : null;

    db.prepare(
      "INSERT INTO nps_responses (session_id, score, comment, elapsed_seconds) VALUES (?, ?, ?, ?)",
    ).run(sessionId, score, commentText, Math.round(elapsedSeconds));

    res.status(200).json({ kind: "recorded" });
  };
}

export function makeNpsSummaryHandler(db: SchedulerDb) {
  ensureNpsSchema(db);
  return (_req: Request, res: Response): void => {
    const rows = db
      .prepare<
        [],
        { score: number; elapsed_seconds: number }
      >("SELECT score, elapsed_seconds FROM nps_responses")
      .all();
    const n = rows.length;
    if (n === 0) {
      res.status(200).json({
        kind: "summary",
        n: 0,
        score: null,
        averageElapsedSeconds: null,
        breakdown: { promoters: 0, passives: 0, detractors: 0 },
        labeling:
          "No demo respondents yet. Run the flow end-to-end and submit the NPS survey to populate this.",
      });
      return;
    }
    let promoters = 0;
    let passives = 0;
    let detractors = 0;
    let elapsedSum = 0;
    for (const r of rows) {
      if (r.score >= 4) promoters += 1;
      else if (r.score === 3) passives += 1;
      else detractors += 1;
      elapsedSum += r.elapsed_seconds;
    }
    const npsScore = ((promoters - detractors) / n) * 100;
    res.status(200).json({
      kind: "summary",
      n,
      score: Math.round(npsScore),
      averageElapsedSeconds: Math.round(elapsedSum / n),
      breakdown: { promoters, passives, detractors },
      labeling: `n=${String(n)} real demo respondents (1-5 scale: 1-2 detractor, 3 passive, 4-5 promoter). NPS = ((${String(promoters)} promoters - ${String(detractors)} detractors) / ${String(n)}) × 100.`,
    });
  };
}
