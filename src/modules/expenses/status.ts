// Derived status of an expense (FR-005, F114 / D60) — pure, never stored. Amounts in the expense's currency:
//   company-paid → `paid` once its `justifies` links cover the amount (the one tolerance, D25), else `awaiting_link`
//   private      → `refunded` when its `settles` links cover the amount, `partially_refunded` when some of it is
//                  allocated, else `to_refund`
// What is still open — in the expense's currency and, for the owner's claim, in base — is derived here too: the
// list, the groups, the ledger, the settlement proposal and the status all read it; one tolerance, no copy.
import { Prisma } from "@/generated/prisma/browser";
import { type Allocation, fxDifference, isSettled, openAmount } from "@/kernel/money/settlement";
import type { ExpenseStatus } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export function deriveExpenseStatus(input: {
  paidByPrivate: boolean;
  /** the expense's amount, its currency */
  amount: string;
  /** Σ allocating links onto it, the same currency */
  allocated: string;
}): ExpenseStatus {
  const allocated = new D(input.allocated);
  const settled = allocated.gt(0) && isSettled(input.amount, [allocated]);
  if (!input.paidByPrivate) return settled ? "paid" : "awaiting_link";
  if (settled) return "refunded";
  if (allocated.gt(0)) return "partially_refunded";
  return "to_refund";
}

/** What is still open on the expense, its currency — 0 when within the tolerance (then it counts as paid / refunded). */
export function openOn(amount: Dec | string, allocated: Dec | string): Dec {
  const open = openAmount(amount, allocated);
  return isSettled(amount, [allocated]) ? new D(0) : open;
}

/**
 * The owner's claim still open on a private expense, in base: the expense's base for the share that is not yet
 * refunded (D26 — the owner is owed the value at the receipt's date), 0 when within the tolerance.
 */
export function openBase(
  amount: Dec | string,
  amountBase: Dec | string,
  allocations: readonly Allocation[],
): Dec {
  const open = openOn(
    amount,
    allocations.reduce((acc, a) => acc.plus(new D(a.amount)), new D(0)),
  );
  if (open.isZero()) return new D(0);
  const { expectedBase } = fxDifference(amount, amountBase, allocations);
  return new D(amountBase).abs().minus(expectedBase);
}
