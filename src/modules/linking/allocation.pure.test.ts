import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { canAllocate, remaining, sumAllocations } from "./allocation";

// Money as 2-decimal strings in a realistic range; property tests must not depend on floating point.
const money = fc.integer({ min: 1, max: 10_000_000 }).map((cents) => (cents / 100).toFixed(2));
const moneyList = fc.array(money, { maxLength: 12 });

describe("allocation arithmetic (pure)", () => {
  it("sum of allocations is exact and order-independent", () => {
    fc.assert(
      fc.property(moneyList, (xs) => {
        const expected = xs.reduce((acc, x) => acc + Math.round(Number(x) * 100), 0);
        const shuffled = [...xs].reverse();
        expect(sumAllocations(xs).toFixed(2)).toBe((expected / 100).toFixed(2));
        expect(sumAllocations(shuffled).toFixed(2)).toBe(sumAllocations(xs).toFixed(2));
      }),
    );
  });

  it("remaining = amount − sum, and a candidate is allowed iff 0 < candidate ≤ remaining", () => {
    fc.assert(
      fc.property(money, moneyList, money, (amount, allocations, candidate) => {
        const rem = remaining(amount, allocations);
        expect(rem.plus(sumAllocations(allocations)).toFixed(2)).toBe(
          new Prisma.Decimal(amount).toFixed(2),
        );
        const allowed = canAllocate(amount, allocations, candidate);
        expect(allowed).toBe(new Prisma.Decimal(candidate).lte(rem));
      }),
    );
  });

  it("never over-allocates: any accepted sequence of candidates stays within the amount", () => {
    fc.assert(
      fc.property(money, fc.array(money, { minLength: 1, maxLength: 20 }), (amount, candidates) => {
        const accepted: string[] = [];
        for (const c of candidates) if (canAllocate(amount, accepted, c)) accepted.push(c);
        expect(sumAllocations(accepted).lte(new Prisma.Decimal(amount))).toBe(true);
      }),
    );
  });

  it("rejects zero and negative candidates", () => {
    expect(canAllocate("100.00", [], "0")).toBe(false);
    expect(canAllocate("100.00", [], "-1.00")).toBe(false);
    expect(canAllocate("100.00", ["99.99"], "0.01")).toBe(true);
    expect(canAllocate("100.00", ["99.99"], "0.02")).toBe(false);
  });
});
