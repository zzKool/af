// The contracts module asks "is this rate used by an invoice line?" before deleting a rate (D24). Wired by
// the composition root (src/instrumentation.ts) — modules never import each other's internals.
import type { TransactionClient } from "@/kernel/db/tenant-client";

export async function rateUsageFromInvoiceLines(
  tx: TransactionClient,
  rateId: string,
): Promise<number> {
  return tx.invoiceLine.count({ where: { rateSourceId: rateId } });
}
