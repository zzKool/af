// Derived status of a supplier invoice (FR-003) — pure. `cancelled` is the typed flag; everything else comes from
// the `justifies` allocations (in the linkable's currency: the paid currency once a cross-currency payment is
// attached, else the invoice's) and the due date. Open, settled and the day arithmetic are the kernel's (audit 27).
import { Prisma } from "@/generated/prisma/browser";
import { daysBetween } from "@/kernel/clock/calendar";
import { isSettled } from "@/kernel/money/settlement";
import type { SupplierInvoiceStatus } from "./types";

export function deriveSupplierInvoiceStatus(input: {
  cancelled: boolean;
  /** `paid_amount ?? amount_total` */
  total: string;
  allocated: string;
  dueDate: string;
  today: string;
}): { status: SupplierInvoiceStatus; daysOverdue: number } {
  if (input.cancelled) return { status: "cancelled", daysOverdue: 0 };
  if (isSettled(input.total, [input.allocated])) return { status: "paid", daysOverdue: 0 };
  const overdueDays = input.dueDate < input.today ? daysBetween(input.dueDate, input.today) : 0;
  if (overdueDays > 0) return { status: "overdue", daysOverdue: overdueDays };
  return {
    status: new Prisma.Decimal(input.allocated).gt(0) ? "partially_paid" : "unpaid",
    daysOverdue: 0,
  };
}

export const DEFAULT_PAYMENT_TERMS_DAYS = 30;
