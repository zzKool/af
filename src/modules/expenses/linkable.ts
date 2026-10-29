import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { CandidateQuery, EntityFacts, Linkable } from "@/modules/linking";
import * as partners from "@/modules/partners";
import { payExpense, unpayExpense } from "./expenses";

type ExpenseRow = {
  id: string;
  key: string;
  date: Date;
  description: string;
  amount: { toFixed(n: number): string };
  currency: string;
  amountBase: { toFixed(n: number): string };
  note: string | null;
  partnerId: string | null;
  group: { number: number; description: string };
};

const EXPENSE_SELECT = {
  id: true,
  key: true,
  date: true,
  description: true,
  amount: true,
  currency: true,
  amountBase: true,
  note: true,
  partnerId: true,
  group: { select: { number: true, description: true } },
} as const;

/** The matcher's view: the receipt's amount in its currency, keyed `Ex213-Tr-01`, dated the receipt's day. */
function expenseFacts(
  e: ExpenseRow,
  partnerName: string | null = null,
): Omit<EntityFacts, "remaining"> {
  return {
    type: "expense",
    id: e.id,
    label: `${e.key} · ${e.date.toISOString().slice(0, 10)} · ${e.amount.toFixed(2)} ${e.currency} · ${e.description}`,
    amount: e.amount.toFixed(2),
    currency: e.currency,
    amountBase: e.amountBase.toFixed(2),
    date: e.date.toISOString().slice(0, 10),
    reference: e.key,
    partnerName,
    partnerId: e.partnerId,
    texts: [e.key, e.description, `${e.group.number} — ${e.group.description}`, e.note ?? ""],
    keywords: e.description.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4),
    direction: "outgoing",
  };
}

/** The facts with the partners' names — the scorer matches them and the memory names them (F116). */
async function toFacts(
  tx: TransactionClient,
  rows: readonly ExpenseRow[],
): Promise<Omit<EntityFacts, "remaining">[]> {
  const ids = [...new Set(rows.flatMap((r) => (r.partnerId ? [r.partnerId] : [])))];
  const names = ids.length ? await partners.partnerNames(tx, ids) : new Map<string, string>();
  return rows.map((e) => expenseFacts(e, e.partnerId ? (names.get(e.partnerId) ?? null) : null));
}

/**
 * An expense carries its own amount in its own currency, always (F114, D60): a bank row justifies it with an
 * allocation in that currency and the base the row gave; a refund row settles a private one the same way; a
 * document is what it was created from. The matcher proposes company-paid expenses still open.
 */
export const expenseLinkable: Linkable = {
  type: "expense",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.expense.count({ where: { id } })) > 0;
  },
  // the payment is this module's (D37): linking's *Link* / *Unlink* come through here (F124 (3))
  async pay(tx, caller, audit, input) {
    const r = await payExpense(tx, caller, audit, {
      expenseId: input.id,
      bankTransactionId: input.bankTransactionId,
      ...(input.amount ? { amount: input.amount } : {}),
    });
    return r.error ? { error: r.error } : { data: { linkId: r.data.linkId } };
  },
  async unpay(tx, caller, audit, input) {
    return unpayExpense(tx, caller, audit, { expenseId: input.id, linkId: input.linkId });
  },
  async summary(tx: TransactionClient, id: string) {
    const e = await tx.expense.findUnique({
      where: { id },
      select: {
        id: true,
        key: true,
        date: true,
        description: true,
        amount: true,
        currency: true,
        amountBase: true,
      },
    });
    if (!e) return null;
    return {
      type: "expense",
      id: e.id,
      label: `${e.key} · ${e.date.toISOString().slice(0, 10)} · ${e.amount.toFixed(2)} ${e.currency} · ${e.description}`,
      amount: e.amount.toFixed(2),
      currency: e.currency,
      amountBase: e.amountBase.toFixed(2),
    };
  },
  async facts(tx: TransactionClient, id: string) {
    const e = await tx.expense.findUnique({ where: { id }, select: EXPENSE_SELECT });
    return e ? ((await toFacts(tx, [e]))[0] ?? null) : null;
  },
  /** Many at once — the counterparty memory reads the partners of what rows were linked to (F116). */
  async factsMany(tx: TransactionClient, ids: readonly string[]) {
    if (ids.length === 0) return [];
    const rows = await tx.expense.findMany({
      where: { id: { in: [...ids] } },
      select: EXPENSE_SELECT,
    });
    return toFacts(tx, rows);
  },
  /** Company-paid expenses dated inside the (wider) window; linking drops the ones with nothing left open. */
  async candidates(tx: TransactionClient, q: CandidateQuery) {
    if (q.direction !== "outgoing") return [];
    const rows = await tx.expense.findMany({
      where: {
        paidFromAccount: { role: "main" },
        date: { gte: new Date(q.dateFrom), lte: new Date(q.dateTo) },
      },
      select: EXPENSE_SELECT,
      orderBy: [{ date: "desc" }],
      take: q.limit,
    });
    return toFacts(tx, rows);
  },
  async search(tx: TransactionClient, q: string, limit: number) {
    const rows = await tx.expense.findMany({
      where: {
        paidFromAccount: { role: "main" },
        OR: [
          { key: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      },
      select: EXPENSE_SELECT,
      orderBy: [{ date: "desc" }],
      take: limit,
    });
    return toFacts(tx, rows);
  },
};
