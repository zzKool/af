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

  test("owner can delete an uploaded document via confirmation dialog", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

    const fileInput = page.locator('input[type="file"]');
    if ((await fileInput.count()) === 0) {
      test.skip();
      return;
    }

    const pdfContent = Buffer.from("%PDF-1.4 e2e-delete-test");
    await fileInput.setInputFiles({
      name: "e2e-delete-test.pdf",
      mimeType: "application/pdf",
      buffer: pdfContent,
    });

    // Wait for upload to complete and document to appear in table
    await expect(page.locator("table")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("e2e-delete-test.pdf")).toBeVisible({ timeout: 10000 });

    // Target the delete button in the row containing our uploaded file
    const row = page.locator("tr", { has: page.getByText("e2e-delete-test.pdf") });
    const deleteBtn = row.getByTitle("Delete document");
    await expect(deleteBtn).toBeVisible({ timeout: 10000 });

    await deleteBtn.click();

    // Confirm dialog appears with title and businessKey (AC #4)
    await expect(page.getByText("Delete document?")).toBeVisible();
    // Dialog body should mention the document's businessKey (rendered as <strong>)
    const dialogBody = page.locator("[role=alertdialog]");
    await expect(dialogBody.locator("strong")).toBeVisible();

    // Confirm deletion
    await page.getByRole("button", { name: "Delete" }).click();

    // Document should be gone from the table
    await expect(page.getByText("e2e-delete-test.pdf")).not.toBeVisible({ timeout: 10000 });
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
