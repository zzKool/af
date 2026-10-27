import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { minimalPdf } from "./fixtures/pdf";
import { expectToast, trackToasts, withToastReport } from "./fixtures/toasts";

const SHOTS = join(__dirname, "..", "specs", "justify", "screenshots");

/** `E2E_SCREENSHOTS=1`: the journey leaves the PR's screenshots behind (definition of done §4.5). */
async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

/** the inbox's panes scroll inside the viewport: the card is captured as its own element */
async function snapElement(locator: Locator, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await locator.screenshot({ path: join(SHOTS, `${name}.png`) });
}

// Justify from the bank row (specs/justify/spec.md US1, US3, SC-001): three rows imported, then on the inbox —
// the proof dropped on the first (mock OCR → the compare card → Create supplier invoice & link), `n` on the fee
// row (no proof needed, 657, the rule proposed), `x` on the card row (receipt lost → an expense with the flag) —
// without leaving Work. The mock reads invented facts: the mechanics are asserted, never the values (D51).
const HEADER =
  "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";

test.describe("Justify", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });
  const stamp = String(Date.now()).slice(-5);
  const supplier = `E2E Supplier ${stamp}`;
  const groupName = `Justify ${stamp}`;

  test("the proof, no proof, the receipt lost — three rows from the inbox", async ({ page }) => {
    test.setTimeout(240_000);
    await trackToasts(page);
    await withToastReport(page, async () => {
      // 1. a vendor and a group for the card
      await page.goto("/partners");
      await page.getByRole("button", { name: "Add partner" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill(supplier);
      await page.getByRole("textbox", { name: "Short code" }).fill(`J${stamp.slice(-4)}`);
      await page.getByLabel("vendor").check();
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expectToast(page, "Partner created");
      await page.goto("/expenses/groups");
      await page.getByTestId("open-new-group").click();
      await page.getByTestId("group-description").fill(groupName);
      await page.getByTestId("save-group").click();
      await expectToast(page, "created");

      // 2. three rows: an invoice payment, a bank fee, a card purchase
      const today = new Date().toISOString().slice(0, 10);
      const d = today.replace(/-/g, "/");
      const counterparty = `JUSTIFY ${stamp}`;
      await page.goto("/banking");
      await page.getByTestId("open-import").click();
      await page.getByTestId("import-file").setInputFiles({
        name: `PLUSGIROKONTO FTG 123 45 67-8 - ${today} 11.00.00.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(
          [
            HEADER,
            `${d};-1297,20;;;${counterparty} OFFICE;;Invoice ${stamp};;;SEK;`,
            `${d};-40,00;;;PRISAVGIFT ${stamp};;;;;SEK;`,
            `${d};-523,17;;;;Kortköp 260708 CAFE ${stamp};;;;SEK;`,
          ].join("\n"),
          "latin1",
        ),
      });
      await expect(page.getByTestId("import-account")).toContainText("Plusgirokonto SEK");
      await page.getByTestId("import-run").click();
      await expect(page.getByTestId("import-summary")).toContainText("3 imported", {
        timeout: 20_000,
      });
      await page.keyboard.press("Escape");

      // 3. the inbox: the invoice row — drop the proof
      await page.goto("/banking/inbox");
      const inboxRow = (text: string) => page.getByTestId("inbox-row").filter({ hasText: text });
      await inboxRow(`${counterparty} OFFICE`).first().click();
      const panel = page.getByTestId("justify-panel");
      await expect(panel).toBeVisible();
      await snap(page, "justify-panel");
      await page.getByTestId("justify-file").setInputFiles({
        name: `proof-${stamp}.pdf`,
        mimeType: "application/pdf",
        buffer: minimalPdf(`Justify ${stamp}`),
      });
      const card = page.getByTestId("justify-card");
      await expect(card).toBeVisible({ timeout: 90_000 }); // the mock OCR job behind the upload
      await expect(card.getByTestId("justify-verdict")).toBeVisible();
      await snap(page, "justify-card");
      await snapElement(card, "justify-card-element");
      // the kind, the supplier, the category, the group — then the one click
      await page.getByTestId("justify-kind-supplier_invoice").click();
      await card.getByTestId("justify-partner").click();
      await page.getByRole("option", { name: supplier }).click();
      await card.getByTestId("justify-invoice-number").fill(`INV-${stamp}`);
      await card.getByTestId("justify-amount").fill("1297.20");
      await card.getByTestId("justify-category").click();
      await page.getByRole("option", { name: /^654/ }).click();
      await card.getByTestId("justify-group").click();
      await page.getByRole("option", { name: new RegExp(groupName) }).click();
      await card.getByTestId("justify-create").click();
      await expectToast(page, "created and linked");
      // the row left the inbox (it is linked)
      await expect(inboxRow(`${counterparty} OFFICE`)).toHaveCount(0, { timeout: 20_000 });

      // 4. the fee row: n → bank fee → no document needed, 657, the rule proposed
      await inboxRow(`PRISAVGIFT ${stamp}`).first().click();
      await expect(page.getByTestId("justify-panel")).toBeVisible();
      await page.keyboard.press("n");
      await page.getByTestId("justify-reason-fee").click();
      await expectToast(page, "no document needed");
      await expect(page.getByText(`Always like this for PRISAVGIFT ${stamp}?`)).toBeVisible();
      await expect(inboxRow(`PRISAVGIFT ${stamp}`)).toHaveCount(0, { timeout: 20_000 });

      // 5. the card row: x → the card without a document → an expense with the flag
      await inboxRow(`CAFE ${stamp}`).first().click();
      await expect(page.getByTestId("justify-panel")).toBeVisible();
      await page.keyboard.press("x");
      const lost = page.getByTestId("justify-card");
      await expect(lost).toBeVisible();
      await expect(lost).toContainText("No document");
      await expect(page.getByTestId("justify-kind-expense")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await lost.getByTestId("justify-description").fill(`Coffee ${stamp}`);
      await lost.getByTestId("justify-category").click();
      await page.getByRole("option", { name: /^580/ }).click();
      await lost.getByTestId("justify-group").click();
      await page.getByRole("option", { name: new RegExp(groupName) }).click();
      await snap(page, "justify-lost");
      await snapElement(lost, "justify-lost-element");
      await lost.getByTestId("justify-create").click();
      await expectToast(page, "created and linked");
      await expect(inboxRow(`CAFE ${stamp}`)).toHaveCount(0, { timeout: 20_000 });

      // 6. the three rows on the list: linked · no document · linked, with their categories
      await page.goto("/banking");
      await expect(
        page.getByRole("row").filter({ hasText: `${counterparty} OFFICE` }),
      ).toContainText("Linked");
      await expect(page.getByRole("row").filter({ hasText: `PRISAVGIFT ${stamp}` })).toContainText(
        "657",
      );
      await expect(page.getByRole("row").filter({ hasText: `CAFE ${stamp}` })).toContainText(
        "Linked",
      );
    });
  });
});
