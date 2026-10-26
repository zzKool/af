import { expect, test } from "@playwright/test";
import { expectToast, trackToasts, withToastReport } from "./fixtures/toasts";

// Subscriptions (specs/subscriptions US1, US3; SEK only — CI has no ECB rates): a vendor → a monthly expense
// subscription with its own new group (Q2 B) → the card row imported into banking → the period offers it (*to
// confirm*) → one *Confirm* creates the expense and attaches the row → *Charged · receipt* still to come. The
// accountant reads, writes nothing. The journey owns its data (a stamped vendor) and opens rows by deep link.
const HEADER =
  "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";

test.describe("Subscriptions", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  const stamp = String(Date.now()).slice(-5);
  const vendor = `Byteform ${stamp}`;
  const iso = (daysFromToday: number) =>
    new Date(Date.now() + daysFromToday * 86_400_000).toISOString().slice(0, 10);

  test("describe once, the card row offered, one confirm", async ({ page }) => {
    test.setTimeout(240_000);
    await trackToasts(page);
    await withToastReport(page, async () => {
      // 1. the vendor
      await page.goto("/partners");
      await page.getByRole("button", { name: "Add partner" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill(vendor);
      await page.getByLabel("client").uncheck();
      await page.getByLabel("vendor").check();
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expect(page.getByText("Partner created")).toBeVisible();

      // 2. the subscription: + New group named after it, paid from AF SEK, monthly from yesterday
      await page.goto("/subscriptions?new=1");
      const form = page.getByTestId("subscription-form");
      await expect(form).toBeVisible();
      const pick = async (testId: string, option: RegExp | string) => {
        await form.getByTestId(testId).click();
        await page.getByRole("option", { name: option }).click();
      };
      await pick("sub-vendor", vendor);
      await expect(form.getByTestId("sub-name")).toHaveValue(vendor);
      await expect(form.getByTestId("sub-group")).toContainText(`New group: ${vendor}`);
      await pick("sub-payer", "AF SEK");
      await pick("sub-category", /\(IT\)/);
      await form.getByTestId("sub-start").fill(iso(-1));
      await form.getByTestId("sub-amount").fill("199.00");
      await form.getByTestId("sub-create").click();
      await expectToast(page, "Subscription created");

      // 3. the card row into banking
      await page.goto("/banking");
      await page.getByTestId("open-import").click();
      await page.getByTestId("import-file").setInputFiles({
        name: `PLUSGIROKONTO FTG 123 45 67-8 - ${iso(0)} sub${stamp}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(
          `${HEADER}\n${iso(0).replace(/-/g, "/")};-199,00;;;${vendor.toUpperCase()};Kortköp;;;;SEK;\n`,
          "latin1",
        ),
      });
      await expect(page.getByTestId("import-account")).toContainText("Plusgirokonto SEK");
      await page.getByTestId("import-run").click();
      await expect(page.getByTestId("import-summary")).toContainText("1 imported", {
        timeout: 20_000,
      });
      await page.keyboard.press("Escape");

      // 4. the period offers the row; one confirm
      await page.goto(`/subscriptions?q=${encodeURIComponent(vendor)}`);
      await page
        .getByRole("row")
        .filter({ hasText: vendor })
        .first()
        .getByText(vendor)
        .first()
        .click();
      const panel = page.getByTestId("subscription-panel");
      await expect(panel).toBeVisible();
      const period = panel.getByTestId(`period-${iso(-1)}`);
      await expect(period.getByTestId("period-state")).toContainText("to confirm");
      await expect(period).toContainText(vendor.toUpperCase());
      await period.getByTestId("period-confirm").click();
      const dialog = page.getByTestId("confirm-period-dialog");
      await expect(dialog.getByTestId("confirm-amount")).toHaveValue("199.00");
      await dialog.getByTestId("confirm-period-submit").click();
      await expectToast(page, /Confirmed — Ex\d+-IT-01/);
      await expect(period.getByTestId("period-state")).toHaveAttribute("data-state", "charged");
      await expect(period).toContainText(/Ex\d+-IT-01/);
    });
  });

  test("the accountant reads subscriptions, writes nothing", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/accountant.json" });
    const page = await ctx.newPage();
    await page.goto("/subscriptions");
    await expect(page.getByRole("heading", { name: "Subscriptions" })).toBeVisible();
    await expect(page.getByTestId("open-new-subscription")).toHaveCount(0);
    await expect(page.getByTestId("confirm-all-exact")).toHaveCount(0);
    await ctx.close();
  });
});
