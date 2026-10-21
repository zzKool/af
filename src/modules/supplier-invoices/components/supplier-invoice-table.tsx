"use client";

// The supplier invoices list (US3): KPI strip (open, overdue, due in 14 days, paid this month — SEK), DataTable
// on SUPPLIER_INVOICE_COLUMNS with the derived status, money in the row's currency, the side panel for the
// selected row, "New supplier invoice" in the toolbar.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import type { ListResult } from "@/kernel/list-query/types";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilterSource,
  useListQuery,
} from "@/kernel/ui/data-table";
import type { SupplierInvoiceColumn } from "@/modules/supplier-invoices/queries";
import {
  distinctSupplierInvoicesAction,
  supplierInvoiceDateHierarchyAction,
} from "@/modules/supplier-invoices/supplier-invoices.actions";
import type {
  CategoryOption,
  DocumentOption,
  GroupOption,
  RegistrationOption,
  SupplierInvoiceKpis,
  SupplierInvoiceListRow,
  SupplierInvoiceRateSource,
  SupplierInvoiceStatus,
  SupplierOption,
} from "@/modules/supplier-invoices/types";
import { groupLabel } from "./labels";
import { NewSupplierInvoiceDialog } from "./new-supplier-invoice-dialog";
import { SupplierInvoiceStatusBadge } from "./status-badge";
import { SupplierInvoicePanel } from "./supplier-invoice-panel";

/** Dates serialised for the client. */
export type SupplierInvoiceRow = Omit<SupplierInvoiceListRow, "createdAt"> & { createdAt: string };

const COLUMN_KEYS = [
  "key",
  "groupId",
  "groupNumber",
  "groupDescription",
  "partnerId",
  "partnerName",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "dueDateDefaulted",
  "daysOverdue",
  "currency",
  "amountNet",
  "vatAmount",
  "amountTotal",
  "amountBase",
  "rateSource",
  "paidAmount",
  "paidCurrency",
  "basCode",
  "basLabel",
  "alias",
  "vatRegistrationId",
  "status",
  "allocated",
  "open",
  "documentMissing",
  "hasDocument",
  "note",
  "cancelled",
  "createdAt",
] as const;
const DEFAULT_SORT = [
  { col: "invoiceDate", dir: "desc" as const },
  { col: "key", dir: "desc" as const },
];

const money = (amount: string, currency: string) =>
  `${formatCurrency(amount, currency as Currency)} ${currency}`;

export function SupplierInvoiceTable({
  result,
  kpis,
  groups,
  categories,
  suppliers,
  registrations,
  documents,
  canWrite,
  groupId,
  initialSelectedId,
}: {
  result: ListResult<SupplierInvoiceRow>;
  kpis: SupplierInvoiceKpis | null;
  groups: GroupOption[];
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  registrations: RegistrationOption[];
  documents: DocumentOption[];
  canWrite: boolean;
  /** the group page: the list is scoped and the dialog pre-selects the group */
  groupId?: string;
  /** `?open=<id>` — the panel opens on this invoice (the graph's "Open") */
  initialSelectedId?: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [newOpen, setNewOpen] = useState(false);

  const filterSource = useMemo<DataTableFilterSource>(
    () => ({
      distinct: async (column, query) => {
        const r = await distinctSupplierInvoicesAction({
          column: column as SupplierInvoiceColumn,
          query,
          groupId,
        });
        if (r.serverError) throw new Error(r.serverError.message ?? "Failed to load values");
        const d = r.data;
        if (d && "error" in d) throw new Error(d.error.message);
        return d?.data ?? [];
      },
      dateHierarchy: async (column, query) => {
        const r = await supplierInvoiceDateHierarchyAction({
          column: column as SupplierInvoiceColumn,
          query,
          groupId,
        });
        if (r.serverError) throw new Error(r.serverError.message ?? "Failed to load dates");
        const d = r.data;
        if (d && "error" in d) throw new Error(d.error.message);
        return d?.data ?? { years: [], empty: 0 };
      },
    }),
    [groupId],
  );

  const groupLabels = useMemo(
    () => Object.fromEntries(groups.map((g) => [g.id, groupLabel(g)])),
    [groups],
  );
  const categoryLabels = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.code, c.label])),
    [categories],
  );
  const supplierNames = useMemo(
    () => Object.fromEntries(suppliers.map((s) => [s.id, s.name])),
    [suppliers],
  );
  const registrationLabels = useMemo(
    () => Object.fromEntries(registrations.map((r) => [r.id, r.label])),
    [registrations],
  );

  const columns = useMemo<DataTableColumn<SupplierInvoiceRow>[]>(
    () => [
      {
        key: "key",
        header: t("supplierInvoices.col.key"),
        type: "text",
        width: "8rem",
        alwaysVisible: true,
        cell: (row) => <span className="font-mono text-xs">{row.key}</span>,
      },
      {
        key: "partnerName",
        header: t("supplierInvoices.col.supplier"),
        type: "text",
        width: "12rem",
        cell: (row) => (
          <span className="block truncate" title={row.partnerName}>
            {row.partnerName}
          </span>
        ),
      },
      {
        key: "partnerId",
        header: `${t("supplierInvoices.col.supplier")} (id)`,
        type: "enum",
        defaultHidden: true,
      },
      {
        key: "invoiceNumber",
        header: t("supplierInvoices.col.number"),
        type: "text",
        width: "7rem",
      },
      {
        key: "groupDescription",
        header: t("supplierInvoices.col.group"),
        type: "text",
        width: "11rem",
        defaultHidden: !!groupId,
        cell: (row) => (
          <Link
            href={`/expenses/groups/${row.groupId}`}
            className="block truncate hover:underline"
            onClick={(e) => e.stopPropagation()}
            title={`${row.groupNumber} — ${row.groupDescription}`}
          >
            {row.groupNumber} — {row.groupDescription}
          </Link>
        ),
      },
      {
        key: "groupId",
        header: `${t("supplierInvoices.col.group")} (id)`,
        type: "enum",
        defaultHidden: true,
      },
      {
        key: "groupNumber",
        header: `${t("supplierInvoices.col.group")} (no.)`,
        type: "number",
        defaultHidden: true,
      },
      {
        key: "invoiceDate",
        header: t("supplierInvoices.col.invoiceDate"),
        type: "date",
        width: "6.5rem",
      },
      {
        key: "dueDate",
        header: t("supplierInvoices.col.dueDate"),
        type: "date",
        width: "6.5rem",
        cell: (row) => (
          <span
            className={row.dueDateDefaulted ? "italic" : undefined}
            title={row.dueDateDefaulted ? t("supplierInvoices.panel.dueDefaulted") : undefined}
          >
            {row.dueDate}
          </span>
        ),
      },
      {
        key: "dueDateDefaulted",
        header: t("supplierInvoices.col.dueDefaulted"),
        type: "boolean",
        defaultHidden: true,
      },
      {
        key: "daysOverdue",
        header: t("supplierInvoices.col.daysOverdue"),
        type: "number",
        width: "5rem",
        defaultHidden: true,
      },
      {
        key: "basLabel",
        header: t("supplierInvoices.col.category"),
        type: "text",
        width: "11rem",
        defaultHidden: true,
        cell: (row) => (
          <span className="block truncate" title={row.basLabel}>
            {row.basLabel}
          </span>
        ),
      },
      {
        key: "basCode",
        header: `${t("supplierInvoices.col.category")} (code)`,
        type: "enum",
        defaultHidden: true,
      },
      {
        key: "alias",
        header: t("supplierInvoices.col.alias"),
        type: "enum",
        width: "4rem",
        defaultHidden: true,
      },
      {
        key: "amountNet",
        header: t("supplierInvoices.col.net"),
        type: "money",
        width: "8rem",
        defaultHidden: true,
        cell: (row) => <span className="tabular-nums">{money(row.amountNet, row.currency)}</span>,
      },
      {
        key: "vatAmount",
        header: t("supplierInvoices.col.vat"),
        type: "money",
        width: "7rem",
        defaultHidden: true,
        cell: (row) => <span className="tabular-nums">{money(row.vatAmount, row.currency)}</span>,
      },
      {
        key: "amountTotal",
        header: t("supplierInvoices.col.total"),
        type: "money",
        width: "8rem",
        cell: (row) => <span className="tabular-nums">{money(row.amountTotal, row.currency)}</span>,
      },
      {
        key: "currency",
        header: t("supplierInvoices.col.currency"),
        type: "enum",
        width: "4rem",
        defaultHidden: true,
      },
      {
        key: "amountBase",
        header: t("supplierInvoices.col.amountBase"),
        type: "money",
        width: "8rem",
        cell: (row) => (
          <span className="tabular-nums">{formatCurrency(row.amountBase, "SEK")}</span>
        ),
      },
      {
        key: "rateSource",
        header: t("supplierInvoices.col.rateSource"),
        type: "enum",
        width: "6rem",
        defaultHidden: true,
      },
      {
        key: "paidAmount",
        header: t("supplierInvoices.col.paid"),
        type: "money",
        width: "8rem",
        defaultHidden: true,
        cell: (row) =>
          row.paidAmount ? (
            <span className="tabular-nums">{money(row.paidAmount, row.paidCurrency ?? "SEK")}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "paidCurrency",
        header: `${t("supplierInvoices.col.paid")} (ccy)`,
        type: "enum",
        defaultHidden: true,
      },
      {
        key: "vatRegistrationId",
        header: t("supplierInvoices.col.registration"),
        type: "enum",
        width: "8rem",
        defaultHidden: true,
        cell: (row) =>
          row.vatRegistrationId ? (
            <span className="block truncate">
              {registrationLabels[row.vatRegistrationId] ?? row.vatRegistrationId}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "status",
        header: t("supplierInvoices.col.status"),
        type: "enum",
        width: "9rem",
        cell: (row) => (
          <SupplierInvoiceStatusBadge status={row.status} daysOverdue={row.daysOverdue} />
        ),
      },
      {
        key: "allocated",
        header: t("supplierInvoices.col.allocated"),
        type: "money",
        width: "7rem",
        defaultHidden: true,
        cell: (row) => (
          <span className="tabular-nums">
            {money(row.allocated, row.paidCurrency ?? row.currency)}
          </span>
        ),
      },
      {
        key: "open",
        header: t("supplierInvoices.col.open"),
        type: "money",
        width: "8rem",
        cell: (row) =>
          row.cancelled ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums">
              {money(row.open, row.paidCurrency ?? row.currency)}
            </span>
          ),
      },
      {
        key: "hasDocument",
        header: t("supplierInvoices.col.document"),
        type: "boolean",
        width: "5rem",
        cell: (row) =>
          row.hasDocument ? (
            <span className="text-green-700 dark:text-green-400">
              {t("expenses.document.present")}
            </span>
          ) : row.documentMissing ? (
            <span className="text-amber-700 dark:text-amber-400">
              {t("expenses.document.missing")}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("expenses.document.none")}</span>
          ),
      },
      {
        key: "documentMissing",
        header: t("supplierInvoices.form.documentMissing"),
        type: "boolean",
        defaultHidden: true,
      },
      {
        key: "cancelled",
        header: t("supplierInvoices.col.cancelled"),
        type: "boolean",
        defaultHidden: true,
      },
      {
        key: "note",
        header: t("supplierInvoices.col.note"),
        type: "text",
        width: "10rem",
        defaultHidden: true,
      },
      {
        key: "createdAt",
        header: t("supplierInvoices.col.created"),
        type: "date",
        width: "7rem",
        defaultHidden: true,
      },
    ],
    [t, groupId, registrationLabels],
  );

  const kpi = (
    testId: string,
    label: string,
    amount: string,
    count: number,
    onClick: () => void,
    tone?: string,
  ) => (
    <button
      type="button"
      className={`rounded-md border px-3 py-1.5 text-left hover:bg-muted ${tone ?? ""}`}
      onClick={onClick}
      data-testid={testId}
    >
      <span className="font-medium">{label}</span>
      <span className="ml-2 tabular-nums">{formatCurrency(amount, "SEK")} SEK</span>
      <span className="ml-2 text-muted-foreground">
        {t("supplierInvoices.kpi.count", { count })}
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      {kpis && (
        <div className="flex flex-wrap gap-2 text-xs" data-testid="supplier-invoice-kpis">
          {kpi("kpi-open", t("supplierInvoices.kpi.open"), kpis.openBase, kpis.openCount, () =>
            state.setFilter("status", {
              kind: "in",
              values: ["unpaid", "partially_paid", "overdue"],
            }),
          )}
          {kpi(
            "kpi-overdue",
            t("supplierInvoices.kpi.overdue"),
            kpis.overdueBase,
            kpis.overdueCount,
            () => state.setFilter("status", { kind: "in", values: ["overdue"] }),
            kpis.overdueCount > 0 ? "border-red-300" : undefined,
          )}
          {kpi(
            "kpi-due-soon",
            t("supplierInvoices.kpi.dueSoon"),
            kpis.dueSoonBase,
            kpis.dueSoonCount,
            () => state.setFilter("status", { kind: "in", values: ["unpaid", "partially_paid"] }),
          )}
          {kpi(
            "kpi-paid-month",
            t("supplierInvoices.kpi.paidThisMonth"),
            kpis.paidThisMonthBase,
            kpis.paidThisMonthCount,
            () => state.setFilter("status", { kind: "in", values: ["paid"] }),
          )}
        </div>
      )}
      <DataTable
        tableKey={groupId ? "supplier-invoices-group" : "supplier-invoices"}
        columns={columns}
        result={result}
        state={state}
        filterSource={filterSource}
        valueLabel={(column, value) => {
          if (value === null) return "(Blanks)";
          if (column === "status")
            return t(`supplierInvoices.status.${value as SupplierInvoiceStatus}`);
          if (column === "groupId") return groupLabels[value] ?? value;
          if (column === "partnerId") return supplierNames[value] ?? value;
          if (column === "basCode") return categoryLabels[value] ?? value;
          if (column === "vatRegistrationId") return registrationLabels[value] ?? value;
          if (column === "rateSource")
            return value === "bank"
              ? t("expenses.rateSource.bank")
              : t(`journal.rateSource.${value as Exclude<SupplierInvoiceRateSource, "bank">}`);
          if (
            column === "dueDateDefaulted" ||
            column === "hasDocument" ||
            column === "documentMissing" ||
            column === "cancelled"
          )
            return value === "true" ? t("common.yes") : t("common.no");
          return value;
        }}
        rowCurrency={(row) => row.currency as Currency}
        sumCurrency={"SEK" as Currency}
        onRowClick={(row) => setSelectedId(row.id)}
        searchPlaceholder={t("supplierInvoices.search")}
        toolbar={
          canWrite ? (
            <Button
              size="sm"
              onClick={() => setNewOpen(true)}
              data-testid="open-new-supplier-invoice"
            >
              {t("supplierInvoices.new")}
            </Button>
          ) : undefined
        }
        emptyState={
          Object.keys(state.query.filters).length || state.query.search
            ? t("supplierInvoices.emptyFiltered")
            : t("supplierInvoices.empty")
        }
      />
      <SupplierInvoicePanel
        invoiceId={selectedId}
        onClose={() => setSelectedId(null)}
        categories={categories}
        suppliers={suppliers}
        registrations={registrations}
        canWrite={canWrite}
        onChanged={() => router.refresh()}
      />
      {canWrite && (
        <NewSupplierInvoiceDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          groups={groups}
          categories={categories}
          suppliers={suppliers}
          registrations={registrations}
          documents={documents}
          defaultGroupId={groupId}
        />
      )}
    </div>
  );
}
