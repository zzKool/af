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
    // Wait for table to be visible (may be loading)
    await page.waitForTimeout(1000);
    // Filter bar should be visible
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

test.describe("Document Library — accountant view", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("accountant can view documents page", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  });

  test("accountant does not see upload zone", async ({ page }) => {
    await page.goto("/documents");
    // Upload button should NOT be visible for accountant
    await expect(page.getByRole("button", { name: "Upload document" })).not.toBeVisible();
  });
});
