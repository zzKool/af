// The one "allocated" rule of a supplier invoice (lessons audit 6, F59): Σ `allocated_amount` of the `justifies`
// links onto it, whatever justifies it — a bank row or a journal entry (linking's matrix allows both) — in the
// linkable's currency. The same rule linking applies when it checks what remains (`getAllocationStatus`), so the
// list, the detail, the KPIs and the payments' "open" can never disagree. MUST NOT import from next/* or components.
import { Prisma } from "@/generated/prisma/browser";
import type { TransactionClient } from "@/kernel/db/tenant-client";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

type LinkFacts = {
  kind: string;
  toType: string;
  toId: string;
  allocatedAmount: Dec | null;
};

/** True for a link that counts towards an invoice's allocated sum. */
export function isAllocation(l: LinkFacts): boolean {
  return l.kind === "justifies" && l.toType === "supplier_invoice" && l.allocatedAmount !== null;
}

/** Σ allocations per invoice over links already loaded (links that are not allocations are ignored). */
export function sumAllocated(links: readonly LinkFacts[]): Map<string, Dec> {
  const out = new Map<string, Dec>();
  for (const l of links) {
    if (!isAllocation(l)) continue;
    out.set(l.toId, (out.get(l.toId) ?? new D(0)).plus(l.allocatedAmount as Dec));
  }
  return out;
}

/** Σ allocations per invoice, read from the database. */
export async function allocatedSums(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<Map<string, Dec>> {
  if (ids.length === 0) return new Map();
  const links = await tx.link.findMany({
    where: {
      kind: "justifies",
      toType: "supplier_invoice",
      toId: { in: [...ids] },
      allocatedAmount: { not: null },
    },
    select: { kind: true, toType: true, toId: true, allocatedAmount: true },
  });
  return sumAllocated(links);
}

/** Σ allocations onto one invoice. */
export async function allocatedTo(tx: TransactionClient, invoiceId: string): Promise<Dec> {
  return (await allocatedSums(tx, [invoiceId])).get(invoiceId) ?? new D(0);
}
