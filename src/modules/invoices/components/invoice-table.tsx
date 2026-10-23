"use client";

// The documents list on the kernel DataTable (D20) and the D40 kit (F71): the derived state as <StateLabel>
// through the module's one family map, the number as a code chip, money through the table's formatMoney, the
// row's ⋮ actions, Date and Client as filter buttons. The "new" primary lives in the title row (NewDocumentButton).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useMemo } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import type { ListResult } from "@/kernel/list-query/types";
import { formatMoney } from "@/kernel/money/format-money";
import type { Currency } from "@/kernel/nav/constants";
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilterSource,
  useListQuery,
} from "@/kernel/ui/data-table";
import { CodeChip } from "@/kernel/ui/tags";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  copyToDraftAction,
  deleteDraftAction,
  distinctInvoicesAction,
  invoiceDateHierarchyAction,
} from "@/modules/invoices/invoices.actions";
import type { InvoiceColumn } from "@/modules/invoices/queries";
import type { InvoiceListRow, InvoiceState } from "@/modules/invoices/types";
import { InvoiceStateLabel } from "./invoice-state-label";

/** Dates serialised for the client. */
export type InvoiceRow = Omit<InvoiceListRow, "issuedAt" | "sentAt" | "createdAt" | "updatedAt"> & {
  issuedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const COLUMN_KEYS = [
  "number",
  "type",
  "state",
  "partnerId",
  "partnerName",
  "issueDate",
  "dueDate",
  "periodLabel",
  "currency",
  "totalAmount",
  "totalBase",
  "remaining",
  "credited",
  "declarationPeriod",
  "language",
  "issuedAt",
  "sentAt",
  "createdAt",
  "updatedAt",
] as const;
const DEFAULT_SORT = [
  { col: "issueDate", dir: "desc" as const },
  { col: "createdAt", dir: "desc" as const },
];

export function InvoiceTable({
  result,
  partnerNames,
  canWrite,
}: {
  result: ListResult<InvoiceRow>;
  /** id → name, for the Client filter's values */
  partnerNames: Record<string, string>;
  canWrite: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });
  const { executeAsync: copy } = useAction(copyToDraftAction);
  const { executeAsync: remove } = useAction(deleteDraftAction);
  const deleteDialog = useConfirmDialog({
    title: t("invoices.action.deleteConfirm.title"),
    variant: "destructive",
    confirmLabel: t("common.delete"),
  });

  const filterSource = useMemo<DataTableFilterSource>(
    () => ({
      distinct: async (column, query) => {
        const r = await distinctInvoicesAction({ column: column as InvoiceColumn, query });
        if (r.serverError) throw new Error(r.serverError.message ?? "Failed to load values");
        const d = r.data;
        if (d && "error" in d) throw new Error(d.error.message);
        return d?.data ?? [];
      },
      dateHierarchy: async (column, query) => {
        const r = await invoiceDateHierarchyAction({ column: column as InvoiceColumn, query });
        if (r.serverError) throw new Error(r.serverError.message ?? "Failed to load dates");
        const d = r.data;
        if (d && "error" in d) throw new Error(d.error.message);
        return d?.data ?? { years: [], empty: 0 };
      },
    }),
    [],
  );

  const columns = useMemo<DataTableColumn<InvoiceRow>[]>(
    () => [
      {
        key: "number",
        header: t("invoices.col.number"),
        type: "text",
        width: "8rem",
        alwaysVisible: true,
        cell: (row) => (
          <Link href={`/invoices/${row.id}`} className="hover:underline">
            {row.number ? (
              <CodeChip>{row.number}</CodeChip>
            ) : (
              <span className="text-muted-foreground">{t("invoices.state.draft")}</span>
            )}
          </Link>
        ),
      },
      {
        key: "type",
        header: t("invoices.col.type"),
        type: "enum",
        width: "7rem",
        cell: (row) => t(`invoices.type.${row.type}`),
      },
      {
        key: "state",
        header: t("invoices.col.state"),
        type: "enum",
        width: "8rem",
        cell: (row) => <InvoiceStateLabel state={row.state} />,
      },
      {
        key: "partnerName",
        header: t("invoices.col.partner"),
        type: "enum",
        width: "14rem",
        quickFilter: true,
      },
      {
        key: "partnerId",
        header: `${t("invoices.col.partner")} (id)`,
        type: "enum",
        defaultHidden: true,
      },
      {
        key: "issueDate",
        header: t("invoices.col.issueDate"),
        type: "date",
        width: "7rem",
        quickFilter: true,
      },
      { key: "dueDate", header: t("invoices.col.dueDate"), type: "date", width: "7rem" },
      { key: "periodLabel", header: t("invoices.col.period"), type: "text", width: "9rem" },
      { key: "currency", header: t("invoices.col.currency"), type: "enum", width: "5rem" },
      { key: "totalAmount", header: t("invoices.col.total"), type: "money", width: "8rem" },
      { key: "remaining", header: t("invoices.col.remaining"), type: "money", width: "8rem" },
      {
        key: "credited",
        header: t("invoices.col.credited"),
        type: "money",
        width: "8rem",
        defaultHidden: true,
      },
      {
        key: "totalBase",
        header: t("invoices.col.totalBase"),
        type: "money",
        width: "8rem",
        defaultHidden: true,
        // in the base currency, not the row's — the header names it
        cell: (row) =>
          row.totalBase === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums">{formatMoney(row.totalBase, null, { bare: true })}</span>
          ),
      },
      {
        key: "declarationPeriod",
        header: t("invoices.col.declarationPeriod"),
        type: "enum",
        width: "7rem",
      },
      {
        key: "language",
        header: t("invoices.col.language"),
        type: "enum",
        width: "4rem",
        defaultHidden: true,
      },
      { key: "issuedAt", header: "Issued at", type: "date", width: "7rem", defaultHidden: true },
      { key: "sentAt", header: "Sent at", type: "date", width: "7rem", defaultHidden: true },
      { key: "createdAt", header: "Created", type: "date", width: "7rem", defaultHidden: true },
      { key: "updatedAt", header: "Updated", type: "date", width: "7rem", defaultHidden: true },
    ],
    [t],
  );

  const go = async (r: unknown) => {
    const error = extractError(r);
    if (error) return toast.error(error);
    const id = (r as { data?: { data?: { id?: string } } })?.data?.data?.id;
    toast.success(t("invoices.created"));
    if (id) router.push(`/invoices/${id}`);
  };

  return (
    <>
      <DataTable
        tableKey="invoices"
        columns={columns}
        result={result}
        state={state}
        filterSource={filterSource}
        valueLabel={(column, value) => {
          if (value === null) return t("common.blanks");
          if (column === "state") return t(`invoices.state.${value as InvoiceState}`);
          if (column === "type")
            return t(`invoices.type.${value as "invoice" | "quote" | "credit_note"}`);
          if (column === "partnerId") return partnerNames[value] ?? value;
          return value;
        }}
        rowCurrency={(row) => row.currency as Currency}
        // the server keeps Σ total / remaining only when the filtered set has one currency (list-sums.ts)
        sumCurrency={
          result.sums?.totalAmount !== undefined
            ? (result.rows[0]?.currency as Currency | undefined)
            : undefined
        }
        rowHref={(row) => `/invoices/${row.id}`}
        rowActions={(row) => [
          { label: t("common.open"), onClick: () => router.push(`/invoices/${row.id}`) },
          ...(canWrite
            ? [
                {
                  label: t("invoices.action.copy"),
                  onClick: async () => go(await copy({ id: row.id })),
                },
              ]
            : []),
          ...(canWrite && row.status === "draft"
            ? [
                {
                  label: t("invoices.action.deleteDraft"),
                  destructive: true,
                  onClick: () =>
                    deleteDialog.confirm(
                      async () => {
                        const r = await remove({ id: row.id });
                        const error = extractError(r);
                        if (error) throw new Error(error);
                        toast.success(t("invoices.deleted"));
                        router.refresh();
                      },
                      { description: t("invoices.action.deleteConfirm.description") },
                    ),
                },
              ]
            : []),
        ]}
        searchPlaceholder={t("invoices.search")}
        emptyState={
          Object.keys(state.query.filters).length || state.query.search
            ? t("invoices.emptyFiltered")
            : t("invoices.empty")
        }
      />
      <ConfirmDialog {...deleteDialog.dialogProps} />
    </>
  );
}
