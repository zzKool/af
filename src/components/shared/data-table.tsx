"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type SortingState,
  type Updater,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
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

// MUST NOT import from @/server/*

export interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  totalCount: number;
  page: number;
  pageSize: number;
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  isLoading?: boolean;
  emptyState?: ReactNode;
  onRowClick?: (row: TData) => void;
  /** Enable row virtualization above this count (default: 50) */
  virtualizeAbove?: number;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function DataTable<TData>({
  columns,
  data,
  totalCount,
  page,
  pageSize,
  sorting,
  onSortingChange,
  onPageChange,
  onPageSizeChange,
  isLoading = false,
  emptyState,
  onRowClick,
  virtualizeAbove = 50,
}: DataTableProps<TData>) {
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Wrap onSortingChange to handle TanStack's Updater<SortingState> pattern
  function handleSortingChange(updaterOrValue: Updater<SortingState>) {
    const newValue =
      typeof updaterOrValue === "function" ? updaterOrValue(sorting) : updaterOrValue;
    onSortingChange(newValue);
  }

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: handleSortingChange,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    rowCount: totalCount,
  });

  const rows = table.getRowModel().rows;
  const useVirtualRows = rows.length > virtualizeAbove;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startItem = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalCount);

  function handleSortClick(columnId: string) {
    const existing = sorting.find((s) => s.id === columnId);
    if (!existing) {
      onSortingChange([{ id: columnId, desc: false }]);
    } else if (!existing.desc) {
      onSortingChange([{ id: columnId, desc: true }]);
    } else {
      onSortingChange([]);
    }
  }

  function getSortIcon(columnId: string) {
    const sort = sorting.find((s) => s.id === columnId);
    if (!sort) return <ChevronsUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground" />;
    return sort.desc ? (
      <ChevronDown className="ml-1 h-3.5 w-3.5" />
    ) : (
      <ChevronUp className="ml-1 h-3.5 w-3.5" />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Table */}
      <div ref={tableContainerRef} className="rounded-md border overflow-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="flex items-center gap-0.5 font-medium hover:text-foreground cursor-pointer select-none"
                          onClick={() => handleSortClick(header.column.id)}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {getSortIcon(header.column.id)}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              // Loading skeleton rows
              Array.from({ length: Math.min(pageSize, 5) }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows have no meaningful key
                <TableRow key={i}>
                  {columns.map((col, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: skeleton cols have no meaningful key
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-40 text-center">
                  {emptyState ?? <span className="text-muted-foreground">No results found.</span>}
                </TableCell>
              </TableRow>
            ) : useVirtualRows ? (
              // Virtualized rows — padding approach keeps valid HTML table structure
              (() => {
                const virtualItems = rowVirtualizer.getVirtualItems();
                const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
                const paddingBottom =
                  virtualItems.length > 0
                    ? rowVirtualizer.getTotalSize() -
                      (virtualItems[virtualItems.length - 1]?.end ?? 0)
                    : 0;
                return (
                  <>
                    {paddingTop > 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={columns.length}
                          style={{ height: paddingTop, padding: 0 }}
                        />
                      </TableRow>
                    )}
                    {virtualItems.map((virtualRow) => {
                      const row = rows[virtualRow.index];
                      return (
                        <TableRow
                          key={row.id}
                          className={onRowClick ? "cursor-pointer" : undefined}
                          onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      );
                    })}
                    {paddingBottom > 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={columns.length}
                          style={{ height: paddingBottom, padding: 0 }}
                        />
                      </TableRow>
                    )}
                  </>
                );
              })()
            ) : (
              // Plain DOM rows
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={onRowClick ? "cursor-pointer" : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination controls */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {totalCount === 0 ? "No results" : `Showing ${startItem}–${endItem} of ${totalCount}`}
        </span>
        <div className="flex items-center gap-4">
          {onPageSizeChange && (
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
                <SelectTrigger className="h-8 w-16">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </Button>
            <span className="tabular-nums">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isLoading}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
