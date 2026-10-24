import { expect, test } from "@playwright/test";
import { expectToast, trackToasts, withToastReport } from "./fixtures/toasts";

// The accountant's invoice (specs/supplier-invoices US1–US3; SEK only — CI has no ECB rates): a vendor with
// 20-day terms → the invoice in a new group, due date from the terms, SI key → the paying row imported into
// banking → *Link payment* → paid → a second invoice from *Copy last*, cancelled with a reason → the group
// page lists them → the accountant reads, writes nothing.
const HEADER =
  "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";

test.describe("Supplier invoices", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  const stamp = String(Date.now()).slice(-5);
  const vendor = `Skattepunkten ${stamp}`;
  const groupName = `Admin ${stamp}`;
  // SEK only and dated around today: the due date (invoice date + 20) must still be ahead → "Unpaid"
  const iso = (daysFromToday: number) =>
    new Date(Date.now() + daysFromToday * 86_400_000).toISOString().slice(0, 10);
  const invoiceDate = iso(-2);
  const dueDate = iso(18);
  const nextInvoiceDate = iso(-1);
  const bankDate = iso(0).replace(/-/g, "/");

  test("vendor, invoice, payment link, copy last, cancel, group page", async ({ page }) => {
    test.setTimeout(240_000); // the longest journey after expenses: an import, two PDF-less creates, links — 180 s ran out on a loaded CI runner (2 workers)
    await trackToasts(page);
    await withToastReport(page, async () => {
      // 1. the vendor with 20-day terms
      await page.goto("/partners");
      await page.getByRole("button", { name: "Add partner" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill(vendor);
      await page.getByLabel("client").uncheck();
      await page.getByLabel("vendor").check();
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expect(page.getByText("Partner created")).toBeVisible();
      // open it by deep link: with many partners the new row may not be on the first page (lessons, fragility 3)
      await page.goto(`/partners?q=${encodeURIComponent(vendor)}`);
      await page.getByRole("link", { name: vendor }).click();
      await expect(page).toHaveURL(/\/partners\/[0-9a-f-]{36}$/);
      await page.getByLabel("Payment terms (days)").fill("20");
      const saved = page.waitForResponse(
        (r) => r.request().method() === "POST" && /\/partners\//.test(r.url()),
      );
      await page.getByLabel("Payment terms (days)").blur();
      await saved;
      await page.reload();
      await expect(page.getByLabel("Payment terms (days)")).toHaveValue("20");

      // 2. the invoice: a new group inline, the due date from the terms, the key
      await page.goto("/supplier-invoices");
      await expect(page.getByTestId("supplier-invoice-kpis")).toBeVisible();
      const dialog = page.getByTestId("new-supplier-invoice-dialog");
      const pick = async (testId: string, option: RegExp | string) => {
        await dialog.getByTestId(testId).click();
        await page.getByRole("option", { name: option }).click();
      };
      await page.getByTestId("open-new-supplier-invoice").click();
      await expect(dialog).toBeVisible();
      await pick("si-supplier", vendor);
      await dialog.getByLabel("Group", { exact: true }).click();
      await page.getByRole("option", { name: "+ New group…" }).click();
      await page.getByTestId("new-group-description").fill(groupName);
      await page.getByTestId("si-number").fill(`9160-${stamp}`);
      await page.getByTestId("si-date").fill(invoiceDate);
      await expect(page.getByTestId("si-due")).toHaveValue(dueDate);
      await pick("si-currency", "SEK");
      await page.getByTestId("si-net").fill("1200.00");
      await page.getByTestId("si-vat").fill("97.20");
      await expect(page.getByTestId("si-total")).toHaveValue("1297.20");
      await pick("si-category", /^653/);
      await page.getByTestId("create-supplier-invoice").click();
      await expectToast(page, "Acc-01 created");
      await expect(dialog).not.toBeVisible();
      const row = page
        .getByRole("row")
        .filter({ hasText: `9160-${stamp}` })
        .first();
      await expect(row).toContainText("Unpaid");
      await expect(row).toContainText(dueDate);

      // the panel: the key, the status, the due date from the terms — click the key cell, not the row's
      // centre (the group link sits there since the columns carry their widths)
      await row.getByText(/^SI\d+-Acc-\d+$/).click();
      const panel = page.getByTestId("supplier-invoice-panel");
      await expect(panel).toBeVisible();
      await expect(page.getByTestId("panel-key")).toContainText(/SI\d+-Acc-01/);
      const key = await page.getByTestId("panel-key").innerText();
      await expect(page.getByTestId("panel-status")).toHaveText("Unpaid");
      await panel.getByLabel("Note").fill("July fee");
      await panel.getByLabel("Note").blur();
      await expectToast(page, "Saved");
      await page.keyboard.press("Escape");
      await expect(panel).not.toBeVisible();

      // 3. the paying row (−1 297.20 SEK) into banking
      await page.goto("/banking");
      await page.getByTestId("open-import").click();
      await page.getByTestId("import-file").setInputFiles({
        name: `PLUSGIROKONTO FTG 123 45 67-8 - ${iso(0)} ${stamp}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(
          `${HEADER}\n${bankDate};-1297,20;;;${vendor};Faktura 9160;;;;SEK;\n`,
          "latin1",
        ),
      });
      await expect(page.getByTestId("import-account")).toContainText("Plusgirokonto SEK");
      await page.getByTestId("import-run").click();
      await expect(page.getByTestId("import-summary")).toContainText("1 imported", {
        timeout: 20_000,
      });
      await page.keyboard.press("Escape");

      // 4. link the payment: the row of the invoice currency, the whole open amount → paid
      await page.goto(`/supplier-invoices?q=${encodeURIComponent(key)}`);
      await page.getByRole("row").filter({ hasText: key }).first().getByText(key).click();
      await expect(panel).toBeVisible();
      await panel.getByLabel("Pick the bank row that paid this invoice").click();
      await page.getByRole("option", { name: new RegExp(vendor) }).click();
      await page.getByTestId("link-payment-run").click();
      await expectToast(page, "Payment linked");
      await expect(page.getByTestId("panel-status")).toHaveText("Paid");
      // the D40 on-screen money: U+202F thousands, "." decimals (formatMoney; \s matches U+202F and U+00A0 whether or not Playwright normalises)
      await expect(panel.getByTestId("payments")).toContainText(/1\s297\.20\sSEK/);
      // paid and linked: the money facts are written, no cancel, no delete
      await expect(panel.getByTestId("save-money")).toHaveCount(0);
      await expect(panel.getByTestId("cancel-invoice")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("row").filter({ hasText: key }).first()).toContainText("Paid");

      // 5. the next month's invoice from *Copy last*, then cancelled with a reason
      await page.getByTestId("open-new-supplier-invoice").click();
      await expect(dialog).toBeVisible();
      await pick("si-supplier", vendor);
      await page.getByTestId("copy-last").click();
      await expect(page.getByTestId("si-net")).toHaveValue("1200.00");
      await expect(page.getByTestId("si-total")).toHaveValue("1297.20");
      await page.getByTestId("si-number").fill(`9161-${stamp}`);
      await page.getByTestId("si-date").fill(nextInvoiceDate);
      await page.getByTestId("create-supplier-invoice").click();
      await expectToast(page, "Acc-02 created");
      await page.goto(`/supplier-invoices?q=9161-${stamp}`);
      await page
        .getByRole("row")
        .filter({ hasText: `9161-${stamp}` })
        .first()
        .getByText(/^SI\d+-Acc-\d+$/)
        .click();
      await expect(panel).toBeVisible();
      await page.getByTestId("cancel-reason").fill("Sent twice");
      await page.getByTestId("cancel-invoice").click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Cancel invoice" }).click();
      await expectToast(page, "cancelled");
      await expect(page.getByTestId("panel-status")).toHaveText("Cancelled");
      await page.keyboard.press("Escape");

      // 6. the group page lists both
      await page.goto("/expenses/groups");
      await page.getByRole("link", { name: groupName }).first().click();
      await expect(page).toHaveURL(/\/expenses\/groups\/[0-9a-f-]+$/);
      const section = page.getByTestId("group-supplier-invoices");
      await expect(section).toContainText("2 supplier invoice(s)");
      await expect(section).toContainText(key);
      await expect(section).toContainText("Cancelled");
    });
  });

  test("the accountant reads supplier invoices, writes nothing", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/accountant.json" });
    const page = await ctx.newPage();
    await page.goto("/supplier-invoices");
    await expect(page.getByRole("heading", { name: "Supplier invoices" })).toBeVisible();
    await expect(page.getByTestId("open-new-supplier-invoice")).toHaveCount(0);
    // ?new=1 opens nothing for a role that cannot create
    await page.goto("/supplier-invoices?new=1");
    await expect(page.getByTestId("new-supplier-invoice-dialog")).toHaveCount(0);
    await ctx.close();
  });

  // F73: + New → Supplier invoice lands on ?new=1 — the dialog opens; closing drops the param
  test("?new=1 opens the new supplier invoice dialog", async ({ page }) => {
    await page.goto("/supplier-invoices?new=1");
    const dialog = page.getByTestId("new-supplier-invoice-dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/new=1/);
  });
});
