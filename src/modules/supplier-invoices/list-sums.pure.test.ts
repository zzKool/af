// F71: the footer Σ is shown only under a currency label that is true for it (lessons: *one currency for every Σ*).
import { describe, expect, it } from "vitest";
import { supplierInvoiceListSums } from "./list-sums";

const sums = { amountTotal: "2594.40", amountBase: "29800.00", open: "1297.20" };
const row = (currency: string, paidCurrency: string | null = null) => ({ currency, paidCurrency });

describe("supplier invoice list sums", () => {
  it("one currency: Σ total and Σ open in it, no base sum under that label", () => {
    expect(supplierInvoiceListSums([row("CHF"), row("CHF")], sums)).toEqual({
      amountTotal: "2594.40",
      open: "1297.20",
    });
  });

  it("several invoice currencies: only the base total — never CHF + EUR added up", () => {
    expect(supplierInvoiceListSums([row("CHF"), row("EUR")], sums)).toEqual({
      amountBase: "29800.00",
    });
  });

  it("a CHF invoice paid from a SEK row: its open is in SEK, so the set has two currencies", () => {
    expect(supplierInvoiceListSums([row("CHF", "SEK"), row("CHF")], sums)).toEqual({
      amountBase: "29800.00",
    });
  });

  it("an empty set or no sums pass through", () => {
    expect(supplierInvoiceListSums([], sums)).toEqual(sums);
    expect(supplierInvoiceListSums([row("CHF")], undefined)).toBeUndefined();
  });
});
