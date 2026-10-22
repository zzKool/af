// What the sections of the expense panel share: the detail as the action returns it (dates as strings), the
// patch the panel saves, and two display helpers.
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import type { updateExpenseAction } from "@/modules/expenses/expenses.actions";
import type { ExpenseDetail } from "@/modules/expenses/queries";

export type ExpensePanelDetail = Omit<ExpenseDetail, "expense" | "group" | "links"> & {
  expense: Omit<ExpenseDetail["expense"], "createdAt" | "updatedAt"> & {
    createdAt: string;
    updatedAt: string;
  };
  group: Omit<ExpenseDetail["group"], "createdAt" | "updatedAt"> & {
    createdAt: string;
    updatedAt: string;
  };
  links: (Omit<ExpenseDetail["links"][number], "createdAt"> & { createdAt: string })[];
};

export type ExpensePatch = Parameters<typeof updateExpenseAction>[0]["data"];

/** Saves a patch, toasts, reloads the panel (also on error, to put the fields back). */
export type SaveExpense = (patch: ExpensePatch) => Promise<void>;

export const money = (amount: string, currency: string) =>
  `${formatCurrency(amount, currency as Currency)} ${currency}`;

export const NONE = "__none__";
