// The settlement rule shared by every module that derives paid / settled (D25): the tolerance, what is still
// open, and whether allocations settle an amount — fixtures from the rule, then the identities as properties.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/browser";
import {
  fxDifference,
  isSettled,
  openAmount,
  paidShare,
  settlementTolerance,
  sliceBase,
} from "./settlement";

const D = Prisma.Decimal;

/** A 2-decimal amount string in [0, max]. */
const amount = (max = 1_000_000) =>
  fc.integer({ min: 0, max: max * 100 }).map((cents) => new D(cents).div(100).toFixed(2));

describe("settlementTolerance", () => {
  it("is max(0.05, 0.5 % of the amount), rounded to the cent, whatever the sign", () => {
    expect(settlementTolerance("25944.00").toFixed(2)).toBe("129.72");
    expect(settlementTolerance("-25944.00").toFixed(2)).toBe("129.72");
    expect(settlementTolerance("10.00").toFixed(2)).toBe("0.05");
    expect(settlementTolerance("0").toFixed(2)).toBe("0.05");
    expect(settlementTolerance("10.10").toFixed(2)).toBe("0.05"); // 0.0505 → 0.05
    expect(settlementTolerance("11.00").toFixed(2)).toBe("0.06"); // 0.055 → 0.06 (half up)
  });

  it("property: at least 0.05, never above max(0.05, 0.5 %) + half a cent, monotone in |amount|", () => {
    fc.assert(
      fc.property(amount(), amount(), (a, b) => {
        const ta = settlementTolerance(a);
        expect(ta.gte("0.05")).toBe(true);
        expect(ta.lte(D.max(new D("0.05"), new D(a).mul("0.005")).plus("0.005"))).toBe(true);
        expect(settlementTolerance(`-${a}`).eq(ta)).toBe(true);
        const [lo, hi] = new D(a).lte(b) ? [a, b] : [b, a];
        expect(settlementTolerance(lo).lte(settlementTolerance(hi))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe("openAmount", () => {
  it("is total − allocated − credited, floored at 0", () => {
    expect(openAmount("1000.00", "400.00").toFixed(2)).toBe("600.00");
    expect(openAmount("1000.00", "400.00", "100.00").toFixed(2)).toBe("500.00");
    expect(openAmount("1000.00", "1000.00").toFixed(2)).toBe("0.00");
    expect(openAmount("1000.00", "1200.00").toFixed(2)).toBe("0.00"); // overpaid: nothing open
    expect(openAmount("1000.00", "0", "1000.00").toFixed(2)).toBe("0.00"); // fully credited
    expect(openAmount(new D("0.10"), new D("0.03")).toFixed(2)).toBe("0.07"); // exact, no float
  });

  it("property: never negative; open + allocated + credited covers the total, exactly while something is open", () => {
    fc.assert(
      fc.property(amount(), amount(), amount(), (total, allocated, credited) => {
        const open = openAmount(total, allocated, credited);
        expect(open.isNegative()).toBe(false);
        const covered = open.plus(allocated).plus(credited);
        if (open.gt(0)) expect(covered.eq(total)).toBe(true);
        else expect(covered.gte(total)).toBe(true);
        // nothing open ⇔ the allocations and credits reach the total
        expect(open.isZero()).toBe(new D(allocated).plus(credited).gte(total));
      }),
      { numRuns: 300 },
    );
  });

  it("property: credited defaults to 0, and allocating more never opens more", () => {
    fc.assert(
      fc.property(amount(), amount(), amount(1000), (total, allocated, more) => {
        expect(openAmount(total, allocated).eq(openAmount(total, allocated, "0"))).toBe(true);
        const after = openAmount(total, new D(allocated).plus(more));
        expect(after.lte(openAmount(total, allocated))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe("isSettled", () => {
  it("settles within the tolerance, not beyond", () => {
    expect(isSettled("25944.00", ["25944.00"])).toBe(true);
    expect(isSettled("25944.00", ["25934.00"])).toBe(true); // a 10 CHF bank fee
    expect(isSettled("25944.00", ["25814.28"])).toBe(true); // short by exactly the tolerance
    expect(isSettled("25944.00", ["25814.27"])).toBe(false); // a cent more
    expect(isSettled("25944.00", ["20000.00", "5944.00"])).toBe(true);
    expect(isSettled("25944.00", [])).toBe(false);
    expect(isSettled("25944.00", ["30000.00"])).toBe(true); // overpaid
  });

  it("property: settled ⇔ what is still open is within the tolerance", () => {
    fc.assert(
      fc.property(amount(), fc.array(amount(), { maxLength: 6 }), (total, allocations) => {
        const sum = allocations.reduce((s, a) => s.plus(a), new D(0));
        expect(isSettled(total, allocations)).toBe(
          openAmount(total, sum).lte(settlementTolerance(total)),
        );
      }),
      { numRuns: 300 },
    );
  });

  it("property: the order and the split of the allocations do not matter; full payment always settles", () => {
    fc.assert(
      fc.property(
        amount(),
        fc.array(amount(), { minLength: 1, maxLength: 6 }),
        (total, allocations) => {
          const sum = allocations.reduce((s, a) => s.plus(a), new D(0));
          expect(isSettled(total, [...allocations].reverse())).toBe(isSettled(total, allocations));
          expect(isSettled(total, [sum])).toBe(isSettled(total, allocations));
          expect(isSettled(total, [total])).toBe(true);
          // short by more than the tolerance never settles
          const short = new D(total).minus(settlementTolerance(total)).minus("0.01");
          if (short.gte(0)) expect(isSettled(total, [short])).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// --- the link as the payment record (F114, D60) ---

describe("paidShare", () => {
  it("is allocated ÷ amount, capped at 1; a zero amount counts as paid", () => {
    expect(paidShare("100.00", "25.00").toFixed(4)).toBe("0.2500");
    expect(paidShare("100.00", "120.00").toFixed(4)).toBe("1.0000");
    expect(paidShare("0.00", "0.00").toFixed(4)).toBe("1.0000");
  });
});

describe("fxDifference", () => {
  it("the spec's card receipt: 45.00 CHF at an ECB base of 523.17, the SEK card gave 531.40 → +8.23, a loss", () => {
    const fx = fxDifference("45.00", "523.17", [{ amount: "45.00", base: "531.40" }]);
    expect(fx.allocated.toFixed(2)).toBe("45.00");
    expect(fx.expectedBase.toFixed(2)).toBe("523.17");
    expect(fx.difference.toFixed(2)).toBe("8.23");
    expect(fx.rounding).toBe(false);
  });
  it("a private CHF receipt refunded in SEK below its ECB value: −40.00, a gain; rounding within the tolerance", () => {
    const fx = fxDifference("100.00", "1140.00", [{ amount: "100.00", base: "1100.00" }]);
    expect(fx.difference.toFixed(2)).toBe("-40.00");
    expect(fx.rounding).toBe(false);
    const r = fxDifference("999.70", "999.70", [{ amount: "999.70", base: "1000.00" }]);
    expect(r.difference.toFixed(2)).toBe("0.30");
    expect(r.rounding).toBe(true);
  });
  it("a partial payment compares against the paid share of the base", () => {
    const fx = fxDifference("12000.00", "12000.00", [{ amount: "4000.00", base: "4000.00" }]);
    expect(fx.expectedBase.toFixed(2)).toBe("4000.00");
    expect(fx.difference.toFixed(2)).toBe("0.00");
  });
  it("property: same-currency slices at the entity's own rate never make a difference; the sign follows the base", () => {
    fc.assert(
      fc.property(amount(100_000), fc.integer({ min: 1, max: 4 }), (total, n) => {
        const amt = new D(total);
        if (amt.isZero()) return;
        const slices: { amount: string; base: string }[] = [];
        let left = amt;
        for (let i = 0; i < n; i += 1) {
          const take = i === n - 1 ? left : left.div(2).toDecimalPlaces(2);
          left = left.minus(take);
          slices.push({ amount: take.toFixed(2), base: take.toFixed(2) });
        }
        expect(fxDifference(total, total, slices).difference.toFixed(2)).toBe("0.00");
        const more = slices.map((s) => ({ ...s, base: new D(s.base).plus("0.50").toFixed(2) }));
        expect(fxDifference(total, total, more).difference.gt(0)).toBe(true);
      }),
    );
  });
});

describe("sliceBase", () => {
  it("pro rata of the row's base; the link that exhausts the row takes the exact remainder", () => {
    const row = { amount: "-200.00", amountBase: "200.00" };
    expect(sliceBase(row, { amount: "0", base: "0" }, "120.00").toFixed(2)).toBe("120.00");
    expect(sliceBase(row, { amount: "120.00", base: "120.00" }, "80.00").toFixed(2)).toBe("80.00");
    const chf = { amount: "-100.00", amountBase: "1140.00" };
    expect(sliceBase(chf, { amount: "0", base: "0" }, "33.33").toFixed(2)).toBe("379.96");
    expect(sliceBase(chf, { amount: "33.33", base: "379.96" }, "66.67").toFixed(2)).toBe("760.04");
  });
  it("property: slices that use a row up sum to its base to the cent", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 2_000_000 }),
        fc.integer({ min: 1, max: 5 }),
        (cents, baseCents, n) => {
          const row = {
            amount: new D(cents).div(100).toFixed(2),
            amountBase: new D(baseCents).div(100).toFixed(2),
          };
          let givenAmount = new D(0);
          let givenBase = new D(0);
          for (let i = 0; i < n; i += 1) {
            const left = new D(row.amount).minus(givenAmount);
            const take = i === n - 1 ? left : left.div(2).toDecimalPlaces(2);
            if (take.lte(0)) break;
            const base = sliceBase(row, { amount: givenAmount, base: givenBase }, take);
            givenAmount = givenAmount.plus(take);
            givenBase = givenBase.plus(base);
          }
          expect(givenBase.toFixed(2)).toBe(row.amountBase);
        },
      ),
    );
  });
});
