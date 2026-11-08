import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const SHOTS = join(__dirname, "..", "specs", "dashboard", "screenshots");

async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

// Work — the monthly close (F137, specs/dashboard US4): the rail's Work opens the month with its five steps, the
// open step's card, Also waiting and the past months; ‹ › move between months. The figures are the seed's — the
// steps' rules are the unit and DB tests' business; here the page holds together. The accountant has no Work.
test.describe("Work — the owner", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("the rail's Work opens the close: five steps, a card, the past months, another month", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: /^Work/ })
      .click();
    await expect(page).toHaveURL(/\/work/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/is \d+ % done/);
    const steps = page.getByTestId("work-steps").getByRole("button");
    await expect(steps).toHaveCount(5);
    await expect(page.getByTestId("work-step-card")).toBeVisible();
    // another step's card on a click
    await steps.nth(3).click();
    await expect(page.getByTestId("work-step-card")).toHaveAttribute("data-step", "expenses");
    await expect(page.getByTestId("work-past")).toBeVisible();
    await expect(page.getByTestId("work-also")).toBeVisible();
    await snap(page, "work");

    const month = await page.getByTestId("work-page").getAttribute("data-month");
    await page.getByRole("link", { name: "Previous month" }).click();
    await expect(page.getByTestId("work-page")).not.toHaveAttribute("data-month", month ?? "");
  });
});

test.describe("Work — the accountant", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("has no Work: the rail does not show it, the address leads to the dashboard", async ({
    page,
  }) => {
    await page.goto("/work");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: /^Work/ }),
    ).toHaveCount(0);
  });
});
