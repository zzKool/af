import { test, expect } from "@playwright/test";

test.describe("Owner authentication and navigation", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("owner can access dashboard with full sidebar navigation", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    // Verify dashboard loaded
    await expect(page).toHaveURL(/\/dashboard/);

    // Verify sidebar navigation contains all owner links
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();

    await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Documents" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Journal" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Banking" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Partners" })).toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Reconciliation" }),
    ).toBeVisible();
    await expect(nav.getByRole("link", { name: "Invoices" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
  });
});

test.describe("Accountant authentication and navigation", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("accountant can access dashboard with restricted sidebar navigation", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    // Verify dashboard loaded
    await expect(page).toHaveURL(/\/dashboard/);

    // Verify sidebar navigation contains only accountant-visible links
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();

    await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Documents" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Journal" })).toBeVisible();

    // Verify owner-only links are NOT visible
    await expect(
      nav.getByRole("link", { name: "Banking" }),
    ).not.toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Partners" }),
    ).not.toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Reconciliation" }),
    ).not.toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Invoices" }),
    ).not.toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Settings" }),
    ).not.toBeVisible();
  });
});
