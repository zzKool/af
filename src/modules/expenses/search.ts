// Global search (F93, D56): expenses — by key (`Ex213-Tr-01`), description, note, amount or what the bank paid —
// and reimbursement settlements — by number (`ST23-001`), note, refund. One query each.
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

export async function searchExpenseHits(
  tx: TransactionClient,
  caller: CallerIdentity,
  raw: string,
): Promise<ServiceResult<SearchGroup>> {
  const q = parseSearchQuery(raw);
  const all = seeAllHref("/expenses", raw);
  if (!q || !can(caller, "read", "expense")) return { data: emptyGroup("expense", all) };

  const contains = { contains: q.text, mode: "insensitive" as const };
  const rows = await tx.expense.findMany({
    where: {
      OR: [
        { key: contains },
        { description: contains },
        { note: contains },
        ...(q.amount ? [{ amount: q.amount }, { paidAmount: q.amount }] : []),
      ],
    },
    select: {
      id: true,
      key: true,
      date: true,
      description: true,
      note: true,
      amount: true,
      paidAmount: true,
      currency: true,
    },
    orderBy: [{ date: "desc" }],
    take: CANDIDATE_LIMIT,
  });

  const hits: SearchHit[] = rows.flatMap((r) => {
    const amount = r.amount.toFixed(2);
    const rank = rankOf(q, {
      keys: [r.key],
      names: [r.description],
      texts: [r.note],
      amounts: [amount, r.paidAmount?.toFixed(2)],
    });
    return rank === null
      ? []
      : [
          {
            kind: "expense" as const,
            id: r.id,
            key: r.key,
            label: r.description,
            date: isoDate(r.date),
            amount,
            currency: r.currency,
            href: `/expenses?open=${r.id}`,
            rank,
          },
        ];
  });
  return { data: toGroup("expense", hits, all) };
}

export async function searchSettlementHits(
  tx: TransactionClient,
  caller: CallerIdentity,
  raw: string,
): Promise<ServiceResult<SearchGroup>> {
  const q = parseSearchQuery(raw);
  const all = seeAllHref("/expenses/settlements", raw);
  if (!q || !can(caller, "read", "settlement")) return { data: emptyGroup("settlement", all) };

  const contains = { contains: q.text, mode: "insensitive" as const };
  const rows = await tx.settlement.findMany({
    where: {
      OR: [
        { number: contains },
        { note: contains },
        ...(q.amount ? [{ refundAmount: { in: [q.amount, `-${q.amount}`] } }] : []),
      ],
    },
    select: {
      id: true,
      number: true,
      note: true,
      refundAmount: true,
      refundCurrency: true,
      createdAt: true,
      paymentSource: { select: { label: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: CANDIDATE_LIMIT,
  });

  const hits: SearchHit[] = rows.flatMap((r) => {
    const amount = r.refundAmount.toFixed(2);
    const rank = rankOf(q, { keys: [r.number], texts: [r.note], amounts: [amount] });
    return rank === null
      ? []
      : [
          {
            kind: "settlement" as const,
            id: r.id,
            key: r.number,
            label: [r.paymentSource.label, r.note].filter(Boolean).join(" · "),
            date: isoDate(r.createdAt),
            amount,
            currency: r.refundCurrency,
            href: `/expenses/settlements/${r.id}`,
            rank,
          },
        ];
  });
  return { data: toGroup("settlement", hits, all) };
}
