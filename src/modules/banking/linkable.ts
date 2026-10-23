import type { Prisma } from "@/generated/prisma/client";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import * as journal from "@/modules/journal";
import type { CandidateQuery, EntityFacts, Linkable } from "@/modules/linking";
import * as partners from "@/modules/partners";
import { accountLabel } from "./bank-accounts";

/**
 * A bank transaction carries |amount| in its currency: it justifies invoices / documents / expenses with
 * allocations (never more than its amount — the linking service checks the source side too), pairs with
 * another transaction (`transfer`) or settles a reimbursement. For the matcher it is the row: its SEK base is
 * the journal entry's, its texts are every field Nordea gave (name, message, details, sender, recipient).
 */
const ROW_SELECT = {
  id: true,
  bookingDate: true,
  amount: true,
  currency: true,
  description: true,
  name: true,
  message: true,
  additionalDetails: true,
  sender: true,
  recipient: true,
  bankAccount: true,
} as const satisfies Prisma.BankTransactionSelect;

/** the selected row — Prisma's own payload type (its Decimal, not a look-alike: lessons audit 30) */
type Row = Prisma.BankTransactionGetPayload<{ select: typeof ROW_SELECT }>;

async function toFacts(
  tx: TransactionClient,
  rows: Row[],
): Promise<Omit<EntityFacts, "remaining">[]> {
  const entries = await journal.entriesForSources(
    tx,
    "bank_transaction",
    rows.map((r) => r.id),
  );
  // the partner the owner (or a rule) put on the journal entry is a name the matcher may use
  const partnerIds = [...entries.values()].map((e) => e.partnerId).filter((p): p is string => !!p);
  const names = await partners.partnerNames(tx, [...new Set(partnerIds)]);
  return rows.map((t) => {
    const date = t.bookingDate.toISOString().slice(0, 10);
    const entry = entries.get(t.id);
    return {
      type: "bank_transaction" as const,
      id: t.id,
      label: `${date} · ${t.amount.toFixed(2)} ${t.currency} · ${t.description} · ${accountLabel(t.bankAccount)}`,
      amount: t.amount.abs().toFixed(2),
      currency: t.currency,
      amountBase: entry ? entry.amountBase.replace(/^-/, "") : null,
      date,
      reference: null,
      partnerName: entry?.partnerId ? (names.get(entry.partnerId) ?? null) : null,
      texts: [t.name, t.message, t.additionalDetails, t.sender, t.recipient, t.description].map(
        (s) => s ?? "",
      ),
      direction: t.amount.gt(0) ? ("incoming" as const) : ("outgoing" as const),
    };
  });
}

export const bankTransactionLinkable: Linkable = {
  type: "bank_transaction",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.bankTransaction.count({ where: { id } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const t = await tx.bankTransaction.findUnique({
      where: { id },
      select: { id: true, bookingDate: true, amount: true, currency: true, description: true },
    });
    if (!t) return null;
    return {
      type: "bank_transaction",
      id: t.id,
      label: `${t.bookingDate.toISOString().slice(0, 10)} · ${t.amount.toFixed(2)} ${t.currency} · ${t.description}`,
      amount: t.amount.abs().toFixed(2),
      currency: t.currency,
    };
  },
  async facts(tx: TransactionClient, id: string) {
    const t = await tx.bankTransaction.findUnique({ where: { id }, select: ROW_SELECT });
    if (!t) return null;
    const [f] = await toFacts(tx, [t]);
    return f ?? null;
  },
  async factsMany(tx: TransactionClient, ids: readonly string[]) {
    if (ids.length === 0) return [];
    const rows = await tx.bankTransaction.findMany({
      where: { id: { in: [...ids] } },
      select: ROW_SELECT,
    });
    return toFacts(tx, rows);
  },
  /** Main-account rows of the direction, booked inside the window, newest first. */
  async candidates(tx: TransactionClient, q: CandidateQuery) {
    const rows = await tx.bankTransaction.findMany({
      where: {
        bankAccount: { role: "main" },
        amount: q.direction === "incoming" ? { gt: 0 } : { lt: 0 },
        bookingDate: { gte: new Date(q.dateFrom), lte: new Date(q.dateTo) },
      },
      select: ROW_SELECT,
      orderBy: [{ bookingDate: "desc" }],
      take: q.limit,
    });
    return toFacts(tx, rows);
  },
  async search(tx: TransactionClient, q: string, limit: number) {
    const rows = await tx.bankTransaction.findMany({
      where: {
        OR: [
          { description: { contains: q, mode: "insensitive" } },
          { message: { contains: q, mode: "insensitive" } },
          { additionalDetails: { contains: q, mode: "insensitive" } },
          { counterpartyKey: { contains: q, mode: "insensitive" } },
        ],
      },
      select: ROW_SELECT,
      orderBy: [{ bookingDate: "desc" }],
      take: limit,
    });
    return toFacts(tx, rows);
  },
};
