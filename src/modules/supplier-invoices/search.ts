// Global search (F93, D56): supplier invoices — by key (`SI213-Acc-01`), the supplier's own number (`9160`), the
// total or what the bank paid. One query; the suppliers' names of the shown hits in one batched read.
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import {
  emptyGroup,
  isoDate,
  parseSearchQuery,
  rankOf,
  seeAllHref,
  toGroup,
} from "@/kernel/search/query";
import { CANDIDATE_LIMIT, type SearchGroup, type SearchHit } from "@/kernel/search/types";
import * as partners from "@/modules/partners";

export async function searchSupplierInvoiceHits(
  tx: TransactionClient,
  caller: CallerIdentity,
  raw: string,
): Promise<ServiceResult<SearchGroup>> {
  const q = parseSearchQuery(raw);
  const all = seeAllHref("/supplier-invoices", raw);
  if (!q || !can(caller, "read", "supplier_invoice")) {
    return { data: emptyGroup("supplier_invoice", all) };
  }

  const contains = { contains: q.text, mode: "insensitive" as const };
  const rows = await tx.supplierInvoice.findMany({
    where: {
      OR: [
        { key: contains },
        { invoiceNumber: contains },
        { note: contains },
        ...(q.amount ? [{ amountTotal: q.amount }] : []),
      ],
    },
    select: {
      id: true,
      key: true,
      invoiceNumber: true,
      partnerId: true,
      invoiceDate: true,
      note: true,
      amountTotal: true,
      currency: true,
    },
    orderBy: [{ invoiceDate: "desc" }],
    take: CANDIDATE_LIMIT,
  });

  const ranked = rows.flatMap((r) => {
    const amount = r.amountTotal.toFixed(2);
    const rank = rankOf(q, {
      keys: [r.key, r.invoiceNumber],
      texts: [r.note],
      amounts: [amount],
    });
    return rank === null ? [] : [{ r, amount, rank }];
  });
  const group = toGroup(
    "supplier_invoice",
    ranked.map(
      ({ r, amount, rank }): SearchHit => ({
        kind: "supplier_invoice",
        id: r.id,
        key: r.key,
        label: `#${r.invoiceNumber}`,
        date: isoDate(r.invoiceDate),
        amount,
        currency: r.currency,
        href: `/supplier-invoices?open=${r.id}`,
        rank,
      }),
    ),
    all,
  );
  const byId = new Map(rows.map((r) => [r.id, r.partnerId]));
  const names = await partners.partnerNames(tx, [
    ...new Set(group.hits.map((h) => byId.get(h.id) as string)),
  ]);
  for (const h of group.hits) {
    const name = names.get(byId.get(h.id) as string);
    if (name) h.label = `${name} · ${h.label}`;
  }
  return { data: group };
}
