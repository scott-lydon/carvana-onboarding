/**
 * Chat-accuracy eval — top-level test wrapper.
 *
 * Discovers every `*.json` fixture under `tests/eval/fixtures/`, validates
 * each one against the Fixture schema (a malformed fixture fails LOUDLY
 * instead of silently skipping), runs each fixture against a single shared
 * Express server hosting the production chat handler, and asserts the
 * per-fixture results.
 *
 * Default vitest `include` filter is `tests/**\/*.test.ts`, so this `.eval.ts`
 * file does not run on `npm test`. It runs only via `npm run test:eval`,
 * which targets `tests/eval` explicitly. That separation keeps the default
 * suite fast (no live LLM calls, no vendor credentials needed) while still
 * letting the eval gate be a single one-command operation when you want it.
 *
 * Auto-skip rules:
 *   - No ANTHROPIC_API_KEY in env  -> every fixture marked SKIPPED.
 *   - Fixture lists requiredEnv that is missing  -> only that fixture SKIPPED.
 *
 * Exit behaviour:
 *   - At least one fixture FAILED -> the `it.each` block raises and vitest
 *     reports the failure with the per-assertion diagnostic.
 *   - All passed or all skipped   -> green, with the structured per-pillar
 *     summary printed via `formatReport`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatReport,
  runFixture,
  startEvalServer,
  validateFixture,
  type EvalServer,
} from "./harness.ts";
import type { Fixture, FixtureResult } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

function loadFixtures(): ReadonlyArray<Fixture> {
  if (!fs.existsSync(FIXTURES_DIR)) {
    throw new Error(
      `Fixtures directory missing at ${FIXTURES_DIR}. The eval cannot run with zero fixtures.`,
    );
  }
  const files = fs
    .readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new Error(
      `No *.json fixtures found in ${FIXTURES_DIR}. The eval cannot run with zero fixtures.`,
    );
  }
  return files.map((file) => {
    const full = path.join(FIXTURES_DIR, file);
    const raw = JSON.parse(fs.readFileSync(full, "utf8")) as unknown;
    return validateFixture(raw, file);
  });
}

const FIXTURES = loadFixtures();
const ANTHROPIC = process.env.ANTHROPIC_API_KEY ?? "";
const HAS_ANTHROPIC = ANTHROPIC.trim() !== "";

describe("chat accuracy eval", () => {
  let server: EvalServer | undefined;
  const results: FixtureResult[] = [];

  beforeAll(async () => {
    if (!HAS_ANTHROPIC) {
      console.log(
        "[chat-accuracy eval] SKIP all fixtures: ANTHROPIC_API_KEY is unset. " +
          "Sign up: https://console.anthropic.com/settings/keys " +
          "Set ANTHROPIC_API_KEY in your shell or .env.local and re-run `npm run test:eval`.",
      );
      return;
    }
    server = await startEvalServer(process.env);
    if (server === undefined) {
      throw new Error(
        "[chat-accuracy eval] HARNESS BUG: ANTHROPIC_API_KEY was set but startEvalServer returned undefined. " +
          "Check makeChatHandler's gating logic.",
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (server !== undefined) {
      await server.close();
    }
    // Per-pillar tally printed once after the suite completes so CI logs
    // carry a structured grade even if individual tests pass quickly.
    if (results.length > 0) {
      console.log(formatReport(results));
    }
  });

  it.each(FIXTURES.map((f) => [f.id, f]))(
    "%s",
    async (_id, fixture) => {
      if (!HAS_ANTHROPIC) {
        const skipped: FixtureResult = {
          fixtureId: fixture.id,
          category: fixture.category,
          status: "skipped",
          skippedReason: "ANTHROPIC_API_KEY unset",
          failures: [],
          fullProse: "",
          toolCalls: [],
        };
        results.push(skipped);
        return;
      }
      if (server === undefined) {
        throw new Error(
          `[${fixture.id}] HARNESS BUG: server was not started but ANTHROPIC_API_KEY is set.`,
        );
      }
      const result = await runFixture(fixture, server.port, process.env);
      results.push(result);
      if (result.status === "skipped") {
        // Skipped fixtures do not fail the test but are tallied in the
        // per-pillar summary. Vitest will still mark the case as passing
        // because no expectation was violated.
        console.log(
          `[${fixture.id}] SKIPPED: ${result.skippedReason ?? "(no reason recorded)"}`,
        );
        return;
      }
      if (result.status === "failed") {
        const lines = result.failures.map(
          (f, i) => `  ${String(i + 1)}. [${f.kind}] ${f.detail}`,
        );
        const toolSummary = result.toolCalls
          .map((c) => `${c.name}(${typeof c.result === "object" && c.result !== null ? "kind=" + String((c.result as Record<string, unknown>).kind ?? "?") : typeof c.result})`)
          .join(", ");
        // Dump the full prose on every failure so a grader can see what
        // the chatbot actually said without having to re-run the fixture
        // with a higher log verbosity. The prose is the system-under-test;
        // hiding it on failure defeats the eval's whole purpose.
        throw new Error(
          [
            `Fixture ${fixture.id} (${fixture.category}) failed ${String(result.failures.length)} assertion(s):`,
            ...lines,
            `Tool calls observed: [${toolSummary}]`,
            `Assistant prose:`,
            result.fullProse === "" ? "  <empty>" : result.fullProse.split("\n").map((l) => `  ${l}`).join("\n"),
            `Description: ${fixture.description}`,
          ].join("\n"),
        );
      }
      expect(result.status).toBe("passed");
    },
    // Real LLM + cascade per turn; allow generous wall clock. Fast paths
    // typically settle in ~3-6 seconds on Haiku 4.5.
    60_000,
  );
});
