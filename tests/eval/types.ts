/**
 * Shape definitions for the chat-accuracy eval harness.
 *
 * A "fixture" is a single declarative scenario: one or more user turns, plus a
 * bag of assertions the live chat handler's behaviour must satisfy. Every
 * assertion is a HARD predicate (substring, regex, set membership, ordering)
 * so the eval is reproducible and graders can see exactly which line failed.
 * No LLM-as-judge: a judgment-based eval can drift when the judge model
 * changes; this harness drifts only when the production code or the fixture
 * itself changes.
 *
 * Fixtures live in `tests/eval/fixtures/*.json`. Every JSON file MUST validate
 * against the Fixture interface below before the harness runs it; a malformed
 * fixture is treated as a harness error (the test fails) rather than silently
 * skipped, because silent skipping is how green CI hides regressions.
 *
 * Categories map to rubric pillars so the per-run summary can score each
 * pillar independently. Adding a new category? Update RUBRIC_CATEGORIES at
 * the bottom of this file too — the harness uses it to print the breakdown.
 */

/** Top-level fixture loaded from a JSON file. */
export interface Fixture {
  /** Stable, human-readable id. Used in test names and reports. */
  readonly id: string;
  /** Rubric pillar this fixture exercises. Must be one of RUBRIC_CATEGORIES. */
  readonly category: RubricCategory;
  /** One-paragraph description of what behaviour this fixture pins. */
  readonly description: string;
  /** Sequential user turns. The chatbot's reply between turns IS the system under test. */
  readonly turns: ReadonlyArray<UserTurn>;
  /** Assertions evaluated against the FINAL turn's collected stream. */
  readonly assertions: FixtureAssertions;
  /**
   * Optional list of env vars that MUST be present for this fixture to run.
   * If any is missing, the fixture is reported as SKIPPED (not FAILED) so a
   * machine without vendor credentials can still produce a useful subset.
   * The harness ALWAYS requires ANTHROPIC_API_KEY whether listed or not.
   */
  readonly requiredEnv?: ReadonlyArray<string>;
  /** Cap on tool-use loops per turn (default 5, matching MAX_TOOL_TURNS). */
  readonly maxToolTurns?: number;
}

/** One user-side message in the conversation. */
export interface UserTurn {
  /** The literal string the user sends. May contain plates, VINs, etc. */
  readonly message: string;
}

/** Declarative predicates evaluated after the final stream is collected. */
export interface FixtureAssertions {
  /** Set-membership: every named tool MUST have been called at least once. */
  readonly mustCallTools?: ReadonlyArray<string>;
  /**
   * Strict ordering: tools MUST be called in this exact order (with no
   * intervening tools-of-interest). Use when the spec pins a sequence
   * like "lookup_plate then start_condition_intake".
   */
  readonly mustCallToolsInOrder?: ReadonlyArray<string>;
  /** Set-membership: every named tool MUST NOT have been called. */
  readonly mustNotCallTools?: ReadonlyArray<string>;
  /**
   * For each named tool, the structured tool_result MUST have one of the
   * listed `kind` values. Catches "the tool was called but returned an
   * error kind we did not expect".
   */
  readonly toolResultKindIs?: Readonly<Record<string, ReadonlyArray<string>>>;
  /**
   * For each named tool, the structured tool_result object MUST contain
   * every listed key (top-level). Used to confirm the result shape (e.g.
   * lookup_plate resolved must have year/make/model).
   */
  readonly toolResultMustHaveKeys?: Readonly<Record<string, ReadonlyArray<string>>>;
  /**
   * Assistant prose (concatenated text_delta values across the turn) MUST
   * contain AT LEAST ONE of the listed case-insensitive substrings.
   * Use when there is more than one acceptable phrasing.
   */
  readonly proseMustContainAny?: ReadonlyArray<string>;
  /**
   * Assistant prose MUST NOT contain any of these substrings (case-
   * insensitive). The PII gate lives here.
   */
  readonly proseMustNotContain?: ReadonlyArray<string>;
  /**
   * Assistant prose MUST match every regex (constructed as `new RegExp(pattern, flags ?? "i")`).
   * Used for structural checks that a substring would miss.
   */
  readonly proseMustMatch?: ReadonlyArray<{ readonly pattern: string; readonly flags?: string }>;
  /** Minimum tool_use events across the turn (default 0). */
  readonly minToolUseCount?: number;
  /** Maximum tool_use events across the turn (default unbounded). */
  readonly maxToolUseCount?: number;
}

/** Outcome of running a single fixture. */
export interface FixtureResult {
  readonly fixtureId: string;
  readonly category: RubricCategory;
  readonly status: "passed" | "failed" | "skipped";
  readonly skippedReason?: string;
  readonly failures: ReadonlyArray<AssertionFailure>;
  /** Concatenated text_delta payloads across every turn, joined with "\n---\n". */
  readonly fullProse: string;
  /** Every tool_use the chatbot fired, in chronological order across turns. */
  readonly toolCalls: ReadonlyArray<RecordedToolCall>;
}

export interface AssertionFailure {
  readonly kind: string;
  readonly detail: string;
}

export interface RecordedToolCall {
  readonly turnIndex: number;
  readonly name: string;
  /** The structured `result` payload the dispatcher returned. */
  readonly result: unknown;
}

/** Rubric pillars the eval scores against. */
export type RubricCategory =
  | "tool_routing"
  | "pii_gate"
  | "empathy_routing"
  | "facts_routing"
  | "flow_ordering"
  | "format_error_recovery";

/** The full set, for harness validation and per-pillar reporting. */
export const RUBRIC_CATEGORIES: ReadonlyArray<RubricCategory> = [
  "tool_routing",
  "pii_gate",
  "empathy_routing",
  "facts_routing",
  "flow_ordering",
  "format_error_recovery",
];
