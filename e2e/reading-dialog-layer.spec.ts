import { expect, test } from "@playwright/test";
import { minimalPdf } from "./fixtures/pdf";

// The owner, 2026-11-10: the reading dialog opened from a bank row on /banking showed the list's sticky column header
// across it. The docked panel is `position: sticky` — a stacking context — and the dialog portals inside it, so its
// z-50 only counted inside the dock, under the header's z-10. The dock now sits above the canvas (z-20). Invented
// row and paper (D51).
const HEADER =
  "Date;Amount;Sender;Recipient;Name;Additional details;Message;Own notes;Balance;Currency;";

test.use({ storageState: "e2e/.auth/owner.json" });

test("the reading dialog covers the bank list's sticky header", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const stamp = String(Date.now()).slice(-5);
  const today = new Date().toISOString().slice(0, 10);
  await page.goto("/banking");
  await page.getByTestId("open-import").click();
  await page.getByTestId("import-file").setInputFiles({
    name: `PLUSGIROKONTO FTG 123 45 67-8 - ${today} 11.00.00.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        HEADER,
        `${today.replace(/-/g, "/")};-1250,00;;;LAYER ${stamp} OFFICE;;Invoice ${stamp};;;SEK;`,
      ].join("\n"),
      "latin1",
    ),
  });
  await page.getByTestId("import-run").click();
  await expect(page.getByTestId("import-summary")).toContainText("1 imported", { timeout: 20_000 });
  await page.keyboard.press("Escape");
  await page.goto("/banking");
  await page
    .getByRole("row")
    .filter({ hasText: `LAYER ${stamp}` })
    .first()
    .click();
  await page.getByTestId("justify-file").setInputFiles({
    name: `layer-${stamp}.pdf`,
    mimeType: "application/pdf",
    buffer: minimalPdf(`Layer ${stamp}`),
  });
  await expect(page.getByTestId("reading-dialog")).toBeVisible({ timeout: 90_000 });
  // what is painted where the list's header sits: the dialog, not the header
  const onTop = await page.evaluate(() => {
    const head = document.querySelector("thead");
    if (!head) return "no header";
    const r = head.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + 40, r.top + r.height / 2);
    return hit?.closest("[data-testid=reading-dialog]") ? "dialog" : "header";
  });
  expect(onTop).toBe("dialog");
});
