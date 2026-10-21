import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { trackToasts, withToastReport } from "./fixtures/toasts";

const SHOTS = join(__dirname, "..", "specs", "documents", "screenshots");

/** `E2E_SCREENSHOTS=1`: the journey leaves the PR's screenshots behind (definition of done §4.5). */
async function snap(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

// The document inbox (specs/documents US4, T017): three uploads, two of them the same bytes → the three rows
// reach *Ready*, the twins sit under *Duplicates* with *Duplicate of* the oldest → j / k move the pane → d
// archives, the bar says so, u brings it back → e opens the expense dialog pre-filled → the accountant reads,
// nothing more. The search on the journey's stamp keeps the parallel journeys' documents out of the way.
// (The mock OCR never fails: *OCR failed* and *stuck* are the unit tests'.)
const stamp = String(Date.now()).slice(-6);
const pdf = (label: string) => Buffer.from(`%PDF-1.4 e2e-inbox-${stamp}-${label}`);

async function upload(page: Page, name: string, bytes: Buffer) {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: bytes,
  });
}

test.describe("Document inbox — owner", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("states, duplicates, the keyboard, archive + undo, Make it…", async ({ page }) => {
    test.setTimeout(150_000);
    await trackToasts(page);
    await withToastReport(page, async () => {
      // 1. three uploads, the third the same bytes as the first (Upload anyway)
      await page.goto("/documents");
      await upload(page, `inbox-a-${stamp}.pdf`, pdf("a"));
      await expect(page.getByRole("button", { name: "Upload another" })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("button", { name: "Upload another" }).click();
      await upload(page, `inbox-b-${stamp}.pdf`, pdf("b"));
      await expect(page.getByRole("button", { name: "Upload another" })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("button", { name: "Upload another" }).click();
      await upload(page, `inbox-c-${stamp}.pdf`, pdf("a"));
      const card = page.getByTestId("upload-duplicate");
      await expect(card).toBeVisible({ timeout: 15_000 });
      await card.getByRole("button", { name: "Upload anyway" }).click();
      await expect(page.getByRole("button", { name: "Upload another" })).toBeVisible({
        timeout: 15_000,
      });

      // 2. the library links the inbox; the inbox lists the three, Ready once the OCR ran
      await expect(page.getByTestId("documents-inbox-link")).toContainText(/Inbox \(\d+\)/);
      await page.getByTestId("documents-inbox-link").click();
      await expect(page).toHaveURL(/\/documents\/inbox$/);
      await expect(page.getByRole("heading", { name: "Document inbox" })).toBeVisible();
      await page.getByTestId("inbox-search").fill(stamp);
      const rows = page.getByTestId("inbox-row");
      await expect(rows).toHaveCount(3);
      await page.getByRole("heading", { name: "Document inbox" }).click(); // out of the search field
      await expect(async () => {
        await page.keyboard.press("r"); // refresh until the mock OCR has run on the three
        await expect(page.locator('[data-inbox-state="ready"]')).toHaveCount(3, { timeout: 2_000 });
      }).toPass({ timeout: 45_000 });

      // 3. the twins: both under Duplicates, the younger captioned with the oldest's key
      await page.getByTestId("inbox-tab-duplicates").click();
      await expect(rows).toHaveCount(2);
      await expect(page.getByTestId("inbox-dup")).toHaveCount(1);
      await expect(page.getByTestId("inbox-dup")).toContainText(/Duplicate of exp_/);
      await page.getByTestId("inbox-tab-all").click();
      await expect(rows).toHaveCount(3);

      // 4. j / k move the pane
      const paneKey = page.getByTestId("inbox-pane-key");
      const first = await paneKey.innerText();
      await page.keyboard.press("j");
      await expect(paneKey).not.toHaveText(first);
      await page.keyboard.press("k");
      await expect(paneKey).toHaveText(first);
      await snap(page, "inbox");

      // 5. d archives the open row, the bar says so; u restores it
      await page.keyboard.press("d");
      await expect(page.getByTestId("inbox-undo")).toContainText("Archived 1 document(s)");
      await expect(rows).toHaveCount(2);
      await page.keyboard.press("u");
      await expect(rows).toHaveCount(3);
      await expect(page.getByTestId("inbox-undo")).toHaveCount(0);

      // 6. e: Make it… Expense, pre-filled from the OCR facts, the document pre-selected
      await expect(page.getByTestId("inbox-pane")).toBeVisible();
      await snap(page, "inbox-pane");
      await page.keyboard.press("e");
      const dialog = page.getByTestId("new-expense-dialog");
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId("expense-amount")).not.toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();

      // 7. the help
      await page.keyboard.press("?");
      await expect(page.getByTestId("inbox-help")).toContainText("u / z");
      await snap(page, "inbox-help");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("inbox-help")).not.toBeVisible();
    });
  });
});

test.describe("Document inbox — accountant", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("reads the queue, changes nothing", async ({ page }) => {
    await page.goto("/documents/inbox");
    await expect(page.getByRole("heading", { name: "Document inbox" })).toBeVisible();
    await expect(page.getByTestId("inbox-row-check")).toHaveCount(0);
    const pane = page.getByTestId("inbox-pane");
    if (await pane.isVisible()) {
      await expect(page.getByTestId("inbox-actions").getByRole("button")).toHaveCount(0);
      const key = await page.getByTestId("inbox-pane-key").innerText();
      await page.keyboard.press("d");
      await expect(page.getByTestId("inbox-undo")).toHaveCount(0);
      await expect(page.getByTestId("inbox-pane-key")).toHaveText(key);
    }
    await page.keyboard.press("?");
    await expect(page.getByTestId("inbox-help").locator("kbd")).toHaveCount(3);
  });
});
