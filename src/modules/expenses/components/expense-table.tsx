"use client";

// The expenses list (US5, D40): the ledger's figures as quick filters, DataTable on EXPENSE_COLUMNS with the derived
// state (<StateLabel>), money through formatMoney, the key a <CodeChip>, the payer a <Tag>, Date and Paid by as
// quick filters, the docked side panel for the selected row. *New expense* is the title row's primary
// (`header-actions.tsx`).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
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
import { StateIcon } from "@/kernel/ui/state-label";
import { CodeChip, Tag } from "@/kernel/ui/tags";
import {
  distinctExpensesAction,
  expenseDateHierarchyAction,
} from "@/modules/expenses/expenses.actions";
import type { ExpenseColumn } from "@/modules/expenses/queries";
import type {
  CategoryOption,
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
import { ExpenseStateLabel } from "./expense-state";
import { groupLabel } from "./labels";

/** Dates serialised for the client. */
export type ExpenseRow = Omit<ExpenseListRow, "createdAt"> & { createdAt: string };

const COLUMN_KEYS = [
  "key",
  "groupId",
  "groupNumber",
  "groupDescription",
  "date",
  "description",
  "partnerName",
  "partnerId",
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

/** a base column: its header names the currency, so the figure goes bare */
const base = (amount: string) => formatMoney(amount, "SEK", { bare: true });

export function ExpenseTable({
  result,
  ledger,
  groups,
  categories,
  sources,
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
  transactions: TransactionOption[];
  canWrite: boolean;
  /** the group page: the list is scoped to the group */
  groupId?: string;
  hideKpis?: boolean;
  /** `?open=<id>` — the panel opens on this expense (the graph's "Open") */
  initialSelectedId?: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);

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
        width: "6.5rem",
        alwaysVisible: true,
        cell: (row) => <CodeChip>{row.key}</CodeChip>,
      },
      {
        key: "groupDescription",
        header: t("expenses.col.group"),
        type: "text",
        width: "9rem",
        defaultHidden: !!groupId,
        cell: (row) => (
          <Link
            href={`/expenses/groups/${row.groupId}`}
            className="block truncate text-primary hover:text-primary-hover hover:underline"
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
      {
        key: "date",
        header: t("expenses.col.date"),
        type: "date",
        width: "6.5rem",
        quickFilter: true,
      },
      {
        key: "description",
        header: t("expenses.col.description"),
        type: "text",
        width: "10.5rem",
        cell: (row) => (
          <span className="block truncate" title={row.description}>
            {row.description}
          </span>
        ),
      },
      {
        key: "partnerName",
        header: t("expenses.partner"),
        type: "enum",
        width: "8rem",
        cell: (row) =>
          row.partnerName ? (
            <Link
              href={`/partners/${row.partnerId}`}
              className="block truncate text-primary hover:text-primary-hover hover:underline"
              onClick={(e) => e.stopPropagation()}
              title={row.partnerName}
            >
              {row.partnerName}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "partnerId",
        header: `${t("expenses.partner")} (id)`,
        type: "enum",
        defaultHidden: true,
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
        width: "8.5rem",
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
        cell: (row) => (
          <span className="tabular-nums" data-amount={row.amount}>
            {formatMoney(row.amount, row.currency)}
          </span>
        ),
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
        width: "7rem",
        // the base sits in the panel and in the footer's Σ; shown, the row is wider than the canvas (D40: no page scroll)
        defaultHidden: true,
        cell: (row) => (
          <span
            className={`tabular-nums ${row.baseProvisional ? "text-muted-foreground italic" : ""}`}
          >
            {base(row.amountBase)}
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
            <span className="tabular-nums">
              {formatMoney(row.paidAmount, row.paidCurrency ?? "SEK")}
            </span>
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
      {
        key: "paymentSourceLabel",
        header: t("expenses.col.paidBy"),
        type: "enum",
        width: "6rem",
        quickFilter: true,
        cell: (row) => <Tag>{row.paymentSourceLabel}</Tag>,
      },
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
        cell: (row) => <ExpenseStateLabel status={row.status} />,
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
            <span className="tabular-nums">{base(row.openBase)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "hasDocument",
        header: t("expenses.col.document"),
        type: "boolean",
        width: "4.5rem",
        cell: (row) =>
          row.hasDocument ? (
            <span>{t("expenses.document.present")}</span>
          ) : row.documentMissing ? (
            <Tag>{t("expenses.document.missing")}</Tag>
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
        <div className="flex flex-wrap gap-2" data-testid="expense-kpis">
          <Kpi
            label={t("expenses.kpi.openLiability")}
            onClick={() =>
              state.setFilter("status", { kind: "in", values: ["to_refund", "partially_refunded"] })
            }
          >
            <span data-testid="kpi-open">{formatMoney(ledger.total.openBase, "SEK")}</span>
            <span className="text-muted-foreground">
              {t("expenses.kpi.openCount", { count: ledger.total.openCount })}
            </span>
          </Kpi>
          {ledger.sources
            .filter((s) => s.openCount > 0)
            .map((s) => (
              <Kpi
                key={s.paymentSourceId}
                label={s.label}
                onClick={() =>
                  state.setFilter("paymentSourceLabel", { kind: "in", values: [s.label] })
                }
              >
                {formatMoney(s.openBase, "SEK")}
              </Kpi>
            ))}
          <Kpi
            label={t("expenses.kpi.refunded")}
            onClick={() => state.setFilter("status", { kind: "in", values: ["refunded"] })}
          >
            {formatMoney(ledger.total.allocatedBase, "SEK")}
          </Kpi>
          {ledger.awaitingLinkCount > 0 && (
            <Kpi
              icon={<StateIcon family="attention" />}
              onClick={() => state.setFilter("status", { kind: "in", values: ["awaiting_link"] })}
            >
              {t("expenses.kpi.awaitingLink", { count: ledger.awaitingLinkCount })}
            </Kpi>
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
          if (value === null) return t("common.blanks");
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
    </div>
  );
}

/** One figure of the ledger, a button that filters the list to the rows behind it. */
function Kpi({
  label,
  icon,
  onClick,
  children,
}: {
  label?: string;
  icon?: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-2 rounded-md border bg-surface px-3 text-[13px] hover:bg-hover"
    >
      {icon}
      {label && <span className="font-semibold">{label}</span>}
      <span className="inline-flex items-center gap-2 tabular-nums">{children}</span>
    </button>
  );
}
