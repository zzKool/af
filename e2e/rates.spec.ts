import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { expectToast, trackToasts } from "./fixtures/toasts";

const SHOTS = join(__dirname, "..", "specs", "rates", "screenshots");

async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

// Exchange rates (F136, in the menu since D76 phase 3; Settings → Exchange rates sends here): the cards, the chart,
// the coverage, the rate on a day and the three ECB pairs; the owner's *Fetch now* queues the sync job (the fetch
// itself is the job's business — the ECB is not asserted on, CI has no rates); the accountant reads, no button.
test.describe("Exchange rates — the owner", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("sees the pairs and queues a fetch", async ({ page }) => {
    await trackToasts(page);
    await page.goto("/rates");
    await expect(page.getByRole("heading", { name: "Exchange rates", level: 1 })).toBeVisible();
    // one card per currency against the base (SEK in the seed): CHF, EUR, USD
    await expect(page.getByTestId("rates-card")).toHaveCount(3);
    await expect(page.getByTestId("rates-coverage")).toBeVisible();
    // the rate on a given day: a Sunday takes the nearest earlier ECB day — or says there is none
    await page.getByTestId("rates-day-input").fill("2026-07-12");
    await expect(page.getByTestId("rates-day-row")).toHaveCount(3);
    await expect(page.getByTestId("rates-day")).toContainText("a weekend");
    const rows = page.getByTestId("rates-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("EUR/SEK");
    await expect(rows.nth(1)).toContainText("EUR/CHF");
    await expect(rows.nth(2)).toContainText("EUR/USD");
    await snap(page, "rates");
    await page.getByTestId("rates-fetch").click();
    await expectToast(page, /Fetching the last \d+ ECB days|A fetch is already running/);
  });
});

test.describe("Exchange rates — the accountant", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("reads the table, cannot fetch", async ({ page }) => {
    await page.goto("/settings/rates"); // the old address sends to the menu's page
    await expect(page).toHaveURL(/\/rates$/);
    await expect(page.getByTestId("rates-row")).toHaveCount(3);
    await expect(page.getByTestId("rates-fetch")).toHaveCount(0);
  });
});
