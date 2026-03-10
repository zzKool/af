import { expect, test as setup } from "@playwright/test";

const OWNER_AUTH_FILE = "e2e/.auth/owner.json";

setup("authenticate as owner", async ({ page }) => {
  await page.goto("/login");

  // Wait for React hydration — form gets __reactFiber property after hydration
  await page.waitForFunction(
    () => {
      const form = document.querySelector("form");
      return (
        form && Object.keys(form).some((k) => k.startsWith("__reactFiber"))
      );
    },
    { timeout: 15000 },
  );

  await page.getByLabel("Email").fill("owner@dev.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

  await page.context().storageState({ path: OWNER_AUTH_FILE });
});
