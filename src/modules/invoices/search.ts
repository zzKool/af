// Global search (F93, D56): quotes, invoices and credit notes — by number (`VA23-INV-001`), period label, total.
// Drafts too (no number yet: found by period or amount). One query; the client names of the shown hits in one
// batched read through partners' index.
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

export async function searchInvoiceHits(
  tx: TransactionClient,
  caller: CallerIdentity,
  raw: string,
): Promise<ServiceResult<SearchGroup>> {
  const q = parseSearchQuery(raw);
  const all = seeAllHref("/invoices", raw);
  if (!q || !can(caller, "read", "invoice")) return { data: emptyGroup("invoice", all) };

  const contains = { contains: q.text, mode: "insensitive" as const };
  const rows = await tx.invoice.findMany({
    where: {
      OR: [
        { number: contains },
        { periodLabel: contains },
        ...(q.amount ? [{ totalAmount: { in: [q.amount, `-${q.amount}`] } }] : []),
      ],
    },
    select: {
      id: true,
      number: true,
      partnerId: true,
      issueDate: true,
      periodLabel: true,
      totalAmount: true,
      currency: true,
    },
    orderBy: [{ issueDate: "desc" }],
    take: CANDIDATE_LIMIT,
  });

  const ranked = rows.flatMap((r) => {
    const amount = r.totalAmount.toFixed(2);
    const rank = rankOf(q, { keys: [r.number], texts: [r.periodLabel], amounts: [amount] });
    return rank === null ? [] : [{ r, amount, rank }];
  });
  const group = toGroup(
    "invoice",
    ranked.map(
      ({ r, amount, rank }): SearchHit => ({
        kind: "invoice",
        id: r.id,
        key: r.number,
        label: r.periodLabel ?? "",
        date: isoDate(r.issueDate),
        amount,
        currency: r.currency,
        href: `/invoices/${r.id}`,
        rank,
      }),
    ),
    all,
  );
  // the client's name on the shown hits only — one read for at most five ids
  const byId = new Map(rows.map((r) => [r.id, r.partnerId]));
  const names = await partners.partnerNames(tx, [
    ...new Set(group.hits.map((h) => byId.get(h.id) as string)),
  ]);
  for (const h of group.hits) {
    const name = names.get(byId.get(h.id) as string) ?? "";
    h.label = [name, h.label].filter(Boolean).join(" · ");
  }
  return { data: group };
}
