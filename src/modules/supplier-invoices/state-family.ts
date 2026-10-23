// The one map from a supplier invoice's derived status to its D40 family (ui-conventions *States and tags*). Every
// screen that shows the status goes through it — the list, the side panel, the group page's section.
//
//   attention  something for the owner to pay now   overdue
//   progress   out with the supplier, not settled    unpaid · partially paid
//   done       settled                               paid
//   neutral    not live                              cancelled
import type { StateFamily } from "@/kernel/ui/state-label";
import type { SupplierInvoiceStatus } from "./types";

export const SUPPLIER_INVOICE_STATE_FAMILY: Readonly<Record<SupplierInvoiceStatus, StateFamily>> = {
  unpaid: "progress",
  partially_paid: "progress",
  paid: "done",
  overdue: "attention",
  cancelled: "neutral",
};

export function supplierInvoiceStateFamily(status: SupplierInvoiceStatus): StateFamily {
  return SUPPLIER_INVOICE_STATE_FAMILY[status];
}
