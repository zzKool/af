"use client";

// The expenses list (US5): KPI strip from the ledger, DataTable on EXPENSE_COLUMNS with the derived status,
// money in the row's currency, the side panel for the selected row, "New expense" in the toolbar.
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
import {
  distinctExpensesAction,
  expenseDateHierarchyAction,
} from "@/modules/expenses/expenses.actions";
import type { ExpenseColumn } from "@/modules/expenses/queries";
import type {
  CategoryOption,
  DocumentOption,
  ExpenseKind,
  ExpenseListRow,
  ExpenseRateSource,
  ExpenseStatus,
  GroupOption,
  LedgerSnapshot,
  SourceOption,
  TransactionOption,
} from "@/modules/expenses/types";
import { ExpensePanel } from "./expense-panel";
import { groupLabel } from "./labels";
import { NewExpenseDialog } from "./new-expense-dialog";
import { StatusBadge } from "./status-badge";

/** Dates serialised for the client. */
export type ExpenseRow = Omit<ExpenseListRow, "createdAt"> & { createdAt: string };

const COLUMN_KEYS = [
  "key",
  "groupId",
  "groupNumber",
  "groupDescription",
  "date",
  "description",
  "kind",
  "basCode",
  "basLabel",
  "alias",
  "amount",
  "currency",
  "amountBase",
  "baseProvisional",
  "rateSource",
  "paidAmount",
  "paidCurrency",
  "paymentSourceId",
  "paymentSourceLabel",
  "paymentSourceKind",
  "status",
  "allocatedBase",
  "openBase",
  "documentMissing",
  "hasDocument",
  "note",
  "vatAmount",
  "createdAt",
] as const;
const DEFAULT_SORT = [
  { col: "date", dir: "desc" as const },
  { col: "key", dir: "desc" as const },
];

const money = (amount: string, currency: string) =>
  `${formatCurrency(amount, currency as Currency)} ${currency}`;

export function ExpenseTable({
  result,
  ledger,
  groups,
  categories,
  sources,
  documents,
  transactions,
  canWrite,
  groupId,
  hideKpis,
  initialSelectedId,
}: {
  result: ListResult<ExpenseRow>;
  ledger: LedgerSnapshot | null;
  groups: GroupOption[];
  categories: CategoryOption[];
  sources: SourceOption[];
  documents: DocumentOption[];
  transactions: TransactionOption[];
  canWrite: boolean;
  /** the group page: the list is scoped and the dialog pre-selects the group */
  groupId?: string;
  hideKpis?: boolean;
  /** `?open=<id>` — the panel opens on this expense (the graph's "Open") */
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
        const r = await distinctExpensesAction({ column: column as ExpenseColumn, query, groupId });
        if (r.serverError) throw new Error(r.serverError.message ?? "Failed to load values");
        const d = r.data;
        if (d && "error" in d) throw new Error(d.error.message);
        return d?.data ?? [];
      },
      dateHierarchy: async (column, query) => {
        const r = await expenseDateHierarchyAction({
          column: column as ExpenseColumn,
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
  const sourceLabels = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s.label])),
    [sources],
  );

  const columns = useMemo<DataTableColumn<ExpenseRow>[]>(
    () => [
      {
        key: "key",
        header: t("expenses.col.key"),
        type: "text",
        width: "8rem",
        alwaysVisible: true,
        cell: (row) => <span className="font-mono text-xs">{row.key}</span>,
      },
      {
        key: "groupDescription",
        header: t("expenses.col.group"),
        type: "text",
        width: "12rem",
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
        header: `${t("expenses.col.group")} (id)`,
        type: "enum",
        defaultHidden: true,
      },
      {
        key: "groupNumber",
        header: `${t("expenses.col.group")} (no.)`,
        type: "number",
        defaultHidden: true,
      },
      { key: "date", header: t("expenses.col.date"), type: "date", width: "6.5rem" },
      {
        key: "description",
        header: t("expenses.col.description"),
        type: "text",
        width: "16rem",
        cell: (row) => (
          <span className="block truncate" title={row.description}>
            {row.description}
          </span>
        ),
      },
      {
        key: "kind",
        header: t("expenses.col.kind"),
        type: "enum",
        width: "6rem",
        defaultHidden: true,
      },
      {
        key: "basLabel",
        header: t("expenses.col.category"),
        type: "text",
        width: "11rem",
        cell: (row) => (
          <span className="block truncate" title={row.basLabel}>
            {row.basLabel}
          </span>
        ),
      },
      {
        key: "basCode",
        header: `${t("expenses.col.category")} (code)`,
        type: "enum",
        defaultHidden: true,
      },
      {
        key: "alias",
        header: t("expenses.col.alias"),
        type: "enum",
        width: "4rem",
        defaultHidden: true,
      },
      {
        key: "amount",
        header: t("expenses.col.amount"),
        type: "money",
        width: "8rem",
        cell: (row) => <span className="tabular-nums">{money(row.amount, row.currency)}</span>,
      },
      {
        key: "currency",
        header: t("expenses.col.currency"),
        type: "enum",
        width: "4rem",
        defaultHidden: true,
      },
      {
        key: "amountBase",
        header: t("expenses.col.amountBase"),
        type: "money",
        width: "8rem",
        cell: (row) => (
          <span
            className={`tabular-nums ${row.baseProvisional ? "text-muted-foreground italic" : ""}`}
          >
            {formatCurrency(row.amountBase, "SEK")}
            {row.baseProvisional ? " *" : ""}
          </span>
        ),
      },
      {
        key: "baseProvisional",
        header: t("expenses.col.provisional"),
        type: "boolean",
        width: "5rem",
        defaultHidden: true,
      },
      {
        key: "rateSource",
        header: t("expenses.col.rateSource"),
        type: "enum",
        width: "6rem",
        defaultHidden: true,
      },
      {
        key: "paidAmount",
        header: t("expenses.col.paid"),
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
        header: `${t("expenses.col.paid")} (ccy)`,
        type: "enum",
        defaultHidden: true,
      },
      { key: "paymentSourceLabel", header: t("expenses.col.paidBy"), type: "text", width: "7rem" },
      {
        key: "paymentSourceId",
        header: `${t("expenses.col.paidBy")} (id)`,
        type: "enum",
        defaultHidden: true,
      },
      {
        key: "paymentSourceKind",
        header: `${t("expenses.col.paidBy")} (kind)`,
        type: "enum",
        defaultHidden: true,
      },
      {
        key: "status",
        header: t("expenses.col.status"),
        type: "enum",
        width: "9rem",
        cell: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: "allocatedBase",
        header: t("expenses.col.allocated"),
        type: "money",
        width: "7rem",
        defaultHidden: true,
      },
      {
        key: "openBase",
        header: t("expenses.col.open"),
        type: "money",
        width: "7rem",
        cell: (row) =>
          row.paymentSourceKind === "private" ? (
            <span className="tabular-nums">{formatCurrency(row.openBase, "SEK")}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "hasDocument",
        header: t("expenses.col.document"),
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
        header: t("expenses.form.documentMissing"),
        type: "boolean",
        defaultHidden: true,
      },
      {
        key: "note",
        header: t("expenses.col.note"),
        type: "text",
        width: "10rem",
        defaultHidden: true,
      },
      {
        key: "vatAmount",
        header: t("expenses.col.vat"),
        type: "money",
        width: "6rem",
        defaultHidden: true,
      },
      {
        key: "createdAt",
        header: t("expenses.col.created"),
        type: "date",
        width: "7rem",
        defaultHidden: true,
      },
    ],
    [t, groupId],
  );

  return (
    <div className="flex flex-col gap-3">
      {!hideKpis && ledger && (
        <div className="flex flex-wrap gap-2 text-xs" data-testid="expense-kpis">
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-left hover:bg-muted"
            onClick={() =>
              state.setFilter("status", { kind: "in", values: ["to_refund", "partially_refunded"] })
            }
          >
            <span className="font-medium">{t("expenses.kpi.openLiability")}</span>
            <span className="ml-2 tabular-nums" data-testid="kpi-open">
              {formatCurrency(ledger.total.openBase, "SEK")} SEK
            </span>
            <span className="ml-2 text-muted-foreground">
              {t("expenses.kpi.openCount", { count: ledger.total.openCount })}
            </span>
          </button>
          {ledger.sources
            .filter((s) => s.openCount > 0)
            .map((s) => (
              <button
                type="button"
                key={s.paymentSourceId}
                className="rounded-md border px-3 py-1.5 text-left hover:bg-muted"
                onClick={() =>
                  state.setFilter("paymentSourceId", { kind: "in", values: [s.paymentSourceId] })
                }
              >
                <span className="font-medium">{s.label}</span>
                <span className="ml-2 tabular-nums">{formatCurrency(s.openBase, "SEK")} SEK</span>
              </button>
            ))}
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-left hover:bg-muted"
            onClick={() => state.setFilter("status", { kind: "in", values: ["refunded"] })}
          >
            <span className="font-medium">{t("expenses.kpi.refunded")}</span>
            <span className="ml-2 tabular-nums">
              {formatCurrency(ledger.total.allocatedBase, "SEK")} SEK
            </span>
          </button>
          {ledger.awaitingLinkCount > 0 && (
            <button
              type="button"
              className="rounded-md border border-amber-300 px-3 py-1.5 text-left hover:bg-muted"
              onClick={() => state.setFilter("status", { kind: "in", values: ["awaiting_link"] })}
            >
              {t("expenses.kpi.awaitingLink", { count: ledger.awaitingLinkCount })}
            </button>
          )}
        </div>
      )}
      <DataTable
        tableKey={groupId ? "expense-group" : "expenses"}
        columns={columns}
        result={result}
        state={state}
        filterSource={filterSource}
        valueLabel={(column, value) => {
          if (value === null) return "(Blanks)";
          if (column === "status") return t(`expenses.status.${value as ExpenseStatus}`);
          if (column === "kind") return t(`expenses.kind.${value as ExpenseKind}`);
          if (column === "groupId") return groupLabels[value] ?? value;
          if (column === "basCode") return categoryLabels[value] ?? value;
          if (column === "paymentSourceId") return sourceLabels[value] ?? value;
          if (column === "rateSource")
            return value === "bank"
              ? t("expenses.rateSource.bank")
              : t(`journal.rateSource.${value as Exclude<ExpenseRateSource, "bank">}`);
          if (
            column === "baseProvisional" ||
            column === "hasDocument" ||
            column === "documentMissing"
          )
            return value === "true" ? t("common.yes") : t("common.no");
          return value;
        }}
        rowCurrency={(row) => row.currency as Currency}
        sumCurrency={"SEK" as Currency}
        onRowClick={(row) => setSelectedId(row.id)}
        searchPlaceholder={t("expenses.search")}
        toolbar={
          <div className="flex gap-2">
            {canWrite && (
              <Button size="sm" onClick={() => setNewOpen(true)} data-testid="open-new-expense">
                {t("expenses.new")}
              </Button>
            )}
            {!groupId && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href="/expenses/groups" />}
                >
                  {t("expenses.nav.groups")}
                </Button>
                {canWrite && (
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href="/expenses/settle" />}
                  >
                    {t("expenses.nav.settle")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href="/expenses/settlements" />}
                >
                  {t("expenses.nav.settlements")}
                </Button>
              </>
            )}
          </div>
        }
        emptyState={
          Object.keys(state.query.filters).length || state.query.search
            ? t("expenses.emptyFiltered")
            : t("expenses.empty")
        }
      />
      <ExpensePanel
        expenseId={selectedId}
        onClose={() => setSelectedId(null)}
        categories={categories}
        sources={sources}
        transactions={transactions}
        canWrite={canWrite}
        onChanged={() => router.refresh()}
      />
      {canWrite && (
        <NewExpenseDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          groups={groups}
          categories={categories}
          sources={sources}
          documents={documents}
          defaultGroupId={groupId}
        />
      )}
    </div>
  );
}
