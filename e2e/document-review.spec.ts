import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Document review page — owner", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("owner can navigate to a document detail page from list", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

    // Click first document row if any exist
    const rows = page.locator("table tbody tr, [data-testid='document-row']");
    const count = await rows.count();

    if (count > 0) {
      await rows.first().click();
      // Should navigate to /documents/[id]
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/);

      // Verify dual-pane layout elements
      await expect(page.getByText(/Back to Documents/)).toBeVisible();

      // Verify review controls are present for owner
      const reviewButton = page.getByRole("button", {
        name: /Mark as Reviewed|Reviewed|Update Review|Marking/,
      });
      const reviewText = page.getByText(/Awaiting review|Reviewed/);
      // Either button or status text should be visible
      await expect(reviewButton.or(reviewText).first()).toBeVisible();
    }
  });

  test("document detail page shows preview and form areas", async ({ page }) => {
    await page.goto("/documents");

    const rows = page.locator("table tbody tr, [data-testid='document-row']");
    const count = await rows.count();

    if (count > 0) {
      await rows.first().click();
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/);

      // Auto-save status indicator should be present
      await expect(page.getByText(/Auto-saved|Saving|Save failed/)).toBeVisible();

      // Verify document preview region with keyboard-accessible document role
      await expect(page.locator("[role='document']")).toBeVisible();

      // Verify financial or relationship form section is rendered
      const financialHeading = page.getByText("Financial Details");
      const rawTextArea = page.locator("textarea[readonly]");
      await expect(financialHeading.or(rawTextArea).first()).toBeVisible();
    }
  });

  test("document detail page has back navigation", async ({ page }) => {
    await page.goto("/documents");

    const rows = page.locator("table tbody tr, [data-testid='document-row']");
    const count = await rows.count();

    if (count > 0) {
      await rows.first().click();
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/);

      // Click back link
      await page.getByText(/Back to Documents/).click();
      await expect(page).toHaveURL(/\/documents$/);
    }
  });

  test("document review page passes automated accessibility checks", async ({ page }) => {
    await page.goto("/documents");

    const rows = page.locator("table tbody tr, [data-testid='document-row']");
    const count = await rows.count();

    if (count > 0) {
      await rows.first().click();
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/);
      // Wait for content to load
      await expect(page.getByText(/Back to Documents/)).toBeVisible();

      const accessibilityScanResults = await new AxeBuilder({ page })
        .exclude(".react-pdf__Document") // Exclude PDF canvas elements (third-party)
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    }
  });

  test("documents list shows review badges for extracted documents", async ({ page }) => {
    await page.goto("/documents");

    const rows = page.locator("table tbody tr");
    const count = await rows.count();

    if (count > 0) {
      // Verify the review column header exists
      await expect(page.getByRole("columnheader", { name: "Review" })).toBeVisible();
    }
  });
});

test.describe("Document review page — accountant blocked", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("accountant cannot access documents page", async ({ page }) => {
    await page.goto("/documents");
    // Accountant should be redirected away
    await expect(page).not.toHaveURL(/\/documents/);
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
