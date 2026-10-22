// The library's columns (D20) — the ListQuery contract the page, the actions and the read model share. A leaf
// file on purpose: the actions read it at load time, and `queries.ts` sits in the import cycle through linking
// (documents → linking → every module's linkable → documents).
import type { ColumnMap, SortSpec } from "@/kernel/list-query/types";

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
