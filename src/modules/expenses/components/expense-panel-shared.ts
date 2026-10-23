// What the sections of the expense panel share: the detail as the action returns it (dates as strings), the
// patch the panel saves, and two display helpers.
import { formatMoney } from "@/kernel/money/format-money";
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

/** On-screen money (D40): `−2 312.43 SEK`. */
export const money = (amount: string, currency: string) => formatMoney(amount, currency);

export const NONE = "__none__";
