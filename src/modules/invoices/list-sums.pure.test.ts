// F71: the footer Σ is shown only under a currency label that is true for it.
import { describe, expect, it } from "vitest";
import { invoiceListSums } from "./list-sums";

const sums = { totalAmount: "35944.00", totalBase: "362000.00", remaining: "10000.00" };

describe("invoice list sums", () => {
  it("one document currency: Σ total and Σ remaining in it, no base-currency sum under that label", () => {
    expect(invoiceListSums(["CHF", "CHF"], sums)).toEqual({
      totalAmount: "35944.00",
      remaining: "10000.00",
    });
  });

  it("several currencies: never CHF + EUR added up — only the base-currency total", () => {
    expect(invoiceListSums(["CHF", "EUR", "CHF"], sums)).toEqual({ totalBase: "362000.00" });
  });

  it("an empty set or no sums pass through", () => {
    expect(invoiceListSums([], sums)).toEqual(sums);
    expect(invoiceListSums(["CHF"], undefined)).toBeUndefined();
  });
});
