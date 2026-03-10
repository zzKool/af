import { expect, test as setup } from "@playwright/test";

const ACCOUNTANT_AUTH_FILE = "e2e/.auth/accountant.json";

setup("authenticate as accountant", async ({ page }) => {
  // Use API directly to bypass React hydration timing in standalone mode
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email: "accountant@dev.test", password: "password123" },
  });
  expect(response.ok()).toBeTruthy();

  // Navigate to dashboard to verify auth and populate storageState
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

  // Save signed-in state
  await page.context().storageState({ path: ACCOUNTANT_AUTH_FILE });
});
