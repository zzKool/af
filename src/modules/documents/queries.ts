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
