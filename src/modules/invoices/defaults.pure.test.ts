// toCurrency — a stored currency code is parsed against CURRENCIES, never cast (lessons audit 30).
import { describe, expect, it } from "vitest";
import { toCurrency } from "./defaults";

describe("toCurrency", () => {
  it("keeps a known code", () => {
    for (const c of ["SEK", "CHF", "EUR", "USD"] as const) expect(toCurrency(c)).toBe(c);
  });

  it("anything else is null, so the defaults chain falls through to the next source", () => {
    for (const v of [null, undefined, "", "GBP", "chf", " CHF"]) expect(toCurrency(v)).toBeNull();
  });
});
