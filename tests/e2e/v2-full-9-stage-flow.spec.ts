/**
 * F.15 — End-to-end Playwright happy path for the full 9-stage sell flow.
 *
 * Walks the chat from greeting through contract acknowledgement:
 *
 *   1. Greeting               (chat shell renders, greeting present)
 *   2. Vehicle lookup         ("my plate is XRJ4041 in Texas" → Vehicle card)
 *   3. Condition intake       (panel opens, upload 3 photos, assessment arrives)
 *   4. Loan / payoff          (chat asks about loan, user replies "no")
 *   5. Instant offer          (OfferCard renders with a dollar amount)
 *   6. Pickup scheduling      (Scheduler opens, slot + address selected, confirmed)
 *   7. Payment method         (ACH option selected, confirmed)
 *   8. Contract               (checkbox + "I agree" → acknowledged)
 *   9. Wrap-up                (chat acknowledges contract with a thank-you turn)
 *
 * **Why this is one test and not nine:**
 *   Each stage depends on prior stages' state (the chatbot doesn't open
 *   the payment-method panel until the offer was generated, etc.). The
 *   only way to verify stage 9 works is to walk all of 1-8 first. The
 *   subassertions throughout document where to look when a future
 *   regression breaks the chain.
 *
 * **Why this is long (~60-90s on a warm Render dyno):**
 *   Six Anthropic round-trips, three CarsXE / vision API hops, three
 *   panel opens, and a real-time scheduler date pick. Test timeout is
 *   bumped accordingly. If a CI run is consistently timing out, the
 *   right move is to add API-side latency budgets in qa-pipeline.html,
 *   NOT to shorten the timeouts here.
 *
 * **Skip rules:**
 *   - Skips without ANTHROPIC_API_KEY (chat + vision)
 *   - Skips without CARSXE_API_KEY (vehicle lookup)
 *   Both keys are required to walk the live URL end-to-end. Without
 *   them stages 2/3/5 short-circuit on configuration_missing and the
 *   test would fail on the FIRST assertion past the greeting, masking
 *   genuine 4-9 regressions.
 */
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HAS_ANTHROPIC = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
const HAS_CARSXE = Boolean(process.env.CARSXE_API_KEY?.trim());

// One overall timeout covers the entire 9-stage walk. Each individual
// step uses its own narrower expect timeout so a regression points at
// the specific stage that broke, not "the test timed out".
test.setTimeout(180_000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "..", "..", "test-plates");

test.describe("F.15 — full 9-stage sell flow", () => {
  test.skip(
    !HAS_ANTHROPIC || !HAS_CARSXE,
    "Skipping: full 9-stage flow needs ANTHROPIC_API_KEY (chat + vision) " +
      "AND CARSXE_API_KEY (vehicle lookup). Get keys at " +
      "https://console.anthropic.com/settings/keys and " +
      "https://api.carsxe.com/register",
  );

  test("greeting → vehicle → condition → loan no → offer → pickup → payment → contract → wrap-up", async ({
    page,
  }) => {
    // ────────── Stage 1: greeting ──────────────────────────────────────
    await page.goto("/");
    await expect(
      page.getByText(/I'm here to help you sell your car/i),
    ).toBeVisible({ timeout: 5_000 });

    // ────────── Stage 2: vehicle lookup (plate path) ───────────────────
    await page.getByPlaceholder(/Type your plate and state/i).fill(
      "my plate is XRJ4041 in Texas",
    );
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Vehicle identified")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/2021.*Toyota.*Highlander/i)).toBeVisible({
      timeout: 3_000,
    });

    // ────────── Stage 3: condition intake (panel + photos) ─────────────
    // The chatbot fires start_condition_intake right after the vehicle
    // resolves; the ConditionIntake panel opens. We attach three HEIC
    // photos via the file inputs the panel exposes by data-testid.
    // Browser test runners can NOT enumerate HEIC fixtures the way
    // unit tests can, so we attach by absolute path.
    const photoInputs = [
      "condition-input-front_left",
      "condition-input-front_right",
      "condition-input-odometer",
    ];
    for (let i = 0; i < photoInputs.length; i += 1) {
      const inputId = photoInputs[i] ?? "";
      const filePath = path.join(FIXTURES_DIR, `IMG_691${String(i)}.HEIC`);
      // Each input mounts only after the panel opens (which happens
      // when the SSE event for open_condition_intake arrives). Allow up
      // to 20s for the first one; subsequent ones are immediate.
      await page.locator(`[data-testid="${inputId}"]`).setInputFiles(filePath, {
        timeout: i === 0 ? 30_000 : 5_000,
      });
    }
    // Confirm photos uploaded — the panel shows a "Submit" or "Run
    // assessment" button once the minimum is met. We tolerate either
    // name in case copy changes.
    const submitCondition = page.getByRole("button", {
      name: /Run assessment|Submit photos|Submit condition/i,
    });
    await submitCondition.waitFor({ state: "visible", timeout: 10_000 });
    await submitCondition.click();
    // The assessment chat message arrives once vision finishes (3-10s).
    await expect(
      page.getByText(/Condition assessment:/i).first(),
    ).toBeVisible({ timeout: 60_000 });

    // ────────── Stage 4: loan question ─────────────────────────────────
    // The chatbot's next turn asks about loan status. We reply "no" to
    // skip the payoff form path.
    await page.getByPlaceholder(/Type your plate and state|Keyboard ready/i).fill(
      "no, no loan on this one",
    );
    await page.getByRole("button", { name: "Send" }).click();

    // ────────── Stage 5: instant offer ─────────────────────────────────
    // generate_offer fires. The OfferCard renders the headline offer.
    // We assert on the recognizable dollar-amount affordance rather
    // than a fixed number (the OfferEngine formula can move when
    // constants are tuned).
    await expect(
      page.getByText(/Your instant offer|Instant offer:/i),
    ).toBeVisible({ timeout: 30_000 });
    // The OfferCard always shows at least one $X,XXX figure; assert
    // SOME dollar amount renders.
    await expect(
      page.getByText(/\$[\d,]+/).first(),
    ).toBeVisible({ timeout: 5_000 });

    // ────────── Stage 6: pickup scheduling ─────────────────────────────
    // The chatbot offers to schedule. The user taps the dedicated
    // "Schedule pickup" CTA. The Scheduler panel renders date slots.
    await page.getByRole("button", { name: /Schedule pickup/i }).click();
    // Pick the first available slot. The Scheduler uses data-testid=
    // "slot-button" for every selectable time chip; we click the
    // first one. Allow up to 10s for the slot grid to fetch.
    const firstSlot = page.locator('[data-testid="slot-button"]').first();
    await firstSlot.waitFor({ state: "visible", timeout: 15_000 });
    await firstSlot.click();
    // Fill in the pickup address (street + zip). The Scheduler's
    // address form pre-fills state from the resolved vehicle (TX
    // here), so we only need street + zip. Use plausible Austin TX
    // values.
    await page.getByLabel(/Street address|Street/i).fill("123 Test St");
    await page.getByLabel(/Zip|Postal/i).fill("78701");
    await page.getByRole("button", { name: /Confirm pickup|Book pickup/i }).click();
    // The chat acknowledges the booking.
    await expect(page.getByText(/Pickup booked:/i)).toBeVisible({
      timeout: 15_000,
    });

    // ────────── Stage 7: payment method ────────────────────────────────
    // After acknowledging the booking, the chatbot calls
    // select_payment_method which opens the panel. Pick ACH and
    // confirm.
    await page
      .getByRole("radio", { name: /Direct deposit \(ACH\)/i })
      .waitFor({ state: "visible", timeout: 20_000 });
    await page.getByRole("radio", { name: /Direct deposit \(ACH\)/i }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    // Chat acknowledges the selection.
    await expect(page.getByText(/Payment method selected:/i)).toBeVisible({
      timeout: 15_000,
    });

    // ────────── Stage 8: contract acknowledgement ──────────────────────
    // Chat fires acknowledge_contract → ContractConsent panel opens.
    // Tick the checkbox + click "I agree".
    const consentCheckbox = page.getByRole("checkbox", {
      name: /I understand and agree to all three/i,
    });
    await consentCheckbox.waitFor({ state: "visible", timeout: 20_000 });
    await consentCheckbox.check();
    await page.getByRole("button", { name: /^I agree$/i }).click();
    await expect(page.getByText(/Contract acknowledged at/i)).toBeVisible({
      timeout: 15_000,
    });

    // ────────── Stage 9: wrap-up ───────────────────────────────────────
    // The chatbot thanks the user. We assert on one of the recognizable
    // wrap-up phrases the system prompt instructs Haiku to use; allow
    // for paraphrase by matching any of three variants.
    await expect(
      page
        .getByText(
          /thanks|all set|confirmation by SMS|you'll be paid|you will be paid/i,
        )
        .last(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
