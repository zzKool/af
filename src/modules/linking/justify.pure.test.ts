// The compare card's rules (specs/justify/spec.md US1): what the row and the reading say side by side, and which
// kind the facts propose. Invented values (D51).
import { describe, expect, it } from "vitest";
import {
  compareRowToReading,
  isCardPurchase,
  monthOf,
  NO_PROOF_BAS,
  proposeKind,
  type RowForJustify,
} from "./justify-rules";

const row = (over: Partial<RowForJustify> = {}): RowForJustify => ({
  id: "r1",
  bookingDate: "2026-07-08",
  amount: "-1297.20",
  currency: "SEK",
  amountBase: "-1297.20",
  description: "SKATTEPUNKTEN OFFICE",
  counterpartyKey: "SKATTEPUNKTEN OFFICE",
  bankAccountId: "acc",
  accountLabel: "Plusgirokonto SEK",
  ...over,
});

describe("compareRowToReading", () => {
  it("amounts equal, two days apart, a supplier invoice", () => {
    const card = compareRowToReading(row(), {
      invoiceTotal: 1297.2,
      currency: "sek",
      invoiceDate: "2026-07-06",
      vendorName: "Skattepunkten Office Services AB",
      vendorTaxId: "SE556677889901",
      invoiceNumber: "2026-071",
    });
    expect(card).toMatchObject({
      kind: "supplier_invoice",
      documentAmount: "1297.20",
      documentCurrency: "SEK",
      rowAmount: "1297.20",
      delta: "0.00",
      equal: true,
      currencyDiffers: false,
      documentDate: "2026-07-06",
      days: 2,
      vendorName: "Skattepunkten Office Services AB",
      vatNumber: "SE556677889901",
      invoiceNumber: "2026-071",
    });
  });

  it("an amount off by 7.20 is shown, never a block", () => {
    const card = compareRowToReading(row(), { invoiceTotal: 1290, currency: "SEK" });
    expect(card.delta).toBe("-7.20");
    expect(card.equal).toBe(false);
  });

  it("another currency: both amounts, no delta (the bank's rate applies, D26)", () => {
    const card = compareRowToReading(row({ amount: "-523.17" }), {
      invoiceTotal: 45,
      currency: "CHF",
      transactionDate: "2026-07-08T10:00:00",
    });
    expect(card).toMatchObject({
      documentAmount: "45.00",
      documentCurrency: "CHF",
      rowAmount: "523.17",
      delta: null,
      currencyDiffers: true,
      days: 0,
    });
  });

  it("no reading (the OCR failed): the row's side only", () => {
    const card = compareRowToReading(row(), {});
    expect(card).toMatchObject({
      documentAmount: null,
      documentCurrency: null,
      delta: null,
      equal: false,
      days: null,
      vendorName: null,
    });
  });
});

describe("proposeKind", () => {
  it("an invoice number or a VAT number → supplier invoice", () => {
    expect(proposeKind(row(), { invoiceNumber: "2026-071" })).toBe("supplier_invoice");
    expect(proposeKind(row(), { vendorTaxId: "CHE-123.456.789" })).toBe("supplier_invoice");
  });
  it("a card purchase → expense, whatever the reading — even an invoice-shaped cloud bill", () => {
    const card = row({ description: "Kortköp 260727 OPENAI *CHATGPT SUBS" });
    expect(isCardPurchase(card)).toBe(true);
    expect(proposeKind(card, {})).toBe("expense");
    expect(proposeKind(card, { merchantName: "OpenAI" })).toBe("expense");
    expect(
      proposeKind(card, {
        vendorName: "Northwind Cloud AB",
        vendorTaxId: "SE556000000001",
        invoiceNumber: "G100200300",
      }),
    ).toBe("expense");
  });
  it("a merchant read with no vendor → expense; otherwise a supplier invoice", () => {
    expect(proposeKind(row(), { merchantName: "SJ" })).toBe("expense");
    expect(proposeKind(row(), { vendorName: "Acme AB" })).toBe("supplier_invoice");
    expect(proposeKind(row(), {})).toBe("supplier_invoice");
  });
});

describe("the small rules", () => {
  it("the row's month and the reasons' accounts", () => {
    expect(monthOf("2026-07-08")).toBe("2026-07");
    expect(NO_PROOF_BAS.fee).toBe("657");
    expect(NO_PROOF_BAS.interest).toBe("831");
    expect(NO_PROOF_BAS.other).toBeNull();
  });
});
