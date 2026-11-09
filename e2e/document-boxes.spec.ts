import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { mockInvoicePdf } from "./fixtures/pdf";

const SHOTS = join(__dirname, "..", "specs", "documents", "screenshots");

async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

// Boxes on the document (F141): a dropped Letter PDF (no type asked, D78) is read by the mock with the invoice
// model, whose fields carry their boxes → the inbox pane lists *What it read* with *N sure · M to check*, the
// preview draws a box per field, hovering *Total* lights its box. Invented values (D51).
test.describe("Documents — what it read, and where", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("a drop → read → What it read → the boxes on the page, the hovered one lit", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const stamp = crypto.randomUUID().slice(0, 8);
    const name = `e2e-boxes-${stamp}.pdf`;
    await page.goto("/documents/library");
    await page.locator('input[type="file"]').setInputFiles({
      name,
      mimeType: "application/pdf",
      buffer: mockInvoicePdf(name),
    });
    await expect(page.getByRole("button", { name: "Upload another" })).toBeVisible({
      timeout: 15_000,
    });

    // the OCR job runs after the upload's commit — the inbox is read on request, so open it until the row is read
    const read = page.getByTestId("inbox-what-it-read");
    await expect(async () => {
      await page.goto(`/documents/inbox`);
      await page.getByPlaceholder("Search key, file or vendor").fill(stamp);
      const row = page.getByTestId("inbox-row").filter({ hasText: name }).first();
      await row.click({ timeout: 5_000 });
      await expect(read).toContainText("6 sure · 1 to check", { timeout: 3_000 });
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 3_000] });
    await expect(page.getByTestId("inbox-proposes")).toContainText("supplier invoice");

    const marks = page.getByTestId("preview-marks");
    await expect(marks).toBeVisible({ timeout: 30_000 });
    await expect(marks.locator("polygon")).toHaveCount(7);
    await read.locator('[data-mark="invoiceTotal"]').hover();
    await expect(marks.locator('polygon[data-mark="invoiceTotal"]')).toHaveAttribute(
      "data-active",
      "true",
    );
    await snap(page, "boxes");
  });
});
