// Settlement arithmetic (specs/expenses US3, US4, SC-002) on the owner's fixture and over random ledgers.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/browser";
import {
  fifoAllocate,
  fifoOrder,
  type OpenExpense,
  residualOpen,
  settlementDifference,
} from "./fifo";
import { deriveExpenseStatus, OPEN_BASE_TOLERANCE_SEK, openBase } from "./status";

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
    const diff = settlementDifference(lines, "9700.00");
    expect(diff).toMatchObject({
      allocatedBase: "9700.00",
      exchangeDifferenceBase: "0.00",
      roundingBase: "0.00",
      unallocatedOnTransaction: "0.00",
      roundingNote: null,
    });
    expect(residualOpen(lines)).toBe("1065.00");
  });

  it("stops at the refund and reports what the transaction has left when the ledger is smaller", () => {
    const lines = fifoAllocate(open.slice(0, 1), "9700.00");
    expect(lines).toHaveLength(1);
    expect(settlementDifference(lines, "9700.00").unallocatedOnTransaction).toBe("3250.00");
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

describe("exchange difference and rounding (US4-3, US4-4; variants B, C)", () => {
  const full = open.map((e) => ({ allocatedBase: e.openBase }));

  it("variant B: 10 765 allocated against a 10 700 base is a +65.00 exchange difference", () => {
    const diff = settlementDifference(full, "10700.00");
    expect(diff.allocatedBase).toBe("10765.00");
    expect(diff.exchangeDifferenceBase).toBe("65.00");
    expect(diff.roundingBase).toBe("0.00");
  });

  it("variant C: 0.30 within the 0.50 tolerance is rounding with the note", () => {
    const diff = settlementDifference(full, "10764.70");
    expect(diff.exchangeDifferenceBase).toBe("0.00");
    expect(diff.roundingBase).toBe("0.30");
    expect(diff.roundingNote).toBe(
      "Rounding adjustment: SEK 0.30 (Swedish 50-öre rounding tolerance)",
    );
    expect(settlementDifference(full, "10764.49").exchangeDifferenceBase).toBe("0.51");
  });
});

describe("derived status (FR-005, US3-3)", () => {
  const priv = (amountBase: string, allocatedBase: string) =>
    deriveExpenseStatus({
      paidByPrivate: true,
      amountBase,
      allocatedBase,
      paidAmount: null,
      justifiedAmount: "0.00",
    });
  it("private: to_refund → partially_refunded → refunded within 0.50", () => {
    expect(priv("2695.00", "0.00")).toBe("to_refund");
    expect(priv("2695.00", "1630.00")).toBe("partially_refunded");
    expect(priv("2695.00", "2694.63")).toBe("refunded");
    expect(priv("2695.00", "2694.49")).toBe("partially_refunded");
    expect(priv("2695.00", "2695.00")).toBe("refunded");
    expect(openBase("2695.00", "2700.00").toFixed(2)).toBe("0.00");
  });
  it("company-paid: awaiting_link until the bank row allocates the paid amount", () => {
    const company = (paidAmount: string | null, justifiedAmount: string) =>
      deriveExpenseStatus({
        paidByPrivate: false,
        amountBase: "523.17",
        allocatedBase: "0.00",
        paidAmount,
        justifiedAmount,
      });
    expect(company(null, "0.00")).toBe("awaiting_link");
    expect(company("523.17", "0.00")).toBe("awaiting_link");
    expect(company("523.17", "523.17")).toBe("paid");
    expect(company("523.17", "523.12")).toBe("paid"); // within max(0.05, 0.5 %)
    expect(company("523.17", "500.00")).toBe("awaiting_link");
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
        const diff = settlementDifference(lines, refundBase);
        expect(new D(diff.exchangeDifferenceBase).isZero()).toBe(true);
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
        expect(new D(diff.unallocatedOnTransaction).plus(sum).toFixed(2)).toBe(
          new D(refundBase).toFixed(2),
        );
      }),
      { numRuns: 200 },
    );
  });

  it("the tolerance is a constant of 0.50 SEK", () => {
    expect(OPEN_BASE_TOLERANCE_SEK.toFixed(2)).toBe("0.50");
  });
});
