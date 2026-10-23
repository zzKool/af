"use client";

// A supplier invoice's derived status on screen (D40): icon + word through the module's one family map; an
// overdue one carries its days (`Overdue · 7 d`).
import { useT } from "@/kernel/i18n/use-t";
import { StateLabel } from "@/kernel/ui/state-label";
import { supplierInvoiceStateFamily } from "../state-family";
import type { SupplierInvoiceStatus } from "../types";

export function SupplierInvoiceStateLabel({
  status,
  daysOverdue,
  testId,
  className,
}: {
  status: SupplierInvoiceStatus;
  daysOverdue?: number;
  testId?: string;
  className?: string;
}) {
  const t = useT();
  return (
    <span data-testid={testId} className="inline-flex">
      <StateLabel
        family={supplierInvoiceStateFamily(status)}
        state={`${t(`supplierInvoices.status.${status}`)}${
          status === "overdue" && daysOverdue ? ` · ${daysOverdue} d` : ""
        }`}
        className={className}
      />
    </span>
  );
}
