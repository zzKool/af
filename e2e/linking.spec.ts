import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { expectToast, trackToasts, withToastReport } from "./fixtures/toasts";

const SHOTS = join(__dirname, "..", "specs", "linking", "screenshots");

/** `E2E_SCREENSHOTS=1`: the journey leaves the PR's screenshots behind (definition of done §4.5). */
async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

// Linking (specs/linking US1, US2, SC-003): an issued SEK invoice → the client's payment imported as a Nordea
// row with the number in the message → the banking panel suggests the invoice HIGH → Link → the invoice derives
// paid and lists the row → Unlink from the invoice page → open again.
const HEADER =
  "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";

test.describe("Linking", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  const stamp = String(Date.now()).slice(-5);
  const client = `E2E Payer ${stamp}`;
  const shortCode = `L${stamp.slice(-4)}`;
  const number = `${shortCode}26-INV-001`;

  test("suggestion → link → paid → unlink", async ({ page }) => {
    test.setTimeout(180_000); // the invoice's PDF job runs behind the issue step
    await trackToasts(page);
    await withToastReport(page, async () => {
      // 1. client, contract, rate, an issued invoice (as the invoices journey does)
      await page.goto("/partners");
      await page.getByRole("button", { name: "Add partner" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill(client);
      await page.getByRole("textbox", { name: "Short code" }).fill(shortCode);
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expectToast(page, "Partner created");
      await page.getByRole("link", { name: client }).click();
      await page.getByRole("tab", { name: /Contracts/ }).click();
      await page.getByRole("button", { name: "+ New Contract" }).click();
      await page.getByLabel("Name").fill("Consulting");
      await page.getByLabel("Start Date").fill("2026-01-01");
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expectToast(page, "Contract created");
      await page.getByText("Consulting", { exact: true }).click();
      const rates = page.getByTestId("contract-rates");
      await rates.getByRole("button", { name: "Add rate" }).click();
      await rates.locator("form").getByLabel("Valid from").fill("2026-01-01");
      await rates.locator("form").getByLabel(/^Rate/).fill("1000");
      await rates.locator("form").getByRole("button", { name: "Add", exact: true }).click();
      await expectToast(page, "Rate added");
      await page.goto("/invoices/new?type=invoice");
      await page.getByLabel("Client").click();
      await page.getByRole("option", { name: new RegExp(client) }).click();
      await expect(page.getByLabel("Contract")).toContainText("Consulting");
      await page.getByLabel("Period", { exact: true }).fill("2026 September");
      await page.getByLabel("Period start").fill("2026-09-01");
      await page.getByRole("button", { name: "Create draft" }).click();
      await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+$/);
      const invoiceUrl = page.url();
      const qty = page.getByLabel("Qty").first();
      await qty.fill("10");
      await qty.blur();
      await expect(page.getByText("Saved")).toBeVisible();
      await page.getByRole("button", { name: "Issue" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Issue" }).click();
      await expectToast(page, `${number} issued`);
      await expect(page.getByTestId("invoice-state")).toHaveText("Issued");
      const remaining = (await page.getByTestId("invoice-remaining").innerText()).trim();
      expect(remaining).toMatch(/^\d+\.\d\d$/);
      // nothing pays it yet — its own page says so
      await expect(page.getByTestId("invoice-links")).toContainText("Not linked to anything yet");

      // 2. the client's payment: an SEK row dated today with the number in the message
      const today = new Date().toISOString().slice(0, 10);
      await page.goto("/banking");
      await page.getByTestId("open-import").click();
      await page.getByTestId("import-file").setInputFiles({
        name: `PLUSGIROKONTO FTG 123 45 67-8 - ${today} 09.00.00.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(
          [
            HEADER,
            `${today.replace(/-/g, "/")};${remaining.replace(".", ",")};${client.toUpperCase()};;${client.toUpperCase()};Payment ${number};${number};;;SEK;`,
          ].join("\n"),
          "latin1",
        ),
      });
      await expect(page.getByTestId("import-account")).toContainText("Plusgirokonto SEK");
      await page.getByTestId("import-run").click();
      await expect(page.getByTestId("import-summary")).toContainText("1 imported", {
        timeout: 20_000,
      });
      await page.getByTestId("import-show-rows").click();

      // 3. the row's panel suggests the invoice HIGH; Link allocates the whole amount
      await page.getByRole("row").filter({ hasText: client.toUpperCase() }).first().click();
      const panel = page.getByTestId("transaction-panel");
      await expect(panel.getByTestId("panel-state")).toHaveText("Open");
      const suggestion = panel.getByTestId("suggestion").filter({ hasText: number });
      await expect(suggestion).toBeVisible();
      await expect(suggestion.getByTestId("suggestion-confidence")).toHaveText("High");
      await expect(suggestion).toContainText("Invoice number in message");
      await expect(suggestion).toContainText("Exact amount match");
      await expect(suggestion.getByTestId("suggestion-allocation")).toHaveValue(remaining);
      await snap(page, "panel-suggestions");
      await suggestion.getByTestId("suggestion-link").click();
      await expectToast(page, `Linked to ${number}`);
      await expect(panel.getByTestId("panel-state")).toHaveText("Linked");
      await expect(panel.getByTestId("link-row").filter({ hasText: number })).toBeVisible();
      await expect(panel).toContainText("Fully allocated");
      await snap(page, "panel-linked");
      await page.keyboard.press("Escape");

      // 4. the invoice derives paid; its page lists the row; unlink reopens it
      await page.goto(invoiceUrl);
      await expect(page.getByTestId("invoice-state")).toHaveText("Paid");
      await expect(page.getByTestId("invoice-remaining")).toHaveText("0.00");
      const links = page.getByTestId("invoice-links");
      await expect(links.getByTestId("link-row")).toHaveCount(1);
      await snap(page, "invoice-paid");
      await links.getByTestId("unlink").click();
      await expectToast(page, "Link removed");
      await expect(page.getByTestId("invoice-state")).toHaveText("Issued");
      await expect(page.getByTestId("invoice-remaining")).toHaveText(remaining);
      // and the row is back among the suggestions on the invoice's side
      await expect(links.getByTestId("suggestion").first()).toContainText(client.toUpperCase());
      await snap(page, "invoice-suggestions");
    });
  });
});
