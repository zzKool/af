import { expect, test } from "@playwright/test";
import { expectToast, trackToasts } from "./fixtures/toasts";

// The journal (specs/journal): the owner types a manual entry — its Proof is *None* and its panel offers
// *Link to…* — and the accountant reads the same ledger with nothing to change: no *New entry*, no form, no
// *Delete*, no *Link to…* (US2 / AC4, US4 / AC2 — journal T008). The journey owns its data (a stamped entry) and
// opens it by its search (`?q=`), never by row position.
test.describe("Journal — owner writes, accountant reads", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("a manual entry, then the accountant's read-only view of it", async ({ page, browser }) => {
    test.setTimeout(240_000);
    await trackToasts(page);
    const stamp = `Forfait e2e ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    // 1. the owner creates it from *New entry*
    await page.goto("/journal");
    await page.getByTestId("new-entry").click();
    const dialog = page.getByTestId("manual-entry-dialog");
    await dialog.getByLabel("Description").fill(stamp);
    await dialog.getByLabel(/^Amount/).fill("-42.00");
    await dialog.getByTestId("manual-entry-create").click();
    await expectToast(page, "Entry created");

    // 2. found by its search; nothing proves it yet; its panel offers the owner's controls
    await page.goto(`/journal?q=${encodeURIComponent(stamp)}`);
    const row = page.getByRole("row").filter({ hasText: stamp });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("journal-links-state")).toHaveAttribute("data-state", "none");
    await row.getByText(stamp).click();
    const panel = page.getByTestId("journal-panel");
    await expect(panel.getByTestId("categorise-form")).toBeVisible();
    await expect(panel.getByTestId("journal-link-to")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Delete entry" })).toBeVisible();

    // 3. the accountant: the same entry, read only
    const context = await browser.newContext({ storageState: "e2e/.auth/accountant.json" });
    try {
      const hers = await context.newPage();
      await hers.goto(`/journal?q=${encodeURIComponent(stamp)}`);
      const herRow = hers.getByRole("row").filter({ hasText: stamp });
      await expect(herRow).toHaveCount(1);
      await expect(hers.getByTestId("new-entry")).toHaveCount(0);
      await herRow.getByText(stamp).click();
      const herPanel = hers.getByTestId("journal-panel");
      await expect(herPanel).toBeVisible();
      await expect(herPanel.getByTestId("journal-proof")).toBeVisible();
      await expect(herPanel.getByTestId("categorise-form")).toHaveCount(0);
      await expect(herPanel.getByTestId("journal-link-to")).toHaveCount(0);
      await expect(herPanel.getByRole("button", { name: "Delete entry" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
