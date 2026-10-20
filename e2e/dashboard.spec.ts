import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { trackToasts, withToastReport } from "./fixtures/toasts";

const SHOTS = join(__dirname, "..", "specs", "dashboard", "screenshots");

/** `E2E_SCREENSHOTS=1`: the journey leaves the PR's screenshots behind (definition of done §4.5). */
async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

// The dashboard (feature inventory §3.14): the to-do list with the figures and the page each item resolves on,
// the pulse, the briefing. An unlinked bank row imported here shows up as the first thing to do.
const HEADER =
  "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";

test.describe("Dashboard", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("to do, pulse, briefing; an item leads to its page", async ({ page }) => {
    await trackToasts(page);
    await withToastReport(page, async () => {
      const today = new Date().toISOString().slice(0, 10);
      const stamp = String(Date.now()).slice(-6);
      await page.goto("/banking");
      await page.getByTestId("open-import").click();
      await page.getByTestId("import-file").setInputFiles({
        name: `PLUSGIROKONTO FTG 123 45 67-8 - ${today} ${stamp}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(
          [
            HEADER,
            `${today.replace(/-/g, "/")};-1${stamp.slice(0, 2)},40;;;;Kortköp DASH ${stamp};DASH ${stamp};;;SEK;`,
          ].join("\n"),
          "utf8",
        ),
      });
      await expect(page.getByTestId("import-account")).toContainText(/Plusgirokonto|Sparkonto/);
      await page.getByTestId("import-run").click();
      await expect(page.getByTestId("import-summary")).toContainText("1 imported", {
        timeout: 20_000,
      });

      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
      const todo = page.getByTestId("action-items");
      await expect(todo).toBeVisible();
      const rows = todo.locator('[data-testid="action-item"][data-kind="rows_to_justify"]');
      await expect(rows).toBeVisible();
      await expect(rows).toContainText(/\d+ bank line\(s\) to justify/);
      await expect(page.getByTestId("business-pulse")).toContainText("Plusgirokonto SEK");
      await expect(page.getByTestId("business-pulse")).toContainText("Receivables open");
      await expect(page.getByTestId("briefing")).toBeVisible();
      await snap(page, "dashboard");

      await rows.getByRole("link").click();
      await expect(page).toHaveURL(/\/banking\/inbox/);
    });
  });
});

test.describe("Dashboard — the accountant", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("sees the pulse and the month-end items, not the owner's work", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("business-pulse")).toBeVisible();
    await expect(
      page.locator('[data-testid="action-item"][data-kind="rows_to_justify"]'),
    ).toHaveCount(0);
  });
});
