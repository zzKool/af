import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { expectToast, trackToasts, withToastReport } from "./fixtures/toasts";

const SHOTS = join(__dirname, "..", "specs", "justify", "screenshots");

/** `E2E_SCREENSHOTS=1`: the journey leaves the PR's screenshots behind (definition of done §4.5). */
async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

// The owner's trip (specs/expenses US1–US5, specs/traktamente US1–US3; SEK only — CI has no ECB rates):
// a trip group → three private receipts → the trip panel writes the per-diem (2025 rates are seeded) → the new
// expense dialog proposes the trip group from a date inside it (F131 §5.2) → a refund row imported into banking →
// *This row refunds me* on the row (F131 §5.1) → the settle page with the row locked proposes FIFO, confirms
// ST25-001 → back on the row, linked → the settlements page and the statement → the rate table under settings.
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
        ["Hotel", "6450.00", /^5800/],
        ["Transport", "1620.00", /^5800/],
        ["Meals", "2695.00", /^5830/],
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
      await expect(page.getByTestId("trip-total")).toContainText("18 506.40 SEK"); // formatMoney (F71)
      await page.getByTestId("write-per-diem").click();
      await expectToast(page, "Per-diem expense");
      await expect(page.getByTestId("per-diem-expense")).toContainText("18 506.40 SEK");
      await expect(
        page.getByRole("row").filter({ hasText: "Traktamente CH 19.5 days" }),
      ).toBeVisible();

      // 3b. F131 §5.2: a receipt dated inside the trip — the dialog proposes the trip group from the date, marked
      //     as a proposal (a day only this journey's trip covers: the Justify journey's trip starts on 03-10)
      await page.goto("/expenses");
      await page.getByTestId("open-new-expense").click();
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Date", { exact: true }).fill("2025-03-04");
      await expect(dialog.getByTestId("group-hint")).toHaveText("proposed (the trip)");
      await expect(dialog.getByLabel("Group", { exact: true })).toContainText(groupName);
      await snap(page, "expense-group-proposed");
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();

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
      await expect(page.getByTestId("import-account")).toContainText(/Plusgirokonto|Sparkonto/);
      await page.getByTestId("import-run").click();
      await expect(page.getByTestId("import-summary")).toContainText("1 imported", {
        timeout: 20_000,
      });
      await page.keyboard.press("Escape");

      // 5. settle, run from the row (F131 §5.1, T021): the row's panel offers *This row refunds me* (the ledger has
      //    something open) → the FIFO picker in place on this row → the proposal covers the three receipts (dated
      //    before the per diem), confirm — the settle page stays one link away
      await page.goto(`/banking?q=${encodeURIComponent(`Zikrija ${stamp}`)}`);
      await page
        .getByRole("row")
        .filter({ hasText: `Zikrija ${stamp}` })
        .first()
        .click();
      await expect(page.getByTestId("transaction-panel")).toBeVisible();
      await page.getByTestId("justify-refund").click();
      const picker = page.getByTestId("refund-picker");
      await expect(picker).toBeVisible();
      await expect(picker.getByTestId("refund-open-settle")).toHaveAttribute(
        "href",
        /\/expenses\/settle\?row=[0-9a-f-]{36}$/,
      );
      // the proposal lands asynchronously — wait for its ticks before adjusting them
      await expect(picker.getByTestId("refund-selected")).not.toContainText("Selected: 0.00");
      // the FIFO proposal ticks the oldest open expenses; keep only this run's three receipts (a developer's
      // database may hold earlier runs), hotel and transport in full, 1 630 of the meals
      for (const row of await picker.getByTestId("refund-line").all()) {
        const key = (await row.innerText()).match(/Ex\d+-\w+-\d+/)?.[0] ?? "";
        const mine = key.startsWith(groupPrefix) && !key.endsWith("Tr-03");
        const box = row.getByRole("checkbox", { name: key, exact: true });
        if ((await box.isChecked()) !== mine) await box.click();
        if (mine && key.endsWith("Rep-01")) await row.getByRole("textbox").fill("1630.00");
      }
      await expect(picker.getByTestId("refund-hint")).toHaveText("Exact match");
      // D40 on-screen money: U+202F thousands, "." decimals (the printed statement keeps its own format)
      await expect(picker.getByTestId("refund-selected")).toContainText(/9\u202F700\.00/);
      await snap(page, "refund-from-row");
      await picker.getByTestId("refund-confirm").click();
      await expectToast(page, "Settlement ST25-");
      // on the row still: justified by the settlement (the statement is its proof, the owner its partner)
      await expect(page.getByTestId("transaction-panel")).toBeVisible();
      await expect(page.getByTestId("panel-state")).toHaveText("Linked");
      await page.goto("/expenses/settlements");
      const settlement = page.getByTestId("settlement-row").first();
      await expect(settlement).toContainText(/ST25-\d{3}/);
      await expect(settlement).toContainText(/9\u202F700\.00/);
      await expect(settlement.getByTestId("settlement-status")).toHaveText("Active");
      // the statement is a stored PDF once the job ran
      await expect(settlement.getByTestId("download-statement")).toBeVisible({ timeout: 90_000 });

      // the statement page
      await settlement.getByTestId("settlement-link").click();
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
        "1 402.00",
      );
      // the paste is a variant of the title row's split primary (F71)
      await page.getByRole("button", { name: "More ways to add rates" }).click();
      await page.getByRole("menuitem", { name: "Paste Skatteverket CSV" }).click();
      await page.getByTestId("paste-text").fill("2025;Albanien;AL;345\n2025;Färöarna;;Se Danmark");
      await page.getByTestId("paste-preview-button").click();
      await expect(page.getByTestId("paste-preview")).toContainText("1 rows · 1 skipped");
    });
  });

  // F87 (specs/expense-partner): an optional partner — its default category proposed, the Partner column, the
  // partner's Expenses tab with its total, *Open in Expenses* landing filtered. Owns its data (vendor, group).
  test("an expense with a partner: default category, Partner column, the partner's Expenses tab", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await trackToasts(page);
    await withToastReport(page, async () => {
      const vendorName = `E2E Bistro ${stamp}`;
      const batch = `Dinners ${stamp}`;

      // the vendor, with 583 as its default category
      await page.goto("/partners");
      await page.getByRole("button", { name: "Add partner" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill(vendorName);
      await page.getByLabel("client").uncheck();
      await page.getByLabel("vendor").check();
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expect(page.getByText("Partner created")).toBeVisible();
      await page.goto(`/partners?q=${encodeURIComponent(vendorName)}`);
      await page.getByRole("link", { name: vendorName }).click();
      await expect(page).toHaveURL(/\/partners\/[0-9a-f-]{36}$/);
      const partnerUrl = page.url();
      // the partner's facts are edited in the *Edit details* dialog; the Details card reads them back (F151)
      await page.getByTestId("partner-edit-details").click();
      await page.getByTestId("partner-default-bas").click();
      await page.getByRole("option", { name: /^5830/ }).click();
      await expect(async () => {
        await page.reload();
        await expect(page.getByTestId("partner-details")).toContainText("5830", { timeout: 2_000 });
      }).toPass({ timeout: 20_000 });

      // a group of its own
      await page.goto("/expenses/groups");
      await page.getByTestId("open-new-group").click();
      await page.getByTestId("group-description").fill(batch);
      await page.getByTestId("save-group").click();
      await expectToast(page, "created");

      // the expense: picking the partner proposes its category, marked *from partner*
      await page.goto("/expenses");
      const dialog = page.getByTestId("new-expense-dialog");
      const pick = async (label: string, option: RegExp | string) => {
        await dialog.getByLabel(label, { exact: true }).click();
        await page.getByRole("option", { name: option }).click();
      };
      await page.getByTestId("open-new-expense").click();
      await expect(dialog).toBeVisible();
      await pick("Group", new RegExp(batch));
      await pick("Paid by", "Private SE");
      await dialog.getByLabel("Date", { exact: true }).fill("2025-04-02");
      await page.getByTestId("expense-description").fill("Dinner with the client");
      await pick("Partner", vendorName);
      await expect(dialog.getByLabel("Category", { exact: true })).toContainText(/^5830/);
      await expect(dialog.getByTestId("category-from-partner")).toBeVisible();
      await page.getByTestId("expense-amount").fill("842.00");
      await page.getByTestId("create-expense").click();
      await expectToast(page, "Rep-01 created");
      await expect(dialog).not.toBeVisible();

      // the partner's Expenses tab: the count, the total, the row; Open in Expenses lands filtered
      await page.goto(partnerUrl);
      await page.getByRole("tab", { name: /^Expenses/ }).click();
      await expect(page.getByTestId("partner-expenses-total")).toContainText("Expenses: 1");
      await expect(page.getByTestId("partner-expenses-total")).toContainText("842.00");
      await expect(page.getByTestId("partner-expenses")).toContainText("Dinner with the client");
      await page.getByTestId("partner-expenses-open").click();
      await expect(page).toHaveURL(/\/expenses\?f\.partnerId=in(%3A|:)[0-9a-f-]{36}/);
      const row = page.getByRole("row").filter({ hasText: "Dinner with the client" });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(vendorName);
    });
  });

  test("the accountant reads expenses and settlements, writes nothing", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/accountant.json" });
    const page = await ctx.newPage();
    await page.goto("/expenses");
    await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();
    await expect(page.getByTestId("open-new-expense")).toHaveCount(0);
    // ?new=1 opens nothing for a role that cannot create
    await page.goto("/expenses?new=1");
    await expect(page.getByTestId("new-expense-dialog")).toHaveCount(0);
    await page.goto("/expenses/settlements");
    await expect(page.getByRole("heading", { name: "Settlements" })).toBeVisible();
    await expect(page.getByTestId("cancel-settlement")).toHaveCount(0);
    await ctx.close();
  });

  // F73: + New → Expense lands on ?new=1 — the dialog opens; closing drops the param
  test("?new=1 opens the new expense dialog", async ({ page }) => {
    await page.goto("/expenses?new=1");
    const dialog = page.getByTestId("new-expense-dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/new=1/);
  });

  // F170 (the board *Pulse — Expenses*): the form docks beside the list, not over it; one panel at a time —
  // a row picked closes the form, the form opened closes the row
  test("the new expense form docks beside the list, one panel at a time", async ({ page }) => {
    await trackToasts(page);
    const desc = `Docked parking ${stamp}`;
    await page.goto("/expenses");
    await page.getByTestId("open-new-expense").click();
    const form = page.getByTestId("new-expense-dialog");
    await expect(form).toBeVisible();
    await expect(form).toHaveAttribute("data-docked", "");
    await expect(page.locator("[data-slot=details-dock]")).toContainText("New expense");
    // nothing covers the list: its search stays usable while the form is open
    await expect(page.getByPlaceholder("Search key, description, group, note…")).toBeEditable();
    const pick = async (label: string, option: RegExp | string) => {
      await form.getByLabel(label, { exact: true }).click();
      await page.getByRole("option", { name: option }).click();
    };
    await pick("Group", "+ New group…");
    await page.getByTestId("new-group-description").fill(`Docked ${stamp}`);
    await pick("Paid by", "Private SE");
    await form.getByLabel("Date", { exact: true }).fill("2025-05-06");
    await page.getByTestId("expense-description").fill(desc);
    await pick("Category", /^5800/);
    await page.getByTestId("expense-amount").fill("90.00");
    await page.getByTestId("create-expense").click();
    await expectToast(page, "created");
    await expect(form).toBeHidden();

    // the row's panel and the form share the dock
    await page.goto(`/expenses?q=${encodeURIComponent(desc)}`);
    await page.getByTestId("open-new-expense").click();
    await expect(form).toBeVisible();
    // the description cell — the narrowed row's middle may fall on its group link
    await page
      .getByRole("row")
      .filter({ hasText: desc })
      .first()
      .getByRole("cell", { name: desc, exact: true })
      .click();
    await expect(page.getByTestId("expense-panel")).toBeVisible();
    await expect(form).toBeHidden();
    await page.getByTestId("open-new-expense").click();
    await expect(form).toBeVisible();
    await expect(page.getByTestId("expense-panel")).toBeHidden();
  });
});
