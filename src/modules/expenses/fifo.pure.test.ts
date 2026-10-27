// Settlement arithmetic (specs/expenses US3, US4, SC-002) on the owner's fixture and over random ledgers.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/browser";
import { fifoAllocate, fifoOrder, type OpenExpense, residualOpen } from "./fifo";
import { amountForBase, expectedBaseFor, settlementTotals } from "./settlement-math";
import { deriveExpenseStatus, openBase } from "./status";

const D = Prisma.Decimal;
const fixture = JSON.parse(
  readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "specs",
      "expenses",
      "fixtures",
      "owner-flow-settlement.json",
    ),
    "utf8",
  ),
);

const open: OpenExpense[] = fixture.expenses.map(
  (e: { key: string; date: string; description: string; amount_base: number }) => ({
    expenseId: e.key,
    key: e.key,
    date: e.date,
    description: e.description,
    amountBase: e.amount_base.toFixed(2),
    openBase: e.amount_base.toFixed(2),
  }),
);

describe("FIFO proposal (US4-1, variant A)", () => {
  it("fills the oldest expenses first and leaves the residual open", () => {
    const lines = fifoAllocate(open, "9700.00");
    expect(lines.map((l) => [l.key, l.allocatedBase, l.remainingOpen])).toEqual([
      ["Ex213-Tr-01", "6450.00", "0.00"],
      ["Ex213-Tr-02", "1620.00", "0.00"],
      ["Ex213-Rep-01", "1630.00", "1065.00"],
    ]);
    // SEK expenses: the base a line gives IS the claim it settles — no difference, nothing left on the row
    const totals = settlementTotals(
      lines.map((l) => ({ allocatedBase: l.allocatedBase, expectedBase: l.allocatedBase })),
      "9700.00",
    );
    expect(totals.allocatedBase.toFixed(2)).toBe("9700.00");
    expect(totals.differenceBase.toFixed(2)).toBe("0.00");
    expect(totals.rounding).toBe(false);
    expect(totals.unallocatedBase.toFixed(2)).toBe("0.00");
    expect(residualOpen(lines)).toBe("1065.00");
  });

  it("stops at the refund and reports what the transaction has left when the ledger is smaller", () => {
    const lines = fifoAllocate(open.slice(0, 1), "9700.00");
    expect(lines).toHaveLength(1);
    expect(
      settlementTotals(
        lines.map((l) => ({ allocatedBase: l.allocatedBase, expectedBase: l.allocatedBase })),
        "9700.00",
      ).unallocatedBase.toFixed(2),
    ).toBe("3250.00");
    expect(fifoAllocate([], "100.00")).toEqual([]);
  });

  it("orders by date then key, skipping what has nothing open", () => {
    const rows = [{ ...open[2], date: "2026-03-01" }, { ...open[0], openBase: "0.00" }, open[1]];
    expect(fifoOrder(rows).map((r) => r.key)).toEqual([
      "Ex213-Rep-01",
      "Ex213-Tr-01",
      "Ex213-Tr-02",
    ]);
    expect(fifoAllocate(rows, "10000.00").map((l) => l.key)).toEqual([
      "Ex213-Rep-01",
      "Ex213-Tr-02",
    ]);
  });
});

describe("the FX difference and the rounding on the links (US4-3, US4-4, F114)", () => {
  it("a SEK refund rounded up by 0.30 is rounding, within the tolerance; 65.00 more is a loss (7960)", () => {
    const claim = { allocatedBase: "10764.70", expectedBase: "10764.70" };
    const rounded = settlementTotals([{ ...claim, allocatedBase: "10765.00" }], "10765.00");
    expect(rounded.differenceBase.toFixed(2)).toBe("0.30");
    expect(rounded.rounding).toBe(true);
    const loss = settlementTotals(
      [{ allocatedBase: "10765.00", expectedBase: "10700.00" }],
      "10765.00",
    );
    expect(loss.differenceBase.toFixed(2)).toBe("65.00");
    expect(loss.rounding).toBe(false);
  });

  it("a CHF claim of 1 140 refunded with 1 100 in full: the amount is the whole receipt, the difference −40.00 (3960)", () => {
    const e = {
      amount: "100.00",
      amountBase: "1140.00",
      openAmount: "100.00",
      openBase: "1140.00",
    };
    // the base alone covers 96.5 % of the claim → the share, unless the owner says "in full"
    expect(amountForBase(e, "1100.00").toFixed(2)).toBe("96.49");
    expect(amountForBase(e, "1139.00").toFixed(2)).toBe("100.00"); // within the tolerance of the claim
    expect(expectedBaseFor(e, "100.00").toFixed(2)).toBe("1140.00");
    const totals = settlementTotals(
      [{ allocatedBase: "1100.00", expectedBase: expectedBaseFor(e, "100.00").toFixed(2) }],
      "1100.00",
    );
    expect(totals.differenceBase.toFixed(2)).toBe("-40.00");
    expect(totals.rounding).toBe(false);
  });
});

describe("derived status (FR-005, US3-3)", () => {
  // amounts in the expense's currency (F114): the one tolerance, max(0.05, 0.5 %)
  const priv = (amount: string, allocated: string) =>
    deriveExpenseStatus({ paidByPrivate: true, amount, allocated });
  it("private: to_refund → partially_refunded → refunded within the tolerance", () => {
    expect(priv("2695.00", "0.00")).toBe("to_refund");
    expect(priv("2695.00", "1630.00")).toBe("partially_refunded");
    expect(priv("2695.00", "2690.00")).toBe("refunded"); // 5.00 open ≤ 13.48
    expect(priv("2695.00", "2680.00")).toBe("partially_refunded");
    expect(priv("2695.00", "2695.00")).toBe("refunded");
    // the claim in base: the base for the unpaid share; 0 once refunded within the tolerance
    expect(
      openBase("2695.00", "2695.00", [{ amount: "2690.00", base: "2690.00" }]).toFixed(2),
    ).toBe("0.00");
    expect(openBase("100.00", "1140.00", [{ amount: "50.00", base: "550.00" }]).toFixed(2)).toBe(
      "570.00",
    );
  });
  it("company-paid: awaiting_link until the links cover the amount", () => {
    const company = (allocated: string) =>
      deriveExpenseStatus({ paidByPrivate: false, amount: "45.00", allocated });
    expect(company("0.00")).toBe("awaiting_link");
    expect(company("45.00")).toBe("paid");
    expect(company("44.96")).toBe("paid"); // within max(0.05, 0.5 %)
    expect(company("40.00")).toBe("awaiting_link");
  });
});

describe("property: allocation invariants (SC-002)", () => {
  const ledger = fc.array(
    fc.record({
      cents: fc.integer({ min: 1, max: 2_000_000 }),
      day: fc.integer({ min: 1, max: 28 }),
      n: fc.integer({ min: 1, max: 99 }),
    }),
    { minLength: 0, maxLength: 12 },
  );
  const refund = fc.integer({ min: 1, max: 5_000_000 });

  it("Σ lines ≤ refund, each line ≤ its open base, FIFO by date, residual = Σ open − Σ lines", () => {
    fc.assert(
      fc.property(ledger, refund, (rows, refundCents) => {
        const open: OpenExpense[] = rows.map((r, i) => ({
          expenseId: String(i),
          key: `Ex1-Tr-${String(r.n).padStart(2, "0")}${i}`,
          date: `2026-03-${String(r.day).padStart(2, "0")}`,
          description: "x",
          amountBase: (r.cents / 100).toFixed(2),
          openBase: (r.cents / 100).toFixed(2),
        }));
        const refundBase = (refundCents / 100).toFixed(2);
        const lines = fifoAllocate(open, refundBase);
        const sum = lines.reduce((acc, l) => acc.plus(l.allocatedBase), new D(0));
        expect(sum.lte(refundBase)).toBe(true);
        for (const l of lines) {
          expect(new D(l.allocatedBase).gt(0)).toBe(true);
          expect(new D(l.allocatedBase).lte(l.openBase)).toBe(true);
          expect(new D(l.remainingOpen).plus(l.allocatedBase).toFixed(2)).toBe(l.openBase);
        }
        // FIFO: lines come in date order and every line but the last is fully covered
        for (let i = 1; i < lines.length; i++) {
          expect(lines[i - 1].date.localeCompare(lines[i].date) <= 0).toBe(true);
          expect(lines[i - 1].remainingOpen).toBe("0.00");
        }
        const totalOpen = open.reduce((acc, e) => acc.plus(e.openBase), new D(0));
        const diff = settlementTotals(
          lines.map((l) => ({ allocatedBase: l.allocatedBase, expectedBase: l.allocatedBase })),
          refundBase,
        );
        expect(diff.differenceBase.isZero()).toBe(true);
        expect(
          totalOpen.minus(sum).toFixed(2) ===
            new D(residualOpen(lines))
              .plus(
                open
                  .filter((e) => !lines.some((l) => l.expenseId === e.expenseId))
                  .reduce((a, e) => a.plus(e.openBase), new D(0)),
              )
              .toFixed(2),
        ).toBe(true);
        expect(diff.unallocatedBase.plus(sum).toFixed(2)).toBe(new D(refundBase).toFixed(2));
      }),
      { numRuns: 200 },
    );
  });
});
