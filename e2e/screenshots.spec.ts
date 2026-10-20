import { mkdirSync } from "node:fs";
import { test } from "@playwright/test";

// Every run on main leaves a screenshot of each page in the `page-screenshots` artifact —
// the "something a human looked at" of the definition of done (constitution §4.5).
const PAGES: Record<string, string> = {
  dashboard: "/dashboard",
  partners: "/partners",
  documents: "/documents",
  settings: "/settings",
};

test.describe("Page screenshots", () => {
  test.use({ storageState: "e2e/.auth/owner.json", viewport: { width: 1440, height: 900 } });

  for (const [name, path] of Object.entries(PAGES)) {
    test(`screenshot ${name}`, async ({ page }) => {
      mkdirSync("e2e-screenshots", { recursive: true });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `e2e-screenshots/${name}.png`, fullPage: true });
    });
  }
});
