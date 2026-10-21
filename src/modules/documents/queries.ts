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
  SortSpec,
} from "@/kernel/list-query/types";
import type { OcrExtractedData } from "@/kernel/ocr/ocr";
import { resolveDocumentData } from "./documents";
import {
  duplicateOfMap,
  type InboxCounts,
  type InboxState,
  type InboxTab,
  inboxCounts,
  inboxState,
  inTab,
} from "./inbox";
import { unlinkedIds } from "./linkable";

export {
  getDocument,
  getDocumentDownloadUrl,
  getDocumentForReview,
  getDocumentOcrData,
  getDocumentStats,
  getDocuments,
  getRecentDocuments,
} from "./documents";

export const DOCUMENT_COLUMNS = {
  businessKey: { type: "text", searchable: true },
  fileName: { type: "text", searchable: true },
  prefixType: { type: "enum" },
  documentType: { type: "enum" },
  status: { type: "enum" },
  mimeType: { type: "enum" },
  fileSize: { type: "number" },
  vendor: { type: "text", searchable: true },
  amount: { type: "money" },
  currency: { type: "enum" },
  documentDate: { type: "date" },
  linked: { type: "boolean" },
  reviewedAt: { type: "date" },
  createdAt: { type: "date" },
} as const satisfies ColumnMap;

export type DocumentColumn = keyof typeof DOCUMENT_COLUMNS;
export const DOCUMENT_COLUMN_KEYS = Object.keys(DOCUMENT_COLUMNS) as DocumentColumn[];
export const DOCUMENT_DEFAULT_SORT: SortSpec[] = [{ col: "createdAt", dir: "desc" }];

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
    const parsed = r.ocrData as unknown as { extractedData?: OcrExtractedData } | null;
    const resolved = resolveDocumentData(
      parsed?.extractedData ?? null,
      (r.corrections as Partial<OcrExtractedData> | null) ?? null,
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
      amount: resolved.invoiceTotal === undefined ? null : resolved.invoiceTotal.toFixed(2),
      currency: resolved.currency ?? null,
      documentDate: resolved.invoiceDate ?? resolved.transactionDate ?? null,
      linked: !free.has(r.id),
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
  return finishList(all, q, DOCUMENT_COLUMNS, DOCUMENT_DEFAULT_SORT);
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
  const became = new Set(
    (
      await tx.link.findMany({
        where: { kind: "created_from", toType: "document" },
        select: { toId: true },
      })
    ).map((l) => l.toId),
  );
  const dupOf = duplicateOfMap(docs);
  const twinOf = new Map<string, number>();
  for (const d of docs)
    if (d.contentHash) twinOf.set(d.contentHash, (twinOf.get(d.contentHash) ?? 0) + 1);
  const keyOf = new Map(docs.map((d) => [d.id, d.businessKey]));

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
    const parsed = d.ocrData as unknown as {
      extractedData?: OcrExtractedData;
      quality?: string;
    } | null;
    const resolved = resolveDocumentData(
      parsed?.extractedData ?? null,
      (d.corrections as Partial<OcrExtractedData> | null) ?? null,
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
      amount: resolved.invoiceTotal === undefined ? null : resolved.invoiceTotal.toFixed(2),
      currency: resolved.currency ?? null,
      documentDate: resolved.invoiceDate ?? resolved.transactionDate ?? null,
      quality: parsed?.quality ?? null,
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
