import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * Uploads a small PDF through the library and opens its review page — the journey owns its document, so a
 * parallel journey deleting its own upload, or an issued invoice's generated PDF landing first in the list,
 * cannot change what this one sees.
 */
async function openOwnDocument(page: Page): Promise<void> {
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  const stamp = String(Date.now()).slice(-6);
  const name = `e2e-review-${stamp}.pdf`;
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(`%PDF-1.4 ${name}`),
  });
  await expect(page.getByRole("button", { name: "Upload another" })).toBeVisible({
    timeout: 15_000,
  });
  const row = page.getByRole("row").filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator("td a[href^='/documents/']").first().click();
  await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/);
}

test.describe("Document review page — owner", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("owner can navigate to a document detail page from list", async ({ page }) => {
    await openOwnDocument(page);

    // Verify dual-pane layout elements
    await expect(page.getByText(/Back to Documents/)).toBeVisible();

    // Verify review controls are present for owner
    const reviewButton = page.getByRole("button", {
      name: /Mark as Reviewed|Reviewed|Update Review|Marking/,
    });
    const reviewText = page.getByText(/Awaiting review|Reviewed/);
    // Either button or status text should be visible
    await expect(reviewButton.or(reviewText).first()).toBeVisible();
  });

  test("document detail page shows preview and form areas", async ({ page }) => {
    await openOwnDocument(page);

    // Auto-save status indicator should be present
    await expect(page.getByText(/Auto-saved|Saving|Save failed/)).toBeVisible();

    // Verify document preview region with keyboard-accessible document role
    await expect(page.locator("[role='document']")).toBeVisible();

    // Verify financial or relationship form section is rendered
    const financialHeading = page.getByText("Financial Details");
    const rawTextArea = page.locator("textarea[readonly]");
    await expect(financialHeading.or(rawTextArea).first()).toBeVisible();
  });

  test("document detail page has back navigation", async ({ page }) => {
    await openOwnDocument(page);

    // Click back link
    await page.getByText(/Back to Documents/).click();
    await expect(page).toHaveURL(/\/documents$/);
  });

  test("document review page passes automated accessibility checks", async ({ page }) => {
    await openOwnDocument(page);
    // Wait for content to load
    await expect(page.getByText(/Back to Documents/)).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .exclude(".react-pdf__Document") // Exclude PDF canvas elements (third-party)
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("documents list shows review status badges for extracted documents", async ({ page }) => {
    await openOwnDocument(page);
    await page.goto("/documents");
    // Review status is a chip next to the Status badge — "needs review" until reviewed
    const reviewBadge = page.getByText(/needs review|extracted|uploaded|processing/i).first();
    await expect(reviewBadge).toBeVisible();
  });
});

test.describe("Document review page — accountant blocked from detail", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("accountant can view the documents list but cannot upload", async ({ page }) => {
    await page.goto("/documents");
    // Story 5.4: accountants have read-only access to the (financial) documents library — the list shows,
    // the upload zone does not. The rows may carry detail links (generated PDFs and bank statements are
    // financial), so the assertion is on the write surface, not on the links.
    await expect(page).toHaveURL(/\/documents/);
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  });
});
