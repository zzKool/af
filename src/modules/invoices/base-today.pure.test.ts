import { describe, expect, it } from "vitest";
import { baseFigure } from "./base-today";

// F169: the base beside the total — an estimate at today's rate on a draft, the stored base once issued.
const draft = { status: "draft", currency: "CHF", baseCurrency: "SEK", totalBase: null };

describe("baseFigure", () => {
  it("a draft in a foreign currency: its total at today's rate, half up to the cent", () => {
    expect(baseFigure(draft, "25944.00", "11.752345")).toEqual({
      amount: "304902.84",
      currency: "SEK",
      estimate: true,
    });
    expect(baseFigure(draft, "0.05", "0.5")).toEqual({
      amount: "0.03",
      currency: "SEK",
      estimate: true,
    });
  });

  it("a draft without today's rate or without a total shows nothing", () => {
    expect(baseFigure(draft, "100.00", null)).toBeNull();
    expect(baseFigure(draft, null, "11.7")).toBeNull();
  });

  it("an issued invoice shows the base stored at issue — never today's estimate", () => {
    const issued = { ...draft, status: "issued", totalBase: "300000.00" };
    expect(baseFigure(issued, "25944.00", "99")).toEqual({
      amount: "300000.00",
      currency: "SEK",
      estimate: false,
    });
    expect(baseFigure({ ...issued, totalBase: null }, "25944.00", "11.7")).toBeNull();
  });

  it("an invoice in the base currency has nothing beside its total", () => {
    expect(baseFigure({ ...draft, currency: "SEK" }, "100.00", "1")).toBeNull();
  });
});
