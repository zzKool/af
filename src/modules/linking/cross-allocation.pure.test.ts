// What a row in one currency allocates onto an entity in another (F116 FR-005, D60, D67's 6 %).
import { describe, expect, it } from "vitest";
import { crossAllocation } from "./suggestions";

const row = (amount: string, base: string, remaining = amount) => ({
  label: "row",
  amount,
  amountBase: base,
  remaining,
});
const entity = (amount: string, base: string | null, remaining = amount) => ({
  label: "receipt",
  currency: "EUR",
  amount,
  amountBase: base,
  remaining,
});

describe("crossAllocation", () => {
  it("within 6 %: the whole open amount, the row's whole remaining base", () => {
    expect(crossAllocation(row("120.00", "120.00"), entity("11.20", "120.40"), null)).toEqual({
      amount: "11.20",
      base: "120.00",
    });
  });
  it("a larger row (it pays something else too): the whole open amount, only the entity's open base", () => {
    expect(crossAllocation(row("500.00", "500.00"), entity("11.20", "120.40"), null)).toEqual({
      amount: "11.20",
      base: "120.40",
    });
  });
  it("a smaller row: the share its base buys, all of its base", () => {
    expect(crossAllocation(row("60.00", "60.00"), entity("11.20", "120.40"), null)).toEqual({
      amount: "5.58",
      base: "60.00",
    });
  });
  it("a typed amount is taken; the base follows its share", () => {
    expect(crossAllocation(row("120.00", "120.00"), entity("11.20", "120.40"), "5.60")).toEqual({
      amount: "5.60",
      base: "60.20",
    });
  });
  it("no base to compare: refused with a reason", () => {
    expect(crossAllocation(row("120.00", "120.00"), entity("11.20", null), null)).toHaveProperty(
      "error",
    );
  });
});
