import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite serves the React frontend on :5173 and proxies /api to the Express
// server on :3001. Keeping the proxy here means slice 1 code can call
// `/api/lookup/plate` directly without thinking about ports.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // tests/eval/** is excluded from the default suite because it requires
    // live Anthropic + CarsXE credentials and runs via `npm run test:eval`
    // against a dedicated config (tests/eval/vitest.eval.config.ts).
    exclude: ["tests/e2e/**", "tests/eval/**", "node_modules"],
  },
});
