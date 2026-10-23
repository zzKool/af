"use client";

// An expense's / a settlement's derived state, the D40 way: <StateLabel> in the family `state-family.ts` maps it to.
import { useT } from "@/kernel/i18n/use-t";
import { StateLabel } from "@/kernel/ui/state-label";
import { expenseStateFamily, settlementStateFamily } from "@/modules/expenses/state-family";
import type { ExpenseStatus, SettlementStatus } from "@/modules/expenses/types";

export function ExpenseStateLabel({ status, testId }: { status: ExpenseStatus; testId?: string }) {
  const t = useT();
  return (
    <span data-testid={testId} className="inline-flex">
      <StateLabel family={expenseStateFamily(status)} state={t(`expenses.status.${status}`)} />
    </span>
  );
}

export function SettlementStateLabel({
  status,
  testId,
}: {
  status: SettlementStatus;
  testId?: string;
}) {
  const t = useT();
  return (
    <span data-testid={testId} className="inline-flex">
      <StateLabel
        family={settlementStateFamily(status)}
        state={t(`expenses.settlements.status.${status}`)}
      />
    </span>
  );
}
