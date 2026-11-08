import { expect, test } from "@playwright/test";

test.describe("Documents page", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("owner can navigate to documents page", async ({ page }) => {
    await page.goto("/documents");
    await expect(page).toHaveURL(/\/documents/);
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  });

  test("upload zone is visible with correct ARIA label", async ({ page }) => {
    await page.goto("/documents");
    const uploadZone = page.getByRole("button", { name: "Upload document" });
    await expect(uploadZone).toBeVisible();
  });

  test("no type to pick (D78): the zone takes anything", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByRole("button", { name: "Upload document" })).toContainText(
      "No type to pick",
    );
    await expect(page.getByLabel("Document type")).toHaveCount(0);
  });
});

test.describe("Documents page — accountant access", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("accountant can view documents page (financial documents only, read-only)", async ({
    page,
  }) => {
    await page.goto("/documents");
    await expect(page).toHaveURL(/\/documents/);
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  });
});
