import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// The owner's monthly routine (specs/banking US1–US4, SEK only — CI has no ECB rates): import the July export
// → the fee rule categorised its row → open the OpenAI row, categorise it, create a rule from it → import the
// savings file (interest rule) and the matching SEK leg → accept the transfer pair → journal and imports pages.
const FIXTURES = join(__dirname, "..", "specs", "banking", "fixtures");
const HEADER =
  "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";

test.describe("Banking", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("import, categorise, rule from a row, transfer pair, journal", async ({ page }) => {
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
    await page.getByTestId("import-run").click();
    const summary = page.getByTestId("import-summary");
    await expect(summary).toBeVisible({ timeout: 20_000 });
    await expect(summary).toContainText("12 imported · 0 duplicates · 0 errors");
    await expect(summary).toContainText("1 categorised by rules"); // AVGIFTER NORDEA → 657
    await page.getByTestId("import-show-rows").click();
    await expect(page).toHaveURL(/bankImportId/);
    await expect(page.getByRole("row").filter({ hasText: "AVGIFTER NORDEA" })).toContainText(
      "No document needed",
    );

    // 2. the OpenAI row: categorise by hand, then "create rule from this"
    await page.getByRole("row").filter({ hasText: "OPENAI" }).first().click();
    const panel = page.getByTestId("transaction-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("panel-amount")).toContainText("132,52 SEK");
    await expect(panel.getByTestId("panel-state")).toHaveText("Open");
    await panel.getByLabel("Category").click();
    await page.getByRole("option", { name: /654 · IT-tjänster/ }).click();
    await expect(page.getByText("Saved").first()).toBeVisible();
    await panel.getByTestId("create-rule").click();
    const dialog = page.getByTestId("rule-dialog");
    await expect(dialog.getByLabel("Pattern")).toHaveValue("OPENAI *CHATGPT SUBS");
    await dialog.getByRole("button", { name: "Test" }).click();
    await expect(dialog.getByTestId("rule-test-result")).toBeVisible();
    await dialog.getByRole("button", { name: "Save rule" }).click();
    await expect(page.getByText("Rule saved")).toBeVisible();
    await page.keyboard.press("Escape");

    // 3. the savings file (interest rule) and the SEK leg of the move → transfer pair
    await page.goto("/banking");
    await page.getByTestId("open-import").click();
    await page.getByTestId("import-file").setInputFiles({
      name: "SPARKONTO FÖRETAG 1234 56 78901 - 2026-12-31 10.00.00.csv",
      mimeType: "text/csv",
      buffer: readFileSync(join(FIXTURES, "nordea-savings-year.csv")),
    });
    await expect(page.getByTestId("import-account")).toContainText("Sparkonto");
    await page.getByTestId("import-run").click();
    await expect(page.getByTestId("import-summary")).toContainText("2 imported");
    await expect(page.getByTestId("import-summary")).toContainText("1 categorised by rules"); // Ranta → 831
    await page.keyboard.press("Escape");

    await page.goto("/banking");
    await page.getByTestId("open-import").click();
    await page.getByTestId("import-file").setInputFiles({
      name: "PLUSGIROKONTO FTG 123 45 67-8 - 2026-01-05 08.00.00.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [HEADER, "2025/12/31;-50000,00;;1234 56 78901;TRANSFER TO OWN ACCOUNT;;;;100,00;SEK;"].join(
          "\n",
        ),
        "latin1",
      ),
    });
    await expect(page.getByTestId("import-account")).toContainText("Plusgirokonto SEK");
    await page.getByTestId("import-run").click();
    await expect(page.getByTestId("import-summary")).toContainText("1 imported");
    await page.getByTestId("import-show-rows").click();
    await page.getByRole("row").filter({ hasText: "TRANSFER TO OWN ACCOUNT" }).click();
    await expect(panel.getByTestId("accept-transfer")).toBeVisible();
    await expect(panel).toContainText("implied 1");
    await panel.getByTestId("accept-transfer").click();
    await expect(page.getByText("Transfer pair linked")).toBeVisible();
    await expect(panel.getByTestId("panel-state")).toHaveText("No document needed");
    await expect(panel).toContainText("transfer");
    await page.keyboard.press("Escape");

    // 4. the rules page lists the learned rule; the journal shows the entries; the imports page the three files
    await page.goto("/banking/rules");
    await expect(page.getByRole("row").filter({ hasText: "OPENAI *CHATGPT SUBS" })).toContainText(
      "learned",
    );
    await page.goto("/journal");
    await expect(page.getByRole("row").filter({ hasText: "AVGIFTER NORDEA" })).toContainText("657");
    await expect(page.getByRole("row").filter({ hasText: "Ranta" })).toContainText("831");
    await page.goto("/banking/imports");
    await expect(page.getByTestId("import-row")).toHaveCount(3);
  });
});
