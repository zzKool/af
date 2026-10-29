import { expect, test } from "@playwright/test";

// F98 (specs/ai US1, PR 1 — no model): the owner categorises two rows of one counterparty by hand → Settings → AI →
// Run now → the third row shows a HIGH category proposal, *remembered*, pre-filled in the picker and not saved →
// Accept → the row is categorised by hand and the proposal is gone. The journey owns its rows (a unique key).
const HEADER =
  "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";

test.describe("AI proposals — stage 1", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("two rows by hand → the third is proposed, pre-filled, accepted", async ({ page }) => {
    test.setTimeout(240_000);
    const key = `CLOUDHOST ${Date.now().toString(36).toUpperCase()}`;
    const csv = [
      HEADER,
      `2026/09/28;-132,52;;;${key};;${key} INV 3;;;SEK;`,
      `2026/08/28;-132,52;;;${key};;${key} INV 2;;;SEK;`,
      `2026/07/28;-132,52;;;${key};;${key} INV 1;;;SEK;`,
    ].join("\n");

    await page.goto("/banking");
    await page.getByTestId("open-import").click();
    await page.getByTestId("import-file").setInputFiles({
      name: "PLUSGIROKONTO FTG 123 45 67-8 - 2026-09-30 09.00.00.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "latin1"),
    });
    await expect(page.getByTestId("import-account")).toContainText("Plusgirokonto SEK");
    await page.getByTestId("import-run").click();
    await expect(page.getByTestId("import-summary")).toContainText("3 imported", {
      timeout: 20_000,
    });
    await page.keyboard.press("Escape");

    // 1. the two older rows, by hand
    await page.goto(`/banking?q=${encodeURIComponent(key)}`);
    const panel = page.getByTestId("transaction-panel");
    // the list shows the name, not the message: the rows are told apart by their date
    const row = (date: string) =>
      page.getByRole("row").filter({ hasText: key }).filter({ hasText: date }).first();
    for (const date of ["2026-07-28", "2026-08-28"]) {
      await row(date).click();
      await expect(panel).toBeVisible();
      await panel.getByLabel("Category").click();
      await page.getByRole("option", { name: /^654 · / }).click();
      await expect(page.getByText("Saved").first()).toBeVisible();
      await page.keyboard.press("Escape");
    }

    // 2. Run now
    await page.goto("/settings/ai");
    await expect(page.getByTestId("ai-state")).toContainText("Off"); // no model in CI — stage 1 needs none
    await page.getByTestId("ai-run-now").click();
    await expect(page.getByText("Queued")).toBeVisible();

    // 3. the third row: the proposal, remembered, pre-filled (the job runs in the background — reload until it shows)
    await expect(async () => {
      await page.goto(`/banking?q=${encodeURIComponent(key)}`);
      await row("2026-09-28").click();
      await expect(page.getByTestId("proposal-line")).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    const line = page.getByTestId("proposal-line");
    await expect(line.getByTestId("proposal-bas-value")).toContainText("654");
    await expect(line).toContainText("remembered");
    await expect(line).toContainText("High");
    await expect(page.getByTestId("prefill-hint")).toBeVisible();
    await expect(page.getByTestId("panel-state")).toHaveText("Open");

    // 4. Accept → categorised by hand, nothing left to propose
    await line.getByTestId("proposal-accept").click();
    await expect(page.getByText("Accepted").first()).toBeVisible();
    await expect(page.getByTestId("proposal-line")).toHaveCount(0);
    await expect(page.getByTestId("prefill-hint")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(row("2026-09-28")).toContainText("654");
  });
});
