// Column definitions of the kernel DataTable (D20). A module declares its columns once — the type
// decides the header filter UI and the alignment; the module never writes filter UI.
import type { ReactNode } from "react";
import type {
  ColumnType,
  DateHierarchy,
  DistinctValue,
  Filter,
  ListQuery,
} from "@/kernel/list-query/types";

export interface DataTableColumn<Row> {
  /** Column key = the ListQuery column name the module's queries.ts understands. */
  key: string;
  header: string;
  type: ColumnType;
  filterable?: boolean;
  sortable?: boolean;
  /** Default: numbers/money right, the rest left. */
  align?: "left" | "right" | "center";
  /** CSS width, e.g. "12rem"; omitted = auto. */
  width?: string;
  /** Custom cell; default renders the row's `key` property with the type's formatter. */
  cell?: (row: Row) => ReactNode;
  /** Keep the cell on one line and truncate (default true for text). */
  truncate?: boolean;
  /** Hidden until the user shows it from the Columns menu. */
  defaultHidden?: boolean;
  /** Cannot be hidden (the identifying column, the actions column). */
  alwaysVisible?: boolean;
  /** A filter button in the filter bar even while inactive (a common filter: Month, Account). */
  quickFilter?: boolean;
}

/** One entry of a row's ⋮ menu (the table's last cell). Destructive ones go through a ConfirmDialog. */
export interface RowAction {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** What a module gives the table to fill its header filters (server actions behind the scenes). */
export interface DataTableFilterSource {
  distinct: (column: string, query: ListQuery) => Promise<DistinctValue[]>;
  dateHierarchy: (column: string, query: ListQuery) => Promise<DateHierarchy>;
}

export interface BulkAction<Row> {
  label: string;
  onClick: (rows: Row[]) => void | Promise<void>;
  variant?: "default" | "destructive";
}

export type FilterChange = (column: string, filter: Filter | null) => void;
