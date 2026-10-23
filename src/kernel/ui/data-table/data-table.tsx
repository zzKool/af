"use client";

// The kernel DataTable (D20, D40): one page of rows from the server, Excel-style typed header filters,
// server-side distinct values, URL state (useListQuery); the filter bar (Filter rows… · one filter button per
// active or quick column · Clear filters), 32 px rows, ⋮ row actions and the column chooser in the last
// column, the footer with count, sums and the pager. Modules declare columns and a filter source; they never
// write filter UI.
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  Columns3,
  Filter as FilterIcon,
  MoreVertical,
  Search,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useT } from "@/kernel/i18n/use-t";
import type {
  ColumnType,
  DateHierarchy,
  DistinctValue,
  Filter,
  ListResult,
  SortSpec,
} from "@/kernel/list-query/types";
import { PAGE_SIZE_OPTIONS } from "@/kernel/list-query/types";
import { formatMoney } from "@/kernel/money/format-money";
import type { Currency } from "@/kernel/nav/constants";
import { useDockedPanel } from "@/kernel/ui/shell/details-dock";
import { cn } from "@/lib/utils";
import { describeFilter } from "./filter-bar";
import { CheckboxFilter } from "./filters/checkbox-filter";
import { DateFilter } from "./filters/date-filter";
import { RangeFilter } from "./filters/range-filter";
import { TextFilter } from "./filters/text-filter";
import { isPinned, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, orderColumns, RESIZE_STEP } from "./layout";
import { type TableLayoutState, useTableLayout } from "./preferences";
import type { BulkAction, DataTableColumn, DataTableFilterSource, RowAction } from "./types";
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
  /** Row height in px (density; D40: 32). */
  rowHeight?: number;
  /** The row's ⋮ menu, in the last column (next to the column chooser in the header). */
  rowActions?: (row: Row) => RowAction[];
  /** Right-aligned context in the filter bar (a balance, an as-of date). */
  context?: ReactNode;
}

const RIGHT_TYPES: ColumnType[] = ["number", "money"];

function defaultCell<Row>(
  row: Row,
  column: DataTableColumn<Row>,
  t: ReturnType<typeof useT>,
  currency?: Currency,
): ReactNode {
  const raw = (row as Record<string, unknown>)[column.key];
  if (raw === null || raw === undefined || raw === "")
    return <span className="text-muted-foreground">—</span>;
  switch (column.type) {
    case "money":
      return <span className="tabular-nums">{safeMoney(String(raw), currency)}</span>;
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
      return raw ? t("common.yes") : t("common.no");
    default:
      return Array.isArray(raw) ? raw.join(", ") : String(raw);
  }
}

/** The one on-screen money format (D40); an unexpected value shows as it came rather than breaking the page. */
function safeMoney(amount: string, currency?: string | null): string {
  try {
    return formatMoney(amount, currency);
  } catch {
    return currency ? `${amount} ${currency}` : amount;
  }
}

/** Elements inside a row that handle their own click — the row's open / navigate ignores clicks on them. */
const INTERACTIVE = "a, button, input, select, textarea, label, [role=checkbox], [role=menuitem]";

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
  searchPlaceholder,
  toolbar,
  emptyState,
  rowHeight = 32,
  rowActions,
  context,
}: DataTableProps<Row>) {
  const t = useT();
  const router = useRouter();
  const { query, isPending } = state;
  const tableLayout = useTableLayout(tableKey, allColumns);
  // the page's docked details panel remembers open / hidden with this table's layout (F74)
  useDockedPanel(tableLayout.panelHidden, tableLayout.setPanelHidden);
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

  const colSpan = columns.length + (selectable ? 1 : 0) + 1;
  const activeFilters = Object.keys(query.filters);
  const barColumns = allColumns.filter(
    (c) => c.filterable !== false && (c.key in query.filters || c.quickFilter),
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            state.setSearch(search);
          }}
          className="relative flex items-center"
        >
          <Search
            className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder ?? t("table.filterRows")}
            className="h-8 w-60 pl-7"
            aria-label={t("table.search")}
          />
        </form>
        {barColumns.map((column) => {
          const f = query.filters[column.key];
          const barKey = `bar:${column.key}`;
          return (
            <Popover
              key={column.key}
              open={openFilter === barKey}
              onOpenChange={(o) => setOpenFilter(o ? barKey : null)}
            >
              <PopoverTrigger
                data-filter-button={column.key}
                data-active={f ? true : undefined}
                className={cn(
                  "inline-flex h-8 max-w-72 items-center gap-1 rounded-md border bg-surface px-2.5 text-[13px] hover:bg-hover",
                  f && "border-primary bg-selection hover:bg-selection",
                )}
              >
                <span className="truncate">
                  {column.header}
                  {f &&
                    `: ${describeFilter(f, valueLabel ? (v) => valueLabel(column.key, v) : undefined, t)}`}
                </span>
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto">
                {openFilter === barKey && filterPopover(column)}
              </PopoverContent>
            </Popover>
          );
        })}
        {(activeFilters.length > 0 || query.search) && (
          <Button
            variant="link"
            size="sm"
            className="text-[13px]"
            onClick={() => {
              state.clearFilters();
              setSearch("");
            }}
          >
            {t("table.clearFilters")}
          </Button>
        )}
        {selectable && selectedRows.length > 0 && bulkActions.length > 0 && (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">
              {t("table.selected", { count: selectedRows.length })}
            </span>
            {bulkActions.map((a) => (
              <Button
                key={a.label}
                size="sm"
                variant={a.variant === "destructive" ? "destructive" : "outline"}
                onClick={() => a.onClick(selectedRows)}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}
        {(toolbar || context) && (
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {context}
            {toolbar}
          </div>
        )}
      </div>

      <div
        className={cn("relative overflow-auto border-b border-subtle", isPending && "opacity-60")}
        aria-busy={isPending}
      >
        <Table className="text-[13px]">
          <TableHeader className="sticky top-0 z-10 bg-surface">
            <TableRow className="border-b border-border hover:bg-transparent">
              {selectable && (
                <TableHead className="w-8 px-2">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={!allSelected && someSelected}
                    onCheckedChange={() =>
                      setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                    }
                    aria-label={t("table.selectPage")}
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
                      "relative h-8 px-2 font-semibold",
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
                            aria-label={t("table.filterColumn", { column: String(column.header) })}
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
              {/* the last column: the column chooser here, each row's ⋮ menu below */}
              {/* sticky on the right: reachable without scrolling a wide table sideways */}
              <TableHead className="sticky right-0 z-10 w-9 bg-surface px-1 text-right">
                <ColumnsMenu columns={allColumns} layout={tableLayout} />
              </TableHead>
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
                    (activeFilters.length || query.search
                      ? t("table.emptyFiltered")
                      : t("table.empty")))
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
                  className={cn("border-b border-subtle", clickable && "cursor-pointer")}
                  onClick={(e) => {
                    // a link, button or field inside the row does its own thing — the row must not also open
                    // (a key link + the row's navigation = two navigations, the second a full reload)
                    if ((e.target as Element).closest(INTERACTIVE)) return;
                    if (onRowClick) onRowClick(row);
                    else if (rowHref) {
                      const href = rowHref(row);
                      if (e.metaKey || e.ctrlKey) window.open(href, "_blank", "noopener");
                      else router.push(href);
                    }
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
                        aria-label={t("table.selectRow")}
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
                          : defaultCell(row, column, t, rowCurrency?.(row) ?? sumCurrency)}
                      </TableCell>
                    );
                  })}
                  <TableCell
                    className="sticky right-0 w-9 bg-surface px-1 py-0 text-right [tr:hover_&]:bg-hover [tr[data-state=selected]_&]:bg-selection"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {rowActions && (
                      <RowActionsMenu actions={rowActions(row)} label={t("table.rowActions")} />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {t("table.range", { first, last, total: result.total })}
        </span>
        {result.sums &&
          Object.entries(result.sums).map(([col, sum]) => {
            const column = allColumns.find((c) => c.key === col);
            return (
              <span key={col} className="tabular-nums">
                Σ {column?.header ?? col}:{" "}
                <span className="font-semibold text-foreground">{safeMoney(sum, sumCurrency)}</span>
              </span>
            );
          })}
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={String(query.pageSize)}
            onValueChange={(v) => state.setPageSize(Number(v))}
          >
            <SelectTrigger className="h-[26px] w-20" aria-label={t("table.rowsPerPage")}>
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
            variant="ghost"
            size="sm"
            className="text-foreground"
            disabled={query.page <= 1}
            onClick={() => state.setPage(query.page - 1)}
          >
            <ChevronLeft aria-hidden />
            {t("table.previous")}
          </Button>
          <span className="tabular-nums">
            {query.page} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-foreground"
            disabled={query.page >= totalPages}
            onClick={() => state.setPage(query.page + 1)}
          >
            {t("table.next")}
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- a row's ⋮ menu ---

function RowActionsMenu({ actions, label }: { actions: RowAction[]; label: string }) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
        aria-label={label}
      >
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        {actions.map((a) => (
          <DropdownMenuItem
            key={a.label}
            disabled={a.disabled}
            variant={a.destructive ? "destructive" : "default"}
            onClick={a.onClick}
          >
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  const t = useT();
  const { hidden, setHidden, move, reset, isDefault } = layout;
  const ordered = orderColumns(columns, layout.layout.order).filter((c) => !isPinned(c));
  const toggleable = ordered.filter((c) => c.header);
  if (toggleable.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
        aria-label={t("table.chooseColumns")}
        title={t("table.columns")}
      >
        <Columns3 className="size-3.5" />
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
                  aria-label={t("table.moveUp", { column: String(name) })}
                  disabled={i === 0}
                  onClick={() => move(c.key, -1)}
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={t("table.moveDown", { column: String(name) })}
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
              {t("table.resetLayout")}
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
  const t = useT();
  const start = useRef<{ x: number; width: number } | null>(null);
  const widthOfHeader = (el: HTMLElement) =>
    (el.closest("th") as HTMLElement | null)?.getBoundingClientRect().width ?? 0;
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focused or dragged; the separator role is the ARIA way to say "resizer"
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={t("table.resize", { column: String(label) })}
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
