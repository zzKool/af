// Read API of the module — the functions pages and other modules may call for data: the single reads of
// `documents.ts` and the ListQuery read model of the library (D20): stored columns in SQL, the OCR facts
// (vendor, amount, date — as corrected) and "linked" (a created_from or justifies link points at it) joined in
// memory over that set, then the derived filters, search, sort and page (cap 20 000).
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { filterInMemory, finishList } from "@/kernel/list-query/memory";
import { buildDateHierarchy, buildWhere, countDistinct } from "@/kernel/list-query/prisma";
import type {
  ColumnMap,
  DateHierarchy,
  DistinctValue,
  ListQuery,
  ListResult,
} from "@/kernel/list-query/types";
import type { OcrExtractedData } from "@/kernel/ocr/ocr";
import { createdFromTargets } from "@/modules/linking";
import {
  duplicateOfMap,
  type InboxCounts,
  type InboxState,
  type InboxTab,
  inboxCounts,
  inboxState,
  inTab,
} from "./inbox";
import { DOCUMENT_COLUMNS, DOCUMENT_DEFAULT_SORT, type DocumentColumn } from "./library-columns";
import { unlinkedIds } from "./linkable";
import { amountText, parseCorrections, parseOcrPayload, resolveDocumentData } from "./ocr-payload";

export {
  getDocumentDownloadUrl,
  getDocumentStats,
  getDocuments,
  getRecentDocuments,
} from "./library";
export {
  DOCUMENT_COLUMN_KEYS,
  DOCUMENT_COLUMNS,
  DOCUMENT_DEFAULT_SORT,
  type DocumentColumn,
} from "./library-columns";
export { getDocument, getDocumentForReview, getDocumentOcrData } from "./review";

const DERIVED: ReadonlySet<string> = new Set([
  "vendor",
  "amount",
  "currency",
  "documentDate",
  "linked",
]);
const STORED_COLUMNS: ColumnMap = Object.fromEntries(
  Object.entries(DOCUMENT_COLUMNS).filter(([k]) => !DERIVED.has(k)),
);
const ROW_CAP = 20_000;

/** What a document became (FR-005): the entity created from it, with its key. */
export type DocumentBecame = {
  type: "expense" | "supplier_invoice";
  id: string;
  /** the entity's key (Ex213-Tr-04) and its full label (key · date · amount · text) */
  key: string | null;
  label: string | null;
};

/** One row of the library. */
export type DocumentListRow = {
  id: string;
  businessKey: string;
  fileName: string;
  prefixType: string;
  documentType: string;
  status: string;
  mimeType: string;
  fileSize: number;
  /** the OCR facts as corrected on review */
  vendor: string | null;
  amount: string | null;
  currency: string | null;
  documentDate: string | null;
  /** an expense / supplier invoice became from it, or a bank row justifies it */
  linked: boolean;
  /** what it became (its `created_from` target, with the entity's key) — filled on the page rows only */
  became: DocumentBecame | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

async function loadRows(
  tx: TransactionClient,
  caller: CallerIdentity,
  q: ListQuery,
  options: { exceptColumn?: string } = {},
): Promise<DocumentListRow[]> {
  // the accountant sees financial documents only (can): the base of every query
  const base = can(caller, "read", "relationship_document") ? {} : { documentType: "financial" };
  const where = buildWhere({ ...q, search: undefined }, STORED_COLUMNS, {
    exceptColumn: options.exceptColumn,
    base,
  });
  const rows = await tx.document.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: ROW_CAP,
    select: {
      id: true,
      businessKey: true,
      fileName: true,
      prefixType: true,
      documentType: true,
      status: true,
      mimeType: true,
      fileSize: true,
      reviewedAt: true,
      createdAt: true,
      ocrData: true,
      corrections: true,
    },
  });
  const free = await unlinkedIds(
    tx,
    rows.map((r) => r.id),
  );
  const list: DocumentListRow[] = rows.map((r) => {
    const resolved = resolveDocumentData(
      parseOcrPayload(r.ocrData)?.extractedData ?? null,
      parseCorrections(r.corrections),
    );
    return {
      id: r.id,
      businessKey: r.businessKey,
      fileName: r.fileName,
      prefixType: r.prefixType,
      documentType: r.documentType,
      status: r.status,
      mimeType: r.mimeType,
      fileSize: r.fileSize,
      vendor: resolved.vendorName ?? resolved.merchantName ?? null,
      amount: amountText(resolved.invoiceTotal),
      currency: resolved.currency ?? null,
      documentDate: resolved.invoiceDate ?? resolved.transactionDate ?? null,
      linked: !free.has(r.id),
      became: null,
      reviewedAt: r.reviewedAt,
      createdAt: r.createdAt,
    };
  });
  return filterInMemory(list, q, DOCUMENT_COLUMNS, {
    derived: DERIVED,
    search: searchHit,
    exceptColumn: options.exceptColumn,
  });
}

function searchHit(row: DocumentListRow, term: string): boolean {
  const t = term.toLowerCase();
  return [row.businessKey, row.fileName, row.vendor].some((v) =>
    (v ?? "").toLowerCase().includes(t),
  );
}

export async function listDocuments(
  tx: TransactionClient,
  caller: CallerIdentity,
  q: ListQuery,
): Promise<ListResult<DocumentListRow>> {
  const all = await loadRows(tx, caller, q);
  const page = finishList(all, q, DOCUMENT_COLUMNS, DOCUMENT_DEFAULT_SORT);
  // what each row of the page became, with the entity's key (FR-005) — labels for one page, not the whole set
  const became = await createdFromTargets(
    tx,
    page.rows.filter((r) => r.linked).map((r) => r.id),
    { labels: true },
  );
  return {
    ...page,
    rows: page.rows.map((r) => {
      const b = became.get(r.id);
      return b && (b.type === "expense" || b.type === "supplier_invoice")
        ? { ...r, became: { type: b.type, id: b.id, key: b.key, label: b.label } }
        : r;
    }),
  };
}

export async function distinctDocumentValues(
  tx: TransactionClient,
  caller: CallerIdentity,
  column: DocumentColumn,
  q: ListQuery,
): Promise<DistinctValue[]> {
  const rows = await loadRows(tx, caller, q, { exceptColumn: column });
  return countDistinct(
    rows.map((r) => r[column as keyof DocumentListRow]),
    DOCUMENT_COLUMNS[column],
  );
}

export async function documentDateHierarchy(
  tx: TransactionClient,
  caller: CallerIdentity,
  column: DocumentColumn,
  q: ListQuery,
): Promise<DateHierarchy> {
  if (DOCUMENT_COLUMNS[column].type !== "date") return { years: [], empty: 0 };
  const rows = await loadRows(tx, caller, q, { exceptColumn: column });
  return buildDateHierarchy(
    rows.map((r) => r[column as keyof DocumentListRow] as Date | string | null),
  );
}

// --- the inbox (specs/documents US4, D34) ---

/** One row of the inbox: the document, its derived state, its twin, the OCR facts as corrected. */
export type InboxListRow = {
  id: string;
  businessKey: string;
  fileName: string;
  prefixType: string;
  documentType: string;
  mimeType: string;
  status: string;
  state: InboxState;
  /** the oldest document holding the same bytes, when another one does */
  duplicateOf: { id: string; businessKey: string } | null;
  hasTwin: boolean;
  vendor: string | null;
  amount: string | null;
  currency: string | null;
  documentDate: string | null;
  quality: string | null;
  /** the OCR facts as corrected that the *Make it…* dialogs pre-fill from (no line items, no raw text) */
  facts: InboxFacts;
  reviewedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type InboxFacts = Pick<
  Partial<OcrExtractedData>,
  | "vendorName"
  | "vendorTaxId"
  | "merchantName"
  | "invoiceNumber"
  | "invoiceDate"
  | "transactionDate"
  | "dueDate"
  | "invoiceTotal"
  | "subtotal"
  | "totalTax"
  | "currency"
>;

const FACT_KEYS = [
  "vendorName",
  "vendorTaxId",
  "merchantName",
  "invoiceNumber",
  "invoiceDate",
  "transactionDate",
  "dueDate",
  "invoiceTotal",
  "subtotal",
  "totalTax",
  "currency",
] as const satisfies readonly (keyof InboxFacts)[];

export type InboxList = { rows: InboxListRow[]; counts: InboxCounts };

/** The inbox row as the page and the action hand it to the client: dates as ISO strings. */
export type InboxItem = Omit<
  InboxListRow,
  "reviewedAt" | "archivedAt" | "createdAt" | "updatedAt"
> & {
  reviewedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type InboxData = { rows: InboxItem[]; counts: InboxCounts };

export function toInboxData(list: InboxList): InboxData {
  return {
    counts: list.counts,
    rows: list.rows.map((r) => ({
      ...r,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      archivedAt: r.archivedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

export const INBOX_SEARCH_MAX = 100;

/**
 * The inbox rows of one tab plus the counts over the whole inbox (filters ignored). The accountant sees
 * financial documents only (`can`). One read of the tenant's non-generated documents (cap 20 000), the
 * `created_from` targets in a second, the rest in memory: state, twins, facts, search, order (newest first).
 */
export async function listInbox(
  tx: TransactionClient,
  caller: CallerIdentity,
  options: { tab?: InboxTab; q?: string; now?: Date } = {},
): Promise<InboxList> {
  const tab = options.tab ?? "all";
  const now = options.now ?? new Date();
  const base = can(caller, "read", "relationship_document") ? {} : { documentType: "financial" };
  const docs = await tx.document.findMany({
    where: { ...base, status: { not: "generated" } },
    orderBy: [{ createdAt: "desc" }],
    take: ROW_CAP,
    select: {
      id: true,
      businessKey: true,
      fileName: true,
      prefixType: true,
      documentType: true,
      mimeType: true,
      status: true,
      contentHash: true,
      reviewedAt: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
      ocrData: true,
      corrections: true,
    },
  });
  const became = await createdFromTargets(
    tx,
    docs.map((d) => d.id),
  );
  // FR-011: twins are counted across every stored document — a generated PDF (an issued invoice) included, so a
  // forced upload of the client's copy is captioned *Duplicate of* it. Generated rows are never inbox rows: only
  // the ones sharing a hash with a loaded document are read, and only what the twin rule needs.
  const hashes = [...new Set(docs.flatMap((d) => (d.contentHash ? [d.contentHash] : [])))];
  const generated = hashes.length
    ? await tx.document.findMany({
        where: { ...base, status: "generated", contentHash: { in: hashes } },
        select: { id: true, businessKey: true, contentHash: true, createdAt: true },
      })
    : [];
  const stored = [...docs, ...generated];
  const dupOf = duplicateOfMap(stored);
  const twinOf = new Map<string, number>();
  for (const d of stored)
    if (d.contentHash) twinOf.set(d.contentHash, (twinOf.get(d.contentHash) ?? 0) + 1);
  const keyOf = new Map(stored.map((d) => [d.id, d.businessKey]));

  const all: InboxListRow[] = [];
  for (const d of docs) {
    const state = inboxState(
      {
        status: d.status,
        archivedAt: d.archivedAt,
        reviewedAt: d.reviewedAt,
        updatedAt: d.updatedAt,
        became: became.has(d.id),
      },
      now,
    );
    if (!state) continue;
    const payload = parseOcrPayload(d.ocrData);
    const resolved = resolveDocumentData(
      payload?.extractedData ?? null,
      parseCorrections(d.corrections),
    );
    const oldest = dupOf.get(d.id) ?? null;
    all.push({
      id: d.id,
      businessKey: d.businessKey,
      fileName: d.fileName,
      prefixType: d.prefixType,
      documentType: d.documentType,
      mimeType: d.mimeType,
      status: d.status,
      state,
      duplicateOf: oldest ? { id: oldest, businessKey: keyOf.get(oldest) ?? "" } : null,
      hasTwin: d.contentHash ? (twinOf.get(d.contentHash) ?? 0) > 1 : false,
      vendor: resolved.vendorName ?? resolved.merchantName ?? null,
      amount: amountText(resolved.invoiceTotal),
      currency: resolved.currency ?? null,
      documentDate: resolved.invoiceDate ?? resolved.transactionDate ?? null,
      quality: payload?.quality ?? null,
      facts: Object.fromEntries(
        FACT_KEYS.filter((k) => resolved[k] !== undefined && resolved[k] !== null).map((k) => [
          k,
          resolved[k],
        ]),
      ) as InboxFacts,
      reviewedAt: d.reviewedAt,
      archivedAt: d.archivedAt,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    });
  }
  const counts = inboxCounts(all);
  const term = (options.q ?? "").trim().slice(0, INBOX_SEARCH_MAX).toLowerCase();
  const rows = all.filter(
    (r) =>
      inTab(r, tab) &&
      (!term ||
        [r.businessKey, r.fileName, r.vendor].some((v) => (v ?? "").toLowerCase().includes(term))),
  );
  return { rows, counts };
}

/** The inbox counts alone — the library's *Inbox (n)* link and the dashboard's *documents to review* (SC-005). */
export async function inboxTotals(
  tx: TransactionClient,
  caller: CallerIdentity,
  now?: Date,
): Promise<InboxCounts> {
  return (await listInbox(tx, caller, { now })).counts;
}
