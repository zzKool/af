// F71: the screens moved to the D40 kit (formatMoney, StateLabel, CodeChip) — the printed document must not move
// with them. The PDF is Chromium's render of this markup (`/print/invoice/[id]` → <InvoiceSheet mode="print">), so
// identical markup is an identical PDF. The snapshots were written from `main` BEFORE the kit change and are
// committed; a diff here is a change to every issued invoice's PDF — it needs its own decision, never an update.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import fixture from "../../../specs/invoices/fixtures/sample-invoice.json";
import { InvoiceSheet, type SheetDocument } from "./components/invoice-sheet";

const inv = fixture.invoice;

/** The fixture invoice as it is issued: a Swiss client, CHF, 8.1 %, references, bank box. */
const issued: SheetDocument = {
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

/** A Swedish-language EUR credit note with a discount and a reverse-charge sentence — the other branches. */
const creditNote: SheetDocument = {
  ...issued,
  type: "credit_note",
  number: "VA26-CN-001",
  language: "sv",
  currency: "EUR",
  relatedNumber: "VA26-INV-001",
  notes: "Kreditering av januari.",
  discountPercent: "5",
  lines: [
    {
      key: "c1",
      description: "Credit: Consulting Services",
      quantity: "-2.5",
      unit: "day",
      unitPrice: "1100.00",
      vatRate: "0",
      netAmount: "-2750.00",
    },
  ],
  subtotal: "-2750.00",
  discountAmount: "-137.50",
  netAmount: "-2612.50",
  vatByRate: [{ rate: "0", base: "-2612.50", vat: "0.00" }],
  vatAmount: "0.00",
  totalAmount: "-2612.50",
  treatment: "reverse_charge",
};

const html = (doc: SheetDocument) => renderToStaticMarkup(<InvoiceSheet mode="print" doc={doc} />);

describe("the printed sheet is unchanged by the screens' kit (F71)", () => {
  it("an issued invoice, French", async () => {
    await expect(html(issued)).toMatchFileSnapshot("__snapshots__/print-identity/invoice-fr.html");
  });

  it("the same invoice, English", async () => {
    await expect(html({ ...issued, language: "en" })).toMatchFileSnapshot(
      "__snapshots__/print-identity/invoice-en.html",
    );
  });

  it("a credit note, Swedish, EUR, discount, reverse charge", async () => {
    await expect(html(creditNote)).toMatchFileSnapshot(
      "__snapshots__/print-identity/credit-note-sv.html",
    );
  });

  it("a quote", async () => {
    await expect(
      html({ ...issued, type: "quote", number: "VA26-QUO-001", language: "en" }),
    ).toMatchFileSnapshot("__snapshots__/print-identity/quote-en.html");
  });
});
