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
    exclude: ["tests/e2e/**", "node_modules"],
  },
});
