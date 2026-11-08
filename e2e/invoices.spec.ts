import { expect, test } from "@playwright/test";
import { expectToast, trackToasts, withToastReport } from "./fixtures/toasts";

// The owner's monthly invoice (specs/invoices US1 + US2): client with a contract rate → new draft pre-filled
// from the contract → 20 days → issue → number assigned, sheet locked, PDF stored by the job → mark as sent.
test.describe("Invoices", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  const stamp = String(Date.now()).slice(-5);
  const client = `E2E Client ${stamp}`;
  const shortCode = `I${stamp.slice(-4)}`;

  test("draft from a contract, issue, PDF, mark as sent", async ({ page }) => {
    test.setTimeout(180_000); // the PDF job behind the issue step
    await trackToasts(page);
    await withToastReport(page, async () => {
      // client + contract + rate
      await page.goto("/partners");
      await page.getByRole("button", { name: "Add partner" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill(client);
      await page.getByRole("textbox", { name: "Short code" }).fill(shortCode);
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expectToast(page, "Partner created");
      await page.getByRole("link", { name: client }).click();
      await expect(page).toHaveURL(/\/partners\/[0-9a-f-]+$/);
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
      await rates.locator("form").getByLabel(/^Rate/).fill("1200");
      await rates.locator("form").getByRole("button", { name: "Add", exact: true }).click();
      await expectToast(page, "Rate added");

      // new draft — the contract fills the line
      await page.goto("/invoices/new?type=invoice");
      await page.getByLabel("Client").click();
      await page.getByRole("option", { name: new RegExp(client) }).click();
      // the contract list loads after the client is chosen — the draft is pre-filled only once it is there
      await expect(page.getByLabel("Contract")).toContainText("Consulting");
      await page.getByLabel("Period", { exact: true }).fill("2026 January");
      await page.getByLabel("Period start").fill("2026-01-01");
      await page.getByRole("button", { name: "Create draft" }).click();
      await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+$/);
      await expect(page.getByTestId("sheet-number")).toContainText(
        `will be ${shortCode}26-INV-001`,
      );
      await expect(page.getByLabel("Unit Price").first()).toHaveValue("1200.00");

      // 20 days, autosaved
      const qty = page.getByLabel("Qty").first();
      await qty.fill("20");
      await qty.blur();
      await expect(page.getByText("Saved")).toBeVisible();
      await expect(page.getByTestId("line-net").first()).toContainText("24");

      // F145: no discount row unless there is one; the PDF is there on demand, even for a draft
      await expect(page.getByTestId("sheet-discount")).toHaveCount(0);
      const preview = await page.request.get(`${page.url()}/pdf`);
      expect(preview.headers()["content-type"]).toContain("application/pdf");
      await expect(page.getByTestId("preview-pdf")).toBeVisible();

      // F143, the studio: ready to send re-checked on the draft, the client's history, the page's language
      const ready = page.getByTestId("invoice-ready");
      await expect(ready.locator('[data-key="lines"]')).toHaveAttribute("data-state", "ok");
      await expect(ready.locator('[data-key="client"]')).toHaveAttribute("data-state", "ok");
      await expect(page.getByTestId("invoice-when-paid")).toContainText("No paid invoice");
      const language = page.getByTestId("invoice-language");
      await language.getByRole("button", { name: "fr" }).click();
      await expect(page.getByText("Facture", { exact: true })).toBeVisible();
      await language.getByRole("button", { name: "en" }).click();
      await expect(language.getByRole("button", { name: "en" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByText("Saved")).toBeVisible();

      // issue → number, locked sheet, PDF from the job
      await page.getByRole("button", { name: "Issue" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Issue" }).click();
      await expectToast(page, `${shortCode}26-INV-001 issued`);
      await expect(page.getByTestId("sheet-number")).toHaveText(`${shortCode}26-INV-001`);
      await expect(page.getByTestId("invoice-state")).toHaveText("Issued");
      await expect(page.getByLabel("Qty")).toHaveCount(0); // print mode: no inputs
      await expect(page.getByTestId("download-pdf")).toBeVisible({ timeout: 90_000 });

      // mark as sent
      await page.getByRole("button", { name: "Mark as sent" }).click();
      await expectToast(page, "Marked as sent");
      await expect(page.getByTestId("invoice-state")).toHaveText("Sent");

      // the list shows it with its derived state
      await page.goto("/invoices");
      await expect(page.getByRole("link", { name: `${shortCode}26-INV-001` })).toBeVisible();

      // F144, the partner page: the year's figure, what happened, *New invoice* opens on this client
      await page.goto("/partners");
      await page.getByRole("link", { name: client }).click();
      await expect(page.getByTestId("partner-invoiced")).toContainText(/24.000\.00/);
      await expect(page.getByTestId("partner-pays-after")).toContainText("no paid invoice yet");
      await expect(page.getByTestId("partner-timeline")).toContainText(
        `Sent ${shortCode}26-INV-001`,
      );
      await page.getByTestId("partner-new-invoice").click();
      await expect(page).toHaveURL(/\/invoices\/new\?type=invoice&partner=/);
      await expect(page.getByLabel("Client")).toContainText(client);
    });
  });

  // F145: the invoice logo is picked in Settings and printed on top of the sheet
  test("the company logo: pick it in Settings", async ({ page }) => {
    await page.goto("/settings/company");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );
    await page
      .getByTestId("company-logo")
      .locator('input[type="file"]')
      .setInputFiles({ name: "invented-logo.png", mimeType: "image/png", buffer: png });
    await expect(page.getByTestId("company-logo").locator("img")).toBeVisible();
    await page.getByTestId("company-logo").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("company-logo").locator("img")).toHaveCount(0);
  });
});
