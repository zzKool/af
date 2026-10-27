"use client";

// The supplier invoices list (US3, D40 kit): the KPI strip (open, overdue, due in 14 days, paid this month — SEK
// base), the DataTable on SUPPLIER_INVOICE_COLUMNS — the key as a code chip, the derived status through the
// module's one family map, money through formatMoney, Month (invoice date) and Supplier quick filters, ⋮ row
// actions, Σ only under a true currency (list-sums.ts) — and the docked side panel for the selected row. The page's
// title row holds *New supplier invoice* (`NewSupplierInvoiceButton`).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";
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
  type RowAction,
  useListQuery,
} from "@/kernel/ui/data-table";
import { StateIcon } from "@/kernel/ui/state-label";
import { CodeChip, Tag } from "@/kernel/ui/tags";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import type { SupplierInvoiceColumn } from "@/modules/supplier-invoices/queries";
import {
  deleteSupplierInvoiceAction,
  distinctSupplierInvoicesAction,
  supplierInvoiceDateHierarchyAction,
  uncancelSupplierInvoiceAction,
} from "@/modules/supplier-invoices/supplier-invoices.actions";
import type {
  CategoryOption,
  GroupOption,
  RegistrationOption,
  SupplierInvoiceKpis,
  SupplierInvoiceListRow,
  SupplierInvoiceRateSource,
  SupplierInvoiceStatus,
  SupplierOption,
} from "@/modules/supplier-invoices/types";
import { groupLabel } from "./labels";
import { SupplierInvoiceStateLabel } from "./state-label";
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
  "basCode",
  "basLabel",
  "alias",
  "vatRegistrationId",
  "status",
  "allocated",
  "allocatedBase",
  "fxDifference",
  "open",
  "documentMissing",
  "hasDocument",
  "reverseCharge",
  "note",
  "cancelled",
  "createdAt",
] as const;
const DEFAULT_SORT = [
  { col: "invoiceDate", dir: "desc" as const },
  { col: "key", dir: "desc" as const },
];

const money = (amount: string, currency: string) => (
  <span className="tabular-nums" data-amount>
    {formatMoney(amount, currency)}
  </span>
);

export function SupplierInvoiceTable({
  result,
  kpis,
  groups,
  categories,
  suppliers,
  registrations,
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
  canWrite: boolean;
  /** a list scoped to one group (the group column hidden) */
  groupId?: string;
  /** `?open=<id>` — the panel opens on this invoice (the graph's "Open") */
  initialSelectedId?: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const { executeAsync: uncancel } = useAction(uncancelSupplierInvoiceAction);
  const { executeAsync: remove } = useAction(deleteSupplierInvoiceAction);
  const deleteDialog = useConfirmDialog({
    title: t("supplierInvoices.panel.delete"),
    variant: "destructive",
    confirmLabel: t("common.delete"),
  });

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
        cell: (row) => <CodeChip>{row.key}</CodeChip>,
      },
      {
        key: "partnerName",
        header: t("supplierInvoices.col.supplier"),
        type: "enum",
        width: "12rem",
        quickFilter: true,
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
            className="block truncate text-primary hover:underline"
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
        quickFilter: true,
      },
      {
        key: "dueDate",
        header: t("supplierInvoices.col.dueDate"),
        type: "date",
        width: "6.5rem",
        cell: (row) => (
          <span
            className={`tabular-nums ${row.dueDateDefaulted ? "italic" : ""}`}
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
        cell: (row) => money(row.amountNet, row.currency),
      },
      {
        key: "vatAmount",
        header: t("supplierInvoices.col.vat"),
        type: "money",
        width: "7rem",
        defaultHidden: true,
        cell: (row) => money(row.vatAmount, row.currency),
      },
      {
        key: "amountTotal",
        header: t("supplierInvoices.col.total"),
        type: "money",
        width: "8rem",
        cell: (row) => money(row.amountTotal, row.currency),
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
        // in the base currency, not the row's — the header names it
        cell: (row) => (
          <span className="tabular-nums" data-amount>
            {formatMoney(row.amountBase, null, { bare: true })}
          </span>
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
          <SupplierInvoiceStateLabel status={row.status} daysOverdue={row.daysOverdue} />
        ),
      },
      {
        key: "allocated",
        header: t("supplierInvoices.col.allocated"),
        type: "money",
        width: "7rem",
        defaultHidden: true,
        cell: (row) => money(row.allocated, row.currency),
      },
      {
        // F114: the base the rows gave, and Σ base − the invoice's base for the paid share, signed
        key: "allocatedBase",
        header: t("supplierInvoices.col.allocatedBase"),
        type: "money",
        width: "7rem",
        defaultHidden: true,
      },
      {
        key: "fxDifference",
        header: t("supplierInvoices.col.fxDifference"),
        type: "money",
        width: "7rem",
        defaultHidden: true,
        cell: (row) =>
          Number(row.fxDifference) !== 0 ? (
            <span className="tabular-nums">{row.fxDifference}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
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
            money(row.open, row.currency)
          ),
      },
      {
        key: "hasDocument",
        header: t("supplierInvoices.col.document"),
        type: "boolean",
        width: "5rem",
        cell: (row) =>
          row.hasDocument ? (
            <span className="text-state-done">{t("expenses.document.present")}</span>
          ) : row.documentMissing ? (
            <span className="text-state-attention">{t("expenses.document.missing")}</span>
          ) : (
            <span className="text-muted-foreground">{t("expenses.document.none")}</span>
          ),
      },
      {
        // D54, F91: made from a document that says the buyer pays the VAT — a tag, nothing computed
        key: "reverseCharge",
        header: t("common.reverseCharge"),
        type: "boolean",
        width: "6.5rem",
        cell: (row) => (row.reverseCharge ? <Tag>{t("common.yes")}</Tag> : null),
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
    attention = false,
  ) => (
    <button
      type="button"
      className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-left hover:bg-hover"
      onClick={onClick}
      data-testid={testId}
    >
      {attention && <StateIcon family="attention" />}
      <span className="font-semibold">{label}</span>
      <span className="tabular-nums" data-amount>
        {formatMoney(amount, "SEK")}
      </span>
      <span className="text-muted-foreground">{t("supplierInvoices.kpi.count", { count })}</span>
    </button>
  );

  const rowActions = (row: SupplierInvoiceRow): RowAction[] => [
    { label: t("common.open"), onClick: () => setSelectedId(row.id) },
    {
      label: t("supplierInvoices.action.openGroup"),
      onClick: () => router.push(`/expenses/groups/${row.groupId}`),
    },
    ...(canWrite && row.cancelled
      ? [
          {
            label: t("supplierInvoices.panel.uncancel"),
            onClick: async () => {
              const r = await uncancel({ id: row.id });
              const error = extractError(r);
              if (error) return void toast.error(error);
              toast.success(t("supplierInvoices.panel.uncancelled"));
              router.refresh();
            },
          },
        ]
      : []),
    // the service refuses once anything but its document is linked (D36) — the toast says so
    ...(canWrite && !row.cancelled && row.allocated === "0.00"
      ? [
          {
            label: t("supplierInvoices.panel.delete"),
            destructive: true,
            onClick: () =>
              deleteDialog.confirm(
                async () => {
                  const r = await remove({ id: row.id });
                  const error = extractError(r);
                  if (error) throw new Error(error);
                  toast.success(t("supplierInvoices.panel.deleted"));
                  if (selectedId === row.id) setSelectedId(null);
                  router.refresh();
                },
                { description: t("supplierInvoices.panel.deleteConfirm", { key: row.key }) },
              ),
          },
        ]
      : []),
  ];

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
            kpis.overdueCount > 0,
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
          if (value === null) return t("common.blanks");
          if (column === "status")
            return t(`supplierInvoices.status.${value as SupplierInvoiceStatus}`);
          if (column === "groupId") return groupLabels[value] ?? value;
          if (column === "partnerId") return supplierNames[value] ?? value;
          if (column === "basCode") return categoryLabels[value] ?? value;
          if (column === "vatRegistrationId") return registrationLabels[value] ?? value;
          if (column === "rateSource")
            return value === "bank"
              ? t("expenses.rateSource.bank")
              : t(`banking.rateSource.${value as Exclude<SupplierInvoiceRateSource, "bank">}`);
          if (
            column === "dueDateDefaulted" ||
            column === "hasDocument" ||
            column === "reverseCharge" ||
            column === "documentMissing" ||
            column === "cancelled"
          )
            return value === "true" ? t("common.yes") : t("common.no");
          return value;
        }}
        rowCurrency={(row) => row.currency as Currency}
        // Σ total / open only when the filtered set has one currency, else the base total bare (list-sums.ts)
        sumCurrency={
          result.sums?.amountTotal !== undefined
            ? (result.rows[0]?.currency as Currency | undefined)
            : undefined
        }
        onRowClick={(row) => setSelectedId(row.id)}
        rowActions={rowActions}
        searchPlaceholder={t("supplierInvoices.search")}
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
      <ConfirmDialog {...deleteDialog.dialogProps} />
    </div>
  );
}
