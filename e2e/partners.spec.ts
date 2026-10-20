import { expect, test } from "@playwright/test";

// Happy path of the reference slice: create → list filter (URL state) → open entity page.
test.describe("Partners", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  const stamp = String(Date.now()).slice(-5);
  const name = `E2E Partner ${stamp}`;
  const shortCode = `E${stamp}`; // unique per tenant per run

  test("create a partner from the list, filter by type, open it", async ({ page }) => {
    await page.goto("/partners");
    await expect(page.getByRole("heading", { name: "Partners" })).toBeVisible();

    // A client (the one we follow) and a vendor (so the Types filter has something to exclude)
    await page.getByRole("button", { name: "Add partner" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill(name);
    await page.getByRole("textbox", { name: "Short code" }).fill(shortCode);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Partner created")).toBeVisible();
    await expect(page.getByRole("link", { name })).toBeVisible();

    await page.getByRole("button", { name: "Add partner" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill(`${name} vendor`);
    await page.getByLabel("client").uncheck();
    await page.getByLabel("vendor").check();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("link", { name: `${name} vendor` })).toBeVisible();

    // Header filter: Types → only clients; the state lands in the URL
    await page.getByRole("button", { name: "Filter Types" }).click();
    await page.getByRole("button", { name: "Clear" }).first().click();
    await page.getByRole("listbox").getByText("client", { exact: true }).click();
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await expect(page).toHaveURL(/f\.types=in%3Aclient/);
    await expect(page.getByRole("link", { name })).toBeVisible();
    await expect(page.getByRole("link", { name: `${name} vendor` })).toHaveCount(0);

    // Search box narrows further
    await page.getByLabel("Search").fill(name);
    await page.getByLabel("Search").press("Enter");
    await expect(page).toHaveURL(/q=E2E/);
    await expect(page.getByText("1–1 of 1")).toBeVisible();

    // Entity page
    await page.getByRole("link", { name }).click();
    await expect(page).toHaveURL(/\/partners\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Short code" })).toHaveValue(shortCode);
  });
});
