import { expect, test } from "@playwright/test";

// The library on the kernel DataTable (docs/document-library.md): upload → the row with its key, the header
// filter on Status, the search, download, delete with its confirmation; the accountant's read-only view.
test.describe("Document Library", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("upload → row → filter → delete", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload document" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search" })).toBeVisible();

    // upload a PDF — Azurite must be running (CI and local)
    const stamp = String(Date.now()).slice(-6);
    await page.locator('input[type="file"]').setInputFiles({
      name: `e2e-library-${stamp}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(`%PDF-1.4 e2e-library-${stamp}`),
    });
    await expect(page.getByRole("button", { name: "Upload another" })).toBeVisible({
      timeout: 15_000,
    });

    // the same bytes again: the card, nothing stored (specs/documents US2); "Upload another" clears it
    await page.getByRole("button", { name: "Upload another" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: `e2e-library-${stamp}-copy.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(`%PDF-1.4 e2e-library-${stamp}`),
    });
    const card = page.getByTestId("upload-duplicate");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByTestId("upload-duplicate-key")).toHaveText(/^exp_/);
    const existingHref = await card
      .getByRole("link", { name: "Use existing document" })
      .getAttribute("href");
    expect(existingHref).toMatch(/^\/documents\/[0-9a-f-]{36}$/);
    await card.getByRole("button", { name: "Upload another" }).click();

    // the row: an upload key (exp_…), status uploaded or processing, not linked — this journey's own file, never
    // the first exp_ row (a parallel journey's upload: deleting it below would pull it from under that journey)
    const row = page
      .getByRole("row")
      .filter({ has: page.getByTestId("document-key") })
      .filter({ hasText: `e2e-library-${stamp}.pdf` })
      .first();
    await expect(row.getByTestId("document-key")).toHaveText(/^exp_/, { timeout: 15_000 });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId("document-download")).toBeVisible();
    await expect(row.getByTestId("document-delete")).toBeVisible();

    // the header filter on Status narrows the list (the URL carries the query)
    await page.getByRole("button", { name: "Filter Status" }).click();
    const listbox = page.getByRole("listbox");
    await expect(listbox.locator("label").first()).toBeVisible();
    await page.getByRole("button", { name: "Clear" }).first().click();
    await listbox.locator("label").first().click();
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await expect(page).toHaveURL(/f\.status=in%3A/);
    // D40: the active filter is a button in the filter bar; Clear filters removes it
    await expect(page.locator("[data-filter-button=status]")).toHaveAttribute("data-active", "true");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/f\.status/);

    // search by key keeps the uploaded one
    const key = (await row.getByTestId("document-key").innerText()).trim();
    await page.getByRole("textbox", { name: "Search" }).fill(key);
    await page.getByRole("textbox", { name: "Search" }).press("Enter");
    await expect(page).toHaveURL(new RegExp(`q=${key}`), { timeout: 10_000 });
    await expect(page.getByTestId("document-key").filter({ hasText: key })).toBeVisible();

    // delete with its confirmation
    await page
      .getByRole("row")
      .filter({ hasText: key })
      .first()
      .getByTestId("document-delete")
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(key);
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId("document-key").filter({ hasText: key })).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});

test.describe("Document Library — the accountant", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("reads the financial documents, cannot upload or delete", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload document" })).toHaveCount(0);
    await expect(page.getByTestId("document-delete")).toHaveCount(0);
  });
});
