import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { CandidateQuery, EntityFacts, Linkable } from "@/modules/linking";
import * as partners from "@/modules/partners";

type Row = {
  id: string;
  key: string;
  partnerId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  amountTotal: { toFixed(n: number): string };
  amountBase: { toFixed(n: number): string };
  currency: string;
  note: string | null;
  cancelled: boolean;
};

const ROW_SELECT = {
  id: true,
  key: true,
  partnerId: true,
  invoiceNumber: true,
  invoiceDate: true,
  dueDate: true,
  amountTotal: true,
  amountBase: true,
  currency: true,
  note: true,
  cancelled: true,
} as const;

/** The matcher's view: the supplier's own number is the reference, its name the partner, dated the invoice day. */
async function toFacts(
  tx: TransactionClient,
  rows: Row[],
): Promise<Omit<EntityFacts, "remaining">[]> {
  const names = await partners.partnerNames(tx, [...new Set(rows.map((r) => r.partnerId))]);
  return rows.map((si) => {
    const partner = names.get(si.partnerId) ?? null;
    return {
      type: "supplier_invoice" as const,
      id: si.id,
      label: `${si.key} · ${partner ?? "?"} · ${si.invoiceNumber} · ${si.amountTotal.toFixed(2)} ${si.currency}${si.cancelled ? " · cancelled" : ""}`,
      amount: si.amountTotal.toFixed(2),
      currency: si.currency,
      amountBase: si.amountBase.toFixed(2),
      date: si.invoiceDate.toISOString().slice(0, 10),
      reference: si.invoiceNumber,
      partnerName: partner,
      texts: [si.key, si.invoiceNumber, partner ?? "", si.note ?? ""],
      direction: "outgoing" as const,
    };
  });
}

/**
 * A supplier invoice carries what the company owes for it: the bank row's amount once a cross-currency payment is
 * attached (`paid_amount / paid_currency`, D-g), else the invoice total in its currency. Bank rows `justify` it —
 * the allocations are the payments; a document is what it was created from.
 */
export const supplierInvoiceLinkable: Linkable = {
  type: "supplier_invoice",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.supplierInvoice.count({ where: { id } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const si = await tx.supplierInvoice.findUnique({
      where: { id },
      select: {
        id: true,
        key: true,
        partnerId: true,
        invoiceNumber: true,
        amountTotal: true,
        amountBase: true,
        currency: true,
        cancelled: true,
      },
    });
    if (!si) return null;
    const names = await partners.partnerNames(tx, [si.partnerId]);
    return {
      type: "supplier_invoice",
      id: si.id,
      label: `${si.key} · ${names.get(si.partnerId) ?? "?"} · ${si.invoiceNumber} · ${si.amountTotal.toFixed(2)} ${si.currency}${si.cancelled ? " · cancelled" : ""}`,
      amount: si.amountTotal.toFixed(2),
      currency: si.currency,
      amountBase: si.amountBase.toFixed(2),
    };
  },
  async facts(tx: TransactionClient, id: string) {
    const si = await tx.supplierInvoice.findUnique({ where: { id }, select: ROW_SELECT });
    if (!si || si.cancelled) return null;
    const [f] = await toFacts(tx, [si]);
    return f ?? null;
  },
  /** Open payables dated inside the window (the linking module drops the ones already paid). */
  async candidates(tx: TransactionClient, q: CandidateQuery) {
    if (q.direction !== "outgoing") return [];
    const rows = await tx.supplierInvoice.findMany({
      where: {
        cancelled: false,
        invoiceDate: { gte: new Date(q.dateFrom), lte: new Date(q.dateTo) },
      },
      select: ROW_SELECT,
      orderBy: [{ invoiceDate: "desc" }],
      take: q.limit,
    });
    return toFacts(tx, rows);
  },
  async search(tx: TransactionClient, q: string, limit: number) {
    const partnerIds = ((await partners.searchPartners(tx, q)).data ?? []).map((p) => p.id);
    const rows = await tx.supplierInvoice.findMany({
      where: {
        cancelled: false,
        OR: [
          { key: { contains: q, mode: "insensitive" } },
          { invoiceNumber: { contains: q, mode: "insensitive" } },
          { partnerId: { in: partnerIds } },
        ],
      },
      select: ROW_SELECT,
      orderBy: [{ invoiceDate: "desc" }],
      take: limit,
    });
    return toFacts(tx, rows);
  },
};
