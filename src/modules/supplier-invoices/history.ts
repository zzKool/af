// The side panel's History (F71): the invoice's own audit entries, newest first, each named by what happened. The
// audit trail stores only create / update / delete, so the event is read from the data the services wrote:
//
//   create                                          created
//   update  new.cancelled = true                    cancelled            (lifecycle.ts)
//   update  old.cancelled = true, new = false       reinstated           (lifecycle.ts)
//   update  new.payment                             payment linked       (payments.ts recordPayment)
//   update  old.paidAmount = null, new.paidAmount   bank row attached    (payments.ts attachPayment)
//   update  old.paidAmount, new.paidAmount = null   bank row detached    (payments.ts detachPayment)
//   update  anything else                           edited               (update.ts)
//
// A same-currency payment *removed* is the link's own entry (linking audits it), not one of these.
// Pure — the read is `supplierInvoiceHistory` in queries.ts.

export const SUPPLIER_INVOICE_HISTORY_EVENTS = [
  "created",
  "edited",
  "cancelled",
  "reinstated",
  "paymentLinked",
  "rowAttached",
  "rowDetached",
  "deleted",
] as const;
export type SupplierInvoiceHistoryEvent = (typeof SUPPLIER_INVOICE_HISTORY_EVENTS)[number];

export type SupplierInvoiceHistoryEntry = {
  id: string;
  event: SupplierInvoiceHistoryEvent;
  /** ISO timestamp */
  at: string;
  source: string;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** What one audit entry of a supplier invoice says happened — pure. */
export function historyEvent(entry: {
  action: string;
  oldData: unknown;
  newData: unknown;
}): SupplierInvoiceHistoryEvent {
  if (entry.action === "create") return "created";
  if (entry.action === "delete") return "deleted";
  const before = record(entry.oldData);
  const after = record(entry.newData);
  if (after.cancelled === true && before.cancelled !== true) return "cancelled";
  if (before.cancelled === true && after.cancelled === false) return "reinstated";
  if ("payment" in after) return "paymentLinked";
  if ("paidAmount" in before && "paidAmount" in after) {
    if (before.paidAmount === null && after.paidAmount !== null) return "rowAttached";
    if (before.paidAmount !== null && after.paidAmount === null) return "rowDetached";
  }
  return "edited";
}
