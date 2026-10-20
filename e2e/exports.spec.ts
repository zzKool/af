import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { expectToast, trackToasts, withToastReport } from "./fixtures/toasts";

const SHOTS = join(__dirname, "..", "specs", "exports", "screenshots");

/** `E2E_SCREENSHOTS=1`: the journey leaves the PR's screenshots behind (definition of done §4.5). */
async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

// The Swiss VAT return (specs/exports SC-004): a CH registration → /exports shows the quarter's form → a manual
// ref enters the figures → Declare freezes them → Undo reopens. The accountant reads without the actions.
test.describe("Swiss VAT return", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("the form of the quarter, a manual ref, declare, undo", async ({ page }) => {
    await trackToasts(page);
    await withToastReport(page, async () => {
      // 1. a CH registration (once)
      await page.goto("/settings/vat-registrations");
      if ((await page.getByText(/CHE-/).count()) === 0) {
        await page.getByRole("button", { name: "Add Registration" }).click();
        await page.getByLabel("Country Code").fill("CH");
        await page.getByLabel("VAT Number").fill(`CHE-100.200.${String(Date.now()).slice(-3)} TVA`);
        await page.getByLabel("Rates (optional)").fill("8.1, 2.6, 3.8");
        await page.getByRole("button", { name: "Add Registration" }).last().click();
        await expect(page.getByText(/CHE-/).first()).toBeVisible();
      }

      // 2. the return of the current quarter
      await page.goto("/exports");
      await expect(page.getByRole("heading", { name: "Swiss VAT return" })).toBeVisible();
      const now = new Date();
      const period = `CH ${now.getUTCFullYear()}/Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
      await expect(page.getByTestId("vat-period")).toContainText(period);
      await expect(page.getByTestId("vat-ref-200")).toBeVisible();
      await expect(page.getByTestId("vat-warnings")).toContainText("incomplete_period");

      // 3. a manual ref (220, exempt supplies) changes the taxable turnover
      const before = (await page.getByTestId("vat-amount-299").innerText()).trim();
      const manual = page.getByTestId("vat-manual-220");
      await manual.fill("100");
      await manual.blur();
      await expect(page.getByTestId("vat-amount-289")).toContainText("100.00");
      await expect(page.getByTestId("vat-amount-299")).not.toHaveText(before);
      await snap(page, "swiss-vat-return");

      // 4. Declare → frozen; the status says so; undo reopens
      await page.getByTestId("vat-declare").click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Declare" }).click();
      await expectToast(page, `${period} declared`);
      await expect(page.getByRole("alertdialog")).toBeHidden();
      await expect(page.getByTestId("vat-status")).toContainText("Declared");
      await expect(page.getByTestId("vat-manual-220")).toHaveCount(0);
      await expect(page.getByTestId("vat-amount-220")).toContainText("100.00");
      await expect(page.getByTestId("vat-mark-paid")).toBeVisible();
      await snap(page, "swiss-vat-declared");
      await page.getByTestId("vat-undeclare").click();
      await expectToast(page, "is open again");
      await expect(page.getByTestId("vat-status")).toContainText("Not declared");
      // leave the quarter clean for the next run
      const again = page.getByTestId("vat-manual-220");
      await again.fill("");
      await again.blur();
      await expect(page.getByTestId("vat-amount-289")).toContainText("0.00");
    });
  });
});

test.describe("Swiss VAT return — the accountant", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("reads the form, cannot declare", async ({ page }) => {
    await page.goto("/exports");
    await expect(page.getByRole("heading", { name: "Swiss VAT return" })).toBeVisible();
    await expect(page.getByTestId("vat-declare")).toHaveCount(0);
    await expect(page.getByTestId("vat-manual-220")).toHaveCount(0);
  });
});
