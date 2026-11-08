// A client's payment history (F143, Pulse phase 7; the boards *Invoice studio* — "When will it be paid?" — and
// *Partner* — "Pays after N days"): for the client's paid invoices, the days from the issue date to the day the
// last paying bank row was booked. Derived on request (`linking.paidOnDates`), nothing stored.

import { daysUntil } from "@/kernel/clock/calendar";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as linking from "@/modules/linking";
import type { PaidInvoice } from "./payment-stats";
import { listInvoices } from "./queries";

/** How many of the client's newest paid invoices the expectation reads. */
export const HISTORY_INVOICES = 12;

export type { PaidInvoice, PaymentStats } from "./payment-stats";
export { expectedPayment, paymentStats } from "./payment-stats";

/** The client's newest paid invoices, each with the day it was paid and how long it took. */
export async function clientPaymentHistory(
  tx: TransactionClient,
  partnerId: string,
  today: string,
  limit = HISTORY_INVOICES,
): Promise<PaidInvoice[]> {
  const list = await listInvoices(
    tx,
    {
      page: 1,
      pageSize: 1000,
      sort: [{ col: "issueDate", dir: "desc" }],
      filters: {
        partnerId: { kind: "in", values: [partnerId] },
        type: { kind: "in", values: ["invoice"] },
        state: { kind: "in", values: ["paid"] },
      },
    },
    today,
  );
  const rows = list.rows.slice(0, limit);
  const paidOn = await linking.paidOnDates(
    tx,
    "invoice",
    rows.map((r) => r.id),
  );
  const out: PaidInvoice[] = [];
  for (const r of rows) {
    const day = paidOn.get(r.id);
    if (!day) continue;
    out.push({
      id: r.id,
      number: r.number,
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      paidOn: day,
      days: Math.max(0, daysUntil(r.issueDate, day)),
      late: r.dueDate !== null && day > r.dueDate,
    });
  }
  return out;
}
