/**
 * Dedicated vitest config for the chat-accuracy eval.
 *
 * The default config at `/vite.config.ts` includes only `tests/**\/*.test.ts`
 * so the eval files (`*.eval.ts`) are excluded from `npm test`. This config
 * inverts the include filter so `npm run test:eval` targets ONLY the eval
 * suite. Running the eval gets its own command because it requires live
 * vendor credentials (Anthropic, optionally CarsXE) and is not appropriate
 * to gate a pull request on without those secrets in CI.
 */
import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/eval/**/*.eval.ts"],
    // Real-network calls; one fixture at a time keeps the SSE stream legible
    // in CI logs and avoids upstream rate-limit churn on Haiku 4.5.
    threads: false,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
