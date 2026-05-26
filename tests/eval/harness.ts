/**
 * Eval harness for the v2 chat handler.
 *
 * Boots a real Express server with the production chat route, exercises each
 * fixture by streaming a multi-turn conversation through the SSE endpoint,
 * and scores every assertion declaratively. No LLM-as-judge: assertions are
 * substring / regex / set-membership predicates against the captured stream
 * and the dispatcher's structured tool_result events.
 *
 * Why this harness exists separately from `tests/integration/*` and
 * `tests/adversary/*`: integration tests pin specific code paths in isolation
 * (one tool, one error case), and adversary tests pin specific regressions
 * (CAT-11 PII leak). This harness exists to score the chatbot's BEHAVIOUR
 * across rubric pillars on real live inputs — i.e. it answers "if we shipped
 * today, would the model still route a Carvana policy question through
 * lookup_carvana_facts, or would it improvise an answer?" That question is
 * meaningfully different from "does the route compile" and "did we fix
 * CAT-11", which is why an eval layer is the right shape.
 */
import http from "node:http";
import express, { type Request, type Response } from "express";
import {
  isChatConfigured,
  makeChatHandler,
} from "../../server/routes/chat.ts";
import { createCascade } from "../../src/lookup/createCascade.ts";
import {
  RUBRIC_CATEGORIES,
  type AssertionFailure,
  type Fixture,
  type FixtureAssertions,
  type FixtureResult,
  type RecordedToolCall,
  type RubricCategory,
  type UserTurn,
} from "./types.ts";

/** Server handle returned by `startEvalServer`. */
export interface EvalServer {
  readonly port: number;
  readonly close: () => Promise<void>;
}

/**
 * Boot a single Express server with the live chat handler and a real
 * VendorCascade. The eval harness reuses one server across all fixtures so
 * we pay startup cost once.
 *
 * Returns `undefined` when ANTHROPIC_API_KEY is missing — the caller treats
 * that as "skip every fixture" rather than failing CI on a machine without
 * credentials.
 */
export async function startEvalServer(env: NodeJS.ProcessEnv): Promise<EvalServer | undefined> {
  const apiKey = env.ANTHROPIC_API_KEY ?? "";
  if (!isChatConfigured(apiKey)) {
    return undefined;
  }
  const carsxe = env.CARSXE_API_KEY ?? "";
  // Cascade is optional — a fixture that requires it will skip rather than
  // fail. We still construct one if the key is present so non-cascade
  // fixtures (empathy / facts routing) can run alongside cascade-dependent
  // ones in the same process.
  const cascade = carsxe !== ""
    ? createCascade({
        CARSXE_API_KEY: carsxe,
        ...(env.CARSXE_BASE_URL !== undefined && env.CARSXE_BASE_URL !== ""
          ? { CARSXE_BASE_URL: env.CARSXE_BASE_URL }
          : {}),
      })
    : undefined;
  const handler = makeChatHandler(apiKey, cascade);
  if (handler === undefined) {
    return undefined;
  }
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.post("/api/chat", (req: Request, res: Response): void => {
    void handler(req, res);
  });
  return new Promise<EvalServer>((resolve, reject) => {
    const server = http.createServer(app);
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Eval server failed to bind a numeric port."));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((closeResolve) => {
            server.close(() => {
              closeResolve();
            });
          }),
      });
    });
  });
}

/** One captured SSE event from the chat stream. */
interface StreamCapture {
  readonly fullProse: string;
  readonly toolCalls: ReadonlyArray<RecordedToolCall>;
  /** Final history_sync messages if emitted; used for multi-turn continuation. */
  readonly historyMessages: ReadonlyArray<unknown>;
  readonly stopReason: string;
}

/**
 * Drive ONE turn through the live SSE endpoint. Returns everything the
 * harness needs to score this turn AND build the next turn's request body.
 *
 * The chat handler is stateless: every request carries the full history. We
 * reconstruct that history from the prior turn's `history_sync` event.
 */
async function streamOneTurn(
  port: number,
  messages: ReadonlyArray<unknown>,
  turnIndex: number,
): Promise<StreamCapture> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (response.body === null) {
    throw new Error(
      `Turn ${String(turnIndex)} response had no body. status=${String(response.status)} ` +
        `statusText=${response.statusText}. If status is 503, ANTHROPIC_API_KEY may be unset.`,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let prose = "";
  const toolCalls: RecordedToolCall[] = [];
  let historyMessages: ReadonlyArray<unknown> = [];
  let stopReason = "unknown";
  // Map tool_use_id -> name so the tool_result event (which only carries id)
  // can be paired with the name from tool_use_start.
  const idToName = new Map<string, string>();
  for (;;) {
    const { done, value } = await reader.read();
    if (value !== undefined) {
      buffer += decoder.decode(value, { stream: true });
    }
    const records = buffer.split("\n\n");
    buffer = records.pop() ?? "";
    for (const record of records) {
      const trimmed = record.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed.slice("data:".length).trim()) as Record<string, unknown>;
      } catch (parseErr) {
        throw new Error(
          `Turn ${String(turnIndex)} SSE record was not JSON. record=${JSON.stringify(trimmed)} ` +
            `cause=${String(parseErr)}`,
        );
      }
      const type = parsed.type;
      if (type === "text_delta" && typeof parsed.text === "string") {
        prose += parsed.text;
      } else if (type === "tool_use_start") {
        const id = typeof parsed.tool_use_id === "string" ? parsed.tool_use_id : undefined;
        const name = typeof parsed.name === "string" ? parsed.name : undefined;
        if (id !== undefined && name !== undefined) {
          idToName.set(id, name);
        }
      } else if (type === "tool_result") {
        const id = typeof parsed.tool_use_id === "string" ? parsed.tool_use_id : undefined;
        const name =
          typeof parsed.name === "string"
            ? parsed.name
            : (id !== undefined ? idToName.get(id) ?? "<unknown>" : "<unknown>");
        toolCalls.push({
          turnIndex,
          name,
          result: parsed.result,
        });
      } else if (type === "history_sync" && Array.isArray(parsed.messages)) {
        historyMessages = parsed.messages as ReadonlyArray<unknown>;
      } else if (type === "done") {
        stopReason = typeof parsed.stop_reason === "string" ? parsed.stop_reason : "unknown";
      }
    }
    if (done) {
      break;
    }
  }
  return { fullProse: prose, toolCalls, historyMessages, stopReason };
}

/**
 * Run ALL turns of a fixture against the live server. Returns the merged
 * capture across turns so the assertion phase can see the full picture.
 */
async function runFixtureTurns(
  port: number,
  turns: ReadonlyArray<UserTurn>,
): Promise<{
  readonly fullProse: string;
  readonly toolCalls: ReadonlyArray<RecordedToolCall>;
}> {
  let messages: ReadonlyArray<unknown> = [];
  const allProse: string[] = [];
  const allTools: RecordedToolCall[] = [];
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    if (turn === undefined) {
      throw new Error(`Turn ${String(i)} missing in fixture loop — fixture validation regressed.`);
    }
    const next: unknown[] = [...messages, { role: "user", content: turn.message }];
    const capture = await streamOneTurn(port, next, i);
    allProse.push(capture.fullProse);
    allTools.push(...capture.toolCalls);
    // Use the server's history_sync to continue. If absent, fall back to
    // appending the user message + a placeholder assistant note so the
    // next turn at least carries the user's prior message.
    messages = capture.historyMessages.length > 0 ? capture.historyMessages : next;
  }
  return { fullProse: allProse.join("\n---\n"), toolCalls: allTools };
}

/**
 * Score one fixture against the captured stream. Pure function over the
 * captured data; no I/O. Returns FixtureResult so the test layer can render
 * a structured report.
 */
export function scoreFixture(
  fixture: Fixture,
  capture: { readonly fullProse: string; readonly toolCalls: ReadonlyArray<RecordedToolCall> },
): FixtureResult {
  const failures: AssertionFailure[] = [];
  const lowered = capture.fullProse.toLowerCase();
  const calledNames = capture.toolCalls.map((c) => c.name);
  const a: FixtureAssertions = fixture.assertions;

  if (a.mustCallTools !== undefined) {
    for (const tool of a.mustCallTools) {
      if (!calledNames.includes(tool)) {
        failures.push({
          kind: "mustCallTools",
          detail: `expected ${tool} to be called; called tools were [${calledNames.join(", ")}]`,
        });
      }
    }
  }
  if (a.mustNotCallTools !== undefined) {
    for (const tool of a.mustNotCallTools) {
      if (calledNames.includes(tool)) {
        failures.push({
          kind: "mustNotCallTools",
          detail: `expected ${tool} NOT to be called; called tools were [${calledNames.join(", ")}]`,
        });
      }
    }
  }
  if (a.mustCallToolsInOrder !== undefined) {
    const expected = a.mustCallToolsInOrder;
    let cursor = 0;
    for (const actual of calledNames) {
      if (cursor < expected.length && actual === expected[cursor]) {
        cursor += 1;
      }
    }
    if (cursor < expected.length) {
      failures.push({
        kind: "mustCallToolsInOrder",
        detail:
          `expected order [${expected.join(", ")}] not found as a subsequence of ` +
          `[${calledNames.join(", ")}] (matched ${String(cursor)} of ${String(expected.length)})`,
      });
    }
  }
  if (a.toolResultKindIs !== undefined) {
    for (const [tool, allowed] of Object.entries(a.toolResultKindIs)) {
      const call = capture.toolCalls.find((c) => c.name === tool);
      if (call === undefined) {
        failures.push({
          kind: "toolResultKindIs",
          detail: `${tool} was not called; cannot inspect tool_result.kind`,
        });
        continue;
      }
      const kind = extractKind(call.result);
      if (kind === undefined) {
        failures.push({
          kind: "toolResultKindIs",
          detail: `${tool} result had no "kind" field; result=${JSON.stringify(call.result)}`,
        });
        continue;
      }
      if (!allowed.includes(kind)) {
        failures.push({
          kind: "toolResultKindIs",
          detail:
            `${tool} returned kind="${kind}" but allowed kinds are [${allowed.join(", ")}]. ` +
            `Full result=${JSON.stringify(call.result)}`,
        });
      }
    }
  }
  if (a.toolResultMustHaveKeys !== undefined) {
    for (const [tool, keys] of Object.entries(a.toolResultMustHaveKeys)) {
      const call = capture.toolCalls.find((c) => c.name === tool);
      if (call === undefined) {
        failures.push({
          kind: "toolResultMustHaveKeys",
          detail: `${tool} was not called; cannot inspect tool_result keys`,
        });
        continue;
      }
      const obj = call.result;
      if (typeof obj !== "object" || obj === null) {
        failures.push({
          kind: "toolResultMustHaveKeys",
          detail: `${tool} result was not an object; got ${typeof obj}`,
        });
        continue;
      }
      const record = obj as Record<string, unknown>;
      for (const key of keys) {
        if (!(key in record)) {
          failures.push({
            kind: "toolResultMustHaveKeys",
            detail: `${tool} result missing key "${key}"; keys present: [${Object.keys(record).join(", ")}]`,
          });
        }
      }
    }
  }
  if (a.proseMustContainAny !== undefined) {
    const matched = a.proseMustContainAny.some((needle) => lowered.includes(needle.toLowerCase()));
    if (!matched) {
      failures.push({
        kind: "proseMustContainAny",
        detail:
          `prose contained none of [${a.proseMustContainAny.map((s) => JSON.stringify(s)).join(", ")}]; ` +
          `prose=${JSON.stringify(capture.fullProse)}`,
      });
    }
  }
  if (a.proseMustNotContain !== undefined) {
    for (const needle of a.proseMustNotContain) {
      if (lowered.includes(needle.toLowerCase())) {
        failures.push({
          kind: "proseMustNotContain",
          detail:
            `prose contained forbidden substring ${JSON.stringify(needle)}; ` +
            `prose=${JSON.stringify(capture.fullProse)}`,
        });
      }
    }
  }
  if (a.proseMustMatch !== undefined) {
    for (const spec of a.proseMustMatch) {
      const re = new RegExp(spec.pattern, spec.flags ?? "i");
      if (!re.test(capture.fullProse)) {
        failures.push({
          kind: "proseMustMatch",
          detail:
            `prose did not match /${spec.pattern}/${spec.flags ?? "i"}; ` +
            `prose=${JSON.stringify(capture.fullProse)}`,
        });
      }
    }
  }
  if (a.minToolUseCount !== undefined && capture.toolCalls.length < a.minToolUseCount) {
    failures.push({
      kind: "minToolUseCount",
      detail: `expected at least ${String(a.minToolUseCount)} tool_use; got ${String(capture.toolCalls.length)}`,
    });
  }
  if (a.maxToolUseCount !== undefined && capture.toolCalls.length > a.maxToolUseCount) {
    failures.push({
      kind: "maxToolUseCount",
      detail: `expected at most ${String(a.maxToolUseCount)} tool_use; got ${String(capture.toolCalls.length)}`,
    });
  }
  return {
    fixtureId: fixture.id,
    category: fixture.category,
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    fullProse: capture.fullProse,
    toolCalls: capture.toolCalls,
  };
}

function extractKind(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) {
    return undefined;
  }
  const k = (result as Record<string, unknown>).kind;
  return typeof k === "string" ? k : undefined;
}

/**
 * Run one fixture end-to-end. Returns FixtureResult including the
 * skipped-because-env case so the per-pillar report shows skipped fixtures
 * distinctly from passing or failing ones.
 */
export async function runFixture(
  fixture: Fixture,
  port: number,
  env: NodeJS.ProcessEnv,
): Promise<FixtureResult> {
  const required = fixture.requiredEnv ?? [];
  for (const key of required) {
    const v = env[key] ?? "";
    if (v === "") {
      return {
        fixtureId: fixture.id,
        category: fixture.category,
        status: "skipped",
        skippedReason: `required env var ${key} is unset`,
        failures: [],
        fullProse: "",
        toolCalls: [],
      };
    }
  }
  const capture = await runFixtureTurns(port, fixture.turns);
  return scoreFixture(fixture, capture);
}

/**
 * Validate fixture JSON shape before running it. A malformed fixture is a
 * harness bug and should fail loudly, not silently skip.
 */
export function validateFixture(raw: unknown, source: string): Fixture {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Fixture at ${source} is not an object`);
  }
  const obj = raw as Record<string, unknown>;
  const id = obj.id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`Fixture at ${source} missing string "id"`);
  }
  const category = obj.category;
  if (typeof category !== "string" || !RUBRIC_CATEGORIES.includes(category as RubricCategory)) {
    throw new Error(
      `Fixture ${id} at ${source} has invalid category=${JSON.stringify(category)}. ` +
        `Known: [${RUBRIC_CATEGORIES.join(", ")}]`,
    );
  }
  const description = obj.description;
  if (typeof description !== "string" || description.trim() === "") {
    throw new Error(`Fixture ${id} at ${source} missing string "description"`);
  }
  const turns = obj.turns;
  if (!Array.isArray(turns) || turns.length === 0) {
    throw new Error(`Fixture ${id} at ${source} must have at least one turn`);
  }
  for (let i = 0; i < turns.length; i += 1) {
    const t = turns[i];
    if (typeof t !== "object" || t === null) {
      throw new Error(`Fixture ${id} turn ${String(i)} is not an object`);
    }
    const m = (t as Record<string, unknown>).message;
    if (typeof m !== "string" || m.trim() === "") {
      throw new Error(`Fixture ${id} turn ${String(i)} missing string "message"`);
    }
  }
  const assertions = obj.assertions;
  if (typeof assertions !== "object" || assertions === null) {
    throw new Error(`Fixture ${id} at ${source} missing "assertions" object`);
  }
  // We do not exhaustively check every assertion shape — vitest's
  // failure-on-runtime-type-mismatch will surface those — but the harness
  // does require that at least ONE assertion exists, else the fixture
  // tautologically passes which is the silent-skip failure mode.
  const aRec = assertions as Record<string, unknown>;
  const hasAny =
    aRec.mustCallTools !== undefined ||
    aRec.mustNotCallTools !== undefined ||
    aRec.mustCallToolsInOrder !== undefined ||
    aRec.toolResultKindIs !== undefined ||
    aRec.toolResultMustHaveKeys !== undefined ||
    aRec.proseMustContainAny !== undefined ||
    aRec.proseMustNotContain !== undefined ||
    aRec.proseMustMatch !== undefined ||
    aRec.minToolUseCount !== undefined ||
    aRec.maxToolUseCount !== undefined;
  if (!hasAny) {
    throw new Error(`Fixture ${id} at ${source} has zero assertions; would tautologically pass`);
  }
  return raw as Fixture;
}

/**
 * Pretty-print per-pillar tally. Called once at the end of the eval run so
 * the CI log carries a structured grade per pillar.
 */
export function formatReport(results: ReadonlyArray<FixtureResult>): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("================ CHAT ACCURACY EVAL ================");
  for (const pillar of RUBRIC_CATEGORIES) {
    const subset = results.filter((r) => r.category === pillar);
    const passed = subset.filter((r) => r.status === "passed").length;
    const failed = subset.filter((r) => r.status === "failed").length;
    const skipped = subset.filter((r) => r.status === "skipped").length;
    lines.push(
      `${pillar.padEnd(24)} ${String(passed).padStart(2)} passed | ${String(failed).padStart(2)} failed | ${String(skipped).padStart(2)} skipped`,
    );
  }
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  lines.push("---------------------------------------------------");
  lines.push(
    `TOTAL                    ${String(passed).padStart(2)} passed | ${String(failed).padStart(2)} failed | ${String(skipped).padStart(2)} skipped`,
  );
  lines.push("====================================================");
  lines.push("");
  return lines.join("\n");
}
