import { describe, expect, it } from "vitest";
import { STATE_FAMILIES } from "@/kernel/ui/state-label";
import {
  EXPENSE_STATE_FAMILY,
  expenseStateFamily,
  SETTLEMENT_STATE_FAMILY,
  settlementStateFamily,
} from "./state-family";
import { deriveExpenseStatus, owedBase } from "./status";
import { EXPENSE_STATUSES, SETTLEMENT_STATUSES } from "./types";

const isFamily = (f: string) => (STATE_FAMILIES as readonly string[]).includes(f);

describe("expenses state → family", () => {
  it("maps every derived expense status, and only those", () => {
    expect(Object.keys(EXPENSE_STATE_FAMILY).sort()).toEqual([...EXPENSE_STATUSES].sort());
    for (const s of EXPENSE_STATUSES) expect(isFamily(expenseStateFamily(s))).toBe(true);
  });

  it("maps every settlement status, and only those", () => {
    expect(Object.keys(SETTLEMENT_STATE_FAMILY).sort()).toEqual([...SETTLEMENT_STATUSES].sort());
    expect(settlementStateFamily("active")).toBe("done");
    expect(settlementStateFamily("cancelled")).toBe("neutral");
  });

  // the label must agree with the owed rule: a private expense the company still owes on is never "done",
  // one with nothing owed (within the 0.50 tolerance) always is
  it.each([
    ["1000.00", "0.00"],
    ["1000.00", "400.00"],
    ["1000.00", "999.70"],
    ["1000.00", "1000.00"],
    ["250.40", "250.00"],
    ["250.40", "249.40"],
  ])("private %s SEK, %s allocated: done ⇔ nothing owed", (amountBase, allocatedBase) => {
    const status = deriveExpenseStatus({
      paidByPrivate: true,
      amountBase,
      allocatedBase,
      paidAmount: null,
      justifiedAmount: "0",
    });
    const owed = owedBase(amountBase, allocatedBase);
    expect(expenseStateFamily(status) === "done", status).toBe(owed.isZero());
  });

  it("a company-paid expense asks for its bank row until it is paid", () => {
    const awaiting = deriveExpenseStatus({
      paidByPrivate: false,
      amountBase: "100.00",
      allocatedBase: "0",
      paidAmount: null,
      justifiedAmount: "0",
    });
    const paid = deriveExpenseStatus({
      paidByPrivate: false,
      amountBase: "100.00",
      allocatedBase: "0",
      paidAmount: "-100.00",
      justifiedAmount: "100.00",
    });
    expect(expenseStateFamily(awaiting)).toBe("attention");
    expect(expenseStateFamily(paid)).toBe("done");
  });
});
