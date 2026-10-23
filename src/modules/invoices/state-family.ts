// The one map from a document's derived state to its D40 family (ui-conventions *States and tags*). Every screen
// that shows an invoice / quote / credit note state goes through it — the list, the title row, the side panel.
//
//   attention  something for the owner to chase   overdue
//   progress   out with the client, not finished   issued · sent · partially paid · accepted (convert it)
//   done       closed in the company's favour      paid · credited · converted
//   neutral    not live, or closed with nothing    draft · declined · expired
import type { StateFamily } from "@/kernel/ui/state-label";
import type { InvoiceState } from "./types";

export const INVOICE_STATE_FAMILY: Record<InvoiceState, StateFamily> = {
  draft: "neutral",
  issued: "progress",
  sent: "progress",
  partially_paid: "progress",
  paid: "done",
  overdue: "attention",
  credited: "done",
  accepted: "progress",
  declined: "neutral",
  expired: "neutral",
  converted: "done",
};

export function invoiceStateFamily(state: InvoiceState): StateFamily {
  return INVOICE_STATE_FAMILY[state];
}
