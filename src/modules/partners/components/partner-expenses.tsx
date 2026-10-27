"use client";

// The partner's Expenses tab (F87, US3): what the company spent with this merchant — `n expenses · Σ base SEK`
// (`*` when a base in it is still the ECB estimate of a company-paid expense), the newest rows, and *Open in
// Expenses* for the whole list filtered on the partner. The rows are plain props: the page composes the expenses
// module's read (`expensesForPartner`), so partners never imports expenses (its UI imports this module's).
import Link from "next/link";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { type StateFamily, StateLabel } from "@/kernel/ui/state-label";
import { CodeChip, Tag } from "@/kernel/ui/tags";
import type { ExpenseStatus } from "@/modules/expenses/ui";

export type PartnerExpenseRow = {
  id: string;
  key: string;
  date: string;
  groupNumber: number;
  description: string;
  basLabel: string;
  amount: string;
  currency: string;
  amountBase: string;
  /** the expense's derived state and its D40 family, as the expenses module maps it */
  status: ExpenseStatus;
  stateFamily: StateFamily;
};

export type PartnerExpenses = {
  rows: PartnerExpenseRow[];
  count: number;
  totalBase: string;
};

export function PartnerExpensesTab({
  partnerId,
  expenses,
  baseCurrency,
}: {
  partnerId: string;
  expenses: PartnerExpenses;
  /** the books' base (the page's one base read — F85: no new hard-coded base) */
  baseCurrency: string;
}) {
  const t = useT();
  if (expenses.count === 0) {
    return (
      <p className="rounded-lg border px-3 py-6 text-center text-[13px] text-muted-foreground">
        {t("partners.expenses.empty")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="partner-expenses">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span data-testid="partner-expenses-total">
          {t("partners.expenses.total", {
            count: expenses.count,
            total: formatMoney(expenses.totalBase, baseCurrency),
          })}
        </span>
        <Link
          href={`/expenses?f.partnerId=in:${partnerId}`}
          className="text-xs text-primary hover:underline"
          data-testid="partner-expenses-open"
        >
          {t("partners.expenses.open")}
        </Link>
      </div>
      <ul className="rounded-lg border text-[13px]">
        {expenses.rows.map((r) => (
          <li
            key={r.id}
            className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-subtle px-3 py-1 last:border-b-0"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Link href={`/expenses?open=${r.id}`} className="shrink-0">
                <CodeChip>{r.key}</CodeChip>
              </Link>
              <span className="shrink-0 text-muted-foreground tabular-nums">{r.date}</span>
              <span className="truncate" title={r.description}>
                {r.description}
              </span>
              <Tag className="shrink-0">{r.basLabel}</Tag>
            </span>
            <span className="flex shrink-0 items-center gap-3 text-right tabular-nums">
              <span data-amount={r.amount}>{formatMoney(r.amount, r.currency)}</span>
              <span className="text-xs text-muted-foreground" data-amount={r.amountBase}>
                {formatMoney(r.amountBase, baseCurrency)}
              </span>
              <StateLabel family={r.stateFamily} state={t(`expenses.status.${r.status}`)} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
