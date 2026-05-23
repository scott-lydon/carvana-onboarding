/**
 * v2 Slice A — chatbot plate happy path.
 *
 * Acceptance criterion for US-V2-1:
 *   "my plate is XRJ4041 in Texas" → vehicle data card appears in chat
 *   within 15 seconds.
 *
 * This test REQUIRES live ANTHROPIC_API_KEY + CARSXE_API_KEY in the
 * environment. It is skipped when either is absent so CI without
 * credentials does not fail. Slice A's submit-gate requires this test to
 * pass against the deployed instance before READY.
 *
 * Why 15 seconds rather than 3 seconds:
 *   - The PRD's "<3s under load" metric is p95 server response time,
 *     measured by k6 in slice F.
 *   - This wall-clock includes Vite proxy, Express, Anthropic round-trip
 *     (streaming start to first token ~1.5s), tool-use turn (~1s),
 *     CarsXE vendor call (~1s), second Anthropic round-trip (~1.5s),
 *     and final render. 15s is generous headroom; realistic is 5-8s on
 *     a warm Render dyno.
 */
import { test, expect } from "@playwright/test";

const HAS_ANTHROPIC = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
const HAS_CARSXE = Boolean(process.env.CARSXE_API_KEY?.trim());

test.describe("v2 slice A — chatbot plate happy path", () => {
  test.skip(
    !HAS_ANTHROPIC || !HAS_CARSXE,
    "Skipping: requires ANTHROPIC_API_KEY and CARSXE_API_KEY in env. " +
      "Get keys: https://console.anthropic.com/settings/keys and https://api.carsxe.com/register",
  );

  test("conversational plate entry resolves to a vehicle card within 15s", async ({ page }) => {
    await page.goto("/");
    // The chatbot greeting is pre-baked client-side and should appear instantly.
    await expect(
      page.getByText(/I'm here to help you sell your car/i),
    ).toBeVisible({ timeout: 2_000 });

    // Type the natural-language plate phrase the system prompt is designed to handle.
    await page.getByPlaceholder(/Type your plate and state/i).fill(
      "my plate is XRJ4041 in Texas",
    );
    await page.getByRole("button", { name: "Send" }).click();

    // The user message should appear immediately (client-side append before
    // network round-trip).
    await expect(page.getByText("my plate is XRJ4041 in Texas")).toBeVisible({
      timeout: 2_000,
    });

    // Wait for the vehicle data card. We assert on "Vehicle identified" + the
    // year/make from the known XRJ4041/TX → 2021 Toyota Highlander fixture.
    await expect(page.getByText("Vehicle identified")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/2021.*Toyota.*Highlander/i)).toBeVisible({
      timeout: 2_000,
    });
  });

  test('the "prefer a form?" fallback link swaps to the EntryForm and back', async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /prefer a form/i }).click();
    // EntryForm-specific copy — the slice-1 surface has License Plate / VIN tabs.
    await expect(page.getByRole("tab", { name: /License Plate/i })).toBeVisible({
      timeout: 2_000,
    });
    await page.getByRole("button", { name: /back to chat/i }).click();
    await expect(
      page.getByText(/I'm here to help you sell your car/i),
    ).toBeVisible();
  });
});
