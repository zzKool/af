// signedTotal — the sign rule the dashboard, the package and the Swiss VAT return share (lessons audit 27).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { creditSign, signedTotal } from "./signed";

describe("signedTotal", () => {
  it("a credit note takes back, an invoice (or a quote) adds", () => {
    expect(signedTotal("credit_note", "6486.00").toFixed(2)).toBe("-6486.00");
    expect(signedTotal("invoice", "25944.00").toFixed(2)).toBe("25944.00");
    expect(signedTotal("quote", "1.05").toFixed(2)).toBe("1.05");
    expect([creditSign("invoice"), creditSign("credit_note")]).toEqual([1, -1]);
  });

  it("an invoice and its full credit note net to zero", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000_00 }), (cents) => {
        const amount = (cents / 100).toFixed(2);
        expect(
          signedTotal("invoice", amount).add(signedTotal("credit_note", amount)).isZero(),
        ).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
