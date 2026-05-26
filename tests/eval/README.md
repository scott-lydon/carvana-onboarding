# Chat accuracy eval

A fixture-driven evaluation of the v2 chat handler that scores the live model
on rubric-pillar behaviour. Distinct from unit / property / integration /
adversary tests because the question it answers is different: "if we shipped
right now, would the model still route an empathy question through the
support-content tool, or would it improvise?" That is a behaviour question
about the model + prompt + tool wiring TOGETHER and only a live-call eval
can answer it honestly.

## What lives here

```
tests/eval/
  README.md
  types.ts                  Fixture + assertion + result shapes
  harness.ts                Express server boot, SSE stream parser, scorer
  chat-accuracy.eval.ts     Vitest entry point (discovers fixtures, runs each)
  fixtures/*.json           One fixture per declarative scenario
```

## How to run

```bash
# Set credentials (Anthropic is required; CarsXE is required only for the
# fixtures whose `requiredEnv` lists CARSXE_API_KEY).
export ANTHROPIC_API_KEY=sk-ant-...
export CARSXE_API_KEY=...

npm run test:eval
```

Without `ANTHROPIC_API_KEY`, every fixture is reported as SKIPPED (not FAILED).
A machine with no credentials still produces a clean run. Fixtures whose
`requiredEnv` is unset are individually skipped while the rest still run.

## How to add a fixture

1. Create a new `tests/eval/fixtures/NNN-category-short-name.json`.
2. Pick a `category` from the `RUBRIC_CATEGORIES` list in `types.ts`. Add a
   new category by extending that list AND `harness.ts` reporting.
3. List one or more user `turns`. The harness reconstructs conversation
   history between turns via the SSE `history_sync` event the server emits.
4. List declarative assertions. Available predicates:

   | Field | Meaning |
   |---|---|
   | `mustCallTools` | every named tool MUST have fired at least once |
   | `mustCallToolsInOrder` | tools must appear as an ordered subsequence |
   | `mustNotCallTools` | none of these tools may fire |
   | `toolResultKindIs` | per-tool: the structured `kind` must be in the allowed set |
   | `toolResultMustHaveKeys` | per-tool: top-level keys that MUST exist on the result |
   | `proseMustContainAny` | case-insensitive substring; at least one must match |
   | `proseMustNotContain` | case-insensitive substring; NONE may match |
   | `proseMustMatch` | one or more regex patterns; ALL must match |
   | `minToolUseCount` / `maxToolUseCount` | bounds on total tool_use across turns |

5. If the fixture requires a vendor key beyond Anthropic, list it under
   `requiredEnv`. The harness auto-skips that fixture when the var is unset.

A fixture with zero assertions is rejected at load time (it would
tautologically pass, which is the silent-skip failure mode this layer was
built to avoid).

## Why hard predicates only

No LLM-as-judge. A judge model drifts when the judge is upgraded, masks
genuine regressions when it is generous, and adds an unaudited dependency to
every grading event. Every assertion in this harness is a deterministic
predicate (substring, regex, set membership, ordering) so the eval drifts
only when the production code or the fixture itself changes.

## Cost

At Haiku 4.5 rates, a full run (currently ten fixtures) costs roughly $0.01
per pass. Cheap enough to run on every commit; the friction is the live
network dependency on Anthropic + CarsXE, not the dollar cost.
