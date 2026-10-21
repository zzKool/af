import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { expectToast, trackToasts } from "./fixtures/toasts";

const SHOTS = join(__dirname, "..", "specs", "kernel-ui", "screenshots");

async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

async function pickLocale(page: Page, label: string) {
  await page.goto("/settings/my-preferences");
  await page.locator("#locale-select").click();
  await page.getByRole("option", { name: label }).click();
  // the confirmation comes in whichever language the page was in when the change was made
  await expectToast(page, /Preferences saved|Inställningar sparade/);
}

// The Swedish dictionary: choosing sv-SE under My Preferences turns the UI Swedish — the nav, a list page, a
// panel string — and back to English afterwards (the owner's state is shared with the other journeys).
test.describe("Swedish UI", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("sv-SE renders the pages in Swedish; English restores", async ({ page }) => {
    await trackToasts(page);
    await pickLocale(page, "Svenska (sv-SE)");
    try {
      await page.goto("/invoices");
      await expect(page.getByRole("heading", { name: "Fakturor" })).toBeVisible();
      await page.goto("/expenses");
      await expect(page.getByRole("heading", { name: "Utlägg" })).toBeVisible();
      // the shell too: the sidebar and the breadcrumb
      await expect(page.getByRole("navigation", { name: "Main navigation" })).toContainText(
        "Leverantörsfakturor",
      );
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Utlägg");
      await expect(page.getByRole("button", { name: "Nytt utlägg" })).toBeVisible();
      await page.goto("/partners");
      await expect(page.getByRole("heading", { name: "Partner" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Lägg till partner" })).toBeVisible();
      await page.goto("/settings");
      await expect(page.getByRole("heading", { name: "Inställningar" })).toBeVisible();
      await expect(page.getByRole("link", { name: /Bankkonton/ })).toBeVisible();
      await page.goto("/settings/rates");
      await expect(page.getByRole("heading", { name: "Valutakurser" })).toBeVisible();
      await expect(page.getByTestId("rates-fetch")).toHaveText("Hämta nu");
      await snap(page, "sv-rates");
    } finally {
      await pickLocale(page, "English US (en-US)");
      await page.goto("/invoices");
      await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    }
  });
});
