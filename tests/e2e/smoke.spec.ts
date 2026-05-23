import { expect, test } from "@playwright/test";

/**
 * Smoke test: dev server boots, EntryForm mounts.
 *
 * Slice 0 originally asserted the server-status indicator (now removed —
 * App.tsx renders EntryForm directly per slice 1.6). The smoke check is
 * now "the entry UI is on screen and the tabs work." The bot-detection /
 * not-found / format-error scenarios live in their own spec files.
 */
test("entry form mounts with plate + VIN tabs (via v2 fallback link)", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Carvana Onboarding/);
  // v2 slice A: the ChatbotShell is the primary entry surface. The
  // slice-1 EntryForm is reachable through the "prefer a form?" link.
  await page.getByRole("button", { name: /prefer a form/i }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Sell your car",
  );
  // Both tabs are visible by their accessible names.
  await expect(
    page.getByRole("tab", { name: "License Plate" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "VIN" })).toBeVisible();
  // Plate tab is the default — its input is in the DOM, VIN input is not.
  await expect(page.getByPlaceholder(/XRJ/i)).toBeVisible();
});
