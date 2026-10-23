// The one place expenses maps its derived states → the D40 family (ui-conventions *States and tags*). Client-safe
// (no Prisma): the list, the side panel, the groups' expenses and the settlements page all read it.
//
//   expense     awaiting_link       attention  company-paid, its bank row not attached yet
//               to_refund           attention  private, the company owes the owner all of it
//               partially_refunded  progress   private, a settlement covered part of it
//               paid                done       company-paid, the bank row justifies it
//               refunded            done       private, nothing owed (`owedBase` = 0)
//   settlement  active              done       the refund is booked, the statement stands
//               cancelled           neutral    undone — its lines no longer count
import type { StateFamily } from "@/kernel/ui/state-label";
import type { ExpenseStatus, SettlementStatus } from "./types";

export const EXPENSE_STATE_FAMILY: Readonly<Record<ExpenseStatus, StateFamily>> = {
  awaiting_link: "attention",
  to_refund: "attention",
  partially_refunded: "progress",
  paid: "done",
  refunded: "done",
};

export const SETTLEMENT_STATE_FAMILY: Readonly<Record<SettlementStatus, StateFamily>> = {
  active: "done",
  cancelled: "neutral",
};

export function expenseStateFamily(status: ExpenseStatus): StateFamily {
  return EXPENSE_STATE_FAMILY[status];
}

export function settlementStateFamily(status: SettlementStatus): StateFamily {
  return SETTLEMENT_STATE_FAMILY[status];
}
