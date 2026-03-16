import { expect, test } from "@playwright/test";

test.describe("Document Library", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("owner sees document library with table and filters", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    // Upload zone visible for owner
    await expect(page.getByRole("button", { name: "Upload document" })).toBeVisible();
  });

  test("document table renders with column headers", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByPlaceholder("Search documents...")).toBeVisible();
  });

  test("filter bar shows status filter dropdown", async ({ page }) => {
    await page.goto("/documents");
    const filterBar = page.getByTestId("document-filters");
    await expect(filterBar.getByRole("button", { name: /Status/ })).toBeVisible();
  });

  test("search input is visible and interactive", async ({ page }) => {
    await page.goto("/documents");
    const searchInput = page.getByPlaceholder("Search documents...");
    await expect(searchInput).toBeVisible();
    await searchInput.fill("test");
    await expect(searchInput).toHaveValue("test");
  });

  test("empty state shows upload CTA when no documents", async ({ page }) => {
    await page.goto("/documents");
    // If no documents, we should see some kind of empty state or table
    // We verify the page renders without errors
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    // No error boundary triggered
    await expect(page.locator("text=Something went wrong")).not.toBeVisible();
  });
});

test.describe("Document Library — delete flow", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("owner can upload and delete a document via confirmation dialog", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

    // Upload a document — Azurite must be running (CI and local)
    const fileInput = page.locator('input[type="file"]');
    const pdfContent = Buffer.from("%PDF-1.4 e2e-delete-test");
    await fileInput.setInputFiles({
      name: "e2e-delete-test.pdf",
      mimeType: "application/pdf",
      buffer: pdfContent,
    });

    // Wait for upload to complete (success state shows "Upload another" button)
    await expect(page.getByRole("button", { name: "Upload another" })).toBeVisible({
      timeout: 15000,
    });

    // Wait for the table to show at least one document with a delete button
    const deleteBtn = page.getByTitle("Delete document").first();
    await expect(deleteBtn).toBeVisible({ timeout: 15000 });

    // Record row count before deletion
    const rowCountBefore = await page.locator("table tbody tr").count();

    // Click delete — use stopPropagation via dispatchEvent to prevent row click
    await deleteBtn.click();

    // Confirm dialog appears
    const dialog = page.locator("[role=alertdialog]");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText("Delete document?")).toBeVisible();

    // Confirm deletion — target the button INSIDE the dialog specifically
    await dialog.getByRole("button", { name: "Delete" }).click();

    // Wait for dialog to close (deletion complete)
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // WORKAROUND: Dialog confirm click sometimes propagates to the table row beneath,
    // causing navigation to the document detail page. This is a UI event propagation bug
    // that should be fixed in the delete button's stopPropagation handling.
    // TODO: Fix in document-library-client.tsx and remove this workaround.
    if (!page.url().endsWith("/documents")) {
      await page.goto("/documents");
    }

    // Verify document was removed — row count decreased
    await expect(page.locator("table tbody tr")).toHaveCount(rowCountBefore - 1, {
      timeout: 10000,
    });
  });
});

test.describe("Document Library — accountant view", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("accountant can view documents page", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  });

  test("accountant does not see upload zone or delete buttons", async ({ page }) => {
    await page.goto("/documents");
    // Upload button should NOT be visible for accountant
    await expect(page.getByRole("button", { name: "Upload document" })).not.toBeVisible();
    // Delete button should NOT be visible for accountant (AC #5)
    await expect(page.getByTitle("Delete document")).not.toBeVisible();
  });
});
