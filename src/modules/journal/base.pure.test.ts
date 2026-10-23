// The SEK base (specs/journal SC-001): round(amount × rate, 2) half-up, sign follows the amount.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/browser";
import { baseAmount } from "./journal";

const D = Prisma.Decimal;

describe("baseAmount", () => {
  it("the fixture rows", () => {
    expect(baseAmount("-20000.00", "11.90").toFixed(2)).toBe("-238000.00");
    expect(baseAmount("1297.20", "11.887").toFixed(2)).toBe("15419.82");
    expect(baseAmount("-132.52", "1").toFixed(2)).toBe("-132.52");
    expect(baseAmount("0.005", "1").toFixed(2)).toBe("0.01"); // half-up
  });

  it("property: sign follows the amount and |base| = round(|amount| × rate, 2) half-up", () => {
    // the oracle is integer arithmetic, not decimal.js (lessons audit 31): |cents| × micro-rate is the base in
    // 1e-8 units (≤ 2e14, exact in a double); + half a cent (500 000 units), floored to a cent = half-up on |base|
    const expected = (cents: number, rateMicro: number): string => {
      const baseCents = Math.floor((Math.abs(cents) * rateMicro + 500_000) / 1_000_000);
      const sign = cents < 0 && baseCents > 0 ? "-" : "";
      return `${sign}${Math.floor(baseCents / 100)}.${String(baseCents % 100).padStart(2, "0")}`;
    };
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }).filter((n) => n !== 0),
        fc.integer({ min: 1, max: 20_000_000 }),
        (cents, rateMicro) => {
          const amount = new D(cents).div(100);
          const rate = new D(rateMicro).div(1_000_000);
          expect(baseAmount(amount, rate).toFixed(2)).toBe(expected(cents, rateMicro));
        },
      ),
      { numRuns: 500 },
    );
  });

  it("the oracle's edges: exactly half a cent rounds away from zero, a vanishing base is 0.00, never -0.00", () => {
    expect(baseAmount("-0.01", "0.5").toFixed(2)).toBe("-0.01"); // −0.005 → −0.01
    expect(baseAmount("0.01", "0.4").toFixed(2)).toBe("0.00"); // 0.004 → 0.00
    expect(baseAmount("-0.01", "0.000001").toFixed(2)).toBe("0.00"); // not "-0.00"
    expect(baseAmount("-0.01", "0.000001").isNegative()).toBe(false);
  });
});
