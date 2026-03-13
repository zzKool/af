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
    await expect(nav.getByRole("link", { name: "Partners" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();

    // Not yet enabled — these appear as epics are completed
    await expect(nav.getByRole("link", { name: "Documents" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Journal" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Banking" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Reconciliation" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Invoices" })).not.toBeVisible();
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

    // Accountant sees Dashboard and Settings (My Preferences tab)
    await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();

    // Owner-only and not-yet-enabled links are NOT visible
    await expect(nav.getByRole("link", { name: "Documents" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Journal" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Banking" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Partners" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Reconciliation" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Invoices" })).not.toBeVisible();
  });
});
