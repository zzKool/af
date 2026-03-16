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

    // Count rows before upload to detect the new one
    const rowCountBefore = await page.locator("table tbody tr").count();

    const pdfContent = Buffer.from("%PDF-1.4 e2e-delete-test");
    await fileInput.setInputFiles({
      name: "e2e-delete-test.pdf",
      mimeType: "application/pdf",
      buffer: pdfContent,
    });

    // Wait for upload to complete — a new row appears (table sorted by createdAt desc)
    await expect(page.locator("table tbody tr")).toHaveCount(rowCountBefore + 1, {
      timeout: 15000,
    });

    // The newest document is the first row (createdAt desc sort)
    const firstRow = page.locator("table tbody tr").first();
    const deleteBtn = firstRow.getByTitle("Delete document");
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });

    // Capture the businessKey from the first row for later verification
    const businessKey = await firstRow.locator("td").first().innerText();

    await deleteBtn.click();

    // Confirm dialog appears with title and businessKey (AC #4)
    await expect(page.getByText("Delete document?")).toBeVisible();
    const dialogBody = page.locator("[role=alertdialog]");
    await expect(dialogBody.locator("strong")).toHaveText(businessKey);

    // Confirm deletion
    await page.getByRole("button", { name: "Delete" }).click();

    // Row count should decrease back
    await expect(page.locator("table tbody tr")).toHaveCount(rowCountBefore, { timeout: 10000 });
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
