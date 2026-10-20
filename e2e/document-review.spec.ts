import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Document review page — owner", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("owner can navigate to a document detail page from list", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

    // Wait for actual data rows (not skeleton rows) by waiting for document links
    const docLink = page
      .locator("table tbody tr")
      .filter({ hasNot: page.getByText("generated", { exact: true }) })
      .locator("td a[href^='/documents/']")
      .first();
    const hasDocuments = await docLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasDocuments) {
      await docLink.click();
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

    // an uploaded document (generated PDFs of issued invoices have no review form)
    const docLink = page
      .locator("table tbody tr")
      .filter({ hasNot: page.getByText("generated", { exact: true }) })
      .locator("td a[href^='/documents/']")
      .first();
    const hasDocuments = await docLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasDocuments) {
      await docLink.click();
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

    const docLink = page
      .locator("table tbody tr")
      .filter({ hasNot: page.getByText("generated", { exact: true }) })
      .locator("td a[href^='/documents/']")
      .first();
    const hasDocuments = await docLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasDocuments) {
      await docLink.click();
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/);

      // Click back link
      await page.getByText(/Back to Documents/).click();
      await expect(page).toHaveURL(/\/documents$/);
    }
  });

  test("document review page passes automated accessibility checks", async ({ page }) => {
    await page.goto("/documents");

    const docLink = page
      .locator("table tbody tr")
      .filter({ hasNot: page.getByText("generated", { exact: true }) })
      .locator("td a[href^='/documents/']")
      .first();
    const hasDocuments = await docLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasDocuments) {
      await docLink.click();
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/);
      // Wait for content to load
      await expect(page.getByText(/Back to Documents/)).toBeVisible();

      const accessibilityScanResults = await new AxeBuilder({ page })
        .exclude(".react-pdf__Document") // Exclude PDF canvas elements (third-party)
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    }
  });

  test("documents list shows review status badges for extracted documents", async ({ page }) => {
    await page.goto("/documents");

    // Wait for table to load (non-skeleton content)
    const docLink = page
      .locator("table tbody tr")
      .filter({ hasNot: page.getByText("generated", { exact: true }) })
      .locator("td a[href^='/documents/']")
      .first();
    const hasDocuments = await docLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasDocuments) {
      // Review status is embedded in the Status badge — look for "Needs Review" or "Reviewed"
      const reviewBadge = page.getByText(/Needs Review|Reviewed/).first();
      await expect(reviewBadge).toBeVisible();
    }
  });
});

test.describe("Document review page — accountant blocked from detail", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("accountant can view documents list but has no view/edit link", async ({ page }) => {
    await page.goto("/documents");
    // Story 5.4: accountants now have read-only access to the documents library
    await expect(page).toHaveURL(/\/documents/);
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    // No navigate-to-detail Eye link for accountants (actions column only has Download)
    await expect(page.locator("table tbody tr td a[href^='/documents/']")).not.toBeVisible();
  });
});
