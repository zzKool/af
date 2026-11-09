import { describe, expect, it } from "vitest";
import { fxCard } from "./fx-card";

// Invented amounts and rates.
describe("fxCard (the work surface's currency card)", () => {
  it("a base-currency row has no card", () => {
    expect(
      fxCard({
        amount: "-100",
        currency: "SEK",
        amountBase: "-100",
        rate: "1",
        bankImplicitRate: null,
      }),
    ).toBeNull();
  });

  it("a foreign row: the original and its base at the ECB rate", () => {
    expect(
      fxCard({
        amount: "-200.00",
        currency: "CHF",
        amountBase: "-2400.00",
        rate: "12.000000",
        bankImplicitRate: null,
      }),
    ).toEqual({
      original: { amount: "200.00", currency: "CHF" },
      ecb: { rate: "12.000000", amount: "2400.00" },
      bank: null,
    });
  });

  it("a transfer leg: what the bank charged and the cost of its rate, out and in", () => {
    const out = fxCard({
      amount: "-200.00",
      currency: "CHF",
      amountBase: "-2400.00",
      rate: "12",
      bankImplicitRate: "12.3",
    });
    expect(out?.bank).toEqual({ rate: "12.3", amount: "2460.00", cost: "60.00", percent: "2.5" });
    const into = fxCard({
      amount: "200.00",
      currency: "CHF",
      amountBase: "2400.00",
      rate: "12",
      bankImplicitRate: "11.7",
    });
    expect(into?.bank).toMatchObject({ amount: "2340.00", cost: "60.00", percent: "2.5" });
  });
});
