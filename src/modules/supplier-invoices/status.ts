// Derived status of a supplier invoice (FR-003) — pure. `cancelled` is the typed flag; everything else comes from
// the `justifies` allocations (in the linkable's currency: the paid currency once a cross-currency payment is
// attached, else the invoice's) and the due date.
import { Prisma } from "@/generated/prisma/browser";
import { settlementTolerance } from "@/kernel/money/settlement";
import type { SupplierInvoiceStatus } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export function openAmount(total: Dec | string, allocated: Dec | string): Dec {
  const open = new D(total).minus(new D(allocated));
  return open.lt(0) ? new D(0) : open;
}

export function deriveSupplierInvoiceStatus(input: {
  cancelled: boolean;
  /** `paid_amount ?? amount_total` */
  total: string;
  allocated: string;
  dueDate: string;
  today: string;
}): { status: SupplierInvoiceStatus; daysOverdue: number } {
  if (input.cancelled) return { status: "cancelled", daysOverdue: 0 };
  const total = new D(input.total);
  const allocated = new D(input.allocated);
  const paid = allocated.gte(total.minus(settlementTolerance(total)));
  if (paid) return { status: "paid", daysOverdue: 0 };
  const overdueDays =
    input.dueDate < input.today
      ? Math.round((Date.parse(input.today) - Date.parse(input.dueDate)) / 86_400_000)
      : 0;
  if (overdueDays > 0) return { status: "overdue", daysOverdue: overdueDays };
  return { status: allocated.gt(0) ? "partially_paid" : "unpaid", daysOverdue: 0 };
}

/** `invoice_date + terms` as an ISO date (calendar arithmetic). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const DEFAULT_PAYMENT_TERMS_DAYS = 30;
