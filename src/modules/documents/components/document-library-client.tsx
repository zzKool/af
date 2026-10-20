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
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Role } from "@/kernel/auth/caller-identity";
import { canRole } from "@/kernel/auth/can";
import { DataTable } from "@/kernel/ui/legacy-data-table";
import { DocumentLibraryFilters } from "@/modules/documents/components/document-library-filters";
import { DocumentStatsBar } from "@/modules/documents/components/document-stats-bar";
import type {
  DocumentFilters,
  DocumentListItem,
  DocumentSort,
} from "@/modules/documents/documents.actions";
import {
  deleteDocumentAction,
  getDocumentDownloadUrlAction,
  getDocumentStatsAction,
  getDocumentsAction,
} from "@/modules/documents/documents.actions";
import { useDocumentLibraryStore } from "@/modules/documents/stores/use-document-library-store";

// MUST NOT import from module services (server code)

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
  role: Role;
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

/** The trash icon of a row — asks the library to confirm (one dialog for the table, so a row re-render never closes it). */
function DeleteButton({ onRequest }: { onRequest: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-destructive hover:text-destructive"
      onClick={(e) => {
        e.stopPropagation();
        onRequest();
      }}
      title="Delete document"
    >
      <Trash2 className="h-3.5 w-3.5" />
      <span className="sr-only">Delete document</span>
    </Button>
  );
}

type DeleteTarget = { id: string; businessKey: string };

/** The one delete confirmation of the library — its state lives in the client, not in the row. */
function DeleteDocumentDialog({
  target,
  onClose,
}: {
  target: DeleteTarget | null;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const invalidate = useDocumentLibraryInvalidate();

  function handleConfirm() {
    if (!target) return;
    const { id, businessKey } = target;
    startTransition(async () => {
      const result = await deleteDocumentAction({ documentId: id });
      // biome-ignore lint/suspicious/noExplicitAny: next-safe-action wrapping
      if ((result?.data as any)?.error) {
        // biome-ignore lint/suspicious/noExplicitAny: next-safe-action wrapping
        toast.error((result?.data as any).error.message);
      } else {
        toast.success(`Document ${businessKey} deleted`);
        invalidate();
      }
      onClose();
    });
  }

  return (
    <AlertDialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete document?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete <strong>{target?.businessKey}</strong> and remove the file
            from storage. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={isPending}
          >
            {isPending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DocumentLibraryClient({
  filterOptions,
  initialPreferences,
  role,
}: DocumentLibraryClientProps) {
  const filters = useDocumentLibraryStore((s) => s.filters);
  const sort = useDocumentLibraryStore((s) => s.sort);
  const page = useDocumentLibraryStore((s) => s.page);
  const pageSize = useDocumentLibraryStore((s) => s.pageSize);
  const setFilters = useDocumentLibraryStore((s) => s.setFilters);
  const setSort = useDocumentLibraryStore((s) => s.setSort);
  const setPage = useDocumentLibraryStore((s) => s.setPage);
  const setPageSize = useDocumentLibraryStore((s) => s.setPageSize);
  const clearFilters = useDocumentLibraryStore((s) => s.clearFilters);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  // Initialize store from server-side preferences (cross-session restore)
  const prefInitialized = useRef(false);
  useEffect(() => {
    if (!prefInitialized.current) {
      // Always mark initialized — even with no preferences, so the debounced
      // persistence effect fires on the first filter change for new users.
      prefInitialized.current = true;
      if (initialPreferences) {
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
    }
  }, [initialPreferences]);

  // Debounced preference persistence
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!prefInitialized.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const { upsertTablePreferenceAction: upsert } = await import("@/modules/settings/ui");
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
      id: "amount",
      header: "Amount",
      enableSorting: false,
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
          <DeleteButton
            onRequest={() =>
              setDeleteTarget({ id: row.original.id, businessKey: row.original.businessKey })
            }
          />
        </div>
      ),
    },
  ];

  // Roles that cannot edit documents get a download-only actions column
  const readOnly = !canRole(role, "update", "financial_document");
  const visibleColumns = readOnly
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

  const emptyState = readOnly ? (
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
      <DeleteDocumentDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
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
