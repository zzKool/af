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

      // 5. the graph (read model): the invoice in the centre, the row one hop away; *Open* brings the
      // banking panel up on that row; back on the invoice, unlink
      await links.getByTestId("graph-link").click();
      await expect(page).toHaveURL(/\/links\/invoice\/[0-9a-f-]+$/);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(number);
      await expect(page.getByTestId("link-graph")).toBeVisible();
      const node = page.getByTestId("graph-node").filter({ hasText: "Bank row" });
      await expect(node).toHaveCount(1);
      await expect(node).toContainText(`${remaining} SEK`);
      await expect(page.getByTestId("graph-truncated")).toHaveCount(0);
      await snap(page, "graph");
      await node.getByTestId("graph-open").click();
      await expect(page).toHaveURL(/\/banking\?open=[0-9a-f-]+$/);
      await expect(page.getByTestId("transaction-panel").getByTestId("panel-state")).toHaveText(
        "Linked",
      );
      await page.keyboard.press("Escape");
      await page.goto(invoiceUrl);
      await links.getByTestId("unlink").click();
      await expectToast(page, "Link removed");
      await expect(page.getByTestId("invoice-state")).toHaveText("Issued");
      await expect(page.getByTestId("invoice-remaining")).toHaveText(remaining);
      // and the row is back among the suggestions on the invoice's side
      await expect(links.getByTestId("suggestion").first()).toContainText(client.toUpperCase());
      await snap(page, "invoice-suggestions");
    });
  });

  // The inbox (US3): the row lands HIGH at the top → Enter links it → it leaves the list → u brings it back →
  // Apply HIGH on the selection reports it applied; the documents tab counts the unlinked uploads.
  test("inbox: Enter applies the HIGH candidate, u undoes, Apply HIGH reports", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const stamp2 = String(Date.now() + 7).slice(-5);
    const payer = `E2E Inbox ${stamp2}`;
    const code = `X${stamp2.slice(-4)}`;
    const num = `${code}26-INV-001`;
    await trackToasts(page);
    await withToastReport(page, async () => {
      await page.goto("/partners");
      await page.getByRole("button", { name: "Add partner" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill(payer);
      await page.getByRole("textbox", { name: "Short code" }).fill(code);
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expectToast(page, "Partner created");
      await page.getByRole("link", { name: payer }).click();
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
      await rates.locator("form").getByLabel(/^Rate/).fill("900");
      await rates.locator("form").getByRole("button", { name: "Add", exact: true }).click();
      await expectToast(page, "Rate added");
      await page.goto("/invoices/new?type=invoice");
      await page.getByLabel("Client").click();
      await page.getByRole("option", { name: new RegExp(payer) }).click();
      await expect(page.getByLabel("Contract")).toContainText("Consulting");
      await page.getByLabel("Period", { exact: true }).fill("2026 August");
      await page.getByLabel("Period start").fill("2026-08-01");
      await page.getByRole("button", { name: "Create draft" }).click();
      await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+$/);
      const qty = page.getByLabel("Qty").first();
      await qty.fill("5");
      await qty.blur();
      await expect(page.getByText("Saved")).toBeVisible();
      await page.getByRole("button", { name: "Issue" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Issue" }).click();
      await expectToast(page, `${num} issued`);
      const remaining = (await page.getByTestId("invoice-remaining").innerText()).trim();

      const today = new Date().toISOString().slice(0, 10);
      await page.goto("/banking");
      await page.getByTestId("open-import").click();
      await page.getByTestId("import-file").setInputFiles({
        name: `PLUSGIROKONTO FTG 123 45 67-8 - ${today} 10.00.00.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(
          [
            HEADER,
            `${today.replace(/-/g, "/")};${remaining.replace(".", ",")};${payer.toUpperCase()};;${payer.toUpperCase()};Payment ${num};${num};;;SEK;`,
          ].join("\n"),
          "latin1",
        ),
      });
      await expect(page.getByTestId("import-account")).toContainText(/Plusgirokonto|Sparkonto/);
      await page.getByTestId("import-run").click();
      await expect(page.getByTestId("import-summary")).toContainText("1 imported", {
        timeout: 20_000,
      });
      await page.keyboard.press("Escape");

      // the inbox lists the row HIGH; select it, Enter links it
      await page.getByTestId("go-inbox").click();
      await expect(page).toHaveURL(/\/banking\/inbox/);
      const row = page.getByTestId("inbox-row").filter({ hasText: payer.toUpperCase() });
      await expect(row).toBeVisible();
      await expect(row.getByTestId("inbox-top-confidence")).toHaveText("High");
      await expect(row).toContainText(num);
      await row.click();
      await expect(page.getByTestId("transaction-detail")).toContainText(payer.toUpperCase());
      await snap(page, "inbox");
      await page.keyboard.press("?");
      await expect(page.getByTestId("inbox-help")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("inbox-help")).toBeHidden();
      await row.click(); // focus back on the page, the row still selected
      await page.keyboard.press("Enter");
      await expectToast(page, `Linked to ${num}`);
      await expect(row).toHaveCount(0);

      // u: the last link made here is undone, the row is back
      await page.keyboard.press("u");
      await expectToast(page, "Link removed");
      await expect(row).toBeVisible();

      // Apply HIGH on the selection: applied 1
      await row.getByRole("checkbox").click();
      await page.getByTestId("apply-high").click();
      const report = page.getByTestId("apply-high-report");
      await expect(report).toBeVisible();
      await expect(report).toContainText("1 applied");
      await snap(page, "inbox-report");
      await page.keyboard.press("Escape");
      await expect(row).toHaveCount(0);

      // the documents tab exists (counts the unlinked uploads)
      await page.getByTestId("inbox-tab-documents").click();
      await expect(page.getByTestId("inbox-tab-documents")).toContainText("Unlinked documents");
    });
  });
});
