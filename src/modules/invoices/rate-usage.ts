// Usage hooks other modules ask before deleting what an invoice carries: a contract rate (D24), a VAT
// registration (lesson 19). Wired by the composition root (src/instrumentation.ts) — modules never import each
// other's internals.
import type { TransactionClient } from "@/kernel/db/tenant-client";

export async function rateUsageFromInvoiceLines(
  tx: TransactionClient,
  rateId: string,
): Promise<number> {
  return tx.invoiceLine.count({ where: { rateSourceId: rateId } });
}

/** Invoices, quotes and credit notes (drafts included) that carry this VAT registration. */
export async function vatRegistrationUsageFromInvoices(
  tx: TransactionClient,
  registrationId: string,
): Promise<number> {
  return tx.invoice.count({ where: { vatRegistrationId: registrationId } });
}
