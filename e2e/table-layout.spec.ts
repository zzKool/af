import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const SHOTS = join(__dirname, "..", "specs", "kernel-ui-datatable", "screenshots");

async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

const headers = (page: Page) =>
  page
    .locator("thead th[data-column]")
    .evaluateAll((ths) => ths.map((t) => t.getAttribute("data-column")));

// The DataTable's layout per user (ui-conventions v2): the Columns menu moves a column, a header is dragged onto
// another, a column is resized — and after a reload (a new session on the server's copy) it all still holds;
// *Reset layout* puts the defaults back.
test.describe("DataTable layout", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("order, width and visibility survive a reload; Reset restores the defaults", async ({
    page,
  }) => {
    await page.goto("/partners");
    await expect(page.getByRole("button", { name: "Choose columns" })).toBeVisible();
    // a clean slate — an earlier run may have left a layout behind
    await page.getByRole("button", { name: "Choose columns" }).click();
    const reset = page.getByTestId("columns-reset");
    if (await reset.isVisible()) {
      await reset.click();
      await page.waitForTimeout(800); // the debounced save
    }
    await page.keyboard.press("Escape");
    const initial = await headers(page);
    expect(initial.slice(0, 2)).toEqual(["name", "shortCode"]);

    // 1. the Columns menu: hide a column, move another down
    await page.getByRole("button", { name: "Choose columns" }).click();
    await page.getByRole("checkbox", { name: "Short", exact: true }).click();
    // the menu orders every column, hidden ones too: Name moves past Short (now hidden) and Types
    await page.getByRole("button", { name: "Move Name down" }).click();
    await page.getByRole("button", { name: "Move Name down" }).click();
    await page.keyboard.press("Escape");
    const afterMenu = await headers(page);
    expect(afterMenu).not.toContain("shortCode");
    expect(afterMenu.indexOf("name")).toBe(1);

    // 2. drag the Email header onto the first column
    const email = page.locator("thead th[data-column=email]");
    const first = page.locator("thead th[data-column]").first();
    await email.dragTo(first);
    const afterDrag = await headers(page);
    expect(afterDrag[0]).toBe("email");
    expect(afterDrag.indexOf("name")).toBe(2);

    // 3. resize Email with the keyboard (8 px per press)
    const handle = page.getByRole("separator", { name: "Resize Email" });
    await handle.focus();
    const before = await email.evaluate((el) => el.getBoundingClientRect().width);
    for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowLeft");
    const after = await email.evaluate((el) => el.getBoundingClientRect().width);
    expect(after).toBeLessThan(before);
    await snap(page, "layout-customised");

    // 4. a new page load reads the server's copy: same order, width and hidden column
    await page.waitForTimeout(800);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("thead th[data-column]").first()).toHaveAttribute(
      "data-column",
      "email",
    );
    const reloaded = await headers(page);
    expect(reloaded).toEqual(afterDrag);
    expect(await email.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(before);

    // 5. Reset layout → the defaults
    await page.getByRole("button", { name: "Choose columns" }).click();
    await page.getByTestId("columns-reset").click();
    await page.keyboard.press("Escape");
    expect((await headers(page)).slice(0, 2)).toEqual(["name", "shortCode"]);
    await page.waitForTimeout(800);
  });
});
