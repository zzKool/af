"use client";

// The kernel DataTable (D20): one page of rows from the server, Excel-style typed header filters,
// server-side distinct values, URL state (useListQuery), chips, footer with count and sums.
// Modules declare columns and a filter source; they never write filter UI.
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Columns3,
  Filter as FilterIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ColumnType,
  DateHierarchy,
  DistinctValue,
  Filter,
  ListResult,
  SortSpec,
} from "@/kernel/list-query/types";
import { PAGE_SIZE_OPTIONS } from "@/kernel/list-query/types";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import { cn } from "@/lib/utils";
import { FilterChips } from "./filter-chips";
import { CheckboxFilter } from "./filters/checkbox-filter";
import { DateFilter } from "./filters/date-filter";
import { RangeFilter } from "./filters/range-filter";
import { TextFilter } from "./filters/text-filter";
import { isPinned, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, orderColumns, RESIZE_STEP } from "./layout";
import { type TableLayoutState, useTableLayout } from "./preferences";
import type { BulkAction, DataTableColumn, DataTableFilterSource } from "./types";
import type { ListQueryState } from "./use-list-query";

export interface DataTableProps<Row extends { id: string }> {
  /** Stable key of this table (e.g. "partners") — the user's column layout (hidden, order, widths) is remembered under it. */
  tableKey: string;
  columns: DataTableColumn<Row>[];
  result: ListResult<Row>;
  state: ListQueryState;
  filterSource?: DataTableFilterSource;
  /** Display names for enum/boolean values, per column ("true" → "Active"). */
  valueLabel?: (column: string, value: string | null) => string;
  /** Currency of money columns (per row, e.g. row.currency) — for footer sums pass `sumCurrency`. */
  rowCurrency?: (row: Row) => Currency;
  sumCurrency?: Currency;
  onRowClick?: (row: Row) => void;
  rowHref?: (row: Row) => string;
  selectable?: boolean;
  bulkActions?: BulkAction<Row>[];
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  emptyState?: ReactNode;
  /** Row height in px (density). */
  rowHeight?: number;
}

const RIGHT_TYPES: ColumnType[] = ["number", "money"];

function defaultCell<Row>(row: Row, column: DataTableColumn<Row>, currency?: Currency): ReactNode {
  const raw = (row as Record<string, unknown>)[column.key];
  if (raw === null || raw === undefined || raw === "")
    return <span className="text-muted-foreground">—</span>;
  switch (column.type) {
    case "money":
      return (
        <span className="tabular-nums">
          {currency ? `${formatCurrency(String(raw), currency)} ${currency}` : String(raw)}
        </span>
      );
    case "number":
      return <span className="tabular-nums">{String(raw)}</span>;
    case "date": {
      const d = raw instanceof Date ? raw : new Date(String(raw));
      return (
        <span className="tabular-nums">
          {Number.isNaN(d.getTime()) ? String(raw) : d.toISOString().slice(0, 10)}
        </span>
      );
    }
    case "boolean":
      return raw ? "Yes" : "No";
    default:
      return Array.isArray(raw) ? raw.join(", ") : String(raw);
  }
}

export function DataTable<Row extends { id: string }>({
  tableKey,
  columns: allColumns,
  result,
  state,
  filterSource,
  valueLabel,
  rowCurrency,
  sumCurrency,
  onRowClick,
  rowHref,
  selectable = false,
  bulkActions = [],
  searchPlaceholder = "Search…",
  toolbar,
  emptyState,
  rowHeight = 36,
}: DataTableProps<Row>) {
  const { query, isPending } = state;
  const tableLayout = useTableLayout(tableKey, allColumns);
  const { hidden, layout } = tableLayout;
  const columns = useMemo(
    () => orderColumns(allColumns, layout.order).filter((c) => !hidden.has(c.key)),
    [allColumns, layout.order, hidden],
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const widthOf = (column: DataTableColumn<Row>): string | number | undefined =>
    layout.widths[column.key] ?? column.width;
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(query.search ?? "");

  const sortOf = (key: string) => query.sort.find((s) => s.col === key);
  function cycleSort(column: DataTableColumn<Row>, additive: boolean) {
    if (column.sortable === false) return;
    const existing = sortOf(column.key);
    const next: SortSpec | null = !existing
      ? { col: column.key, dir: "asc" }
      : existing.dir === "asc"
        ? { col: column.key, dir: "desc" }
        : null;
    const others = additive ? query.sort.filter((s) => s.col !== column.key) : [];
    state.setSort(next ? [...others, next] : others);
  }

  const rows = result.rows;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));
  const selectedRows = rows.filter((r) => selected.has(r.id));

  const totalPages = Math.max(1, Math.ceil(result.total / query.pageSize));
  const first = result.total === 0 ? 0 : (query.page - 1) * query.pageSize + 1;
  const last = Math.min(query.page * query.pageSize, result.total);

  const loaders = useMemo(() => {
    const d = new Map<string, () => Promise<DistinctValue[]>>();
    const h = new Map<string, () => Promise<DateHierarchy>>();
    if (filterSource) {
      for (const c of columns) {
        d.set(c.key, () => filterSource.distinct(c.key, query));
        h.set(c.key, () => filterSource.dateHierarchy(c.key, query));
      }
    }
    return { d, h };
  }, [filterSource, columns, query]);

  const applyFilter = useCallback(
    (column: string, f: Filter | null) => {
      state.setFilter(column, f);
      setSelected(new Set());
    },
    [state],
  );

  function filterPopover(column: DataTableColumn<Row>) {
    const current = query.filters[column.key] ?? null;
    const close = () => setOpenFilter(null);
    const common = {
      current,
      onApply: (f: Filter | null) => applyFilter(column.key, f),
      onClose: close,
    };
    switch (column.type) {
      case "text":
        return <TextFilter {...common} />;
      case "number":
      case "money":
        return <RangeFilter {...common} />;
      case "date": {
        const load = loaders.h.get(column.key);
        return load ? (
          <DateFilter {...common} load={load} />
        ) : (
          <p className="text-xs text-muted-foreground">No filter source</p>
        );
      }
      default: {
        const load = loaders.d.get(column.key);
        return load ? (
          <CheckboxFilter
            {...common}
            load={load}
            label={valueLabel ? (v) => valueLabel(column.key, v) : undefined}
          />
        ) : (
          <p className="text-xs text-muted-foreground">No filter source</p>
        );
      }
    }
  }

  const colSpan = columns.length + (selectable ? 1 : 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            state.setSearch(search);
          }}
          className="flex items-center gap-1"
        >
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 w-64"
            aria-label="Search"
          />
        </form>
        {selectable && selectedRows.length > 0 && bulkActions.length > 0 && (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">{selectedRows.length} selected</span>
            {bulkActions.map((a) => (
              <Button
                key={a.label}
                size="sm"
                variant={a.variant === "destructive" ? "destructive" : "outline"}
                className="h-7"
                onClick={() => a.onClick(selectedRows)}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          <ColumnsMenu columns={allColumns} layout={tableLayout} />
        </div>
      </div>

      <FilterChips
        query={query}
        columns={allColumns}
        valueLabel={valueLabel}
        onRemove={(c) => applyFilter(c, null)}
        onClearAll={() => {
          state.clearFilters();
          setSearch("");
        }}
        onClearSearch={() => {
          setSearch("");
          state.setSearch("");
        }}
      />

      <div
        className={cn("relative overflow-auto rounded-md border", isPending && "opacity-60")}
        aria-busy={isPending}
      >
        <Table className="text-[13px]">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow className="hover:bg-transparent">
              {selectable && (
                <TableHead className="w-8 px-2">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={!allSelected && someSelected}
                    onCheckedChange={() =>
                      setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                    }
                    aria-label="Select all rows on this page"
                  />
                </TableHead>
              )}
              {columns.map((column) => {
                const sort = sortOf(column.key);
                const active = !!query.filters[column.key];
                const right =
                  column.align === "right" || (!column.align && RIGHT_TYPES.includes(column.type));
                const filterable = column.filterable !== false;
                const width = widthOf(column);
                const movable = !isPinned(column);
                return (
                  <TableHead
                    key={column.key}
                    aria-sort={sort ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    style={width ? { width, minWidth: width, maxWidth: width } : undefined}
                    className={cn(
                      "relative h-9 px-2 font-medium",
                      right && "text-right",
                      dragging === column.key && "opacity-50",
                    )}
                    data-column={column.key}
                    draggable={movable}
                    onDragStart={(e) => {
                      if (!movable) return;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", column.key);
                      setDragging(column.key);
                    }}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(e) => {
                      if (movable && dragging && dragging !== column.key) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const key = dragging ?? e.dataTransfer.getData("text/plain");
                      if (movable && key && key !== column.key) tableLayout.drop(key, column.key);
                      setDragging(null);
                    }}
                  >
                    <div className={cn("flex items-center gap-0.5", right && "flex-row-reverse")}>
                      {/* a column without a header (row actions): a name for the screen reader, no button */}
                      {column.header === "" && column.sortable === false ? (
                        <span className="sr-only">{column.key}</span>
                      ) : (
                        <button
                          type="button"
                          className={cn(
                            "flex items-center gap-1 truncate hover:text-foreground",
                            column.sortable === false && "cursor-default",
                          )}
                          onClick={(e) => cycleSort(column, e.shiftKey)}
                        >
                          <span className="truncate">{column.header}</span>
                          {column.sortable !== false &&
                            (sort ? (
                              sort.dir === "asc" ? (
                                <ChevronUp className="size-3.5" />
                              ) : (
                                <ChevronDown className="size-3.5" />
                              )
                            ) : (
                              <ChevronsUpDown className="size-3.5 text-muted-foreground/60" />
                            ))}
                        </button>
                      )}
                      {filterable && (
                        <Popover
                          open={openFilter === column.key}
                          onOpenChange={(o) => setOpenFilter(o ? column.key : null)}
                        >
                          <PopoverTrigger
                            className={cn(
                              "rounded p-0.5 text-muted-foreground/60 hover:text-foreground",
                              active && "text-primary",
                            )}
                            aria-label={`Filter ${column.header}`}
                            data-active={active || undefined}
                          >
                            <FilterIcon className={cn("size-3.5", active && "fill-current")} />
                          </PopoverTrigger>
                          <PopoverContent align={right ? "end" : "start"} className="w-auto">
                            {openFilter === column.key && filterPopover(column)}
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                    {movable && (
                      <ResizeHandle
                        label={typeof column.header === "string" ? column.header : column.key}
                        width={layout.widths[column.key]}
                        onResize={(px) => tableLayout.setWidth(column.key, px)}
                      />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                  {isPending ? (
                    <Skeleton className="mx-auto h-4 w-40" />
                  ) : (
                    (emptyState ??
                    (Object.keys(query.filters).length || query.search
                      ? "Nothing matches the active filters."
                      : "Nothing here yet."))
                  )}
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => {
              const isSelected = selected.has(row.id);
              const clickable = !!(onRowClick || rowHref);
              return (
                <TableRow
                  key={row.id}
                  data-state={isSelected ? "selected" : undefined}
                  style={{ height: rowHeight }}
                  className={cn(clickable && "cursor-pointer")}
                  onClick={() => {
                    if (onRowClick) onRowClick(row);
                    else if (rowHref) window.location.assign(rowHref(row));
                  }}
                >
                  {selectable && (
                    <TableCell className="px-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => {
                          const next = new Set(selected);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          setSelected(next);
                        }}
                        aria-label="Select row"
                      />
                    </TableCell>
                  )}
                  {columns.map((column) => {
                    const right =
                      column.align === "right" ||
                      (!column.align && RIGHT_TYPES.includes(column.type));
                    const width = widthOf(column);
                    return (
                      <TableCell
                        key={column.key}
                        style={width ? { width, minWidth: width, maxWidth: width } : undefined}
                        className={cn(
                          "px-2 py-1",
                          right && "text-right",
                          column.truncate === false
                            ? "whitespace-normal"
                            : width
                              ? "max-w-0 truncate"
                              : "whitespace-nowrap",
                        )}
                      >
                        {column.cell
                          ? column.cell(row)
                          : defaultCell(row, column, rowCurrency?.(row) ?? sumCurrency)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          {first}–{last} of {result.total}
        </span>
        {result.sums &&
          Object.entries(result.sums).map(([col, sum]) => {
            const column = allColumns.find((c) => c.key === col);
            return (
              <span key={col} className="tabular-nums">
                Σ {column?.header ?? col}:{" "}
                {sumCurrency ? `${formatCurrency(sum, sumCurrency)} ${sumCurrency}` : sum}
              </span>
            );
          })}
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={String(query.pageSize)}
            onValueChange={(v) => state.setPageSize(Number(v))}
          >
            <SelectTrigger className="h-7 w-20" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={query.page <= 1}
            onClick={() => state.setPage(query.page - 1)}
          >
            Previous
          </Button>
          <span className="tabular-nums">
            {query.page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={query.page >= totalPages}
            onClick={() => state.setPage(query.page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- the Columns menu: visibility, order (arrows — the keyboard path next to header drag and drop), reset ---

function ColumnsMenu<Row>({
  columns,
  layout,
}: {
  columns: DataTableColumn<Row>[];
  layout: TableLayoutState;
}) {
  const { hidden, setHidden, move, reset, isDefault } = layout;
  const ordered = orderColumns(columns, layout.layout.order).filter((c) => !isPinned(c));
  const toggleable = ordered.filter((c) => c.header);
  if (toggleable.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground"
        aria-label="Choose columns"
      >
        <Columns3 className="size-3.5" />
        Columns
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="flex flex-col gap-1" data-testid="columns-menu">
          {toggleable.map((c, i) => {
            const name = typeof c.header === "string" ? c.header : c.key;
            return (
              <div key={c.key} className="flex items-center gap-2 text-sm">
                {/* the label wraps the control: a `for` cannot name Base UI's span[role=checkbox] */}
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <Checkbox
                    aria-label={name}
                    disabled={c.alwaysVisible}
                    checked={!hidden.has(c.key)}
                    onCheckedChange={() => {
                      const next = new Set(hidden);
                      if (next.has(c.key)) next.delete(c.key);
                      else next.add(c.key);
                      setHidden(next);
                    }}
                  />
                  <span className="truncate">{c.header}</span>
                </label>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Move ${name} up`}
                  disabled={i === 0}
                  onClick={() => move(c.key, -1)}
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Move ${name} down`}
                  disabled={i === toggleable.length - 1}
                  onClick={() => move(c.key, 1)}
                >
                  <ArrowDown className="size-3.5" />
                </button>
              </div>
            );
          })}
          {!isDefault && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-1 justify-start"
              onClick={reset}
              data-testid="columns-reset"
            >
              Reset layout
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- the resize handle on a header's right edge: drag with the pointer, or ← / → on the keyboard ---

function ResizeHandle({
  label,
  width,
  onResize,
}: {
  label: string;
  /** the stored width, when the user set one */
  width: number | undefined;
  onResize: (px: number) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const widthOfHeader = (el: HTMLElement) =>
    (el.closest("th") as HTMLElement | null)?.getBoundingClientRect().width ?? 0;
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focused or dragged; the separator role is the ARIA way to say "resizer"
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuenow={width ?? MIN_COLUMN_WIDTH}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      tabIndex={0}
      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-primary/40 focus-visible:bg-primary/40 focus-visible:outline-none"
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        start.current = { x: e.clientX, width: widthOfHeader(e.currentTarget) };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onResize(start.current.width + (e.clientX - start.current.x));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        onResize(start.current.width + (e.clientX - start.current.x));
        start.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const width = widthOfHeader(e.currentTarget);
        onResize(width + (e.key === "ArrowRight" ? RESIZE_STEP : -RESIZE_STEP));
      }}
    />
  );
}
