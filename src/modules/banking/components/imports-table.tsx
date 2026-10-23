"use client";

// The import history (FR-002): one row per file — its account, period and counts — as a DataTable (D20, D40).
// The file name is the row link (the workbench filtered on that import); ⋮ → Delete (refused while linked).
// The title row's Import CSV is `header-actions.tsx`.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import type { ListResult } from "@/kernel/list-query/types";
import { DataTable, type DataTableColumn, useListQuery } from "@/kernel/ui/data-table";
import {
  deleteImportAction,
  distinctImportsAction,
  importDateHierarchyAction,
} from "@/modules/banking/banking.actions";
import type { BankImportDto } from "@/modules/banking/types";
import { filterSourceOf } from "./filter-source";

export type ImportRow = Omit<BankImportDto, "importedAt"> & {
  importedAt: string;
  accountLabel: string;
};

const COLUMN_KEYS = [
  "fileName",
  "accountLabel",
  "periodFrom",
  "recordCount",
  "importedCount",
  "duplicateCount",
  "errorCount",
  "importedAt",
] as const;
const DEFAULT_SORT = [{ col: "importedAt", dir: "desc" as const }];
/** the workbench filtered on this import's rows */
const rowsOf = (row: { id: string }) => `/banking?f.bankImportId=in:${row.id}`;

export function ImportsTable({
  result,
  canWrite,
}: {
  result: ListResult<ImportRow>;
  canWrite: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });
  const [toDelete, setToDelete] = useState<ImportRow | null>(null);
  const { executeAsync: remove, isPending } = useAction(deleteImportAction);
  const filterSource = useMemo(
    () => filterSourceOf(distinctImportsAction, importDateHierarchyAction),
    [],
  );

  async function confirmDelete() {
    if (!toDelete) return;
    const r = await remove({ id: toDelete.id });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("banking.imports.deleted"));
    setToDelete(null);
    router.refresh();
  }

  const columns = useMemo<DataTableColumn<ImportRow>[]>(
    () => [
      {
        key: "fileName",
        header: t("banking.imports.col.file"),
        type: "text",
        width: "16rem",
        alwaysVisible: true,
        cell: (row) => (
          <Link
            href={rowsOf(row)}
            className="block truncate font-mono text-xs text-primary hover:text-primary-hover hover:underline"
            title={row.fileName}
          >
            {row.fileName}
          </Link>
        ),
      },
      {
        key: "accountLabel",
        header: t("banking.imports.col.account"),
        type: "enum",
        width: "10rem",
        quickFilter: true,
      },
      {
        key: "periodFrom",
        header: t("banking.imports.col.period"),
        type: "date",
        width: "13rem",
        cell: (row) =>
          row.periodFrom && row.periodTo ? (
            <span className="tabular-nums">
              {row.periodFrom} → {row.periodTo}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "recordCount",
        header: t("banking.imports.col.rows"),
        type: "number",
        width: "6rem",
      },
      {
        key: "importedCount",
        header: t("banking.imports.col.imported"),
        type: "number",
        width: "6.5rem",
      },
      {
        key: "duplicateCount",
        header: t("banking.imports.col.duplicates"),
        type: "number",
        width: "7rem",
      },
      {
        key: "errorCount",
        header: t("banking.imports.col.errors"),
        type: "number",
        width: "6rem",
        cell: (row) =>
          row.errorCount > 0 ? (
            <span className="tabular-nums text-destructive" title={row.errors.join("\n")}>
              {row.errorCount}
            </span>
          ) : (
            <span className="tabular-nums">0</span>
          ),
      },
      {
        key: "importedAt",
        header: t("banking.imports.col.date"),
        type: "date",
        width: "11.5rem",
        cell: (row) => (
          <span className="tabular-nums">{row.importedAt.slice(0, 16).replace("T", " ")}</span>
        ),
      },
    ],
    [t],
  );

  return (
    <>
      <DataTable
        tableKey="bank-imports"
        columns={columns}
        result={result}
        state={state}
        filterSource={filterSource}
        valueLabel={(_column, value) => (value === null ? t("common.blanks") : value)}
        rowHref={rowsOf}
        rowActions={
          canWrite
            ? (row) => [
                {
                  label: t("banking.imports.delete"),
                  destructive: true,
                  onClick: () => setToDelete(row),
                },
              ]
            : undefined
        }
        emptyState={t("banking.imports.empty")}
      />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        description={t("banking.imports.deleteConfirm", { count: toDelete?.importedCount ?? 0 })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void confirmDelete()}
        isLoading={isPending}
      />
    </>
  );
}
