"use client";

import { Badge } from "@/components/ui/badge";
import { useT } from "@/kernel/i18n/use-t";
import type { ExpenseStatus } from "@/modules/expenses/types";

export const STATUS_STYLE: Record<ExpenseStatus, string> = {
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  awaiting_link: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  to_refund: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  partially_refunded: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  refunded: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

export function StatusBadge({ status, testId }: { status: ExpenseStatus; testId?: string }) {
  const t = useT();
  return (
    <Badge variant="outline" className={STATUS_STYLE[status]} data-testid={testId}>
      {t(`expenses.status.${status}`)}
    </Badge>
  );
}
