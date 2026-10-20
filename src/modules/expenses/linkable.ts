import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { CandidateQuery, EntityFacts, Linkable } from "@/modules/linking";

type ExpenseRow = {
  id: string;
  key: string;
  date: Date;
  description: string;
  amount: { toFixed(n: number): string };
  currency: string;
  amountBase: { toFixed(n: number): string };
  paidAmount: { toFixed(n: number): string } | null;
  paidCurrency: string | null;
  note: string | null;
  paymentSource: { kind: string; label: string };
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
  paidAmount: true,
  paidCurrency: true,
  note: true,
  paymentSource: { select: { kind: true, label: true } },
  group: { select: { number: true, description: true } },
} as const;

/** The matcher's view: what the company paid (or will pay) for it, keyed `Ex213-Tr-01`, dated the receipt's day. */
function expenseFacts(e: ExpenseRow): Omit<EntityFacts, "remaining"> {
  const amount = e.paidAmount ?? e.amount;
  const currency = e.paidCurrency ?? e.currency;
  return {
    type: "expense",
    id: e.id,
    label: `${e.key} · ${e.date.toISOString().slice(0, 10)} · ${e.amount.toFixed(2)} ${e.currency} · ${e.description}`,
    amount: amount.toFixed(2),
    currency,
    amountBase: e.amountBase.toFixed(2),
    date: e.date.toISOString().slice(0, 10),
    reference: e.key,
    partnerName: null,
    texts: [e.key, e.description, `${e.group.number} — ${e.group.description}`, e.note ?? ""],
    keywords: e.description.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4),
    direction: "outgoing",
  };
}

/**
 * An expense carries what the company paid for it: the bank row's amount once attached (company-paid), else the
 * receipt's amount in its currency. A bank row justifies it (allocation = the paid amount); a document is what it
 * was created from. Private expenses are refunded through settlements, not links.
 */
export const expenseLinkable: Linkable = {
  type: "expense",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.expense.count({ where: { id } })) > 0;
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
        paidAmount: true,
        paidCurrency: true,
      },
    });
    if (!e) return null;
    const amount = e.paidAmount ?? e.amount;
    const currency = e.paidCurrency ?? e.currency;
    return {
      type: "expense",
      id: e.id,
      label: `${e.key} · ${e.date.toISOString().slice(0, 10)} · ${e.amount.toFixed(2)} ${e.currency} · ${e.description}`,
      amount: amount.toFixed(2),
      currency,
    };
  },
  async facts(tx: TransactionClient, id: string) {
    const e = await tx.expense.findUnique({ where: { id }, select: EXPENSE_SELECT });
    return e ? expenseFacts(e) : null;
  },
  /** Company-paid expenses still without their bank row, dated inside the (wider) window. */
  async candidates(tx: TransactionClient, q: CandidateQuery) {
    if (q.direction !== "outgoing") return [];
    const rows = await tx.expense.findMany({
      where: {
        paymentSource: { kind: "bank_account" },
        paidAmount: null,
        date: { gte: new Date(q.dateFrom), lte: new Date(q.dateTo) },
      },
      select: EXPENSE_SELECT,
      orderBy: [{ date: "desc" }],
      take: q.limit,
    });
    return rows.map(expenseFacts);
  },
  async search(tx: TransactionClient, q: string, limit: number) {
    const rows = await tx.expense.findMany({
      where: {
        paymentSource: { kind: "bank_account" },
        OR: [
          { key: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      },
      select: EXPENSE_SELECT,
      orderBy: [{ date: "desc" }],
      take: limit,
    });
    return rows.map(expenseFacts);
  },
};

/** A settlement carries |the refund amount| in the refund currency; the refund's bank row `settles` it. */
export const settlementLinkable: Linkable = {
  type: "settlement",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.settlement.count({ where: { id } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const s = await tx.settlement.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        refundAmount: true,
        refundCurrency: true,
        allocatedBase: true,
        status: true,
      },
    });
    if (!s) return null;
    return {
      type: "settlement",
      id: s.id,
      label: `${s.number} · ${s.refundAmount.abs().toFixed(2)} ${s.refundCurrency} · ${s.allocatedBase.toFixed(2)} SEK settled${s.status === "cancelled" ? " · cancelled" : ""}`,
      amount: s.refundAmount.abs().toFixed(2),
      currency: s.refundCurrency,
    };
  },
};
