import { expect, test as setup } from "@playwright/test";

const ACCOUNTANT_AUTH_FILE = "e2e/.auth/accountant.json";

setup("authenticate as accountant", async ({ page }) => {
  // Log all network responses for debugging
  const responses: string[] = [];
  page.on("response", (response) => {
    responses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("/login");

  // Wait for React hydration
  await page.waitForFunction(
    () => {
      const form = document.querySelector("form");
      return form && Object.keys(form).some((k) => k.startsWith("__reactFiber"));
    },
    { timeout: 15000 },
  );

  await page.getByLabel("Email").fill("accountant@dev.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait a moment and log debug info
  await page.waitForTimeout(5000);
  console.log("=== DEBUG: Current URL:", page.url());
  console.log("=== DEBUG: Network responses:", responses.join("\n"));
  console.log("=== DEBUG: Page text:", await page.textContent("body"));

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

  await page.context().storageState({ path: ACCOUNTANT_AUTH_FILE });
});
