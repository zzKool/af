import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { resetColumns, showColumns, visibleColumns } from "./fixtures/columns";

// The owner's monthly routine (specs/banking US1–US4, SEK only — CI has no ECB rates): import the July export
// through its preview (F128: new / duplicate / no proof needed, Import N) → the fee rule categorised its row → open
// the OpenAI row, categorise it, create a rule from it → import the savings file (interest rule) and the matching
// SEK leg → accept the transfer pair → the categories on the list, imports page.
const FIXTURES = join(__dirname, "..", "specs", "banking", "fixtures");
const HEADER =
  "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";

test.describe("Banking", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("import, categorise, rule from a row, transfer pair, the list", async ({ page }) => {
    test.setTimeout(240_000); // five pages, four imports — a long journey (lessons: e2e budgets)
    // 1. the July sample into the SEK account (pre-selected from the file name)
    await page.goto("/banking");
    await page.getByTestId("open-import").click();
    await page.getByTestId("import-file").setInputFiles({
      name: "PLUSGIROKONTO FTG 123 45 67-8 - 2026-07-31 09.12.01.csv",
      mimeType: "text/csv",
      buffer: readFileSync(join(FIXTURES, "nordea-2026-07-sek-sample.csv")),
    });
    await expect(page.getByText("Pre-selected from the file name")).toBeVisible();
    await expect(page.getByTestId("import-account")).toContainText("Plusgirokonto SEK");
    // F128: the preview before anything is written — every row with its *Will be*, the header line, Import N
    const preview = page.getByTestId("import-preview");
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("import-preview-header")).toContainText(
      "12 rows · 2026-07-03 → 2026-07-28",
    );
    const previewRows = page.getByTestId("import-preview-row");
    await expect(previewRows).toHaveCount(12);
    await expect(
      previewRows.filter({ hasText: "AVGIFTER NORDEA" }).getByTestId("import-will-be"),
    ).toHaveText("no proof needed · Nordea bank fees · Nordea"); // the seed's default rule, the bank its partner
    await expect(
      previewRows.filter({ hasText: "OPENAI" }).getByTestId("import-will-be"),
    ).toHaveText("new");
    await expect(page.getByTestId("import-run")).toHaveText("Import 12");
    await page.getByTestId("import-run").click();
    const summary = page.getByTestId("import-summary");
    await expect(summary).toBeVisible({ timeout: 20_000 });
    await expect(summary).toContainText("12 imported · 0 duplicates · 0 errors");
    await expect(summary).toContainText("1 categorised by rules"); // AVGIFTER NORDEA → 657
    await page.getByTestId("import-show-rows").click();
    await expect(page).toHaveURL(/bankImportId/);
    const feeRow = page.getByRole("row").filter({ hasText: "AVGIFTER NORDEA" });
    await expect(feeRow).toContainText("No document needed");
    // F129 (D73): the fee rule names the bank — the row is justified with a partner, not merely flagged (the
    // Partner column is one tick away beside the work surface, F131 §6.2)
    await showColumns(page, ["Partner"]);
    await expect(feeRow).toContainText("Nordea");

    // 1b. the same export again with two new rows (a vendor, August's fee): the preview greys the twelve as
    //     duplicates, the fee row is *no proof needed* by the rule, Import 2 — then Escape: nothing is written.
    //     The screenshot of the preview comes from here.
    await expect(page.getByText("12 imported · 0 duplicates · 0 errors")).toBeHidden({
      timeout: 15_000,
    }); // the import's toast, gone before the picture
    await page.getByTestId("open-import").click();
    await page.getByTestId("import-file").setInputFiles({
      name: "PLUSGIROKONTO FTG 123 45 67-8 - 2026-08-02 09.00.00.csv",
      mimeType: "text/csv",
      buffer: Buffer.concat([
        readFileSync(join(FIXTURES, "nordea-2026-07-sek-sample.csv")),
        Buffer.from(
          [
            "2026/08/02;-85,00;;;AVGIFTER NORDEA;Priset for juli;;;;SEK;",
            "2026/07/29;-1297,20;;822-3877;SKATTEPUNKTEN OFFICE;Skattepunkten Office Services AB;2026-071;Ex-Acc;;SEK;",
            "",
          ].join("\n"),
          "latin1",
        ),
      ]),
    });
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("import-preview-header")).toContainText("14 rows");
    await expect(page.getByTestId("import-preview-header")).toContainText("12 duplicates");
    await expect(
      page.locator('[data-testid="import-preview-row"][data-will-be="duplicate"]'),
    ).toHaveCount(12);
    const augustFee = page.locator('[data-testid="import-preview-row"][data-will-be="no_proof"]');
    await expect(augustFee).toHaveCount(1);
    await expect(augustFee).toContainText("AVGIFTER NORDEA");
    await expect(augustFee.getByTestId("import-will-be")).toHaveText(
      "no proof needed · Nordea bank fees · Nordea",
    );
    await expect(
      previewRows.filter({ hasText: "SKATTEPUNKTEN OFFICE" }).getByTestId("import-will-be"),
    ).toHaveText("new");
    await expect(
      previewRows.filter({ hasText: "OPENAI" }).getByTestId("import-will-be"),
    ).toHaveText("duplicate — already imported");
    await expect(page.getByTestId("import-run")).toHaveText("Import 2");
    if (process.env.E2E_SCREENSHOTS) {
      const shots = join(__dirname, "..", "specs", "justify", "screenshots");
      mkdirSync(shots, { recursive: true });
      await previewRows.last().scrollIntoViewIfNeeded(); // the new rows sit at the bottom of the file
      await page.getByTestId("import-dialog").screenshot({
        path: join(shots, "import-preview.png"),
      });
    }
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("import-dialog")).toBeHidden();

    // 2. the owner's default columns (2026-11-08) — Date · Partner · Counterparty · Category · Reference · Own notes ·
    //    Amount · Checks · State · Imported; was (F131 §6.2, D76): five columns by default — Date · Counterparty · the
    //    three dots · State · Amount — the rest in the chooser; the journey owns its layout (an earlier run may
    //    have shown more)
    await resetColumns(page);
    expect(await visibleColumns(page)).toEqual([
      "bookingDate",
      "partnerName",
      "counterpartyKey",
      "basLabel",
      "reference",
      "ownNotes",
      "amount",
      "steps",
      "state",
      "createdAt",
    ]);
    //    the OpenAI row: categorise by hand, then "create rule from this"
    await page.getByRole("row").filter({ hasText: "OPENAI" }).first().click();
    const panel = page.getByTestId("transaction-panel");
    await expect(panel).toBeVisible();
    // D40 money: U+2212 minus, "." decimals, U+202F / no-break spaces (lessons: match with \s)
    await expect(panel.getByTestId("panel-amount")).toHaveText(/^−132\.52\sSEK$/);
    await expect(panel.getByTestId("panel-state")).toHaveText("Open");
    // F131: the work surface — the three zones; ≈ 55 % of the canvas by default; ← on the handle widens it by
    // 40 px and the width is remembered with the table (asserted after the next reload, step 3)
    await expect(panel.getByTestId("zone-row")).toBeVisible();
    await expect(panel.getByTestId("zone-proof")).toBeVisible();
    await expect(panel.getByTestId("zone-facts")).toBeVisible();
    await expect(panel.getByRole("button", { name: "As the bank said" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    const widthOf = (selector: string) =>
      page.locator(selector).evaluate((el) => Math.round(el.getBoundingClientRect().width));
    const handle = panel.getByRole("separator", { name: "Resize the panel" });
    // the journey owns its state: a width remembered by an earlier run goes first (double-click = the default)
    await handle.dblclick();
    // the list's own row (the panel docks beside the list, below the cards — 2026-11-09)
    const canvas = await widthOf("[data-slot=details-canvas][data-inline]");
    const defaultWidth = await widthOf("[data-testid=transaction-panel]");
    expect(Math.abs(defaultWidth / canvas - 0.38)).toBeLessThan(0.02);
    if (process.env.E2E_SCREENSHOTS) {
      const shots = join(__dirname, "..", "specs", "justify", "screenshots");
      mkdirSync(shots, { recursive: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(panel.getByTestId("zone-facts")).toBeVisible();
      await page.screenshot({ path: join(shots, "work-surface.png") });
      await page.emulateMedia({ colorScheme: "dark" });
      // the rows and the nav transition their colours (150 ms): shoot once every transition has ended
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
      await page.screenshot({ path: join(shots, "work-surface-dark.png") });
      await page.emulateMedia({ colorScheme: "light" });
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => widthOf("[data-testid=transaction-panel]")).toBe(defaultWidth + 40);
    await panel.getByLabel("Category").click();
    await page.getByRole("option", { name: /^6540 · IT services/ }).click();
    await expect(page.getByText("Saved").first()).toBeVisible();
    await panel.getByTestId("create-rule").click();
    const dialog = page.getByTestId("rule-dialog");
    await expect(dialog.getByLabel("Pattern")).toHaveValue("OPENAI *CHATGPT SUBS");
    await dialog.getByRole("button", { name: "Test" }).click();
    await expect(dialog.getByTestId("rule-test-result")).toBeVisible();
    await dialog.getByRole("button", { name: "Save rule" }).click();
    await expect(page.getByText("Rule saved")).toBeVisible();
    await page.keyboard.press("Escape");

    // 3. the savings file (interest rule) and the SEK leg of the move, dropped together (D76 phase 2b: several
    //    files at once, each to its own account, imported one after the other) → transfer pair
    await page.goto("/banking");
    await page.getByTestId("open-import").click();
    await page.getByTestId("import-file").setInputFiles([
      {
        name: "SPARKONTO FÖRETAG 1234 56 78901 - 2026-12-31 10.00.00.csv",
        mimeType: "text/csv",
        buffer: readFileSync(join(FIXTURES, "nordea-savings-year.csv")),
      },
      {
        name: "PLUSGIROKONTO FTG 123 45 67-8 - 2026-01-05 08.00.00.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          [
            HEADER,
            "2025/12/31;-50000,00;;1234 56 78901;TRANSFER TO OWN ACCOUNT;;;;100,00;SEK;",
          ].join("\n"),
          "latin1",
        ),
      },
    ]);
    const savingsCard = page.getByTestId("import-file-card").filter({ hasText: "SPARKONTO" });
    const legCard = page.getByTestId("import-file-card").filter({ hasText: "PLUSGIROKONTO" });
    await expect(savingsCard.getByTestId("import-account")).toContainText("Sparkonto");
    await expect(legCard.getByTestId("import-account")).toContainText("Plusgirokonto SEK");
    await expect(page.getByTestId("import-run")).toHaveText("Import 3 from 2 files", {
      timeout: 20_000,
    });
    await page.getByTestId("import-run").click();
    await expect(savingsCard.getByTestId("import-summary")).toContainText("2 imported");
    // Ranta → 831
    await expect(savingsCard.getByTestId("import-summary")).toContainText("1 categorised by rules");
    await expect(legCard.getByTestId("import-summary")).toContainText("1 imported");
    await expect(page.getByTestId("import-summary-total")).toContainText(
      "2 files · 3 imported · 0 duplicates · 0 errors",
    );
    await page.getByTestId("import-show-rows").click();
    await page.getByRole("row").filter({ hasText: "TRANSFER TO OWN ACCOUNT" }).click();
    await expect(panel.getByTestId("accept-transfer")).toBeVisible();
    // F131: the width chosen in step 2 came back with the table's layout (two reloads later)
    await expect.poll(() => widthOf("[data-testid=transaction-panel]")).toBe(defaultWidth + 40);
    await expect(panel).toContainText("implied 1");
    await panel.getByTestId("accept-transfer").click();
    await expect(page.getByText("Transfer pair linked")).toBeVisible();
    await expect(panel.getByTestId("panel-state")).toHaveText("No document needed");
    await expect(panel).toContainText("transfer");
    // F71 History (collapsed by default): the trail, newest first — the accepted pair, then the import
    await panel.getByRole("button", { name: "History" }).click();
    const history = panel.getByTestId("transaction-history");
    await expect(history.getByRole("listitem").first()).toContainText(
      "Linked: Bank row (transfer)",
    );
    await expect(history.getByRole("listitem").last()).toContainText("Imported");
    await page.keyboard.press("Escape");

    // 4. the rules page lists the learned rule; a no-proof rule without a partner (F129 US6) shows under
    //    *Needs a look* until it gets one; the list shows the categories on the rows (F113: no journal page);
    //    the imports page the three files
    await page.goto("/banking/rules");
    await expect(page.getByRole("row").filter({ hasText: "OPENAI *CHATGPT SUBS" })).toContainText(
      "learned",
    );
    const insurance = `E2E Insurance ${Date.now().toString().slice(-5)}`;
    await page.getByTestId("new-rule").click();
    const newRule = page.getByTestId("rule-dialog");
    await newRule.getByLabel("Name", { exact: true }).fill(insurance);
    await newRule.getByLabel("Pattern").fill(insurance.toUpperCase());
    await newRule.getByRole("checkbox", { name: /No document needed/ }).click();
    await newRule.getByRole("button", { name: "Save rule" }).click();
    // two saves in a row: the first toast may still be on screen on a slow runner — the newest counts
    await expect(page.getByText("Rule saved").last()).toBeVisible();
    await page.keyboard.press("Escape");
    const nearMiss = page
      .getByTestId("rule-near-miss")
      .filter({ hasText: insurance })
      .filter({ hasText: "sets no proof without a partner" });
    await expect(nearMiss).toHaveCount(1);
    if (process.env.E2E_SCREENSHOTS) {
      const shots = join(__dirname, "..", "specs", "justify", "screenshots");
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, "needs-a-look-no-partner.png"), fullPage: true });
    }
    await nearMiss.getByTestId("rule-near-miss-edit").click();
    const editRule = page.getByTestId("rule-dialog");
    await expect(editRule.getByLabel("Name", { exact: true })).toHaveValue(insurance);
    await editRule.getByLabel("Partner").click();
    await page.getByRole("option", { name: "Nordea" }).click();
    await editRule.getByRole("button", { name: "Save rule" }).click();
    await expect(page.getByTestId("rule-near-miss").filter({ hasText: insurance })).toHaveCount(0);
    await page.goto("/banking");
    await showColumns(page, ["Category"]); // one tick away beside the work surface (F131 §6.2)
    await expect(page.getByRole("row").filter({ hasText: "AVGIFTER NORDEA" })).toContainText(
      "6570",
    );
    await expect(page.getByRole("row").filter({ hasText: "Ranta" })).toContainText("8310");
    // the three imports of this journey are listed (other journeys import too — CI runs two workers)
    await page.goto("/banking/imports");
    for (const name of [
      "PLUSGIROKONTO FTG 123 45 67-8 - 2026-07-31 09.12.01.csv",
      "SPARKONTO FÖRETAG 1234 56 78901 - 2026-12-31 10.00.00.csv",
      "PLUSGIROKONTO FTG 123 45 67-8 - 2026-01-05 08.00.00.csv",
    ]) {
      await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(1);
    }

    // 5. the Months panel (F69): July has rows; a click on its bar is the Month filter, a second click clears it.
    // The banner's month depends on every journey's data (two workers) — only that it shows is asserted.
    await page.goto("/banking");
    const months = page.getByTestId("months-panel");
    await expect(months).toBeVisible();
    await expect(page.getByTestId("months-banner")).toBeVisible();
    const july = months.locator('button[data-month="2026-07"]');
    await july.click();
    await expect(page).toHaveURL(/f\.bookingDate=dates(%3A|:)2026-07/);
    await expect(july).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("row").filter({ hasText: "AVGIFTER NORDEA" })).toBeVisible();
    await july.click();
    await expect(page).not.toHaveURL(/f\.bookingDate/);
  });

  // F73: + New → Import bank CSV lands on ?new=1 — the import dialog opens; closing drops the param
  test("?new=1 opens the import dialog", async ({ page }) => {
    await page.goto("/banking?new=1");
    const dialog = page.getByTestId("import-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("import-file")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/new=1/);
    // the imports page reads it too
    await page.goto("/banking/imports?new=1");
    await expect(page.getByTestId("import-dialog")).toBeVisible();
  });
});
