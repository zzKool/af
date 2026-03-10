import { expect, test as setup } from "@playwright/test";

const OWNER_AUTH_FILE = "e2e/.auth/owner.json";

setup("authenticate as owner", async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Email").fill("owner@dev.test");
  await page.getByLabel("Password").fill("password123");

  // Click sign-in and wait for auth API response
  const [authResponse] = await Promise.all([
    page.waitForResponse("**/api/auth/sign-in/email"),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  expect(authResponse.ok()).toBeTruthy();

  // Set active organization on the new session (required by dashboard layout)
  const orgId = await page.evaluate(async () => {
    const res = await fetch("/api/auth/organization/list", { method: "GET" });
    const orgs = await res.json();
    if (orgs.length > 0) {
      await fetch("/api/auth/organization/set-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgs[0].id }),
      });
      return orgs[0].id;
    }
    return null;
  });
  expect(orgId).toBeTruthy();

  // Navigate to dashboard — should work now with active org set
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

  await page.context().storageState({ path: OWNER_AUTH_FILE });
});
