import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { devices, expect, type Page, test } from "@playwright/test";

const SHOTS = join(__dirname, "..", "specs", "expenses", "screenshots");

async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

/** An invented till receipt (D51) — fresh bytes each run (a few after IEND), so it is never a duplicate. */
function receipt(stamp: string): Buffer {
  return Buffer.concat([
    readFileSync(join(__dirname, "fixtures", "invented-receipt.png")),
    Buffer.from(stamp),
  ]);
}

// Phone — snap a receipt (F142, the board *Phone*): on a phone-sized screen, /m takes a photo (a file here), the
// mock reads it with the receipt model (D78: a photo, no type asked), the check step shows what was read, one tap
// on *My own card* saves the expense → the saved step names its key and what the company owes. The group is the
// journey's own trip.
test.describe("Phone — snap a receipt", () => {
  // a phone's screen and touch, in the project's Chromium (the device's own browser type would force a new worker)
  const { defaultBrowserType: _browser, ...phone } = devices["iPhone 13"];
  test.use({ ...phone, storageState: "e2e/.auth/owner.json" });

  test("photo → read → check → who paid → saved", async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = crypto.randomUUID().slice(0, 8);
    const trip = `E2E Phone ${stamp}`;
    await page.goto("/expenses/groups");
    await page.getByTestId("open-new-group").click();
    await page.getByTestId("group-description").fill(trip);
    await page.getByTestId("save-group").click();
    await expect(page.getByRole("link", { name: trip })).toBeVisible();

    await page.goto("/m");
    await expect(page.getByRole("heading", { name: "Snap a receipt" })).toBeVisible();
    await snap(page, "phone-snap");
    await page.getByTestId("phone-file").setInputFiles({
      name: `receipt-${stamp}.png`,
      mimeType: "image/png",
      buffer: receipt(stamp),
    });
    const check = page.getByTestId("phone-check");
    await expect(check).toBeVisible({ timeout: 60_000 });
    // the mock's receipt reading (invented): ICA Maxi · 2026-03-14 · 342.50 SEK
    await expect(page.getByTestId("phone-from")).toHaveValue("ICA Maxi");
    await expect(page.getByTestId("phone-amount")).toHaveValue("342.50");
    await expect(page.getByTestId("phone-date")).toHaveValue("2026-03-14");
    const group = page.getByTestId("phone-group");
    const value = await group.locator("option", { hasText: trip }).getAttribute("value");
    await group.selectOption(value ?? "");
    const category = page.getByTestId("phone-category");
    await category.selectOption({ index: 1 });
    await snap(page, "phone-check");
    await page.locator('[data-testid="phone-paid"][data-kind="private"]').first().click();

    const saved = page.getByTestId("phone-saved");
    await expect(saved).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("phone-saved-key")).toHaveText(/^Ex\d+-/);
    await expect(page.getByTestId("phone-owed")).toContainText("SEK");
    await snap(page, "phone-saved");
    await page.getByTestId("phone-next").click();
    await expect(page.getByTestId("phone-capture")).toHaveAttribute("data-step", "snap");
  });
});
