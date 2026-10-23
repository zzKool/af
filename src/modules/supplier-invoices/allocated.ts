// The one "allocated" rule of a supplier invoice (lessons audit 6, F59; T010): Σ `allocated_amount` of the
// allocations onto it, whatever pays it — a bank row or a journal entry (linking's matrix allows both) — in the
// linkable's currency. Read through linking's batch API (`allocatedSums`, audit 22), the same rule linking applies
// when it checks what remains, so the list, the detail, the KPIs and the payments' "open" can never disagree.
// MUST NOT import from next/* or components.
import { Prisma } from "@/generated/prisma/browser";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as linking from "@/modules/linking";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

/** Σ allocations per invoice; an invoice with none is absent. */
export async function allocatedSums(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<Map<string, Dec>> {
  const sums = await linking.allocatedSums(tx, "supplier_invoice", ids);
  return new Map([...sums].map(([id, sum]) => [id, new D(sum)]));
}

/** Σ allocations onto one invoice. */
export async function allocatedTo(tx: TransactionClient, invoiceId: string): Promise<Dec> {
  return (await allocatedSums(tx, [invoiceId])).get(invoiceId) ?? new D(0);
}
