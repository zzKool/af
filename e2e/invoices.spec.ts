import { expect, test } from "@playwright/test";

// The owner's monthly invoice (specs/invoices US1 + US2): client with a contract rate → new draft pre-filled
// from the contract → 20 days → issue → number assigned, sheet locked, PDF stored by the job → mark as sent.
test.describe("Invoices", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  const stamp = String(Date.now()).slice(-5);
  const client = `E2E Client ${stamp}`;
  const shortCode = `I${stamp.slice(-4)}`;

  test("draft from a contract, issue, PDF, mark as sent", async ({ page }) => {
    // client + contract + rate
    await page.goto("/partners");
    await page.getByRole("button", { name: "Add partner" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill(client);
    await page.getByRole("textbox", { name: "Short code" }).fill(shortCode);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Partner created")).toBeVisible();
    await page.getByRole("link", { name: client }).click();
    await expect(page).toHaveURL(/\/partners\/[0-9a-f-]+$/);
    await page.getByRole("tab", { name: /Contracts/ }).click();
    await page.getByRole("button", { name: "+ New Contract" }).click();
    await page.getByLabel("Name").fill("Consulting");
    await page.getByLabel("Start Date").fill("2026-01-01");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Contract created")).toBeVisible();
    await page.getByText("Consulting", { exact: true }).click();
    const rates = page.getByTestId("contract-rates");
    await rates.getByRole("button", { name: "Add rate" }).click();
    await rates.locator("form").getByLabel("Valid from").fill("2026-01-01");
    await rates.locator("form").getByLabel(/^Rate/).fill("1200");
    await rates.locator("form").getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Rate added").last()).toBeVisible();

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
    await expect(page.getByTestId("sheet-number")).toContainText(`will be ${shortCode}26-001`);
    await expect(page.getByLabel("Unit Price").first()).toHaveValue("1200.00");

    // 20 days, autosaved
    const qty = page.getByLabel("Qty").first();
    await qty.fill("20");
    await qty.blur();
    await expect(page.getByText("Saved")).toBeVisible();
    await expect(page.getByTestId("line-net").first()).toContainText("24");

    // issue → number, locked sheet, PDF from the job
    await page.getByRole("button", { name: "Issue" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Issue" }).click();
    await expect(page.getByText(`${shortCode}26-001 issued`)).toBeVisible();
    await expect(page.getByTestId("sheet-number")).toHaveText(`${shortCode}26-001`);
    await expect(page.getByTestId("invoice-state")).toHaveText("Issued");
    await expect(page.getByLabel("Qty")).toHaveCount(0); // print mode: no inputs
    await expect(page.getByTestId("download-pdf")).toBeVisible({ timeout: 90_000 });

    // mark as sent
    await page.getByRole("button", { name: "Mark as sent" }).click();
    await expect(page.getByText("Marked as sent")).toBeVisible();
    await expect(page.getByTestId("invoice-state")).toHaveText("Sent");

    // the list shows it with its derived state
    await page.goto("/invoices");
    await expect(page.getByRole("link", { name: `${shortCode}26-001` })).toBeVisible();
  });
});
