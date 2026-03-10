import { expect, test as setup } from "@playwright/test";

const ACCOUNTANT_AUTH_FILE = "e2e/.auth/accountant.json";

setup("authenticate as accountant", async ({ page }) => {
  // Sign in via API
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email: "accountant@dev.test", password: "password123" },
  });
  expect(response.ok()).toBeTruthy();

  // Extract session cookie from response and add to browser context
  const setCookieHeader = response.headersArray().find(
    (h) => h.name.toLowerCase() === "set-cookie",
  );
  expect(setCookieHeader).toBeTruthy();

  const cookieParts = setCookieHeader!.value.split(";")[0];
  const eqIndex = cookieParts.indexOf("=");
  const name = cookieParts.substring(0, eqIndex);
  const value = cookieParts.substring(eqIndex + 1);

  await page.context().addCookies([
    {
      name,
      value,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  // Verify auth works
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

  // Save signed-in state
  await page.context().storageState({ path: ACCOUNTANT_AUTH_FILE });
});
