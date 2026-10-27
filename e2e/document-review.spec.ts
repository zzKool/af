import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, request, test } from "@playwright/test";
import { minimalPdf } from "./fixtures/pdf";

/**
 * Uploads a small PDF through the library and opens its review page — the journey owns its document, so a
 * parallel journey deleting its own upload, or an issued invoice's generated PDF landing first in the list,
 * cannot change what this one sees.
 */
async function openOwnDocument(page: Page, real = false): Promise<void> {
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  // random, not the clock: parallel journeys starting in the same millisecond would upload the same bytes (a duplicate)
  const stamp = crypto.randomUUID().slice(0, 8);
  const name = `e2e-review-${stamp}.pdf`;
  await page.getByTestId("upload-type").selectOption("expense"); // no default type (D52)
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/pdf",
    // `real`: a one-page PDF pdf.js renders (F106 — the preview must load); else the bytes the other journeys use
    buffer: real ? minimalPdf(name) : Buffer.from(`%PDF-1.4 ${name}`),
  });
  await expect(page.getByRole("button", { name: "Upload another" })).toBeVisible({
    timeout: 15_000,
  });
  const row = page.getByRole("row").filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator("td a[href^='/documents/']").first().click();
  await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/);
}

test.describe("Document review page — owner", () => {
  test.use({ storageState: "e2e/.auth/owner.json" });

  test("the type drives the reading: expense → invoice swaps the key and reads it again (D52)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openOwnDocument(page);
    const key = page.getByTestId("document-review-key");
    await expect(key).toHaveText(/^exp_\d{8}_\d{3}$/);
    const upload = (await key.textContent()) ?? "";
    // the mock OCR reads it as a receipt; the page follows the reading on its own
    await expect(page.getByTestId("document-review-state")).toHaveText(/Ready/, {
      timeout: 30_000,
    });

    await page.locator("#prefixType").click();
    await page.getByRole("option", { name: "Invoice" }).click();

    // same date, same number; the invoice model reads it, the page lands on Ready again with the invoice's fields
    await expect(key).toHaveText(upload.replace(/^exp_/, "inv_"));
    await expect(page.getByTestId("document-review-state")).toHaveText(/Ready/, {
      timeout: 30_000,
    });
    await expect(page.locator("#invoiceNumber")).toBeVisible();
    await expect(page.getByTestId("billed-to")).toBeVisible();
  });

  test("owner can navigate to a document detail page from list", async ({ page }) => {
    await openOwnDocument(page);

    // the title row (D40, F71): the key with its derived state as icon + word
    await expect(page.getByTestId("document-review-state")).toBeVisible();

    // Verify review controls are present for owner
    const reviewButton = page.getByRole("button", {
      name: /Mark as Reviewed|Reviewed|Update Review|Marking/,
    });
    const reviewText = page.getByText(/Awaiting review|Reviewed/);
    // Either button or status text should be visible
    await expect(reviewButton.or(reviewText).first()).toBeVisible();
  });

  test("document detail page shows preview and form areas", async ({ page }) => {
    await openOwnDocument(page);

    // Auto-save status indicator should be present
    await expect(page.getByText(/Auto-saved|Saving|Save failed/)).toBeVisible();

    // the preview region: the viewer (keyboard-accessible document role) while it loads, or its "Unable to load
    // preview" state — the journey's file is a few bytes, not a parseable PDF, and pdf.js may reject it before
    // this line runs (a race that failed main twice)
    await expect(
      page.locator("[role='document']").or(page.getByText("Unable to load preview")).first(),
    ).toBeVisible();

    // Verify financial or relationship form section is rendered
    const financialHeading = page.getByText("Financial Details");
    const rawTextArea = page.locator("textarea[readonly]");
    await expect(financialHeading.or(rawTextArea).first()).toBeVisible();
  });

  // F106 (audit D2, D15): the bytes come from the authenticated route, so the preview loads — through the compose
  // network or Azurite alike, no SAS URL in the browser — and a request without a session gets nothing.
  test("the preview loads through /api/documents/[id]/file; no session, no file", async ({
    page,
    baseURL,
  }) => {
    await openOwnDocument(page, true);
    const id = page.url().match(/\/documents\/([a-f0-9-]+)/)?.[1];
    expect(id).toBeTruthy();

    // the viewer rendered a page (react-pdf's canvas), not "Unable to load preview"
    await expect(page.locator("[role='document'] canvas").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Unable to load preview")).toHaveCount(0);

    // the route itself: the session's cookies → the PDF, inline; download=1 → an attachment
    const inline = await page.request.get(`/api/documents/${id}/file`);
    expect(inline.status()).toBe(200);
    expect(inline.headers()["content-type"]).toBe("application/pdf");
    expect(inline.headers()["content-disposition"]).toMatch(/^inline; filename=/);
    expect(inline.headers()["cache-control"]).toContain("no-store");
    expect((await inline.body()).subarray(0, 5).toString()).toBe("%PDF-");
    const download = await page.request.get(`/api/documents/${id}/file?download=1`);
    expect(download.headers()["content-disposition"]).toMatch(/^attachment; filename=/);

    // no session: 401, no bytes
    const anonymous = await request.newContext({ baseURL });
    const refused = await anonymous.get(`/api/documents/${id}/file`);
    expect(refused.status()).toBe(401);
    await anonymous.dispose();
  });

  test("document detail page has back navigation", async ({ page }) => {
    await openOwnDocument(page);

    // D40: the breadcrumb is the way back (no back link of the page's own under a named parent)
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Documents" })
      .click();
    await expect(page).toHaveURL(/\/documents$/);
  });

  test("document review page passes automated accessibility checks", async ({ page }) => {
    await openOwnDocument(page);
    // Wait for content to load
    await expect(page.getByTestId("document-review-state")).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .exclude(".react-pdf__Document") // Exclude PDF canvas elements (third-party)
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("Make it… → Expense: the receipt becomes an expense, the page says what it became", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openOwnDocument(page);
    // the owner ticks *Reverse charge* on the document (D54) — what it becomes carries the tag (F91)
    await expect(page.getByTestId("document-review-state")).toHaveText(/Ready/, {
      timeout: 30_000,
    });
    const reverseCharge = page.getByTestId("reverse-charge");
    await reverseCharge.click();
    await expect(reverseCharge).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Reverse charge (saving…)")).toHaveCount(0, { timeout: 10_000 });
    const makeIt = page.getByTestId("make-it");
    await expect(makeIt).toBeVisible();
    await expect(makeIt.getByTestId("make-it-file")).toBeEnabled();
    await makeIt.getByTestId("make-it-expense").click();

    // the expense dialog, pre-filled once the mock OCR has run (ICA Maxi, 342.50 SEK) — or empty when the
    // job has not finished yet: the test fills what is missing and the service does the rest
    const dialog = page.getByTestId("new-expense-dialog");
    await expect(dialog).toBeVisible();
    const pick = async (label: string, option: RegExp | string) => {
      await dialog.getByLabel(label, { exact: true }).click();
      await page.getByRole("option", { name: option }).click();
    };
    const stamp = String(Date.now()).slice(-5);
    await pick("Group", "+ New group…");
    await page.getByTestId("new-group-description").fill(`Receipts ${stamp}`);
    await pick("Paid by", "Private SE");
    await pick("Category", /^580/);
    if (!(await page.getByTestId("expense-description").inputValue())) {
      await page.getByTestId("expense-description").fill("ICA Maxi");
    }
    if (!(await page.getByTestId("expense-amount").inputValue())) {
      await page.getByTestId("expense-amount").fill("342.50");
    }
    await expect(page.getByTestId("create-expense")).toBeEnabled();
    await page.getByTestId("create-expense").click();
    await expect(page.getByText(/-01 created/)).toBeVisible({ timeout: 15_000 });

    // the page re-reads: Became expense Ex…, no Make it… any more, the chip in the header links to it
    const became = page.getByTestId("document-became");
    await expect(became).toBeVisible({ timeout: 15_000 });
    await expect(became).toContainText(/Became expense Ex\d+-\w+-\d+/);
    await expect(page.getByTestId("make-it")).toHaveCount(0);
    const href = await page.getByTestId("became-chip").getAttribute("href");
    expect(href).toMatch(/^\/expenses\?open=[0-9a-f-]{36}$/);

    // FR-005: the library says it too — Expense {key}, linking to the same expense
    const docKey = (await page.getByTestId("document-review-key").textContent())?.trim() ?? "";
    await page.goto(`/documents?q=${encodeURIComponent(docKey)}`);
    const libraryBecame = page.getByTestId("document-became-link");
    await expect(libraryBecame).toContainText(/Expense Ex\d+-\w+-\d+/);
    await expect(libraryBecame).toHaveAttribute("href", href ?? "");

    await page.goto(href ?? "/expenses");
    await expect(page.getByTestId("expense-panel")).toBeVisible();
    await expect(page.getByTestId("panel-key")).toContainText(/Ex\d+-\w+-\d+/);
    await expect(page.getByTestId("panel-reverse-charge")).toHaveText("Reverse charge");
  });

  test("documents list shows each row's derived state as icon + word", async ({ page }) => {
    await openOwnDocument(page);
    await page.goto("/documents");
    // F71: the inbox's word through the module's one family map — Ready until it is decided, never a pill
    const state = page.getByTestId("document-state").first();
    await expect(state).toBeVisible();
    await expect(state).toHaveText(
      /Needs OCR|Processing|OCR failed|Ready|Archived|Filed|generated/,
    );
    await expect(state.locator("[data-state-family]")).toHaveAttribute(
      "data-state-family",
      /attention|progress|done|neutral/,
    );
  });
});

test.describe("Document review page — accountant blocked from detail", () => {
  test.use({ storageState: "e2e/.auth/accountant.json" });

  test("accountant can view the documents list but cannot upload", async ({ page }) => {
    await page.goto("/documents");
    // Story 5.4: accountants have read-only access to the (financial) documents library — the list shows,
    // the upload zone does not. The rows may carry detail links (generated PDFs and bank statements are
    // financial), so the assertion is on the write surface, not on the links.
    await expect(page).toHaveURL(/\/documents/);
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  });
});
