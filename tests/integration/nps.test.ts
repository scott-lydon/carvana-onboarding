// @vitest-environment node
/**
 * /api/nps/submit + /api/nps/summary integration tests.
 *
 * - Input validation (score range, elapsedSeconds, sessionId).
 * - Round-trip: submit a few rows, verify summary computes NPS correctly
 *   per the Bain definition: ((promoters - detractors) / n) * 100.
 * - Constitutional rule 13: the summary response carries a `labeling`
 *   string with n + the source, so consumers cannot drop a number into
 *   the deck without context.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import express, { type Request, type Response } from "express";
import { openSchedulerDb, type SchedulerDb } from "../../server/scheduler/db.ts";
import {
  makeNpsSubmitHandler,
  makeNpsSummaryHandler,
} from "../../server/routes/nps.ts";

interface TestApp {
  port: number;
  close: () => Promise<void>;
}

async function startApp(db: SchedulerDb): Promise<TestApp> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const submit = makeNpsSubmitHandler(db);
  const summary = makeNpsSummaryHandler(db);
  app.post("/api/nps/submit", (req: Request, res: Response): void => {
    submit(req, res);
  });
  app.get("/api/nps/summary", (req: Request, res: Response): void => {
    summary(req, res);
  });
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Test server failed to bind.");
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((res) => {
            server.close(() => {
              res();
            });
          }),
      });
    });
  });
}

describe("NPS submit/summary", () => {
  let db: SchedulerDb;
  let app: TestApp;
  beforeEach(async () => {
    db = openSchedulerDb(":memory:");
    app = await startApp(db);
  });
  afterEach(async () => {
    await app.close();
  });

  it("400 on score outside 0-10", async () => {
    const response = await fetch(
      `http://127.0.0.1:${String(app.port)}/api/nps/submit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score: 11,
          elapsedSeconds: 60,
          sessionId: "s1",
        }),
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("format_error");
    expect(body.field).toBe("score");
  });

  it("400 on missing sessionId", async () => {
    const response = await fetch(
      `http://127.0.0.1:${String(app.port)}/api/nps/submit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: 9, elapsedSeconds: 60, sessionId: "" }),
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.field).toBe("sessionId");
  });

  it("summary reports n=0 with labeling when no rows", async () => {
    const response = await fetch(
      `http://127.0.0.1:${String(app.port)}/api/nps/summary`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe("summary");
    expect(body.n).toBe(0);
    expect(body.score).toBeNull();
    expect(typeof body.labeling).toBe("string");
    expect(String(body.labeling)).toMatch(/No demo respondents yet/i);
  });

  it("summary computes NPS = ((promoters - detractors) / n) * 100", async () => {
    // 2 promoters (9,10), 1 passive (8), 1 detractor (3)
    // (2 - 1) / 4 = 0.25 = 25
    const scores = [9, 10, 8, 3];
    for (let i = 0; i < scores.length; i += 1) {
      await fetch(`http://127.0.0.1:${String(app.port)}/api/nps/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score: scores[i],
          elapsedSeconds: 120 + i,
          sessionId: `s${String(i)}`,
        }),
      });
    }
    const response = await fetch(
      `http://127.0.0.1:${String(app.port)}/api/nps/summary`,
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.n).toBe(4);
    expect(body.score).toBe(25);
    expect(body.breakdown).toEqual({
      promoters: 2,
      passives: 1,
      detractors: 1,
    });
    expect(String(body.labeling)).toMatch(/n=4 real demo respondents/);
  });
});
