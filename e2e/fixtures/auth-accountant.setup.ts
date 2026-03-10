import { expect, test as setup } from "@playwright/test";

const ACCOUNTANT_AUTH_FILE = "e2e/.auth/accountant.json";

setup("authenticate as accountant", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Email").fill("accountant@dev.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait for redirect to dashboard
  await expect(page).toHaveURL(/\/dashboard/);

  // Save signed-in state
  await page.context().storageState({ path: ACCOUNTANT_AUTH_FILE });
});
