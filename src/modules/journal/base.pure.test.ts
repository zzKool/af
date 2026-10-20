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

  it("property: sign follows the amount and |base| = round(|amount| × rate, 2)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }).filter((n) => n !== 0),
        fc.integer({ min: 1, max: 20_000_000 }),
        (cents, rateMicro) => {
          const amount = new D(cents).div(100);
          const rate = new D(rateMicro).div(1_000_000);
          const base = baseAmount(amount, rate);
          expect(base.isNegative()).toBe(amount.isNegative() && !base.isZero());
          expect(base.abs().toFixed(2)).toBe(
            amount.abs().mul(rate).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2),
          );
          expect(base.decimalPlaces()).toBeLessThanOrEqual(2);
        },
      ),
      { numRuns: 200 },
    );
  });
});
