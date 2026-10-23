import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { expectToast, trackToasts, withToastReport } from "./fixtures/toasts";

const SHOTS = join(__dirname, "..", "specs", "accountant-package", "screenshots");

/** `E2E_SCREENSHOTS=1`: the journey leaves the PR's screenshots behind (definition of done §4.5). */
async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

// The accountant package (specs/accountant-package SC-004): two rows imported for this month, one of them left
// unlinked → /package shows the month with its live counts and the flag → Build → the job stores the zip → the
// version and Download appear. The accountant sees the page without Build.
const HEADER =
  "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

test.describe("Accountant package", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("the month-end checklist → Build → Download", async ({ page }) => {
    test.setTimeout(180_000); // the build job behind the Build step
    await trackToasts(page);
    await withToastReport(page, async () => {
      const today = new Date().toISOString().slice(0, 10);
      const period = today.slice(0, 7);
      const label = `${MONTHS[Number(today.slice(5, 7)) - 1]} ${today.slice(0, 4)}`;
      const stamp = String(Date.now()).slice(-6);

      // 1. two rows of this month, nothing links them
      await page.goto("/banking");
      await page.getByTestId("open-import").click();
      await page.getByTestId("import-file").setInputFiles({
        name: `PLUSGIROKONTO FTG 123 45 67-8 - ${today} ${stamp}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(
          [
            HEADER,
            `${today.replace(/-/g, "/")};-${stamp.slice(0, 3)},52;;;;Kortköp PKG ${stamp};PACKAGE E2E ${stamp};;;SEK;`,
            `${today.replace(/-/g, "/")};-${stamp.slice(3)},10;;;;Kortköp PKG ${stamp} B;PACKAGE E2E ${stamp} B;;;SEK;`,
          ].join("\n"),
          "utf8",
        ),
      });
      await expect(page.getByTestId("import-account")).toContainText("Plusgirokonto SEK");
      await page.getByTestId("import-run").click();
      await expect(page.getByTestId("import-summary")).toContainText("2 imported", {
        timeout: 20_000,
      });

      // 2. the page: this month with its counts and flags, the preview naming the unlinked rows
      await page.goto("/package");
      await expect(page.getByRole("heading", { name: "Accountant package" })).toBeVisible();
      // the months are a DataTable (F71): the row holds the month's cell, its state word and its flags
      const cell = page.locator(`[data-testid="package-period"][data-period="${period}"]`);
      const month = page.getByRole("row").filter({ has: cell });
      await expect(cell).toHaveText(label);
      await expect(month).toContainText("Flags to check");
      expect(Number(await month.getByTestId("package-flags").innerText())).toBeGreaterThanOrEqual(
        2,
      );
      await cell.click();
      // the docked panel: the period's preview, one primary (Build)
      const preview = page.getByTestId("package-preview");
      await expect(preview).toContainText(`Before sending — ${label}`);
      await expect(preview.getByTestId("package-flag-list")).toContainText("Unlinked bank lines", {
        timeout: 30_000,
      });
      await expect(preview.getByTestId("package-flag-list")).toContainText(`PKG ${stamp}`);
      await preview.getByRole("button", { name: "notes.md", exact: true }).click();
      await expect(preview.getByTestId("package-notes")).toContainText(
        `# Accountant package ${period}`,
      );
      await snap(page, "package-checklist");

      // 3. Build → queued → the job stores the zip → the version and Download
      await preview.getByTestId("package-build").click();
      await expectToast(page, `Build of ${label} queued`);
      await expect(preview.getByTestId("package-download")).toBeVisible({ timeout: 90_000 });
      await expect(preview.getByTestId("package-download")).toHaveAttribute(
        "title",
        new RegExp(`^Package_${period}`),
      );
      await expectToast(page, `Package_${period}`);
      const versions = preview.getByTestId("package-version");
      await expect(versions.first()).toContainText("Built");
      await expect(month.getByText(new RegExp(`^Package_${period}`))).toBeVisible();
      await expect(versions.first()).toContainText(`Package_${period}`);
      await expect(versions.first().getByTestId("package-version-download")).toBeVisible();
      await snap(page, "package-built");
    });
  });
});

test.describe("Accountant package — the accountant", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("sees the months and the versions, cannot build", async ({ page }) => {
    await page.goto("/package");
    await expect(page.getByRole("heading", { name: "Accountant package" })).toBeVisible();
    await expect(page.getByTestId("package-period").first()).toBeVisible();
    await expect(page.getByTestId("package-build")).toHaveCount(0);
  });
});
