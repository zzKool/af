import { expect, test as setup } from "@playwright/test";

const ACCOUNTANT_AUTH_FILE = "e2e/.auth/accountant.json";

setup("authenticate as accountant", async ({ page }) => {
  // Navigate to any page first so we have a valid origin for fetch
  await page.goto("/login");

  // Call auth API via browser fetch so cookies are set in the browser context
  const result = await page.evaluate(async () => {
    const res = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "accountant@dev.test",
        password: "password123",
      }),
    });
    return { ok: res.ok, status: res.status };
  });
  expect(result.ok).toBeTruthy();

  // Navigate to dashboard — middleware should now see the session cookie
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

  // Save signed-in state
  await page.context().storageState({ path: ACCOUNTANT_AUTH_FILE });
});
