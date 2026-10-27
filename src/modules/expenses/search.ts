// Global search (F93, D56): expenses — by key (`Ex213-Tr-01`), description, note, amount or what the bank paid —
// and reimbursement settlements — by number (`ST23-001`), note, refund. One query each.
import { Prisma } from "@/generated/prisma/browser";
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
import * as banking from "@/modules/banking";
import * as linking from "@/modules/linking";

/** the payer as `accountLabel` wants it */
const PAYER_SELECT = {
  select: { accountAlias: true, accountNumber: true, currency: true },
} as const;

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
        ...(q.amount ? [{ amount: q.amount }] : []),
      ],
    },
    select: {
      id: true,
      key: true,
      date: true,
      description: true,
      note: true,
      amount: true,
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
      amounts: [amount],
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
  // the refund's amount is the row's (F114): the number and the note match here, the amount through the rows
  const byAmount = q.amount
    ? await banking.transactionIdsByAmount(tx, q.amount, CANDIDATE_LIMIT)
    : [];
  const rows = await tx.settlement.findMany({
    where: {
      OR: [
        { number: contains },
        { note: contains },
        ...(byAmount.length > 0 ? [{ bankTransactionId: { in: byAmount } }] : []),
      ],
    },
    select: { id: true, number: true, note: true, createdAt: true, bankTransactionId: true },
    orderBy: [{ createdAt: "desc" }],
    take: CANDIDATE_LIMIT,
  });
  const rowIds = rows.map((r) => r.bankTransactionId);
  const refunds = await banking.transactionFacts(tx, rowIds);
  // who was refunded: the private instruments of the expenses its `settles` links reach
  const settles = await linking.linksTouching(tx, "bank_transaction", rowIds, {
    kinds: ["settles"],
  });
  const expenseIds = [...new Set(settles.map((l) => l.to.id))];
  const payers = new Map(
    (
      await tx.expense.findMany({
        where: { id: { in: expenseIds } },
        select: { id: true, paidFromAccount: PAYER_SELECT },
      })
    ).map((e) => [e.id, banking.accountLabel(e.paidFromAccount)]),
  );
  const payeesOf = (rowId: string): string[] =>
    [
      ...new Set(
        settles
          .filter((l) => l.from.id === rowId)
          .flatMap((l) => {
            const p = payers.get(l.to.id);
            return p ? [p] : [];
          }),
      ),
    ].sort();

  const hits: SearchHit[] = rows.flatMap((r) => {
    const t = refunds.get(r.bankTransactionId);
    const amount = t ? new Prisma.Decimal(t.amount).abs().toFixed(2) : "0.00";
    const rank = rankOf(q, { keys: [r.number], texts: [r.note], amounts: [amount] });
    const payees = payeesOf(r.bankTransactionId).join(", ");
    return rank === null
      ? []
      : [
          {
            kind: "settlement" as const,
            id: r.id,
            key: r.number,
            label: [payees || t?.bookingDate, r.note].filter(Boolean).join(" · "),
            date: isoDate(r.createdAt),
            amount,
            currency: t?.currency ?? "",
            href: `/expenses/settlements/${r.id}`,
            rank,
          },
        ];
  });
  return { data: toGroup("settlement", hits, all) };
}
