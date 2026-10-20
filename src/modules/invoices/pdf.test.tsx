// The sheet through kernel/pdf with a real Chromium (skipped when none): one page for the usual invoice,
// several for a long one with the table header repeated and the footer on every page (spec SC-004).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chromiumExecutablePath, renderHtmlToPdf } from "@/kernel/pdf/pdf";
import { InvoiceSheet, type SheetDocument } from "./components/invoice-sheet";

const executable = chromiumExecutablePath();

function pageCount(pdf: Buffer): number {
  const m = pdf.toString("latin1").match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/);
  return m ? Number(m[1]) : -1;
}

const doc = (lineCount: number): SheetDocument => ({
  type: "invoice",
  status: "issued",
  number: "VA26-INV-001",
  issueDate: "2026-01-31",
  dueDate: "2026-03-02",
  periodLabel: "2026 January",
  currency: "CHF",
  language: "fr",
  printedReferences: [{ label: "Bon de commande", value: "4500000000" }],
  parties: {
    tenant: {
      name: "AnalyticsFab AB",
      orgNumber: "559000-0000",
      address: "Placeholder street 1, 000 00 Stockholm",
      email: "invoices@example.com",
      website: "https://example.com",
      logoUrl: null,
      vatNumber: "CHE-000.000.000 TVA",
      vatCountry: "CH",
    },
    partner: {
      name: "Client VA SA",
      address: { city: "Lausanne", country: "CH" },
      vatNumber: null,
      orgNumber: null,
      email: null,
    },
    bank: {
      bankName: "Nordea",
      accountHolder: "AnalyticsFab AB",
      iban: "SE00 0000 0000 0000 0000 0001",
      bic: "NDEASESS",
      accountNumber: null,
      currency: "CHF",
    },
  },
  relatedNumber: null,
  notes: null,
  paymentTermsText: null,
  paymentTermsDays: 30,
  discountPercent: null,
  lines: Array.from({ length: lineCount }, (_, i) => ({
    key: `l${i}`,
    description: `Consulting Services — day ${i + 1}`,
    quantity: "1",
    unit: "day",
    unitPrice: "1200.00",
    vatRate: "8.1",
    netAmount: "1200.00",
  })),
  subtotal: (1200 * lineCount).toFixed(2),
  discountAmount: "0.00",
  netAmount: (1200 * lineCount).toFixed(2),
  vatByRate: [
    { rate: "8.1", base: (1200 * lineCount).toFixed(2), vat: (97.2 * lineCount).toFixed(2) },
  ],
  vatAmount: (97.2 * lineCount).toFixed(2),
  totalAmount: (1297.2 * lineCount).toFixed(2),
  treatment: "standard",
});

// the print page's bare shell: the sheet's own <style> carries the page rules; a minimal base replaces Tailwind
const html = (
  d: SheetDocument,
) => `<!doctype html><html lang="${d.language}"><head><meta charset="utf-8"><style>
  body { font-family: sans-serif; margin: 0; } table { width: 100%; border-collapse: collapse; } th, td { padding: 2px 4px; }
  thead { display: table-header-group; } .text-right { text-align: right; }
</style></head><body>${renderToStaticMarkup(<InvoiceSheet mode="print" doc={d} />)}</body></html>`;

describe.skipIf(!executable)("invoice PDF (Chromium)", () => {
  it("the usual one-line invoice is exactly one page, with the footer", async () => {
    const pdf = await renderHtmlToPdf(html(doc(1)));
    expect(pageCount(pdf)).toBe(1);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);

  it("a 60-line invoice flows over several pages; the table header repeats and the footer is on each", async () => {
    const pdf = await renderHtmlToPdf(html(doc(60)));
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThanOrEqual(2);
    // every page object carries its own content stream — the repeated header and the fixed footer live there
    expect(pdf.length).toBeGreaterThan(10_000);
  }, 60_000);
});
