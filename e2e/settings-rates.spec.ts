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

// Settings → Exchange rates: the three ECB pairs with their coverage; the owner's *Fetch now* queues the sync
// job (the fetch itself is the job's business — the ECB is not asserted on); the accountant reads, no button.
test.describe("Exchange rates — the owner", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("sees the pairs and queues a fetch", async ({ page }) => {
    await trackToasts(page);
    await page.goto("/settings/rates");
    await expect(page.getByRole("heading", { name: "Exchange rates" })).toBeVisible();
    const rows = page.getByTestId("rates-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("EUR/SEK");
    await expect(rows.nth(1)).toContainText("EUR/CHF");
    await expect(rows.nth(2)).toContainText("EUR/USD");
    await snap(page, "settings-rates");
    await page.getByTestId("rates-fetch").click();
    await expectToast(page, /Fetching the last \d+ ECB days|A fetch is already running/);
  });
});

test.describe("Exchange rates — the accountant", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("reads the table, cannot fetch", async ({ page }) => {
    await page.goto("/settings/rates");
    await expect(page.getByTestId("rates-row")).toHaveCount(3);
    await expect(page.getByTestId("rates-fetch")).toHaveCount(0);
  });
});
