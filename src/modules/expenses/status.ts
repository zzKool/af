// Derived status of an expense (FR-005) — pure, never stored. Decimal strings in, a status out.
//   company-paid → `paid` once a `justifies` link allocates the paid amount (within the paid currency's tolerance),
//                  else `awaiting_link`
//   private      → `refunded` when nothing is owed (`owedBase` = 0: what is open is ≤ 0.50 SEK, D25/D26 rounding),
//                  `partially_refunded` when some of the base is allocated, else `to_refund`
// `owedBase` is THE "still owed" rule (F62): the list, the groups, the ledger, the open expenses a settlement
// proposes and the status all read it — one tolerance, no copy.
import { Prisma } from "@/generated/prisma/browser";
import { isSettled } from "@/kernel/money/settlement";
import type { ExpenseStatus } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

/** Below this, what is left of a private expense's SEK base is rounding, not a debt (Swedish 50-öre tolerance). */
export const OPEN_BASE_TOLERANCE_SEK = new D("0.50");

/** The arithmetic remainder: base − Σ active settlement lines, never negative. */
export function openBase(amountBase: Dec | string, allocatedBase: Dec | string): Dec {
  const open = new D(amountBase).minus(new D(allocatedBase));
  return open.lt(0) ? new D(0) : open;
}

/** What the company still owes the owner on a private expense: the remainder, or 0 when it is within the tolerance. */
export function owedBase(amountBase: Dec | string, allocatedBase: Dec | string): Dec {
  const open = openBase(amountBase, allocatedBase);
  return open.gt(OPEN_BASE_TOLERANCE_SEK) ? open : new D(0);
}

export function deriveExpenseStatus(input: {
  paidByPrivate: boolean;
  amountBase: string;
  /** Σ active settlement lines, SEK */
  allocatedBase: string;
  /** the bank row's amount once attached (company-paid), else null */
  paidAmount: string | null;
  /** Σ `justifies` allocations onto the expense, in the paid currency */
  justifiedAmount: string;
}): ExpenseStatus {
  if (!input.paidByPrivate) {
    if (!input.paidAmount) return "awaiting_link";
    return isSettled(new D(input.paidAmount).abs(), [input.justifiedAmount])
      ? "paid"
      : "awaiting_link";
  }
  if (owedBase(input.amountBase, input.allocatedBase).isZero()) return "refunded";
  if (new D(input.allocatedBase).gt(0)) return "partially_refunded";
  return "to_refund";
}
