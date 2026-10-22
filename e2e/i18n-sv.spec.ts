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
// panel string, the settings pages. The journey registers its own owner (a fresh tenant): the locale is a user
// preference, and switching the shared owner's would turn every journey running beside this one Swedish.
test.describe("Swedish UI", () => {
  test("sv-SE renders the pages in Swedish", async ({ page }) => {
    await trackToasts(page);
    const stamp = Date.now();
    await page.goto("/register");
    await page.getByLabel("Name").fill(`Sv Owner ${stamp}`);
    await page.getByLabel("Email").fill(`sv-${stamp}@dev.test`);
    await page.getByLabel("Password").fill("e2e-password-12345");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    await pickLocale(page, "Svenska (sv-SE)");
    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: "Fakturor" })).toBeVisible();
    await page.goto("/expenses");
    await expect(page.getByRole("heading", { name: "Utlägg" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nytt utlägg" })).toBeVisible();
    // the shell too: the sidebar (its current item) and, on a sub-page, the breadcrumb (D40: the current page
    // is not repeated in it — a top page has none)
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toContainText("Leverantörsfakturor");
    await expect(nav.getByRole("link", { name: "Utlägg" })).toHaveAttribute("aria-current", "page");
    await page.goto("/expenses/groups");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Utlägg");
    await page.goto("/partners");
    await expect(page.getByRole("heading", { name: "Partner" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Lägg till partner" })).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Inställningar" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Bankkonton/ })).toBeVisible();
    await page.goto("/settings/company");
    await expect(page.getByRole("heading", { name: "Företagsprofil" })).toBeVisible();
    await expect(page.getByText("Organisationsnummer")).toBeVisible();
    await page.goto("/settings/bank-accounts");
    await expect(page.getByRole("heading", { name: "Bankkonton" })).toBeVisible();
    await page.goto("/settings/vat-registrations");
    await expect(page.getByRole("heading", { name: "Momsregistreringar" })).toBeVisible();
    await page.goto("/settings/rates");
    await expect(page.getByRole("heading", { name: "Valutakurser" })).toBeVisible();
    await expect(page.getByTestId("rates-fetch")).toHaveText("Hämta nu");
    await snap(page, "sv-rates");
  });
});
