import { expect, test } from "@playwright/test";

/**
 * Slice 2 — bot-detected differentiation E2E (the central pitch).
 *
 * Carvana's failure mode (documented in docs/SELL_FLOW_AUDIT.md and verified
 * during our live walk) is that a bot-detected session and a vendor-data-miss
 * session both render the SAME hostile "we can't find your plate" copy. Our
 * fix is to render distinct copy for each named failure mode.
 *
 * This spec proves the differentiation on the deployed UI by intercepting
 * the /api/lookup/plate call with Playwright's `route.fulfill` and asserting
 * the correct DegradationPanel variant renders. Field values must be
 * preserved (CAT-2) across the error so the user does not lose their input.
 *
 * Route interception is preferred over backend env-var swapping because it
 * keeps the slice 2 test self-contained: no server-side feature flag is
 * needed for the test to drive a bot_detected response. The cascade in
 * production still depends on real vendor responses; this spec only exercises
 * the client's pattern-matching of the discriminated-union response.
 */

test.describe("bot-detected differentiation", () => {
  test("bot_detected renders distinct copy from not_found", async ({ page }) => {
    // Intercept the lookup call and force a bot_detected response.
    await page.route("**/api/lookup/plate", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          kind: "bot_detected",
          advisedAction: "use_different_session",
        }),
      });
    });

    await page.goto("/");
    await page.getByPlaceholder(/XRJ/i).fill("ABC1234");
    await page.getByRole("button", { name: /Get my offer/i }).click();

    // The bot-detected panel must render with its own distinct heading,
    // not the generic "we couldn't find your plate" copy.
    const panel = page.getByRole("region", { name: /automated behavior/i }).or(
      page.locator("section.result-bot"),
    );
    await expect(
      page.getByRole("heading", { name: /detected automated behavior/i }),
    ).toBeVisible();
    await expect(panel).toContainText(/protect against fraud/i);
    // It MUST NOT render the not-found copy. If both copies render, the
    // discriminated union is broken or the panels are stacking.
    await expect(panel).not.toContainText(/couldn.?t find your plate/i);

    // CAT-2: form value preserved across error.
    await expect(page.getByPlaceholder(/XRJ/i)).toHaveValue("ABC1234");
  });

  test("not_found renders distinct copy from bot_detected", async ({ page }) => {
    await page.route("**/api/lookup/plate", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          kind: "not_found",
          attemptedVendors: ["carsxe"],
          lastVendorTried: "carsxe",
        }),
      });
    });

    await page.goto("/");
    await page.getByPlaceholder(/XRJ/i).fill("XYZ9999");
    await page.getByRole("button", { name: /Get my offer/i }).click();

    await expect(
      page.getByRole("heading", { name: /couldn.?t find your plate/i }),
    ).toBeVisible();
    // It MUST NOT render the bot-detected copy.
    await expect(
      page.getByRole("heading", { name: /detected automated behavior/i }),
    ).not.toBeVisible();

    // CAT-2: form value preserved.
    await expect(page.getByPlaceholder(/XRJ/i)).toHaveValue("XYZ9999");
  });

  test("tab switch clears the result panel (F3 fix)", async ({ page }) => {
    await page.route("**/api/lookup/plate", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          kind: "bot_detected",
          advisedAction: "use_different_session",
        }),
      });
    });

    await page.goto("/");
    await page.getByPlaceholder(/XRJ/i).fill("ABC1234");
    await page.getByRole("button", { name: /Get my offer/i }).click();
    await expect(
      page.getByRole("heading", { name: /detected automated behavior/i }),
    ).toBeVisible();

    // Switch to VIN tab.
    await page.getByRole("tab", { name: "VIN" }).click();
    // The plate-error panel must NOT still be visible under the VIN form.
    await expect(
      page.getByRole("heading", { name: /detected automated behavior/i }),
    ).not.toBeVisible();
    // The VIN input is now mounted.
    await expect(page.getByPlaceholder(/17-character VIN/i)).toBeVisible();
  });
});
