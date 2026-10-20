import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { CandidateQuery, EntityFacts, Linkable } from "@/modules/linking";
import * as partners from "@/modules/partners";

/** Issued invoices and credit notes carry an amount: bank transactions justify them with allocations (D18). */
type Row = {
  id: string;
  number: string | null;
  type: "quote" | "invoice" | "credit_note";
  status: string;
  partnerId: string;
  issueDate: Date;
  totalAmount: { toFixed(n: number): string };
  totalBase: { toFixed(n: number): string } | null;
  currency: string;
  periodLabel: string | null;
};

const ROW_SELECT = {
  id: true,
  number: true,
  type: true,
  status: true,
  partnerId: true,
  issueDate: true,
  totalAmount: true,
  totalBase: true,
  currency: true,
  periodLabel: true,
} as const;

async function toFacts(
  tx: TransactionClient,
  rows: Row[],
): Promise<Omit<EntityFacts, "remaining">[]> {
  const names = await partners.partnerNames(tx, [...new Set(rows.map((r) => r.partnerId))]);
  return rows
    .filter((r) => r.type !== "quote" && r.status !== "draft")
    .map((r) => {
      const partner = names.get(r.partnerId) ?? null;
      return {
        type: "invoice" as const,
        id: r.id,
        label: `${r.number ?? r.id} · ${partner ?? "?"} · ${r.totalAmount.toFixed(2)} ${r.currency}${r.type === "credit_note" ? " · credit note" : ""}`,
        amount: r.totalAmount.toFixed(2),
        currency: r.currency,
        amountBase: r.totalBase ? r.totalBase.toFixed(2) : null,
        date: r.issueDate.toISOString().slice(0, 10),
        reference: r.number,
        partnerName: partner,
        texts: [r.number ?? "", partner ?? "", r.periodLabel ?? ""],
        // a client pays an invoice (money in); a credit note is refunded to the client (money out)
        direction: r.type === "credit_note" ? ("outgoing" as const) : ("incoming" as const),
      };
    });
}

export const invoiceLinkable: Linkable = {
  type: "invoice",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.invoice.count({ where: { id, status: { not: "draft" } } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const inv = await tx.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
        totalAmount: true,
        currency: true,
      },
    });
    if (!inv || inv.status === "draft") return null;
    return {
      type: "invoice",
      id: inv.id,
      label: inv.number ?? inv.id,
      // quotes are not paid; invoices and credit notes carry their total
      amount: inv.type === "quote" ? null : inv.totalAmount.toFixed(2),
      currency: inv.type === "quote" ? null : inv.currency,
    };
  },
  async facts(tx: TransactionClient, id: string) {
    const inv = await tx.invoice.findUnique({ where: { id }, select: ROW_SELECT });
    if (!inv) return null;
    const [f] = await toFacts(tx, [inv]);
    return f ?? null;
  },
  /** Issued / sent invoices for incoming rows, credit notes for outgoing ones, issued inside the window. */
  async candidates(tx: TransactionClient, q: CandidateQuery) {
    const rows = await tx.invoice.findMany({
      where: {
        type: q.direction === "incoming" ? "invoice" : "credit_note",
        status: { in: ["issued", "sent"] },
        issueDate: { gte: new Date(q.dateFrom), lte: new Date(q.dateTo) },
      },
      select: ROW_SELECT,
      orderBy: [{ issueDate: "desc" }],
      take: q.limit,
    });
    return toFacts(tx, rows);
  },
  async search(tx: TransactionClient, q: string, limit: number) {
    const partnerIds = ((await partners.searchPartners(tx, q)).data ?? []).map((p) => p.id);
    const rows = await tx.invoice.findMany({
      where: {
        type: { not: "quote" },
        status: { in: ["issued", "sent"] },
        OR: [{ number: { contains: q, mode: "insensitive" } }, { partnerId: { in: partnerIds } }],
      },
      select: ROW_SELECT,
      orderBy: [{ issueDate: "desc" }],
      take: limit,
    });
    return toFacts(tx, rows);
  },
};
