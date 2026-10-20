// ListQuery — the one contract between a DataTable and a module's `queries.ts` (D20, ui-conventions).
// The table never holds more than one page; paging, sorting, filtering and distinct values are
// server-side. Filters are typed by column type; the component derives the filter UI from the type.

export type SortDir = "asc" | "desc";

export type ColumnType = "text" | "enum" | "number" | "money" | "date" | "boolean" | "relation";

export interface ColumnSpec {
  /** Prisma field name (defaults to the column key). */
  field?: string;
  type: ColumnType;
  /** Postgres array column (e.g. `types String[]`): `in` becomes `hasSome`, distinct unnests. */
  array?: boolean;
  /** Takes part in the free-text search box. */
  searchable?: boolean;
  /** Summed in the footer (money/number). */
  sum?: boolean;
}

export type ColumnMap = Record<string, ColumnSpec>;

export type TextOp = "contains" | "startsWith" | "equals" | "empty" | "notEmpty";

/** `null` in `values` selects blanks. */
export type InFilter = { kind: "in"; values: (string | null)[] };
export type TextFilter = { kind: "text"; op: TextOp; value?: string };
/** Decimal strings; either bound optional; `empty` selects nulls instead. */
export type RangeFilter = { kind: "range"; min?: string; max?: string; empty?: boolean };
/**
 * Excel's date hierarchy plus presets: any combination of whole years (`2026`), months (`2026-10`),
 * days (`2026-10-15`) is a union; `from`/`to` (inclusive, ISO dates) intersect with it; `empty`
 * selects nulls instead.
 */
export type DatesFilter = {
  kind: "dates";
  years?: number[];
  months?: string[];
  days?: string[];
  from?: string;
  to?: string;
  empty?: boolean;
};

export type Filter = InFilter | TextFilter | RangeFilter | DatesFilter;

export interface SortSpec {
  col: string;
  dir: SortDir;
}

export interface ListQuery {
  page: number;
  pageSize: number;
  sort: SortSpec[];
  filters: Record<string, Filter>;
  /** Free-text search over the module's searchable columns. */
  search?: string;
}

export interface ListResult<Row> {
  rows: Row[];
  total: number;
  /** Sums of the `sum` columns over the whole filtered set, as decimal strings. */
  sums?: Record<string, string>;
}

/** One entry of a header filter's checkbox list; `value` null = blanks. */
export interface DistinctValue {
  value: string | null;
  count: number;
}

/** Date hierarchy for the date filter: counts per year → month → day, over the filtered set. */
export interface DateHierarchy {
  years: {
    year: number;
    count: number;
    months: { month: string; count: number; days: { day: string; count: number }[] }[];
  }[];
  empty: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
export const DISTINCT_CAP = 500;
