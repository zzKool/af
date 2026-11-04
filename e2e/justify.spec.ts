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
  await page.waitForTimeout(400); // a theme or a scroll just changed: let the paint settle
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** the inbox's panes scroll inside the viewport: an element is captured on its own */
async function snapElement(locator: Locator, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await locator.screenshot({ path: join(SHOTS, `${name}.png`) });
}

// Justify from the bank row (specs/justify/spec.md US1, US3; F129 US3; F131 the reading dialog, review 2026-10-31
// §6.3): four rows imported, then on the inbox — the proof dropped on the first as an *Invoice* (D75; mock OCR → the
// reading dialog: the fields with their glyphs, the new partner from the paper, the checks, the trip group proposed
// from the paper's date, *Confirm & link*), a *Receipt* dropped on the second (the receipt model's reading, a new
// group in place), `n` on the fee row (no proof needed, the bank proposed as its partner, the rule proposed), `x` on
// the last (receipt lost → the dialog without a paper) — without leaving Work. The mock reads invented facts: the
// mechanics are asserted, never the values (D51).
const HEADER =
  "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";

test.describe("Justify", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });
  const stamp = String(Date.now()).slice(-5);
  const supplier = `E2E Supplier ${stamp}`;
  const supplierVat = `SE${stamp}${stamp}01`.slice(0, 14);
  const tripName = `Justify trip ${stamp}`;
  const groupName = `Justify ${stamp}`;

  test("the reading dialog — an invoice, a receipt, no proof, the receipt lost", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    // the dialog fills the viewport: the PR's pictures take a taller one so the checks and the group are in view
    if (process.env.E2E_SCREENSHOTS) await page.setViewportSize({ width: 1280, height: 1000 });
    await trackToasts(page);
    await withToastReport(page, async () => {
      // 1. a trip group whose days cover a paper date (2025, the seeded rates' year) — the dialog proposes it
      await page.goto("/expenses/groups");
      await page.getByTestId("open-new-group").click();
      await page.getByTestId("group-description").fill(tripName);
      await page.getByLabel("Kind", { exact: true }).click();
      await page.getByRole("option", { name: "Trip" }).click();
      await page.getByTestId("save-group").click();
      await expectToast(page, "created");
      await page
        .getByRole("link", { name: new RegExp(tripName) })
        .first()
        .click();
      await expect(page).toHaveURL(/\/expenses\/groups\/[0-9a-f-]+$/);
      await page.getByLabel("Departure").fill("2025-03-10T09:00");
      await page.getByLabel("Return").fill("2025-03-20T17:00");
      await page.getByLabel("Country", { exact: true }).click();
      await page.getByRole("option", { name: /Switzerland|Schweiz/ }).click();
      await page.getByTestId("save-trip").click();
      await expectToast(page, "Trip saved");

      // 2. four rows: an invoice payment, a card purchase (the receipt), a bank fee, a card purchase (lost)
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
            `${d};-1250,00;;;${counterparty} OFFICE;;Invoice ${stamp};;;SEK;`,
            `${d};-342,50;;;;Kortköp 260708 ICA ${stamp};;;;SEK;`,
            `${d};-40,00;;;PRISAVGIFT ${stamp};;;;;SEK;`,
            `${d};-523,17;;;;Kortköp 260708 CAFE ${stamp};;;;SEK;`,
          ].join("\n"),
          "latin1",
        ),
      });
      await expect(page.getByTestId("import-account")).toContainText("Plusgirokonto SEK");
      await page.getByTestId("import-run").click();
      await expect(page.getByTestId("import-summary")).toContainText("4 imported", {
        timeout: 20_000,
      });
      await page.keyboard.press("Escape");

      // 3. the inbox: the invoice row — the paper question, Invoice by default (D75), the proof dropped
      await page.goto("/banking/inbox");
      const inboxRow = (text: string) => page.getByTestId("inbox-row").filter({ hasText: text });
      await inboxRow(`${counterparty} OFFICE`).first().click();
      const panel = page.getByTestId("justify-panel");
      await expect(panel).toBeVisible();
      await expect(page.getByTestId("justify-paper-invoice")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await snap(page, "justify-panel");
      await page.getByTestId("justify-file").setInputFiles({
        name: `proof-${stamp}.pdf`,
        mimeType: "application/pdf",
        buffer: minimalPdf(`Justify ${stamp}`),
      });
      const dialog = page.getByTestId("reading-dialog");
      await expect(dialog).toBeVisible({ timeout: 90_000 }); // the mock OCR job behind the upload
      // the reading: the invoice model's fields with a confidence glyph each (F127), Becomes derived (D75)
      await expect(dialog.getByTestId("reading-becomes")).toHaveText("supplier invoice");
      await expect(dialog.getByTestId("justify-vendor")).not.toHaveValue("");
      await expect(dialog.getByTestId("justify-invoice-number")).not.toHaveValue("");
      await expect(dialog.getByTestId("justify-amount")).toHaveValue("1250.00");
      expect(await dialog.getByTestId("field-confidence").count()).toBeGreaterThan(3);
      await expect(dialog.getByTestId("reading-preview")).toBeVisible();
      // the partner block first: the match card, then + New partner from this invoice → the full form, pre-filled
      await expect(dialog.getByTestId("partner-match")).toBeVisible();
      // the checks: the amount equal, the vendor against the counterparty (a warning — the paper names another vendor)
      await expect(dialog.getByTestId("reading-check-ok").first()).toContainText("amount equal", {
        timeout: 15_000,
      });
      await snap(page, "reading-dialog");
      await page.emulateMedia({ colorScheme: "dark" });
      await snap(page, "reading-dialog-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await dialog.getByTestId("partner-match-new").click();
      const form = dialog.getByTestId("reading-new-partner");
      await expect(form.getByTestId("reading-new-partner-name")).not.toHaveValue("");
      await form.getByTestId("reading-new-partner-name").fill(supplier);
      await form.getByTestId("reading-new-partner-vat").fill(supplierVat);
      await form.getByTestId("reading-new-partner-create").click();
      await expectToast(page, "created");
      await expect(dialog.getByTestId("justify-partner")).toContainText(supplier);
      // the invoice date edited into the trip's days: the group follows — proposed (the trip); the date check warns
      await dialog.getByTestId("justify-date").fill("2025-03-14");
      await expect(dialog.getByTestId("reading-group-hint")).toHaveText("proposed (the trip)");
      await expect(dialog.getByTestId("justify-group")).toContainText(tripName);
      await expect(dialog.getByTestId("reading-check-warning").first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        dialog.getByTestId("reading-check-warning").filter({ hasText: /^!?\s*Booked/ }),
      ).toHaveCount(1);
      await dialog.getByTestId("reading-checks").scrollIntoViewIfNeeded();
      await snap(page, "reading-dialog-warnings");
      await snapElement(dialog.getByTestId("reading-checks"), "reading-dialog-checks-element");
      // the category, then the one click — warn, never block
      await dialog.getByTestId("justify-category").click();
      await page.getByRole("option", { name: /^654/ }).click();
      await expect(dialog.getByTestId("justify-create")).toBeEnabled();
      await dialog.getByTestId("justify-create").click();
      await expectToast(page, "created and linked");
      await expect(dialog).not.toBeVisible();
      // the row left the inbox (it is linked)
      await expect(inboxRow(`${counterparty} OFFICE`)).toHaveCount(0, { timeout: 20_000 });

      // 4. the receipt path: Receipt selected → the receipt model's reading → Becomes expense; a new group in place
      await inboxRow(`ICA ${stamp}`).first().click();
      await expect(page.getByTestId("justify-panel")).toBeVisible();
      await page.getByTestId("justify-paper-receipt").click();
      await expect(page.getByTestId("justify-paper-receipt")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await page.getByTestId("justify-file").setInputFiles({
        name: `receipt-${stamp}.pdf`,
        mimeType: "application/pdf",
        buffer: minimalPdf(`Receipt ${stamp}`),
      });
      await expect(dialog).toBeVisible({ timeout: 90_000 });
      await expect(dialog.getByTestId("reading-paper-receipt")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(dialog.getByTestId("reading-becomes")).toHaveText("expense");
      await expect(dialog.getByTestId("justify-amount")).toHaveValue("342.50");
      await expect(dialog.getByTestId("reading-payer")).toContainText("Plusgirokonto SEK");
      // the merchant read is no partner: the supplier made above is picked (F129: every exit names one)
      await dialog.getByTestId("justify-partner").click();
      await page.getByRole("option", { name: supplier }).click();
      await dialog.getByTestId("justify-group").getByRole("combobox").click();
      await page.getByRole("option", { name: "+ New group…" }).click();
      await dialog.getByTestId("new-group-description").fill(groupName);
      await dialog.getByTestId("justify-category").click();
      await page.getByRole("option", { name: /^580/ }).click();
      await dialog.getByTestId("justify-create").click();
      await expectToast(page, "created and linked");
      await expect(inboxRow(`ICA ${stamp}`)).toHaveCount(0, { timeout: 20_000 });

      // 5. the fee row: n → bank fee → the bank proposed as the partner (F129, D73) → Done → no document needed,
      //    657, Nordea, the rule proposed
      await inboxRow(`PRISAVGIFT ${stamp}`).first().click();
      await expect(page.getByTestId("justify-panel")).toBeVisible();
      await page.keyboard.press("n");
      await page.getByTestId("justify-reason-fee").click();
      const partnerLine = page.getByTestId("justify-partner-line");
      await expect(partnerLine).toContainText("Nordea — proposed (the bank)");
      await partnerLine.getByTestId("justify-no-proof-done").click();
      await expectToast(page, "no document needed");
      await expect(page.getByText(`Always like this for PRISAVGIFT ${stamp}?`)).toBeVisible();
      await expect(inboxRow(`PRISAVGIFT ${stamp}`)).toHaveCount(0, { timeout: 20_000 });

      // 6. the card row: x → the dialog without a paper → an expense with the flag, the merchant picked
      await inboxRow(`CAFE ${stamp}`).first().click();
      await expect(page.getByTestId("justify-panel")).toBeVisible();
      await page.keyboard.press("x");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("reading-title")).toContainText("Receipt lost");
      await expect(dialog.getByTestId("reading-no-document")).toBeVisible();
      await expect(dialog.getByTestId("reading-becomes")).toHaveText("expense");
      await dialog.getByTestId("justify-vendor").fill(`Coffee ${stamp}`);
      await dialog.getByTestId("justify-partner").click();
      await page.getByRole("option", { name: supplier }).click();
      await dialog.getByTestId("justify-group").getByRole("combobox").click();
      await page.getByRole("option", { name: new RegExp(groupName) }).click();
      await dialog.getByTestId("justify-category").click();
      await page.getByRole("option", { name: /^580/ }).click();
      await snap(page, "reading-dialog-lost");
      await dialog.getByTestId("justify-create").click();
      await expectToast(page, "created and linked");
      await expect(inboxRow(`CAFE ${stamp}`)).toHaveCount(0, { timeout: 20_000 });

      // 7. the four rows on the list: linked · linked · no document · linked, with their partners — the supplier's
      //    name on the rows the dialog linked (F129, D73 (a): derived on read)
      await page.goto("/banking");
      const officeRow = page.getByRole("row").filter({ hasText: `${counterparty} OFFICE` });
      await expect(officeRow).toContainText("Linked");
      await expect(officeRow).toContainText(supplier);
      const icaRow = page.getByRole("row").filter({ hasText: `ICA ${stamp}` });
      await expect(icaRow).toContainText("Linked");
      await expect(icaRow).toContainText(supplier);
      const feeRow = page.getByRole("row").filter({ hasText: `PRISAVGIFT ${stamp}` });
      await expect(feeRow).toContainText("657");
      await expect(feeRow).toContainText("Nordea");
      await expect(feeRow).toContainText("No document needed");
      await expect(page.getByRole("row").filter({ hasText: `CAFE ${stamp}` })).toContainText(
        "Linked",
      );
    });
  });
});
