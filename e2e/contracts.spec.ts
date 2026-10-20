import { expect, test } from "@playwright/test";

// Contract rate history happy path (specs/contracts US1): partner → contract → two rates → the first one is
// closed for the owner on the day before the second starts; states derive from today; overlap refused.
test.describe("Contract rates", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  const stamp = String(Date.now()).slice(-5);
  const name = `E2E Rates ${stamp}`;

  test("add a yearly rate change; the previous rate auto-closes; overlaps are refused", async ({
    page,
  }) => {
    await page.goto("/partners");
    await page.getByRole("button", { name: "Add partner" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill(name);
    await page.getByRole("textbox", { name: "Short code" }).fill(`R${stamp}`);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Partner created")).toBeVisible();
    await page.getByRole("link", { name }).click();
    await expect(page).toHaveURL(/\/partners\/[0-9a-f-]+$/);

    await page.getByRole("tab", { name: /Contracts/ }).click();
    await page.getByRole("button", { name: "+ New Contract" }).click();
    await page.getByLabel("Name").fill("BI consulting");
    await page.getByLabel("Start Date").fill("2025-01-01");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Contract created")).toBeVisible();
    await page.getByText("BI consulting", { exact: true }).click();
    const rates = page.getByTestId("contract-rates");
    await expect(rates).toBeVisible();
    await expect(rates.getByText("No rates yet")).toBeVisible();

    const addRate = async (from: string, rate: string) => {
      await rates.getByRole("button", { name: "Add rate" }).click();
      const form = rates.locator("form");
      await form.getByLabel("Valid from").fill(from);
      await form.getByLabel(/^Rate/).fill(rate);
      await form.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByText("Rate added").last()).toBeVisible();
    };

    await addRate("2025-01-01", "1000");
    await expect(rates.getByRole("row")).toHaveCount(2); // header + 1
    await expect(page.getByTestId("current-rate")).toContainText("1'000.00");

    await addRate("2026-01-01", "1200");
    const rows = rates.getByRole("row");
    await expect(rows).toHaveCount(3);
    // newest first; the 2025 rate was closed on 2025-12-31 by the server
    await expect(rows.nth(1).getByLabel("Valid from")).toHaveValue("2026-01-01");
    await expect(rows.nth(1).getByLabel("Valid to")).toHaveValue("");
    await expect(rows.nth(1)).toContainText("Current");
    await expect(rows.nth(2).getByLabel("Valid from")).toHaveValue("2025-01-01");
    await expect(rows.nth(2).getByLabel("Valid to")).toHaveValue("2025-12-31");
    await expect(rows.nth(2)).toContainText("Expired");
    await expect(page.getByTestId("current-rate")).toContainText("1'200.00");

    // an overlapping closed rate is refused and nothing changes
    await rates.getByRole("button", { name: "Add rate" }).click();
    const form = rates.locator("form");
    await form.getByLabel("Valid from").fill("2025-06-01");
    await form.getByLabel("Valid to").fill("2025-08-31");
    await form.getByLabel(/^Rate/).fill("1100");
    await form.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
      page.getByText("This rate overlaps an existing rate (2025-01-01 → 2025-12-31)"),
    ).toBeVisible();
    await form.getByRole("button", { name: "Cancel" }).click();
    await expect(rates.getByRole("row")).toHaveCount(3);

    // delete the future-proof way: the unused 2026 rate goes, the 2025 one stays
    await rows.nth(1).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Rate deleted")).toBeVisible();
    await expect(rates.getByRole("row")).toHaveCount(2);
    await expect(page.getByTestId("current-rate")).toContainText("No rate for today");
  });
});
