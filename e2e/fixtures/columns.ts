import { expect, type Page } from "@playwright/test";

/**
 * The banking list shows four columns beside the work surface by default (F131 §6.2: Date · Amount · Counterparty ·
 * State); Partner, Category, Proposed… wait in the column chooser. A journey that asserts one of those on the list
 * shows it first through the chooser — `check()` leaves a column that is already shown alone, so a layout an earlier
 * run saved (the chooser remembers it per user, lessons *F131 build*) does not flip it back.
 */
export async function showColumns(page: Page, names: string[]): Promise<void> {
  await page.getByRole("button", { name: "Choose columns" }).click();
  const menu = page.getByTestId("columns-menu");
  await expect(menu).toBeVisible();
  for (const name of names) await menu.getByRole("checkbox", { name, exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
}

/** The chooser's *Reset layout* when a layout was saved — the journey's own state goes first (lessons *F131 build*). */
export async function resetColumns(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Choose columns" }).click();
  const menu = page.getByTestId("columns-menu");
  await expect(menu).toBeVisible();
  const reset = menu.getByTestId("columns-reset");
  if (await reset.isVisible()) await reset.click();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
}

/** The `data-column` keys of the visible headers, left to right. */
export function visibleColumns(page: Page): Promise<(string | null)[]> {
  return page
    .locator("thead th[data-column]")
    .evaluateAll((ths) => ths.map((t) => t.getAttribute("data-column")));
}
