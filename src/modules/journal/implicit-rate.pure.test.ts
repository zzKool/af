// T005: the bank's implied rate of a transfer pair — |base leg| ÷ |foreign leg|, 6 dp half-up, foreign leg only.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { impliedRate } from "./implicit-rate";

const MICRO = BigInt(1_000_000);
const ZERO = BigInt(0);
const TWO = BigInt(2);

describe("impliedRate", () => {
  it("CHANGE CHFSEK: −20 000.00 CHF against +237 740.00 SEK is 11.887 on the CHF leg, nothing on the SEK leg", () => {
    const chf = { amount: "-20000.00", currency: "CHF" };
    const sek = { amount: "237740.00", currency: "SEK" };
    expect(impliedRate(chf, sek)).toBe("11.887");
    expect(impliedRate(sek, chf)).toBeNull();
  });

  it("rounds half-up at 6 dp; same currency or no base leg gives none", () => {
    expect(
      impliedRate({ amount: "3.00", currency: "CHF" }, { amount: "-35.00", currency: "SEK" }),
    ).toBe("11.666667");
    expect(
      impliedRate({ amount: "8.00", currency: "CHF" }, { amount: "-0.10", currency: "SEK" }),
    ).toBe("0.0125");
    expect(
      impliedRate({ amount: "-50.00", currency: "SEK" }, { amount: "50.00", currency: "SEK" }),
    ).toBeNull();
    expect(
      impliedRate({ amount: "-50.00", currency: "CHF" }, { amount: "52.00", currency: "EUR" }),
    ).toBeNull();
  });

  it("property: the rate times the foreign amount gives back the base amount within half a unit of the 6th dp", () => {
    const cents = fc.integer({ min: 1, max: 10_000_000_000 });
    fc.assert(
      fc.property(cents, cents, (f, b) => {
        const foreign = (f / 100).toFixed(2);
        const base = (b / 100).toFixed(2);
        const rate = impliedRate(
          { amount: `-${foreign}`, currency: "CHF" },
          { amount: base, currency: "SEK" },
        );
        expect(rate).not.toBeNull();
        // |rate − base/foreign| ≤ 0.5e-6, checked in integers: |rate·f − b| · 1e6 ≤ 0.5 · f (all scaled by 100)
        const [int, frac = ""] = (rate as string).split(".");
        const micro = BigInt(int as string) * MICRO + BigInt(frac.padEnd(6, "0"));
        const diff = micro * BigInt(f) - BigInt(b) * MICRO;
        const abs = diff < ZERO ? -diff : diff;
        expect(abs * TWO <= BigInt(f)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
