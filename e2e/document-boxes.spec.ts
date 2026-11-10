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

// Boxes on the document (F141, F185): a dropped Letter PDF (no type asked, D78) is read by the mock with the invoice
// model, whose fields carry their boxes → the desk lists *What it read* with *N sure · M to check*, the page draws a
// box per field, hovering *Total* lights its box; the invoice number (read at 81 %) asks *is it right?* — *Yes*
// writes the owner's word on the document and the field is sure. Invented values (D51).
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
      await page.getByTestId("inbox-tools").click();
      await page.getByPlaceholder("Search key, file or vendor").fill(stamp);
      // the card names the vendor once read; the search on the stamp leaves this one document
      const row = page.getByTestId("inbox-row").first();
      await expect(row).toHaveAttribute("data-inbox-state", "ready", { timeout: 3_000 });
      await row.click({ timeout: 5_000 });
      await expect(read).toContainText("6 sure · 1 to check", { timeout: 3_000 });
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 3_000] });
    await expect(page.getByTestId("inbox-proposes")).toContainText("Supplier invoice");
    await expect(page.getByTestId("inbox-proposes")).toContainText("detected");

    const marks = page.getByTestId("preview-marks");
    await expect(marks).toBeVisible({ timeout: 30_000 });
    await expect(marks.locator("[data-mark]")).toHaveCount(7);
    await read.locator('[data-mark="invoiceTotal"]').hover();
    await expect(marks.locator('[data-mark="invoiceTotal"]')).toHaveAttribute(
      "data-active",
      "true",
    );
    await snap(page, "boxes");

    // the field to check: its question in place, Yes → a correction on the document → sure, its box too
    const number = read.locator('[data-mark="invoiceNumber"]');
    await expect(number.getByTestId("read-field-ask")).toContainText("Read at 81 % — is it right?");
    await number.getByRole("button", { name: "Yes, it is" }).click();
    await expect(read).toContainText("7 sure · 0 to check", { timeout: 10_000 });
    await expect(marks.locator('[data-mark="invoiceNumber"]')).toHaveAttribute("data-sure", "true");
  });
});
