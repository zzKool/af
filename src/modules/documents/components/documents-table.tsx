"use client";

// The document library on the kernel DataTable (D20; phase-0 item 8's last leftover): the URL is the query, the
// server loads one page, header filters fetch their values through the module's actions. Rows open the review
// page; Download and Delete (owner, confirmed) on each row; the upload zone in the toolbar refreshes the page.
import { Download, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import type { ListResult } from "@/kernel/list-query/types";
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilterSource,
  useListQuery,
} from "@/kernel/ui/data-table";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  deleteDocumentAction,
  distinctDocumentValuesAction,
  documentDateHierarchyAction,
  getDocumentDownloadUrlAction,
} from "@/modules/documents/documents.actions";
import type { DocumentListRow } from "@/modules/documents/queries";
import { FileUploadZone } from "./file-upload-zone";
import { becameHref } from "./make-it-section";

/** What the page hands over: Dates serialised, nothing else. */
export type DocumentRow = Omit<DocumentListRow, "createdAt" | "reviewedAt"> & {
  createdAt: string;
  reviewedAt: string | null;
};

const COLUMN_KEYS = [
  "businessKey",
  "fileName",
  "prefixType",
  "documentType",
  "status",
  "vendor",
  "amount",
  "currency",
  "documentDate",
  "linked",
  "mimeType",
  "fileSize",
  "reviewedAt",
  "createdAt",
] as const;
const DEFAULT_SORT = [{ col: "createdAt", dir: "desc" as const }];

const STATUS_STYLE: Record<string, string> = {
  uploaded: "bg-muted text-muted-foreground",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  extracted: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  ocr_failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  generated: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  linked: { true: "Linked", false: "Not linked" },
  documentType: { financial: "Financial", relationship: "Relationship" },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsTable({
  result,
  canUpload,
  canDelete,
  prefixOptions,
}: {
  result: ListResult<DocumentRow>;
  canUpload: boolean;
  canDelete: boolean;
  prefixOptions: { documentType: string; prefix: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });
  const { executeAsync: downloadUrl } = useAction(getDocumentDownloadUrlAction);
  const { executeAsync: remove } = useAction(deleteDocumentAction);
  const { dialogProps, confirm } = useConfirmDialog({
    title: t("documents.delete"),
    variant: "destructive",
    confirmLabel: t("documents.delete"),
  });

  const filterSource = useMemo<DataTableFilterSource>(
    () => ({
      distinct: async (column, query) => {
        const r = await distinctDocumentValuesAction({
          column: column as (typeof COLUMN_KEYS)[number],
          query,
        });
        if (r.serverError) throw new Error(r.serverError.message ?? "Failed to load values");
        return r.data?.data ?? [];
      },
      dateHierarchy: async (column, query) => {
        const r = await documentDateHierarchyAction({
          column: column as (typeof COLUMN_KEYS)[number],
          query,
        });
        if (r.serverError) throw new Error(r.serverError.message ?? "Failed to load dates");
        return r.data?.data ?? { years: [], empty: 0 };
      },
    }),
    [],
  );

  const download = useCallback(
    async (row: DocumentRow) => {
      const r = await downloadUrl({ documentId: row.id });
      const error = extractError(r);
      if (error) return toast.error(error);
      const url = r?.data?.data?.downloadUrl;
      if (!url) return;
      const a = document.createElement("a");
      a.href = url;
      a.download = row.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    [downloadUrl],
  );

  const askDelete = useCallback(
    (row: DocumentRow) =>
      confirm(
        async () => {
          const r = await remove({ documentId: row.id });
          const error = extractError(r);
          if (error) throw new Error(error);
          toast.success(t("documents.deleted", { key: row.businessKey }));
          router.refresh();
        },
        { description: t("documents.deleteConfirm", { key: row.businessKey }) },
      ),
    [confirm, remove, router, t],
  );

  const columns = useMemo<DataTableColumn<DocumentRow>[]>(
    () => [
      {
        key: "businessKey",
        header: t("documents.col.businessKey"),
        type: "text",
        width: "16rem",
        alwaysVisible: true,
        cell: (row) => (
          <Link
            href={`/documents/${row.id}`}
            className="font-mono text-xs font-medium hover:underline"
            data-testid="document-key"
          >
            {row.businessKey}
          </Link>
        ),
      },
      { key: "fileName", header: t("documents.col.fileName"), type: "text", width: "12rem" },
      { key: "prefixType", header: t("documents.col.prefixType"), type: "enum", width: "7rem" },
      {
        key: "documentType",
        header: t("documents.col.documentType"),
        type: "enum",
        width: "7rem",
        defaultHidden: true,
      },
      {
        key: "status",
        header: t("documents.col.status"),
        type: "enum",
        width: "12rem",
        truncate: false,
        cell: (row) => (
          <span className="flex items-center gap-1">
            <Badge variant="outline" className={STATUS_STYLE[row.status] ?? ""}>
              {row.status.replace("_", " ")}
            </Badge>
            {(row.status === "extracted" || row.status === "ocr_failed") && !row.reviewedAt && (
              <Badge
                variant="outline"
                className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
              >
                {t("documents.needsReview")}
              </Badge>
            )}
          </span>
        ),
      },
      { key: "vendor", header: t("documents.col.vendor"), type: "text", width: "12rem" },
      {
        key: "amount",
        header: t("documents.col.amount"),
        type: "money",
        width: "7rem",
        cell: (row) => (
          <span className="tabular-nums">
            {row.amount === null ? "—" : `${row.amount}${row.currency ? ` ${row.currency}` : ""}`}
          </span>
        ),
      },
      {
        key: "currency",
        header: t("documents.col.currency"),
        type: "enum",
        width: "5rem",
        defaultHidden: true,
      },
      { key: "documentDate", header: t("documents.col.documentDate"), type: "date", width: "7rem" },
      {
        key: "linked",
        header: t("documents.col.linked"),
        type: "boolean",
        width: "13rem",
        truncate: false,
        // FR-005: what the document became, linking to it; a document only a bank row justifies stays *Linked*
        cell: (row) =>
          row.became ? (
            <Link href={becameHref(row.became)} data-testid="document-became-link">
              <Badge variant="default" className="hover:underline">
                {t(
                  row.became.type === "expense"
                    ? "documents.became.expense"
                    : "documents.became.supplierInvoice",
                  { key: row.became.label ?? "" },
                )}
              </Badge>
            </Link>
          ) : (
            <Badge variant={row.linked ? "default" : "secondary"}>
              {row.linked ? t("documents.linked") : t("documents.notLinked")}
            </Badge>
          ),
      },
      {
        key: "mimeType",
        header: t("documents.col.mimeType"),
        type: "enum",
        width: "8rem",
        defaultHidden: true,
      },
      {
        key: "fileSize",
        header: t("documents.col.fileSize"),
        type: "number",
        width: "5rem",
        defaultHidden: true,
        cell: (row) => <span className="tabular-nums">{formatSize(row.fileSize)}</span>,
      },
      {
        key: "reviewedAt",
        header: t("documents.col.reviewedAt"),
        type: "date",
        width: "7rem",
        defaultHidden: true,
      },
      { key: "createdAt", header: t("documents.col.createdAt"), type: "date", width: "7rem" },
      {
        key: "actions",
        header: "",
        type: "text",
        filterable: false,
        sortable: false,
        width: canDelete ? "5rem" : "3rem",
        alwaysVisible: true,
        cell: (row) => (
          <span className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              title={t("documents.download")}
              onClick={(e) => {
                e.stopPropagation();
                void download(row);
              }}
              data-testid="document-download"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                title={t("documents.delete")}
                onClick={(e) => {
                  e.stopPropagation();
                  askDelete(row);
                }}
                data-testid="document-delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </span>
        ),
      },
    ],
    [t, canDelete, download, askDelete],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="documents-library">
      {canUpload && (
        <FileUploadZone prefixOptions={prefixOptions} onUploadComplete={() => router.refresh()} />
      )}
      <DataTable
        tableKey="documents"
        columns={columns}
        result={result}
        state={state}
        filterSource={filterSource}
        valueLabel={(column, value) =>
          value === null ? t("documents.blank") : (VALUE_LABELS[column]?.[value] ?? value)
        }
        rowHref={(row) => `/documents/${row.id}`}
        searchPlaceholder={t("documents.search")}
        emptyState={t("documents.empty")}
      />
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
