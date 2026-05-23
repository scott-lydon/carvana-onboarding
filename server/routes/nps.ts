/**
 * /api/nps/submit (POST) and /api/nps/summary (GET).
 *
 * Stores NPS responses + completion times in SQLite alongside the
 * scheduler's appointments. Used by:
 *   - NpsSurvey React component, posts on submit
 *   - MetricsOverlay (dev-only ?metrics=1), polls summary for the
 *     on-page metric panel
 *   - The architecture-website pitch slide (slice G) will cite the
 *     summary with n + source labeling per constitutional rule 13.
 *
 * NPS interpretation (standard Bain definition):
 *   - 0-6  → detractor
 *   - 7-8  → passive
 *   - 9-10 → promoter
 *   - score = (% promoters) - (% detractors)
 */
import type { Request, Response } from "express";
import type { SchedulerDb } from "../scheduler/db.js";

const NPS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS nps_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 10),
  comment TEXT,
  elapsed_seconds INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

export function ensureNpsSchema(db: SchedulerDb): void {
  db.exec(NPS_TABLE_SQL);
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
      score < 0 ||
      score > 10
    ) {
      res.status(400).json({
        kind: "format_error",
        field: "score",
        reason: "score must be an integer 0-10",
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
      if (r.score >= 9) promoters += 1;
      else if (r.score >= 7) passives += 1;
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
      // Constitutional rule 13: NPS data is real or labeled. This number
      // is labeled with n so any consumer (architecture website slice,
      // interview-prep deck) cannot present it without the sample size.
      labeling: `n=${String(n)} real demo respondents. NPS = ((${String(promoters)} promoters - ${String(detractors)} detractors) / ${String(n)}) × 100.`,
    });
  };
}
