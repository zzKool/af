import { expect, test } from "@playwright/test";
import { expectToast, trackToasts } from "./fixtures/toasts";

// Settings → BAS (F187, D84): *Use my usual accounts* — the confirm dialog says what happens (the set with its
// notes, *Deactivate the others* ticked), Apply makes the set the active accounts. On the seed the set is already
// active (the seed runs the same service): the run is idempotent, the list still shows the set.
test.describe("Settings → BAS — the owner's accounts", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("Use my usual accounts: the dialog, Apply, the list shows the set", async ({ page }) => {
    await trackToasts(page);
    await page.goto("/settings/bas-categories");
    await page.getByTestId("bas-use-mine").click();
    const dialog = page.getByTestId("bas-mine-dialog");
    await expect(dialog.getByTestId("bas-mine-set")).toContainText("1630");
    await expect(dialog.getByTestId("bas-mine-set")).toContainText("The owner's salary");
    await expect(dialog.getByTestId("bas-mine-deactivate")).toHaveAttribute("aria-checked", "true");
    await dialog.getByTestId("bas-mine-apply").click();
    await expectToast(page, "Your accounts are active");
    await expect(dialog).not.toBeVisible();

    const search = page.getByPlaceholder("Search by code, name, alias…");
    for (const code of ["1630", "5420", "7220", "3305"]) {
      await search.fill(code);
      await expect(page.getByRole("checkbox", { name: `Deactivate ${code}` })).toBeChecked();
    }
  });
});
