// The months table's columns (F71) — a leaf file: `package.actions.ts` reads them at load time, and anything an
// actions file reads at module scope must not import another module (lessons, F61). `month` is the period's
// first day, so the Month quick filter is the kit's date filter (years → months).
import type { ColumnMap, SortSpec } from "@/kernel/list-query/types";

export const MONTH_COLUMNS = {
  month: { type: "date" },
  state: { type: "enum" },
  bankRows: { type: "number" },
  invoices: { type: "number" },
  supplierInvoices: { type: "number" },
  expenses: { type: "number" },
  documents: { type: "number" },
  flags: { type: "number" },
  packageKey: { type: "text", searchable: true },
} as const satisfies ColumnMap;
export type MonthColumn = keyof typeof MONTH_COLUMNS;
export const MONTH_COLUMN_KEYS = Object.keys(MONTH_COLUMNS) as MonthColumn[];
export const MONTH_DEFAULT_SORT: SortSpec[] = [{ col: "month", dir: "desc" }];
