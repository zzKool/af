// Σ of the issued credit notes of each original invoice — the one query the read model (`queries.ts`) and the
// issue-time limit (`issue.ts`) both ask (lessons audit 27). Drafts are not credits yet.
import { Prisma } from "@/generated/prisma/browser";
import type { TransactionClient } from "@/kernel/db/tenant-client";

const D = Prisma.Decimal;

/** Σ totals of the issued credit notes referencing each of `ids`, as 2-decimal strings; ids with none are absent. */
export async function creditedSum(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const credits = await tx.invoice.groupBy({
    by: ["relatedInvoiceId"],
    where: { type: "credit_note", status: { not: "draft" }, relatedInvoiceId: { in: [...ids] } },
    _sum: { totalAmount: true },
  });
  for (const c of credits)
    if (c.relatedInvoiceId)
      out.set(c.relatedInvoiceId, (c._sum.totalAmount ?? new D(0)).toFixed(2));
  return out;
}
