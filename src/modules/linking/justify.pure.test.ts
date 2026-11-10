// The compare card's rules (specs/justify/spec.md US1): what the row and the reading say side by side, and which
// kind the facts propose. Invented values (D51).
import { describe, expect, it } from "vitest";
import {
  compareRowToReading,
  DEFAULT_PAPER,
  greenChecks,
  isCardPurchase,
  monthOf,
  NO_PROOF_BAS,
  NO_PROOF_REASONS,
  noProofBas,
  PAPERS,
  paperOfPrefixType,
  paperOfReading,
  prefixTypeOfPaper,
  proposedPartnerRole,
  proposeKind,
  proposeVendorRule,
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
    expect(NO_PROOF_BAS.fee).toBe("6570");
    expect(NO_PROOF_BAS.interest).toBe("8310");
    expect(NO_PROOF_BAS.other).toBeNull();
  });
  it("D84: the reasons propose the owner's accounts — tax by the account's country, salary 7220", () => {
    expect(noProofBas("tax", "SEK")).toBe("1630");
    expect(noProofBas("tax", "chf")).toBe("2890");
    expect(noProofBas("tax", "EUR")).toBe("1630");
    expect(noProofBas("salary", "SEK")).toBe("7220");
    expect(noProofBas("fee", "CHF")).toBe("6570");
    expect(noProofBas("client", "CHF")).toBeNull();
  });
});

describe("F129 — the reasons' partner by type, the vendor rule (D74)", () => {
  it("proposedPartnerRole: fee / interest → the bank, tax by the account's currency, salary → the owner, client → the picker, other → none", () => {
    expect(proposedPartnerRole("fee", "SEK")).toBe("bank");
    expect(proposedPartnerRole("interest", "SEK")).toBe("bank");
    expect(proposedPartnerRole("tax", "SEK")).toBe("tax_agency_se");
    expect(proposedPartnerRole("tax", "CHF")).toBe("tax_agency_ch");
    expect(proposedPartnerRole("tax", "chf")).toBe("tax_agency_ch");
    expect(proposedPartnerRole("tax", "EUR")).toBe("tax_agency_se");
    expect(proposedPartnerRole("salary", "CHF")).toBe("owner");
    expect(proposedPartnerRole("client", "SEK")).toBe("client");
    expect(proposedPartnerRole("other", "SEK")).toBeNull();
    expect(NO_PROOF_REASONS).toContain("client");
    expect(NO_PROOF_BAS.client).toBeNull();
  });
  it("proposeVendorRule: the key, contains on the counterparty key, the partner and the category", () => {
    expect(proposeVendorRule("SKATTEPUNKTEN OFFICE", "p1", "6540")).toEqual({
      name: "SKATTEPUNKTEN OFFICE",
      matchType: "contains",
      matchField: "counterparty_key",
      matchPattern: "SKATTEPUNKTEN OFFICE",
      partnerId: "p1",
      basCode: "6540",
    });
    expect(proposeVendorRule("MSFT", "p2", null).basCode).toBeNull();
  });
});

describe("F131 — the paper question (D75) and the green checks", () => {
  it("the paper picks the upload type, Invoice by default (O5); a stored type reads back as its paper", () => {
    expect(DEFAULT_PAPER).toBe("invoice");
    expect(PAPERS).toEqual(["invoice", "receipt"]);
    expect(prefixTypeOfPaper("invoice")).toBe("invoice");
    expect(prefixTypeOfPaper("receipt")).toBe("expense");
    expect(paperOfPrefixType("expense")).toBe("receipt");
    expect(paperOfPrefixType("invoice")).toBe("invoice");
    expect(paperOfPrefixType(undefined)).toBe("invoice");
    // T030: the model that read it speaks first — an expense PDF read by the invoice model is an invoice
    expect(paperOfReading("prebuilt-invoice", "expense")).toBe("invoice");
    expect(paperOfReading("prebuilt-receipt", "invoice")).toBe("receipt");
    expect(paperOfReading("prebuilt-layout", "expense")).toBe("receipt");
    expect(paperOfReading(null, "expense")).toBe("receipt");
  });

  it("greenChecks: a ✓ line only for what was read and nothing warned about — every claim true", () => {
    const reading = {
      vendorName: "Skattepunkten Office Services AB",
      invoiceTotal: 1297.2,
      currency: "SEK",
      invoiceDate: "2026-07-06",
    };
    expect(greenChecks(row(), reading, true, [])).toEqual([
      { code: "amount", kind: "equal" },
      { code: "days", days: 2 },
      { code: "vendor" },
    ]);
    // a warning takes its line away
    expect(greenChecks(row(), reading, true, ["amount_same", "date"])).toEqual([
      { code: "vendor" },
    ]);
    // within the tolerance but not equal: the difference is named, never "equal"
    expect(greenChecks(row(), { ...reading, invoiceTotal: 1297.18 }, false, [])).toEqual([
      { code: "amount", kind: "within", difference: "-0.02", currency: "SEK" },
      { code: "days", days: 2 },
      { code: "vendor" },
    ]);
    // another currency inside the FX tolerance: said as such
    expect(greenChecks(row(), { ...reading, currency: "EUR" }, true, [])[0]).toEqual({
      code: "amount",
      kind: "fx",
      currency: "EUR",
    });
    // nothing read, no partner: nothing claimed
    expect(greenChecks(row(), {}, false, [])).toEqual([]);
    // a partner picked without a vendor read still claims the vendor line when the check is silent
    expect(greenChecks(row(), {}, true, [])).toEqual([{ code: "vendor" }]);
    // an amount without a currency is never claimed (F61-b)
    expect(greenChecks(row(), { invoiceTotal: 10 }, false, ["currency_unread"])).toEqual([]);
  });
});
