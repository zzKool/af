import { expect, test } from "@playwright/test";
import { expectToast, trackToasts, withToastReport } from "./fixtures/toasts";

// The owner's trip (specs/expenses US1–US5, specs/traktamente US1–US3; SEK only — CI has no ECB rates):
// a trip group → three private receipts → the trip panel writes the per-diem (2025 rates are seeded) →
// a refund row imported into banking → the settle page proposes FIFO, confirms ST25-001 → the settlements page
// and the statement → the rate table under settings.
const HEADER =
  "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";

test.describe("Expenses", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  const stamp = String(Date.now()).slice(-5);
  const groupName = `Travel to CH ${stamp}`;

  test("group, receipts, per diem, settle, statement, rates", async ({ page }) => {
    test.setTimeout(240_000); // one long flow with two PDF jobs behind it
    await trackToasts(page);
    await withToastReport(page, async () => {
      // 1. the trip group
      await page.goto("/expenses/groups");
      await page.getByTestId("open-new-group").click();
      await page.getByTestId("group-description").fill(groupName);
      await page.getByLabel("Kind", { exact: true }).click();
      await page.getByRole("option", { name: "Trip" }).click();
      await page.getByTestId("save-group").click();
      await expectToast(page, "created");
      await expect(page.getByRole("link", { name: groupName })).toBeVisible();

      // 2. three private receipts from the list (SEK, Private SE)
      await page.goto("/expenses");
      const dialog = page.getByTestId("new-expense-dialog");
      const pick = async (label: string, option: RegExp | string) => {
        await dialog.getByLabel(label, { exact: true }).click();
        await page.getByRole("option", { name: option }).click();
      };
      const receipts: [string, string, RegExp][] = [
        ["Hotel", "6450.00", /^580/],
        ["Transport", "1620.00", /^580/],
        ["Meals", "2695.00", /^583/],
      ];
      for (const [i, [desc, amount, category]] of receipts.entries()) {
        await page.getByTestId("open-new-expense").click();
        await expect(dialog).toBeVisible();
        await pick("Group", new RegExp(groupName));
        await pick("Paid by", "Private SE");
        await dialog.getByLabel("Date", { exact: true }).fill(`2025-03-1${i}`);
        await page.getByTestId("expense-description").fill(desc);
        await pick("Category", category);
        await page.getByTestId("expense-amount").fill(amount);
        await page.getByTestId("create-expense").click();
        await expectToast(
          page,
          `${desc === "Meals" ? "Rep" : "Tr"}-0${desc === "Transport" ? 2 : 1} created`,
        );
        await expect(dialog).not.toBeVisible();
      }
      await page.goto("/expenses");
      await expect(page.getByTestId("kpi-open")).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: "Hotel" }).first()).toContainText(
        "To refund",
      );

      // the panel: the key, the status, a fact saved on change
      await page.getByRole("row").filter({ hasText: "Hotel" }).first().click();
      const panel = page.getByTestId("expense-panel");
      await expect(panel).toBeVisible();
      await expect(page.getByTestId("panel-key")).toContainText(/Ex\d+-Tr-01/);
      const groupPrefix = (await page.getByTestId("panel-key").innerText()).replace(/Tr-01$/, "");
      await expect(page.getByTestId("panel-status")).toHaveText("To refund");
      await panel.getByLabel("Note").fill("Booked on booking.com");
      await panel.getByLabel("Note").blur();
      await expectToast(page, "Saved");
      await page.keyboard.press("Escape");
      await expect(panel).not.toBeVisible();

      // 3. the trip panel: 2025-03-02 09:00 → 03-21 17:00, CH, 18 lunches → 19.5 days, 18 506.40
      await page
        .getByRole("link", { name: new RegExp(groupName) })
        .first()
        .click();
      await expect(page).toHaveURL(/\/expenses\/groups\/[0-9a-f-]+$/);
      await page.getByLabel("Departure").fill("2025-03-02T09:00");
      await page.getByLabel("Return").fill("2025-03-21T17:00");
      await page.getByLabel("Country", { exact: true }).click();
      await page.getByRole("option", { name: /Switzerland|Schweiz/ }).click();
      await page.getByTestId("trip-lunches").fill("18");
      await page.getByTestId("save-trip").click();
      await expectToast(page, "Trip saved");
      await expect(page.getByTestId("trip-days")).toContainText(
        "19.5 days (19 full + 1 half), 19 nights",
      );
      await expect(page.getByTestId("trip-total")).toContainText("18 506,40");
      await page.getByTestId("write-per-diem").click();
      await expectToast(page, "Per-diem expense");
      await expect(page.getByTestId("per-diem-expense")).toContainText("18 506,40");
      await expect(
        page.getByRole("row").filter({ hasText: "Traktamente CH 19.5 days" }),
      ).toBeVisible();

      // 4. the refund row (−9 700 SEK) into banking
      await page.goto("/banking");
      await page.getByTestId("open-import").click();
      await page.getByTestId("import-file").setInputFiles({
        name: `PLUSGIROKONTO FTG 123 45 67-8 - 2025-03-31 ${stamp}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(
          `${HEADER}\n2025/03/31;-9700,00;;;Zikrija ${stamp};Utlägg mars;;;;SEK;\n`,
          "latin1",
        ),
      });
      await page.getByTestId("import-run").click();
      await expect(page.getByTestId("import-summary")).toContainText("1 imported", {
        timeout: 20_000,
      });
      await page.keyboard.press("Escape");

      // 5. settle: the FIFO proposal covers the three receipts (dated before the per diem), confirm
      await page.goto("/expenses/settle");
      await page.getByTestId("pick-transaction").click();
      await page.getByRole("option", { name: new RegExp(`Zikrija ${stamp}`) }).click();
      await expect(page.getByTestId("settle-summary")).toBeVisible();
      // the proposal lands asynchronously — wait for its ticks before adjusting them
      await expect(page.getByTestId("settle-selected")).not.toContainText("Selected: 0,00");
      // the FIFO proposal ticks the oldest open expenses; keep only this run's three receipts (a developer's
      // database may hold earlier runs), hotel and transport in full, 1 630 of the meals
      for (const row of await page.getByTestId("settle-row").all()) {
        const key = (await row.innerText()).match(/Ex\d+-\w+-\d+/)?.[0] ?? "";
        const mine = key.startsWith(groupPrefix) && !key.endsWith("Tr-03");
        const box = row.getByRole("checkbox");
        if ((await box.isChecked()) !== mine) await box.click();
        if (mine && key.endsWith("Rep-01")) await row.getByRole("textbox").fill("1630.00");
      }
      await expect(page.getByTestId("settle-hint")).toHaveText("Exact match");
      await expect(page.getByTestId("settle-selected")).toContainText("9 700,00");
      await page.getByTestId("open-confirm").click();
      await expect(page.getByTestId("confirm-state")).toContainText(
        "Partial — 1 065,00 SEK stays open",
      );
      await page.getByTestId("confirm-settlement").click();
      await expectToast(page, "Settlement ST25-");
      await expect(page).toHaveURL(/\/expenses\/settlements$/);
      const settlement = page.getByTestId("settlement-row").first();
      await expect(settlement).toContainText(/ST25-\d{3}/);
      await expect(settlement).toContainText("9 700,00");
      await expect(settlement.getByTestId("settlement-status")).toHaveText("Active");
      // the statement is a stored PDF once the job ran
      await expect(settlement.getByTestId("download-statement")).toBeVisible({ timeout: 90_000 });

      // the statement page
      await settlement.getByRole("link", { name: "→" }).click();
      await expect(page.getByTestId("statement-sheet")).toBeVisible();
      await expect(page.getByTestId("statement-total")).toContainText("9 700,00");

      // the ledger moved: refunded / partially refunded
      await page.goto(`/expenses?q=${encodeURIComponent(groupPrefix)}`);
      await expect(page.getByRole("row").filter({ hasText: "Hotel" })).toContainText("Refunded");
      await expect(page.getByRole("row").filter({ hasText: "Meals" })).toContainText(
        "Partially refunded",
      );
      await expect(page.getByRole("row").filter({ hasText: "Traktamente" })).toContainText(
        "To refund",
      );

      // 6. the rate table: the seeded 2025 rows, a paste preview
      await page.goto("/settings/traktamente?year=2025");
      await expect(page.getByTestId("rate-row").filter({ hasText: "Schweiz" })).toContainText(
        "1 402,00",
      );
      await page.getByTestId("open-paste").click();
      await page.getByTestId("paste-text").fill("2025;Albanien;AL;345\n2025;Färöarna;;Se Danmark");
      await page.getByTestId("paste-preview-button").click();
      await expect(page.getByTestId("paste-preview")).toContainText("1 rows · 1 skipped");
    });
  });

  test("the accountant reads expenses and settlements, writes nothing", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/accountant.json" });
    const page = await ctx.newPage();
    await page.goto("/expenses");
    await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();
    await expect(page.getByTestId("open-new-expense")).toHaveCount(0);
    await page.goto("/expenses/settlements");
    await expect(page.getByRole("heading", { name: "Settlements" })).toBeVisible();
    await expect(page.getByTestId("cancel-settlement")).toHaveCount(0);
    await ctx.close();
  });
});
