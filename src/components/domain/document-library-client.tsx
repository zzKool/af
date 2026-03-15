"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import {
  AlertCircle,
  Download,
  Eye,
  FileCheck,
  FileText,
  Link2,
  Loader2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import { DocumentLibraryFilters } from "@/components/domain/document-library-filters";
import { DocumentStatsBar } from "@/components/domain/document-stats-bar";
import { DataTable } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { useDocumentLibraryStore } from "@/hooks/use-document-library-store";
import type { DocumentFilters, DocumentListItem, DocumentSort } from "@/server/actions/documents";
import {
  getDocumentDownloadUrlAction,
  getDocumentStatsAction,
  getDocumentsAction,
} from "@/server/actions/documents";

// MUST NOT import from @/server/services/*

interface FilterOptions {
  statuses: string[];
  documentTypes: string[];
  prefixTypes: string[];
}

interface InitialPreferences {
  filters?: DocumentFilters;
  sort?: DocumentSort;
  pageSize?: number;
}

interface DocumentLibraryClientProps {
  filterOptions: FilterOptions;
  initialPreferences: InitialPreferences | null;
  role: "owner" | "accountant";
}

// Status config — icon + color + label (AC #6)
const STATUS_CONFIG: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  uploaded: { color: "bg-muted text-muted-foreground", icon: Upload, label: "Uploaded" },
  processing: {
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    icon: Loader2,
    label: "Processing",
  },
  extracted: { color: "bg-muted text-muted-foreground", icon: FileCheck, label: "Extracted" },
  ocr_failed: {
    color: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
    icon: AlertCircle,
    label: "OCR Failed",
  },
  linked: {
    color: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400",
    icon: Link2,
    label: "Linked",
  },
};

const TYPE_LABELS: Record<string, string> = {
  expense: "Expense",
  invoice: "Invoice",
  contract: "Contract",
  nda: "NDA",
  certificate: "Certificate",
  financial: "Financial",
  relationship: "Relationship",
};

function StatusBadge({ status, reviewedAt }: { status: string; reviewedAt: Date | null }) {
  const config = STATUS_CONFIG[status] ?? {
    color: "bg-muted text-muted-foreground",
    icon: FileText,
    label: status,
  };
  const Icon = config.icon;
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${config.color}`}
      >
        <Icon className="h-3 w-3" />
        {config.label}
      </span>
      {(status === "extracted" || status === "ocr_failed") && (
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${
            reviewedAt
              ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400"
              : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
          }`}
        >
          <Eye className="h-3 w-3" />
          {reviewedAt ? "Reviewed" : "Needs Review"}
        </span>
      )}
    </div>
  );
}

function DownloadButton({ documentId }: { documentId: string }) {
  async function handleDownload() {
    const result = await getDocumentDownloadUrlAction({ documentId });
    // next-safe-action wraps service result: result.data = { data: { downloadUrl } }
    // biome-ignore lint/suspicious/noExplicitAny: next-safe-action wrapping
    const downloadUrl = (result?.data as any)?.data?.downloadUrl as string | undefined;
    if (downloadUrl) {
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 w-7 p-0"
      onClick={(e) => {
        e.stopPropagation();
        handleDownload();
      }}
      title="Download"
    >
      <Download className="h-3.5 w-3.5" />
    </Button>
  );
}

export function DocumentLibraryClient({
  filterOptions,
  initialPreferences,
  role,
}: DocumentLibraryClientProps) {
  const queryClient = useQueryClient();
  const filters = useDocumentLibraryStore((s) => s.filters);
  const sort = useDocumentLibraryStore((s) => s.sort);
  const page = useDocumentLibraryStore((s) => s.page);
  const pageSize = useDocumentLibraryStore((s) => s.pageSize);
  const setFilters = useDocumentLibraryStore((s) => s.setFilters);
  const setSort = useDocumentLibraryStore((s) => s.setSort);
  const setPage = useDocumentLibraryStore((s) => s.setPage);
  const setPageSize = useDocumentLibraryStore((s) => s.setPageSize);
  const clearFilters = useDocumentLibraryStore((s) => s.clearFilters);

  // Initialize store from server-side preferences (cross-session restore)
  const prefInitialized = useRef(false);
  useEffect(() => {
    if (!prefInitialized.current && initialPreferences) {
      prefInitialized.current = true;
      const store = useDocumentLibraryStore.store;
      if (initialPreferences.filters) {
        store.setState({ filters: initialPreferences.filters });
      }
      if (initialPreferences.sort) {
        store.setState({ sort: initialPreferences.sort });
      }
      if (initialPreferences.pageSize) {
        store.setState({ pageSize: initialPreferences.pageSize });
      }
    }
  }, [initialPreferences]);

  // Debounced preference persistence
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { upsertTablePreferenceAction } = useRef(
    typeof window !== "undefined"
      ? // biome-ignore lint/suspicious/noExplicitAny: dynamic import for SSR safety
        { upsertTablePreferenceAction: null as any }
      : { upsertTablePreferenceAction: null },
  ).current;

  useEffect(() => {
    if (!prefInitialized.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const { upsertTablePreferenceAction: upsert } = await import(
        "@/server/actions/table-preferences"
      );
      await upsert({ tableKey: "documents", preferences: { filters, sort, pageSize } });
    }, 2000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, sort, pageSize]);

  // Documents query
  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: ["documents", filters, sort, page, pageSize],
    queryFn: async () => {
      const result = await getDocumentsAction({ filters, sort, page, pageSize });
      // biome-ignore lint/suspicious/noExplicitAny: next-safe-action wrapping
      return (result?.data as any)?.data ?? { items: [], totalCount: 0 };
    },
    placeholderData: keepPreviousData,
  });

  // Stats query (separate, less frequent refresh)
  const { data: statsData } = useQuery({
    queryKey: ["document-stats"],
    queryFn: async () => {
      const result = await getDocumentStatsAction({});
      // biome-ignore lint/suspicious/noExplicitAny: next-safe-action wrapping
      return (result?.data as any)?.data ?? null;
    },
    staleTime: 30_000,
  });

  const handleSortingChange = useCallback(
    (sorting: SortingState) => {
      if (sorting.length > 0) {
        setSort({
          field: sorting[0].id as DocumentSort["field"],
          direction: sorting[0].desc ? "desc" : "asc",
        });
      } else {
        setSort({ field: "createdAt", direction: "desc" });
      }
    },
    [setSort],
  );

  const handleStatsFilter = useCallback(
    (newFilters: Partial<DocumentFilters>) => {
      clearFilters();
      setFilters(newFilters);
    },
    [clearFilters, setFilters],
  );

  const sortingState: SortingState = [{ id: sort.field, desc: sort.direction === "desc" }];

  // Column definitions
  const columns: ColumnDef<DocumentListItem>[] = [
    {
      id: "businessKey",
      accessorKey: "businessKey",
      header: "Business Key",
      enableSorting: true,
      cell: ({ row }) => (
        <Link
          href={`/documents/${row.original.id}`}
          className="font-mono text-xs hover:underline text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          {row.original.businessKey}
        </Link>
      ),
    },
    {
      id: "documentType",
      accessorKey: "documentType",
      header: "Type",
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm">
          {TYPE_LABELS[row.original.prefixType] ??
            TYPE_LABELS[row.original.documentType] ??
            row.original.prefixType}
        </span>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: "Status",
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} reviewedAt={row.original.reviewedAt} />
      ),
    },
    {
      id: "createdAt",
      accessorKey: "createdAt",
      header: "Date",
      enableSorting: true,
      cell: ({ row }) => {
        const date = row.original.extractedDate
          ? new Date(row.original.extractedDate)
          : row.original.createdAt;
        return (
          <span className="text-sm text-muted-foreground">
            {date instanceof Date && !Number.isNaN(date.getTime())
              ? date.toLocaleDateString()
              : "—"}
          </span>
        );
      },
    },
    {
      id: "vendor",
      header: "Vendor",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm truncate max-w-[140px] block">
          {row.original.extractedVendor ?? <span className="text-muted-foreground">—</span>}
        </span>
      ),
      meta: { compactHidden: true },
    },
    {
      id: "fileSize",
      accessorKey: "fileSize",
      header: "Amount",
      enableSorting: true,
      cell: ({ row }) => {
        const { extractedAmount, extractedCurrency } = row.original;
        if (!extractedAmount) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="text-sm tabular-nums">
            {extractedAmount.toLocaleString()} {extractedCurrency ?? ""}
          </span>
        );
      },
      meta: { compactHidden: true },
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <DownloadButton documentId={row.original.id} />
          <Link
            href={`/documents/${row.original.id}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent transition-colors"
          >
            <Eye className="h-3.5 w-3.5" />
          </Link>
        </div>
      ),
    },
  ];

  // Filter out action column for accountant (read-only, download only — no edit)
  const visibleColumns =
    role === "accountant"
      ? columns
          .filter((c) => c.id !== "actions")
          .concat({
            id: "actions",
            header: "",
            enableSorting: false,
            cell: ({ row }) => <DownloadButton documentId={row.original.id} />,
          })
      : columns;

  const items = docsData?.items ?? [];
  const totalCount = docsData?.totalCount ?? 0;

  // Empty state
  const hasActiveFilters = Object.values(filters).some((v) =>
    Array.isArray(v) ? v.length > 0 : !!v,
  );

  const emptyState =
    role === "accountant" ? (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <FileText className="h-10 w-10 opacity-30" />
        <p className="text-sm">No financial documents have been uploaded for this period yet.</p>
        <p className="text-xs">The business owner will upload documents as they arrive.</p>
      </div>
    ) : hasActiveFilters ? (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <span className="text-2xl">🔍</span>
        <p className="text-sm">No documents match your filters.</p>
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear all filters
        </Button>
      </div>
    ) : (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <FileText className="h-10 w-10 opacity-30" />
        <p className="text-sm font-medium">No documents uploaded yet.</p>
        <p className="text-xs">Drop files above to get started.</p>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {/* Summary stats bar */}
      <DocumentStatsBar stats={statsData ?? null} onFilterApply={handleStatsFilter} />

      {/* Filter bar */}
      <DocumentLibraryFilters
        filters={filters}
        filterOptions={filterOptions}
        onFilterChange={setFilters}
        onClearAll={clearFilters}
      />

      {/* DataTable */}
      <DataTable
        columns={visibleColumns}
        data={items}
        totalCount={totalCount}
        page={page}
        pageSize={pageSize}
        sorting={sortingState}
        onSortingChange={handleSortingChange}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        isLoading={docsLoading}
        emptyState={emptyState}
        onRowClick={(row) => {
          window.location.href = `/documents/${row.id}`;
        }}
      />
    </div>
  );
}

// Export for cache invalidation from upload zone
export function useDocumentLibraryInvalidate() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    queryClient.invalidateQueries({ queryKey: ["document-stats"] });
  }, [queryClient]);
}
