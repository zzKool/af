import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { trackToasts, withToastReport } from "./fixtures/toasts";

const SHOTS = join(__dirname, "..", "specs", "documents", "screenshots");

/** `E2E_SCREENSHOTS=1`: the journey leaves the PR's screenshots behind (definition of done §4.5). */
async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

// F92 (D55): several files, one type. The journey owns its three files (a unique stamp — two journeys never
// share bytes): a receipt, the same bytes under another name, and a ".pdf" that is not a PDF. One drop →
// one row each: uploaded with its own key · duplicate (Upload anyway stores it) · failed with the reason.
// Then the inbox, opened by URL, lists the two stored documents.
const stamp = randomUUID().slice(0, 8);
const receipt = Buffer.from(`%PDF-1.4 e2e-multi-${stamp}-a`);

test.describe("Document upload — several files at once", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("one type, three files: uploaded · duplicate · failed, each on its own row", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await trackToasts(page);
    await withToastReport(page, async () => {
      await page.goto("/documents");
      await page.getByTestId("upload-type").selectOption("expense"); // once, for the three (D52)
      await page.locator('input[type="file"]').setInputFiles([
        { name: `multi-a-${stamp}.pdf`, mimeType: "application/pdf", buffer: receipt },
        { name: `multi-copy-${stamp}.pdf`, mimeType: "application/pdf", buffer: receipt },
        {
          name: `multi-broken-${stamp}.pdf`,
          mimeType: "application/pdf",
          buffer: Buffer.from(`not a pdf at all ${stamp}`),
        },
      ]);

      // 1. the result list: one row per file, in drop order
      const rows = page.getByTestId("upload-batch-row");
      await expect(page.getByTestId("upload-batch-summary")).toContainText("3 of 3", {
        timeout: 60_000,
      });
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0)).toHaveAttribute("data-status", "uploaded");
      await expect(rows.nth(0).getByTestId("upload-batch-key")).toHaveText(/^exp_\d{8}_\d{3}$/);
      await expect(rows.nth(1)).toHaveAttribute("data-status", "duplicate");
      const firstKey = (await rows.nth(0).getByTestId("upload-batch-key").textContent()) ?? "";
      await expect(rows.nth(1).getByTestId("upload-batch-duplicate-key")).toHaveText(firstKey);
      await expect(rows.nth(2)).toHaveAttribute("data-status", "failed");
      await expect(rows.nth(2).getByTestId("upload-batch-reason")).not.toBeEmpty();
      await expect(page.getByTestId("upload-batch-summary")).toContainText(
        "1 uploaded · 1 duplicates · 1 failed",
      );
      await snap(page, "upload-multi");

      // 2. the duplicate row keeps the card's way out: Upload anyway stores a second copy, its own key
      await rows.nth(1).getByRole("button", { name: "Upload anyway" }).click();
      await expect(rows.nth(1)).toHaveAttribute("data-status", "uploaded", { timeout: 30_000 });
      const copyKey = (await rows.nth(1).getByTestId("upload-batch-key").textContent()) ?? "";
      expect(copyKey).toMatch(/^exp_\d{8}_\d{3}$/);
      expect(copyKey).not.toBe(firstKey);

      // 3. the inbox, opened by URL: the two stored documents, each read by its own OCR job
      await page.goto("/documents/inbox");
      await expect(page.getByRole("heading", { name: "Document inbox" })).toBeVisible();
      await page.getByTestId("inbox-search").fill(stamp);
      const inboxRows = page.getByTestId("inbox-row");
      await expect(inboxRows).toHaveCount(2, { timeout: 15_000 });
      await page.getByRole("heading", { name: "Document inbox" }).click(); // out of the search field
      await expect(async () => {
        await page.keyboard.press("r"); // refresh until the mock OCR has run on both
        await expect(page.locator('[data-inbox-state="ready"]')).toHaveCount(2, {
          timeout: 2_000,
        });
      }).toPass({ timeout: 90_000 });
    });
  });
});
