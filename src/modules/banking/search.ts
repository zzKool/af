// Global search (F93, D56): bank rows — by their texts (description, name, message, details, reference, own notes,
// the normalised counterparty) and by amount in either direction. One query, newest first.
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

export async function searchBankTransactionHits(
  tx: TransactionClient,
  caller: CallerIdentity,
  raw: string,
): Promise<ServiceResult<SearchGroup>> {
  const q = parseSearchQuery(raw);
  const all = seeAllHref("/banking", raw);
  if (!q || !can(caller, "read", "bank_transaction")) {
    return { data: emptyGroup("bank_transaction", all) };
  }

  const contains = { contains: q.text, mode: "insensitive" as const };
  const rows = await tx.bankTransaction.findMany({
    where: {
      OR: [
        { description: contains },
        { name: contains },
        { message: contains },
        { additionalDetails: contains },
        { reference: contains },
        { ownNotes: contains },
        { counterpartyKey: contains },
        ...(q.amount ? [{ amount: { in: [q.amount, `-${q.amount}`] } }] : []),
      ],
    },
    select: {
      id: true,
      bookingDate: true,
      amount: true,
      currency: true,
      description: true,
      name: true,
      message: true,
      additionalDetails: true,
      reference: true,
      ownNotes: true,
      counterpartyKey: true,
    },
    orderBy: [{ bookingDate: "desc" }, { rowIndex: "asc" }],
    take: CANDIDATE_LIMIT,
  });

  const hits: SearchHit[] = rows.flatMap((r) => {
    const amount = r.amount.toFixed(2);
    const rank = rankOf(q, {
      keys: [r.reference],
      names: [r.description, r.name],
      texts: [r.message, r.additionalDetails, r.ownNotes, r.counterpartyKey],
      amounts: [amount],
    });
    return rank === null
      ? []
      : [
          {
            kind: "bank_transaction" as const,
            id: r.id,
            key: null,
            label: r.description,
            date: isoDate(r.bookingDate),
            amount,
            currency: r.currency,
            href: `/banking?open=${r.id}`,
            rank,
          },
        ];
  });
  return { data: toGroup("bank_transaction", hits, all) };
}
