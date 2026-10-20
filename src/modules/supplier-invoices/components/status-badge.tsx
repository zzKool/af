"use client";

import { Badge } from "@/components/ui/badge";
import { useT } from "@/kernel/i18n/use-t";
import type { SupplierInvoiceStatus } from "@/modules/supplier-invoices/types";

export const STATUS_STYLE: Record<SupplierInvoiceStatus, string> = {
  unpaid: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  partially_paid: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  overdue: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function SupplierInvoiceStatusBadge({
  status,
  daysOverdue,
  testId,
}: {
  status: SupplierInvoiceStatus;
  daysOverdue?: number;
  testId?: string;
}) {
  const t = useT();
  return (
    <Badge variant="outline" className={STATUS_STYLE[status]} data-testid={testId}>
      {t(`supplierInvoices.status.${status}`)}
      {status === "overdue" && daysOverdue ? ` · ${daysOverdue} d` : ""}
    </Badge>
  );
}
