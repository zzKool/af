"use client";

// The document library on the kernel DataTable (D20) and the D40 kit (F71): the URL is the query, the server
// loads one page, header filters fetch their values through the module's actions. The derived state as
// <StateLabel> through the module's one family map (the inbox's word), the key as a code chip, the kind as a tag,
// money through formatMoney; Open / Download / Delete (owner, confirmed) in the row's ⋮; Document date and Kind
// as quick filters; the upload zone above the table refreshes the page. `?new=1` (+ New → Upload document, F73)
// opens the same zone in a dialog.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { extractError } from "@/kernel/errors/extract-error";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import type { ListResult } from "@/kernel/list-query/types";
import { formatMoney } from "@/kernel/money/format-money";
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilterSource,
  useListQuery,
} from "@/kernel/ui/data-table";
import { useNewParam } from "@/kernel/ui/shell/use-new-param";
import { CodeChip, Tag } from "@/kernel/ui/tags";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  deleteDocumentAction,
  distinctDocumentValuesAction,
  documentDateHierarchyAction,
  getDocumentDownloadUrlAction,
} from "@/modules/documents/documents.actions";
import type { DocumentListRow } from "@/modules/documents/queries";
import { DocumentStateLabel } from "./document-state-label";
import { FileUploadZone } from "./file-upload-zone";
import { becameHref } from "./make-it-section";
import { UploadDocumentDialog } from "./upload-document-dialog";

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

/** The filter values' words: the Status filter is on the OCR step (the cell shows the derived state). */
function valueKey(column: string, value: string): MessageKey | null {
  switch (column) {
    case "status":
      return ["uploaded", "processing", "extracted", "ocr_failed", "generated"].includes(value)
        ? (`documents.status.${value}` as MessageKey)
        : null;
    case "prefixType":
      return ["expense", "invoice", "contract", "nda", "certificate"].includes(value)
        ? (`documents.prefix.${value}` as MessageKey)
        : null;
    case "documentType":
      return value === "financial" || value === "relationship"
        ? (`documents.category.${value}` as MessageKey)
        : null;
    case "linked":
      return value === "true"
        ? "documents.linked"
        : value === "false"
          ? "documents.notLinked"
          : null;
    default:
      return null;
  }
}

/** The amount in its currency; an amount the formatter refuses shows as it came rather than breaking the row. */
function money(amount: string, currency: string | null): string {
  try {
    return formatMoney(amount, currency);
  } catch {
    return currency ? `${amount} ${currency}` : amount;
  }
}

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
  const [uploadOpen, setUploadOpen] = useNewParam(canUpload);
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
        width: "12rem",
        alwaysVisible: true,
        cell: (row) => (
          <Link
            href={`/documents/${row.id}`}
            className="hover:underline"
            data-testid="document-key"
          >
            <CodeChip>{row.businessKey}</CodeChip>
          </Link>
        ),
      },
      { key: "fileName", header: t("documents.col.fileName"), type: "text", width: "10rem" },
      {
        key: "prefixType",
        header: t("documents.col.prefixType"),
        type: "enum",
        width: "6.5rem",
        quickFilter: true,
        cell: (row) => {
          const k = valueKey("prefixType", row.prefixType);
          return <Tag>{k ? t(k) : row.prefixType}</Tag>;
        },
      },
      {
        key: "documentType",
        header: t("documents.col.documentType"),
        type: "enum",
        width: "7rem",
        defaultHidden: true,
        cell: (row) => {
          const k = valueKey("documentType", row.documentType);
          return <Tag>{k ? t(k) : row.documentType}</Tag>;
        },
      },
      {
        key: "status",
        header: t("documents.col.status"),
        type: "enum",
        width: "7.5rem",
        truncate: false,
        cell: (row) => <DocumentStateLabel state={row.state} testId="document-state" />,
      },
      { key: "vendor", header: t("documents.col.vendor"), type: "text", width: "9rem" },
      {
        key: "amount",
        header: t("documents.col.amount"),
        type: "money",
        width: "8rem",
        cell: (row) =>
          row.amount === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums" data-amount={row.amount}>
              {money(row.amount, row.currency)}
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
      {
        key: "documentDate",
        header: t("documents.col.documentDate"),
        type: "date",
        width: "7rem",
        quickFilter: true,
      },
      {
        key: "linked",
        header: t("documents.col.linked"),
        type: "boolean",
        width: "10rem",
        truncate: false,
        // FR-005: what the document became, linking to it; a document only a bank row justifies stays *Linked*
        cell: (row) =>
          row.became ? (
            <Link
              href={becameHref(row.became)}
              title={row.became.label ?? undefined}
              className="text-primary hover:underline"
              data-testid="document-became-link"
            >
              {t(
                row.became.type === "expense"
                  ? "documents.became.expense"
                  : "documents.became.supplierInvoice",
                { key: row.became.key ?? "" },
              )}
            </Link>
          ) : (
            <span className={row.linked ? undefined : "text-muted-foreground"}>
              {row.linked ? t("documents.linked") : t("documents.notLinked")}
            </span>
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
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="documents-library">
      {canUpload && (
        <FileUploadZone
          prefixOptions={prefixOptions}
          onUploadComplete={() => router.refresh()}
          onBatchComplete={() => router.refresh()}
        />
      )}
      <DataTable
        tableKey="documents"
        columns={columns}
        result={result}
        state={state}
        filterSource={filterSource}
        valueLabel={(column, value) => {
          if (value === null) return t("documents.blank");
          const k = valueKey(column, value);
          return k ? t(k) : value;
        }}
        rowHref={(row) => `/documents/${row.id}`}
        rowActions={(row) => [
          { label: t("common.open"), onClick: () => router.push(`/documents/${row.id}`) },
          { label: t("documents.download"), onClick: () => void download(row) },
          ...(canDelete
            ? [{ label: t("documents.delete"), destructive: true, onClick: () => askDelete(row) }]
            : []),
        ]}
        searchPlaceholder={t("documents.search")}
        emptyState={t("documents.empty")}
      />
      <ConfirmDialog {...dialogProps} />
      {canUpload && (
        <UploadDocumentDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          prefixOptions={prefixOptions}
          onUploadComplete={() => router.refresh()}
          onBatchComplete={() => router.refresh()}
        />
      )}
    </div>
  );
}
