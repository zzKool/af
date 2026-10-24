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
    const stamp = crypto.randomUUID().slice(0, 8); // not the clock: parallel journeys, same millisecond
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
    // F71: the row's derived state as icon + word, its actions in the ⋮ menu
    await expect(row.getByTestId("document-state")).toHaveText(/Needs OCR|Processing|Ready/);
    await row.getByRole("button", { name: "Row actions" }).click();
    const rowMenu = page.getByRole("menu");
    await expect(rowMenu.getByRole("menuitem", { name: "Open" })).toBeVisible();
    await expect(rowMenu.getByRole("menuitem", { name: "Download" })).toBeVisible();
    await expect(rowMenu.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(rowMenu).toBeHidden();

    // the header filter on Status narrows the list (the URL carries the query)
    await page.getByRole("button", { name: "Filter Status" }).click();
    const listbox = page.getByRole("listbox");
    await expect(listbox.locator("label").first()).toBeVisible();
    await page.getByRole("button", { name: "Clear" }).first().click();
    await listbox.locator("label").first().click();
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await expect(page).toHaveURL(/f\.status=in%3A/);
    // D40: the active filter is a button in the filter bar; Clear filters removes it
    await expect(page.locator("[data-filter-button=status]")).toHaveAttribute(
      "data-active",
      "true",
    );
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/f\.status/);

    // search by key keeps the uploaded one
    const key = (await row.getByTestId("document-key").innerText()).trim();
    await page.getByRole("textbox", { name: "Search" }).fill(key);
    await page.getByRole("textbox", { name: "Search" }).press("Enter");
    await expect(page).toHaveURL(new RegExp(`q=${key}`), { timeout: 10_000 });
    await expect(page.getByTestId("document-key").filter({ hasText: key })).toBeVisible();

    // delete with its confirmation (the row's ⋮ menu)
    await page
      .getByRole("row")
      .filter({ hasText: key })
      .first()
      .getByRole("button", { name: "Row actions" })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(key);
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId("document-key").filter({ hasText: key })).toHaveCount(0, {
      timeout: 10_000,
    });
  });

  // F73: + New → Upload document lands on ?new=1 — the zone in a dialog; closing drops the param
  test("?new=1 opens the upload dialog", async ({ page }) => {
    await page.goto("/documents?new=1");
    const dialog = page.getByTestId("upload-document-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Upload document" })).toBeVisible();
    const stamp = crypto.randomUUID().slice(0, 8);
    await dialog.locator('input[type="file"]').setInputFiles({
      name: `e2e-new-${stamp}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(`%PDF-1.4 e2e-new-${stamp}`),
    });
    await expect(dialog.getByRole("button", { name: "Upload another" })).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/new=1/);
    // the list behind refreshed with the new row
    await page.getByRole("textbox", { name: "Search" }).fill(`e2e-new-${stamp}`);
    await expect(page.getByText(`e2e-new-${stamp}.pdf`)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Document Library — the accountant", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("reads the financial documents, cannot upload or delete", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload document" })).toHaveCount(0);
    // ?new=1 opens nothing for a role that cannot upload
    await page.goto("/documents?new=1");
    await expect(page.getByTestId("upload-document-dialog")).toHaveCount(0);
    // no Delete in any row's ⋮ menu
    const firstRowMenu = page.getByRole("button", { name: "Row actions" }).first();
    if (await firstRowMenu.count()) {
      await firstRowMenu.click();
      await expect(page.getByRole("menuitem", { name: "Download" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
    }
  });
});
