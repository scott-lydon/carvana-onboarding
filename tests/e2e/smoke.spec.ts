import { expect, test } from "@playwright/test";

// Slice 0 end-to-end smoke. The dev server boots, the React app mounts, the
// client fetches /api/health, and the status indicator transitions from
// "checking" to "ok". Slice 3+ adds the failure-mode scenarios (CAT-2 tab
// reset, CAT-3 blame-the-user copy, CAT-5 account-before-value gate).
test("scaffold loads and reports the server is reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Carvana Onboarding Recovery Layer",
  );
  const status = page.getByTestId("server-status");
  await expect(status).toContainText("Status:");
  // The status should resolve to "ok" given the Express server is up via the
  // playwright.config.ts webServer block. If we get "unreachable" something is
  // wrong with the proxy or the server, which is exactly what this test should
  // catch on regression.
  await expect(status).toContainText("ok", { timeout: 10_000 });
});
