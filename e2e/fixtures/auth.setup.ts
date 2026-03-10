import { expect, test as setup } from "@playwright/test";

const OWNER_AUTH_FILE = "e2e/.auth/owner.json";

setup("authenticate as owner", async ({ page }) => {
  // Debug: capture console errors and network
  page.on("pageerror", (error) => console.log("PAGE ERROR:", error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("CONSOLE ERROR:", msg.text());
  });

  const responses: string[] = [];
  page.on("response", (resp) => responses.push(`${resp.status()} ${resp.url()}`));

  await page.goto("/login");
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");

  console.log("RESPONSES:", JSON.stringify(responses.slice(0, 20)));
  console.log("URL after load:", page.url());

  await page.getByLabel("Email").fill("owner@dev.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForTimeout(3000);
  console.log("URL after click:", page.url());
  console.log("RESPONSES after click:", JSON.stringify(responses.slice(0, 30)));

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  await page.context().storageState({ path: OWNER_AUTH_FILE });
});
