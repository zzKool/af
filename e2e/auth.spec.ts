import { expect, test } from "@playwright/test";

test.describe("Owner authentication and navigation", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("owner can access dashboard with full sidebar navigation", async ({ page }) => {
    await page.goto("/dashboard");

    // Verify dashboard loaded
    await expect(page).toHaveURL(/\/dashboard/);

    // Verify sidebar navigation contains enabled owner links
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();

    // Currently enabled routes (updated as epics enable more pages)
    await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Documents" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Partners" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Invoices", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Expenses" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Supplier invoices" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Package" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Declarations" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Banking" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
    // the journal page went with F113 (D59): the rows carry their facts on /banking
    await expect(nav.getByRole("link", { name: "Journal" })).not.toBeVisible();

    // Not yet enabled — these appear as epics are completed
    await expect(nav.getByRole("link", { name: "Reconciliation" })).not.toBeVisible();
  });
});

test.describe("Accountant authentication and navigation", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("accountant can access dashboard with restricted sidebar navigation", async ({ page }) => {
    await page.goto("/dashboard");

    // Verify dashboard loaded
    await expect(page).toHaveURL(/\/dashboard/);

    // Verify sidebar navigation contains only accountant-visible enabled links
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();

    // Accountant sees Dashboard, Banking, Invoices (read-only) and Settings (My Preferences tab)
    await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Banking" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Invoices", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Package" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Declarations" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();

    // Owner-only and not-yet-enabled links are NOT visible
    await expect(nav.getByRole("link", { name: "Documents" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Partners" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Reconciliation" })).not.toBeVisible();
  });
});
