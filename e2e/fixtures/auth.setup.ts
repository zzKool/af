import { expect, test as setup } from "@playwright/test";

const OWNER_AUTH_FILE = "e2e/.auth/owner.json";

setup("authenticate as owner", async ({ page }) => {
  // Use API directly to bypass React hydration timing in standalone mode
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email: "owner@dev.test", password: "password123" },
  });
  expect(response.ok()).toBeTruthy();

  // Navigate to dashboard to verify auth and populate storageState
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

  // Save signed-in state
  await page.context().storageState({ path: OWNER_AUTH_FILE });
});
