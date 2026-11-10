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
    // Work (F97 US4, F137, F182): the monthly close, first after Dashboard, the owner's — one Work; the linking
    // inbox is Banking › Inbox
    const links = nav.getByRole("link");
    await expect(links.nth(0)).toHaveAccessibleName("Dashboard");
    await expect(links.nth(1)).toHaveAccessibleName("Work");
    await expect(links.nth(1)).toHaveAttribute("href", "/work");
    await expect(links.nth(2)).toHaveAccessibleName("Banking");
    await expect(nav.getByRole("link", { name: /^Work/ })).toHaveCount(1);
    // the journal page went with F113 (D59): the rows carry their facts on /banking
    await expect(nav.getByRole("link", { name: "Journal" })).not.toBeVisible();

    // Not yet enabled — these appear as epics are completed
    await expect(nav.getByRole("link", { name: "Reconciliation" })).not.toBeVisible();
  });

  // F182: Ctrl K knows the two pages — Work (the close) and the Inbox under Banking; on the inbox the rail marks
  // Banking, the breadcrumb reads Banking
  test("Ctrl K finds Work and Banking › Inbox; on the inbox Banking is the current item", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Control+k");
    const input = page.getByRole("combobox", { name: "Search" });
    await expect(input).toBeFocused();
    await input.fill("work");
    await page.getByRole("option", { name: /^Work$/ }).click();
    await expect(page).toHaveURL(/\/work$/);
    await expect(page.getByTestId("work-percent")).toBeVisible();

    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Search" }).fill("inbox bank");
    await page.getByRole("option", { name: /Banking.*Inbox/ }).click();
    await expect(page).toHaveURL(/\/banking\/inbox$/);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Banking" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Work" })).not.toHaveAttribute("aria-current");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Banking");
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

    await expect(nav.getByRole("link", { name: /^Work/ })).not.toBeVisible();
    // Owner-only and not-yet-enabled links are NOT visible
    await expect(nav.getByRole("link", { name: "Documents" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Partners" })).not.toBeVisible();
    await expect(nav.getByRole("link", { name: "Reconciliation" })).not.toBeVisible();
  });
});
