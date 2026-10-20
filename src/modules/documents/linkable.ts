import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { OcrExtractedData } from "@/kernel/ocr/ocr";
import type { CandidateQuery, EntityFacts, Linkable } from "@/modules/linking";
import { resolveDocumentData } from "./documents";

/**
 * Documents are justification targets and belong to partners/contracts. A financial document carries the amount,
 * currency and date OCR read (with the owner's corrections) — that is what the matcher compares; a document
 * without an amount can still be linked, without an allocation.
 */
type Row = {
  id: string;
  businessKey: string;
  fileName: string;
  status: string;
  documentType: string;
  createdAt: Date;
  ocrData: unknown;
  corrections: unknown;
};

export const ROW_SELECT = {
  id: true,
  businessKey: true,
  fileName: true,
  status: true,
  documentType: true,
  createdAt: true,
  ocrData: true,
  corrections: true,
} as const;

function resolved(r: Row): Partial<OcrExtractedData> {
  const parsed = r.ocrData as { extractedData?: OcrExtractedData } | null;
  return resolveDocumentData(
    parsed?.extractedData ?? null,
    (r.corrections as Partial<OcrExtractedData> | null) ?? null,
  );
}

export function documentFacts(r: Row): Omit<EntityFacts, "remaining"> {
  const d = resolved(r);
  const amount =
    d.invoiceTotal !== undefined && d.invoiceTotal !== null ? Number(d.invoiceTotal) : 0;
  const vendor = d.vendorName ?? d.merchantName ?? null;
  return {
    type: "document",
    id: r.id,
    label: `${r.businessKey || r.fileName}${vendor ? ` · ${vendor}` : ""}${amount ? ` · ${amount.toFixed(2)} ${d.currency ?? ""}` : ""}`,
    amount: amount > 0 ? amount.toFixed(2) : "0.00",
    currency: (d.currency ?? "").toUpperCase() || "SEK",
    amountBase: null,
    date: d.invoiceDate ?? d.transactionDate ?? r.createdAt.toISOString().slice(0, 10),
    reference: d.invoiceNumber ?? null,
    partnerName: vendor,
    texts: [r.businessKey, r.fileName, vendor ?? "", d.invoiceNumber ?? ""],
    keywords: (vendor ?? "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4),
    direction: "outgoing",
  };
}

/** Documents that became nothing (no `created_from`) and justify nothing yet. */
export async function unlinkedIds(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const links = await tx.link.findMany({
    where: {
      OR: [
        { kind: "created_from", toType: "document", toId: { in: [...ids] } },
        { kind: "justifies", toType: "document", toId: { in: [...ids] } },
      ],
    },
    select: { toId: true },
  });
  const taken = new Set(links.map((l) => l.toId));
  return new Set(ids.filter((id) => !taken.has(id)));
}

export const documentLinkable: Linkable = {
  type: "document",
  async exists(tx: TransactionClient, id: string) {
    return (await tx.document.count({ where: { id } })) > 0;
  },
  async summary(tx: TransactionClient, id: string) {
    const d = await tx.document.findUnique({ where: { id }, select: ROW_SELECT });
    if (!d) return null;
    const f = documentFacts(d);
    return {
      type: "document",
      id: d.id,
      label: d.businessKey || d.fileName,
      amount: f.amount === "0.00" ? null : f.amount,
      currency: f.amount === "0.00" ? null : f.currency,
    };
  },
  async facts(tx: TransactionClient, id: string) {
    const d = await tx.document.findUnique({ where: { id }, select: ROW_SELECT });
    return d ? documentFacts(d) : null;
  },
  /** Financial uploads with an OCR amount, dated inside the window, that became nothing and justify nothing. */
  async candidates(tx: TransactionClient, q: CandidateQuery) {
    if (q.direction !== "outgoing") return [];
    const rows = await tx.document.findMany({
      where: { documentType: "financial", status: { notIn: ["generated", "processing"] } },
      select: ROW_SELECT,
      orderBy: { createdAt: "desc" },
      take: 400,
    });
    const free = await unlinkedIds(
      tx,
      rows.map((r) => r.id),
    );
    return rows
      .filter((r) => free.has(r.id))
      .map(documentFacts)
      .filter((f) => f.amount !== "0.00" && f.date >= q.dateFrom && f.date <= q.dateTo)
      .slice(0, q.limit);
  },
  async search(tx: TransactionClient, q: string, limit: number) {
    const rows = await tx.document.findMany({
      where: {
        status: { not: "generated" },
        OR: [
          { businessKey: { contains: q, mode: "insensitive" } },
          { fileName: { contains: q, mode: "insensitive" } },
        ],
      },
      select: ROW_SELECT,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(documentFacts);
  },
};

/** Financial uploads that became nothing and justify nothing (the linking inbox's documents tab), newest first. */
export async function unlinkedFinancialDocuments(
  tx: TransactionClient,
  limit = 200,
): Promise<Omit<EntityFacts, "remaining">[]> {
  const rows = await tx.document.findMany({
    where: { documentType: "financial", status: { notIn: ["generated", "processing"] } },
    select: ROW_SELECT,
    orderBy: { createdAt: "desc" },
    take: limit * 2,
  });
  const free = await unlinkedIds(
    tx,
    rows.map((r) => r.id),
  );
  return rows
    .filter((r) => free.has(r.id))
    .slice(0, limit)
    .map(documentFacts);
}
