import { expect, test } from "@playwright/test";
import { expectToast, trackToasts, withToastReport } from "./fixtures/toasts";

// F93 global search (specs/search/spec.md): the journey owns its data — a client, a contract rate, an issued
// invoice — then Ctrl K anywhere, the invoice's key typed in full, Enter opens it by its deep link.
test.describe("Global search", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  const stamp = String(Date.now()).slice(-4);
  const client = `E2E Search ${stamp}`;
  const shortCode = `K${stamp}`;

  test("Ctrl K finds an invoice by its key and opens it", async ({ page }) => {
    test.setTimeout(180_000);
    await trackToasts(page);
    await withToastReport(page, async () => {
      // a client with a contract rate, so the draft has a line to issue
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
      await rates.locator("form").getByLabel(/^Rate/).fill("1250");
      await rates.locator("form").getByRole("button", { name: "Add", exact: true }).click();
      await expectToast(page, "Rate added");

      await page.goto("/invoices/new?type=invoice");
      await page.getByLabel("Client").click();
      await page.getByRole("option", { name: new RegExp(client) }).click();
      await expect(page.getByLabel("Contract")).toContainText("Consulting");
      await page.getByLabel("Period", { exact: true }).fill("2026 February");
      await page.getByLabel("Period start").fill("2026-02-01");
      await page.getByRole("button", { name: "Create draft" }).click();
      await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+$/);
      const invoiceUrl = page.url();
      await expect(page.getByLabel("Unit Price").first()).toHaveValue("1250.00");
      await page.getByRole("button", { name: "Issue" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Issue" }).click();
      const key = `${shortCode}26-INV-001`;
      await expectToast(page, `${key} issued`);

      // anywhere else: Ctrl K, the key, Enter
      await page.goto("/dashboard");
      await page.keyboard.press("Control+k");
      const input = page.getByRole("combobox", { name: "Search" });
      await expect(input).toBeFocused();
      await input.fill(key.toLowerCase());
      const group = page.getByRole("group", { name: "Invoices" });
      const option = group.getByRole("option", { name: new RegExp(key) });
      await expect(option).toBeVisible();
      await expect(option).toHaveAttribute("aria-selected", "true"); // the exact key is first
      await input.press("Enter");
      await expect(page).toHaveURL(invoiceUrl);
      await expect(page.getByTestId("sheet-number")).toHaveText(key);

      // the top-bar box opens the same palette; Esc closes it
      await page.getByRole("button", { name: /Search pages, keys, names, amounts/ }).click();
      await expect(input).toBeVisible();
      await input.press("Escape");
      await expect(input).toBeHidden();
    });
  });
});
