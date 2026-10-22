import { expect, test } from "@playwright/test";

// The shell's menus (D40). No journey opened the account menu, so a Base UI error that only fires when it opens
// (a group label outside its group) shipped unseen — this opens it.
test.describe("Shell", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("the account menu opens with the user's name and leads to My Preferences", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/dashboard");

    const trigger = page.getByRole("button", { name: /^Account: / });
    const label = (await trigger.getAttribute("aria-label"))?.replace(/^Account: /, "") ?? "";
    await trigger.click();

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText(label, { exact: true })).toBeVisible();
    await menu.getByRole("menuitem", { name: "My Preferences" }).click();
    await expect(page).toHaveURL(/\/settings\/my-preferences$/);
    expect(errors).toEqual([]);
  });
});
