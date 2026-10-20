"use client";

// The documents list on the kernel DataTable (D20): derived state chips, money in the row's currency,
// header filters from the module's distinct/hierarchy actions, "new" buttons in the toolbar.
import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import type { ListResult } from "@/kernel/list-query/types";
import type { Currency } from "@/kernel/nav/constants";
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilterSource,
  useListQuery,
} from "@/kernel/ui/data-table";
import {
  distinctInvoicesAction,
  invoiceDateHierarchyAction,
} from "@/modules/invoices/invoices.actions";
import type { InvoiceColumn } from "@/modules/invoices/queries";
import type { InvoiceListRow, InvoiceState } from "@/modules/invoices/types";

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

export const STATE_STYLE: Record<InvoiceState, string> = {
  draft: "bg-muted text-muted-foreground",
  issued: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  partially_paid: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  overdue: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  credited: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  accepted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  declined: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  expired: "bg-muted text-muted-foreground",
  converted: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

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
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });

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
          <Link href={`/invoices/${row.id}`} className="font-medium tabular-nums hover:underline">
            {row.number ?? (
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
        cell: (row) => (
          <Badge variant="outline" className={STATE_STYLE[row.state]}>
            {t(`invoices.state.${row.state}`)}
          </Badge>
        ),
      },
      { key: "partnerName", header: t("invoices.col.partner"), type: "text", width: "14rem" },
      {
        key: "partnerId",
        header: `${t("invoices.col.partner")} (id)`,
        type: "enum",
        defaultHidden: true,
      },
      { key: "issueDate", header: t("invoices.col.issueDate"), type: "date", width: "7rem" },
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

  return (
    <DataTable
      tableKey="invoices"
      columns={columns}
      result={result}
      state={state}
      filterSource={filterSource}
      valueLabel={(column, value) => {
        if (value === null) return "(Blanks)";
        if (column === "state") return t(`invoices.state.${value as InvoiceState}`);
        if (column === "type")
          return t(`invoices.type.${value as "invoice" | "quote" | "credit_note"}`);
        if (column === "partnerId") return partnerNames[value] ?? value;
        return value;
      }}
      rowCurrency={(row) => row.currency as Currency}
      sumCurrency={result.rows[0]?.currency as Currency | undefined}
      rowHref={(row) => `/invoices/${row.id}`}
      searchPlaceholder={t("invoices.search")}
      toolbar={
        canWrite && (
          <div className="flex gap-2">
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href="/invoices/new?type=invoice" />}
            >
              {t("invoices.new.invoice")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/invoices/new?type=quote" />}
            >
              {t("invoices.new.quote")}
            </Button>
          </div>
        )
      }
      emptyState={
        Object.keys(state.query.filters).length || state.query.search
          ? t("invoices.emptyFiltered")
          : t("invoices.empty")
      }
    />
  );
}
