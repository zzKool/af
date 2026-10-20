// Print mode of the sheet for the fixture invoice (specs/invoices/fixtures/sample-invoice.json) — the strings
// the Swiss client sees in French, the same layout in English, credit note and quote variants, VAT column rule.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { translator } from "@/kernel/i18n/translate";
import fixture from "../../../specs/invoices/fixtures/sample-invoice.json";
import {
  InvoiceSheet,
  type SheetDocument,
  sheetDate,
  sheetMoney,
  sheetQuantity,
} from "./components/invoice-sheet";

const inv = fixture.invoice;
const base: SheetDocument = {
  type: "invoice",
  status: "issued",
  number: inv.number,
  issueDate: inv.issueDate,
  dueDate: inv.dueDate,
  periodLabel: inv.periodLabel,
  currency: "CHF",
  language: "fr",
  printedReferences: [
    { label: "Bon de commande", value: "4500000000" },
    { label: "N° Fournisseur", value: "000000" },
  ],
  parties: {
    tenant: {
      name: fixture.tenant.name,
      orgNumber: fixture.tenant.orgNumber,
      address: "Placeholder street 1, 000 00 Stockholm, Sweden",
      email: fixture.tenant.email,
      website: fixture.tenant.website,
      logoUrl: null,
      vatNumber: "CHE-000.000.000 TVA",
      vatCountry: "CH",
    },
    partner: {
      name: fixture.partner.name,
      address: fixture.partner.address,
      vatNumber: null,
      orgNumber: null,
      email: null,
    },
    bank: {
      bankName: "Nordea",
      accountHolder: "AnalyticsFab AB",
      iban: "SE00 0000 0000 0000 0000 0001",
      bic: "NDEASESS",
      accountNumber: "211 53 13-5",
      currency: "CHF",
    },
  },
  relatedNumber: null,
  notes: null,
  paymentTermsText: null,
  paymentTermsDays: 30,
  discountPercent: null,
  lines: [
    {
      key: "l1",
      description: "Consulting Services",
      quantity: "20",
      unit: "day",
      unitPrice: "1200.00",
      vatRate: "8.1",
      netAmount: "24000.00",
    },
  ],
  subtotal: "24000.00",
  discountAmount: "0.00",
  netAmount: "24000.00",
  vatByRate: [{ rate: "8.1", base: "24000.00", vat: "1944.00" }],
  vatAmount: "1944.00",
  totalAmount: "25944.00",
  treatment: "standard",
};

const text = (doc: SheetDocument) =>
  renderToStaticMarkup(<InvoiceSheet mode="print" doc={doc} />)
    .replace(/<style>[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("the printed invoice — French (fixture expectedPrintFr)", () => {
  const html = text(base);

  it("title, number, dates, period, references", () => {
    expect(html).toContain("Facture");
    expect(html).toContain("VA26-001");
    expect(html).toContain("31 janvier 2026");
    expect(html).toContain("02 mars 2026");
    expect(html).toContain("Date d'échéance");
    expect(html).toContain("Période 2026 January");
    expect(html).toContain("Bon de commande 4500000000");
    expect(html).toContain("N° Fournisseur 000000");
    expect(html).toContain("N° org.: 559000-0000");
    expect(html).toContain("N° TVA: CHE-000.000.000 TVA");
  });

  it("the line, the money style and the totals", () => {
    expect(html).toContain("Consulting Services");
    expect(html).toContain("20 Jours");
    expect(html).toContain("CHF 1'200 "); // unit price without decimals
    expect(html).toContain("CHF 24'000.00");
    expect(html).toContain("TVA (8.1%)");
    expect(html).toContain("CHF 1'944.00");
    expect(html).toContain("Total CHF 25'944.00");
    expect(html).not.toContain("TVA %"); // every line at the registration rate → no VAT column
  });

  it("payment box and bank details of the invoice currency", () => {
    expect(html).toContain("Paiement dû dans les 30 jours à compter de la date de facturation.");
    expect(html).toContain("Veuillez indiquer le numéro de facture VA26-001.");
    expect(html).toContain("Banque Nordea");
    expect(html).toContain("Titulaire du compte AnalyticsFab AB");
    expect(html).toContain("IBAN SE00 0000 0000 0000 0000 0001");
    expect(html).toContain("BIC/SWIFT NDEASESS");
    expect(html).toContain("AnalyticsFab AB • invoices@example.com • https://example.com");
    expect(html).not.toContain("Autoliquidation");
  });
});

describe("the printed invoice — variants", () => {
  it("English: same layout, English strings, same money style", () => {
    const html = text({ ...base, language: "en" });
    expect(html).toContain("Invoice");
    expect(html).toContain("31 January 2026");
    expect(html).toContain("Due Date");
    expect(html).toContain("20 Days");
    expect(html).toContain("CHF 25'944.00");
    expect(html).toContain("Please reference invoice number VA26-001.");
  });

  it("VAT column appears when a line differs; two rates → two rows ascending; 0 % → no VAT row", () => {
    const two = text({
      ...base,
      lines: [
        base.lines[0],
        {
          key: "l2",
          description: "Books",
          quantity: "1",
          unit: "day",
          unitPrice: "200.00",
          vatRate: "2.6",
          netAmount: "200.00",
        },
      ],
      vatByRate: [
        { rate: "2.6", base: "200.00", vat: "5.20" },
        { rate: "8.1", base: "24000.00", vat: "1944.00" },
      ],
    });
    expect(two).toContain("TVA %");
    expect(two.indexOf("TVA (2.6%)")).toBeLessThan(two.indexOf("TVA (8.1%)"));
    const zero = text({
      ...base,
      vatByRate: [],
      vatAmount: "0.00",
      lines: [{ ...base.lines[0], vatRate: "0" }],
    });
    expect(zero).not.toContain("TVA (");
  });

  it("credit note: title, minus-prefixed amounts, reference to the original", () => {
    const html = text({
      ...base,
      type: "credit_note",
      number: "VA26-CN-001",
      relatedNumber: "VA26-001",
    });
    expect(html).toContain("Note de crédit");
    expect(html).toContain("−CHF 25'944.00");
    expect(html).toContain("Note de crédit pour la facture VA26-001");
  });

  it("quote: title, valid until, no payment box", () => {
    const html = text({ ...base, type: "quote", number: "VA26-QT-001" });
    expect(html).toContain("Devis");
    expect(html).toContain("Valable jusqu'au");
    expect(html).not.toContain("Coordonnées bancaires");
  });

  it("reverse charge and export sentences follow the treatment when VAT is 0", () => {
    const rc = text({
      ...base,
      language: "en",
      treatment: "reverse_charge",
      vatAmount: "0.00",
      vatByRate: [],
    });
    expect(rc).toContain("Reverse charge");
    const ex = text({
      ...base,
      language: "en",
      treatment: "export",
      vatAmount: "0.00",
      vatByRate: [],
    });
    expect(ex).toContain("no Swiss VAT");
    const std = text({ ...base, language: "en", treatment: "reverse_charge" }); // VAT charged → no sentence
    expect(std).not.toContain("Reverse charge");
  });

  it("draft: no number, DRAFT mark, the hint", () => {
    const html = text({ ...base, status: "draft", number: null, numberHint: "VA26-004" });
    expect(html).toContain("BROUILLON");
    expect(html).toContain("sera VA26-004");
  });

  it("formatting helpers", () => {
    const t = translator("fr");
    expect(sheetMoney("25944.00", "CHF")).toBe("CHF 25'944.00");
    expect(sheetMoney("1200.00", "CHF", true)).toBe("CHF 1'200");
    expect(sheetMoney("1200.50", "CHF", true)).toBe("CHF 1'200.50");
    expect(sheetMoney("60000.00", "SEK")).toBe("SEK 60 000,00");
    expect(sheetQuantity("1", "day", t)).toBe("1 Jour");
    expect(sheetQuantity("0.5", "day", t)).toBe("0.5 Jours");
    expect(sheetQuantity("20.0000", "day", t)).toBe("20 Jours");
    expect(sheetDate("2026-01-31", "fr")).toBe("31 janvier 2026");
    expect(sheetDate("2026-01-31", "en")).toBe("31 January 2026");
    expect(sheetDate("2026-01-31", "sv")).toBe("31 januari 2026");
  });
});
