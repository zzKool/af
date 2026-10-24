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
    // the button is named by a visually hidden text (no aria-label since axe 4.14's label-content-name-mismatch)
    const label =
      (await trigger.locator(".sr-only").textContent())?.replace(/^Account: /, "") ?? "";
    expect(label).not.toBe("");
    await trigger.click();

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText(label, { exact: true })).toBeVisible();
    await menu.getByRole("menuitem", { name: "My Preferences" }).click();
    await expect(page).toHaveURL(/\/settings\/my-preferences$/);
    expect(errors).toEqual([]);
  });

  // F73: + New opens the page's dialog — from another page, and on the page itself (same route, new params)
  test("+ New opens the dialog: from the dashboard, and again on the page it lands on", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const newMenu = page.getByRole("button", { name: "New", exact: true });
    await newMenu.click();
    await page.getByRole("menuitem", { name: "Expense" }).click();
    await expect(page).toHaveURL(/\/expenses\?new=1/);
    const expense = page.getByTestId("new-expense-dialog");
    await expect(expense).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(expense).toBeHidden();
    await expect(page).not.toHaveURL(/new=1/);
    // already on /expenses: + New → Expense opens it again
    await newMenu.click();
    await page.getByRole("menuitem", { name: "Expense" }).click();
    await expect(expense).toBeVisible();
    await page.keyboard.press("Escape");
    await newMenu.click();
    await page.getByRole("menuitem", { name: "Import bank CSV" }).click();
    await expect(page.getByTestId("import-dialog")).toBeVisible();
  });
});

// The colour scheme (D43): System / Light / Dark under My Preferences. A freshly registered owner (a user
// preference — switching the shared owner's would turn the journeys beside this one dark), the browser set to
// light so a forced dark is visible, then a second browser for the same user: the stored choice follows them.
test.describe("Colour scheme", () => {
  test.use({ colorScheme: "light" });

  test("Dark forces dark over a light system, survives a reload and a new browser; System follows the OS", async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    const email = `theme-${stamp}@dev.test`;
    await page.goto("/register");
    await page.getByLabel("Name").fill(`Theme Owner ${stamp}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("e2e-password-12345");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    const html = page.locator("html");
    const appBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await appBg();

    await page.goto("/settings/my-preferences");
    await page.getByTestId("theme-select").click();
    await page.getByRole("option", { name: "Dark" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByText("Preferences saved")).toBeVisible();
    const dark = await appBg();
    expect(dark).not.toBe(light);

    // in the first HTML after a reload (the cookie) — not only after the client ran
    const response = await page.request.get("/dashboard");
    expect(await response.text()).toMatch(/<html[^>]*data-theme="dark"/);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await appBg()).toBe(dark);

    // another browser, no cookie: the stored choice is applied once signed in
    const other = await browser.newContext({ colorScheme: "light" });
    const second = await other.newPage();
    await second.goto("/login");
    await second.getByLabel("Email").fill(email);
    await second.getByLabel("Password").fill("e2e-password-12345");
    await second.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(second).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await expect(second.locator("html")).toHaveAttribute("data-theme", "dark");
    await other.close();

    // System: no attribute, the light OS decides again
    await page.getByTestId("theme-select").click();
    await page.getByRole("option", { name: "System" }).click();
    await expect(html).not.toHaveAttribute("data-theme");
    await expect.poll(appBg).toBe(light);
  });
});
