// The FX tolerance per kind of row (F130, O4): two figures, decimal strings, the card's the tighter one.
import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/browser";
import { fxTolerance } from "./fx-tolerance";

describe("fxTolerance", () => {
  it("a card purchase may differ by 4 % (O4), every other row by the scorer's 6 % (harvest R6, moved)", () => {
    expect(fxTolerance("card")).toBe("0.04");
    expect(fxTolerance("other")).toBe("0.06");
  });

  it("both are decimal shares in (0, 1), and the card's is the tighter", () => {
    const card = new Prisma.Decimal(fxTolerance("card"));
    const other = new Prisma.Decimal(fxTolerance("other"));
    expect(card.gt(0) && card.lt(1)).toBe(true);
    expect(other.gt(0) && other.lt(1)).toBe(true);
    expect(card.lt(other)).toBe(true);
  });
});
