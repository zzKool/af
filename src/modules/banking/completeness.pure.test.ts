// The balance chain (F115, audit B4): `balance(d₁) + Σ amounts (d₁, d₂] = balance(d₂)` — holds when every row is
// here, breaks by exactly what is missing. Synthetic rows, newest first in the file like Nordea's export.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type BalanceRow, balanceChain, lastDayOf, monthComplete } from "./completeness";

/** Rows of one export, newest first: the end-of-day balance sits on the first row of each day. */
function statement(
  rows: readonly { date: string; amount: string; balance?: string }[],
  offset = 0,
): BalanceRow[] {
  return rows.map((r, i) => ({
    bookingDate: r.date,
    amount: r.amount,
    balance: r.balance ?? null,
    rowIndex: offset + i,
  }));
}

// May 31 closes at 10 000.00; June: −100 on the 2nd, −250 + −50 on the 10th, +1 000 on the 28th → 10 600.00
const JUNE = statement([
  { date: "2026-06-28", amount: "1000.00", balance: "10600.00" },
  { date: "2026-06-10", amount: "-250.00", balance: "9600.00" },
  { date: "2026-06-10", amount: "-50.00" },
  { date: "2026-06-02", amount: "-100.00", balance: "9900.00" },
  { date: "2026-05-31", amount: "-40.00", balance: "10000.00" },
]);
// July: −200 on the 3rd, −300 on the 31st → 10 100.00 (the 3rd's balance comes later in the export, rows 100+)
const JULY = statement(
  [
    { date: "2026-07-31", amount: "-300.00", balance: "10100.00" },
    { date: "2026-07-03", amount: "-200.00", balance: "10400.00" },
  ],
  100,
);

describe("balanceChain", () => {
  it("holds inside one export and across two: complete from the first balanced day to the last", () => {
    const c = balanceChain([...JUNE, ...JULY]);
    expect(c).toEqual({
      completeFrom: "2026-05-31",
      completeTo: "2026-07-31",
      gaps: [],
      balancedDays: 6,
    });
  });

  it("a day without a balance is summed into the next balanced one; several balances on a day take the one that agrees", () => {
    const everyRow = statement([
      { date: "2026-06-10", amount: "-250.00", balance: "9600.00" },
      { date: "2026-06-10", amount: "-50.00", balance: "9850.00" },
      { date: "2026-06-02", amount: "-100.00", balance: "9900.00" },
      { date: "2026-05-31", amount: "-40.00", balance: "10000.00" },
    ]);
    expect(balanceChain(everyRow).gaps).toEqual([]);
    expect(balanceChain(everyRow).completeTo).toBe("2026-06-10");
  });

  it("rows missing between two exports: one gap, off by exactly what is missing; complete to the last day before it", () => {
    // the −200 of July 3rd never arrived: July's export started on the 4th
    const c = balanceChain([...JUNE, ...JULY.filter((r) => r.bookingDate !== "2026-07-03")]);
    expect(c.completeTo).toBe("2026-06-28");
    expect(c.gaps).toEqual([
      {
        from: "2026-06-28",
        to: "2026-07-31",
        expected: "10300.00",
        actual: "10100.00",
        difference: "-200.00",
      },
    ]);
    // the chain re-syncs on the bank's balance: nothing later is blamed on the same gap
    expect(
      balanceChain([
        ...JUNE,
        ...JULY.filter((r) => r.bookingDate !== "2026-07-03"),
        ...statement([{ date: "2026-08-02", amount: "-10.00", balance: "10090.00" }], 200),
      ]).gaps,
    ).toHaveLength(1);
  });

  it("a doubled row (an import that slipped the dedup) is a gap the other way", () => {
    const c = balanceChain([...JUNE, { ...JUNE[3], rowIndex: 50 } as BalanceRow]);
    expect(c.gaps[0]?.difference).toBe("100.00");
  });

  it("nothing balanced: nothing proven", () => {
    expect(balanceChain(statement([{ date: "2026-06-02", amount: "-100.00" }]))).toEqual({
      completeFrom: null,
      completeTo: null,
      gaps: [],
      balancedDays: 0,
    });
    expect(balanceChain([])).toMatchObject({ completeFrom: null, completeTo: null });
  });

  it("property: a consistent statement has no gap; drop any row after the first balanced day and exactly one gap of that amount appears", () => {
    const cents = fc.integer({ min: -500_000, max: 500_000 }).filter((n) => n !== 0);
    fc.assert(
      fc.property(fc.array(cents, { minLength: 3, maxLength: 40 }), (amounts) => {
        // one row per day from June 1st, every day balanced — the bank's running balance
        let running = 1_000_000;
        const rows: BalanceRow[] = amounts.map((a, i) => {
          running += a;
          const day = String(i + 1).padStart(2, "0");
          return {
            bookingDate: `2026-06-${day}`,
            amount: (a / 100).toFixed(2),
            balance: (running / 100).toFixed(2),
            rowIndex: amounts.length - i,
          };
        });
        expect(balanceChain(rows).gaps).toEqual([]);
        // any row but the first (nothing before it is proven) and the last (no balanced day after it to notice)
        const drop = 1 + (Math.abs(amounts[1] ?? 1) % (amounts.length - 2));
        const dropped = rows.filter((_, i) => i !== drop);
        const c = balanceChain(dropped);
        expect(c.gaps).toHaveLength(1);
        // the missing row's amount is what the balance is off by — its day being gone, the gap closes on the next
        expect(c.gaps[0]?.difference).toBe(((amounts[drop] ?? 0) / 100).toFixed(2));
        expect(c.completeTo).toBe(rows[drop - 1]?.bookingDate);
      }),
    );
  });
});

describe("monthComplete / lastDayOf", () => {
  const chain = { completeFrom: "2026-05-31", completeTo: "2026-07-15", gaps: [], balancedDays: 5 };
  it("needs a balanced day before the month and the chain reaching its last day", () => {
    expect(monthComplete(chain, "2026-06")).toBe(true);
    expect(monthComplete(chain, "2026-07")).toBe(false);
    expect(monthComplete({ ...chain, completeFrom: "2026-06-01" }, "2026-06")).toBe(false);
    expect(monthComplete({ ...chain, completeFrom: null, completeTo: null }, "2026-06")).toBe(
      false,
    );
  });
  it("knows the month's last day, leap years included", () => {
    expect(lastDayOf("2026-02")).toBe("2026-02-28");
    expect(lastDayOf("2028-02")).toBe("2028-02-29");
    expect(lastDayOf("2026-12")).toBe("2026-12-31");
  });
});
