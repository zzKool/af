"use client";

// The transactions workbench (D20): DataTable on TRANSACTION_COLUMNS with the derived state chips, the money in
// the row's currency, footer sums, the side panel for the selected row, the import dialog in the toolbar.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
  distinctTransactionsAction,
  transactionDateHierarchyAction,
} from "@/modules/banking/banking.actions";
import type { TransactionColumn } from "@/modules/banking/queries";
import type {
  AccountBalance,
  BankMonthsOverview,
  TransactionListRow,
  TransactionState,
} from "@/modules/banking/types";
import type { CategoryOption, PartnerOption } from "@/modules/journal/ui";
import { type AccountOption, ImportDialog } from "./import-dialog";
import { MonthsPanel } from "./months-panel";
import { STATE_STYLE, TransactionPanel } from "./transaction-panel";

/** Dates serialised for the client. */
export type TransactionRow = Omit<TransactionListRow, "createdAt"> & { createdAt: string };

const COLUMN_KEYS = [
  "bookingDate",
  "bankAccountId",
  "accountLabel",
  "description",
  "counterpartyKey",
  "amount",
  "currency",
  "balance",
  "reference",
  "ownNotes",
  "amountBase",
  "rate",
  "rateSource",
  "basCode",
  "basLabel",
  "partnerId",
  "partnerName",
  "note",
  "noDocumentNeeded",
  "categorisedBy",
  "state",
  "allocated",
  "bankImportId",
  "createdAt",
] as const;
const DEFAULT_SORT = [
  { col: "bookingDate", dir: "desc" as const },
  { col: "createdAt", dir: "desc" as const },
];

export function TransactionTable({
  result,
  balances,
  accounts,
  categories,
  partners,
  importLabels,
  canWrite,
  initialSelectedId,
  months,
}: {
  result: ListResult<TransactionRow>;
  balances: (Omit<AccountBalance, "lastImportAt"> & { lastImportAt: string | null })[];
  accounts: AccountOption[];
  categories: CategoryOption[];
  partners: PartnerOption[];
  /** import id → file name, for the Import filter's values */
  importLabels: Record<string, string>;
  canWrite: boolean;
  /** `?open=<id>` — the panel opens on this row (the graph's "Open") */
  initialSelectedId?: string | null;
  /** the Months panel (F69) — omitted, no panel */
  months?: BankMonthsOverview;
}) {
  const t = useT();
  const router = useRouter();
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [importOpen, setImportOpen] = useState(false);

  const filterSource = useMemo<DataTableFilterSource>(
    () => ({
      distinct: async (column, query) => {
        const r = await distinctTransactionsAction({ column: column as TransactionColumn, query });
        if (r.serverError) throw new Error(r.serverError.message ?? "Failed to load values");
        const d = r.data;
        if (d && "error" in d) throw new Error(d.error.message);
        return d?.data ?? [];
      },
      dateHierarchy: async (column, query) => {
        const r = await transactionDateHierarchyAction({
          column: column as TransactionColumn,
          query,
        });
        if (r.serverError) throw new Error(r.serverError.message ?? "Failed to load dates");
        const d = r.data;
        if (d && "error" in d) throw new Error(d.error.message);
        return d?.data ?? { years: [], empty: 0 };
      },
    }),
    [],
  );

  // the Month filter as the panel sees it: exactly one month, nothing else on the date column
  const dateFilter = state.query.filters.bookingDate;
  const selectedMonth =
    dateFilter?.kind === "dates" &&
    dateFilter.months?.length === 1 &&
    !dateFilter.years?.length &&
    !dateFilter.days?.length &&
    !dateFilter.from &&
    !dateFilter.to &&
    !dateFilter.empty
      ? dateFilter.months[0]
      : null;

  const accountLabels = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.label])),
    [accounts],
  );
  const categoryLabels = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.code, c.label])),
    [categories],
  );
  const partnerLabels = useMemo(
    () => Object.fromEntries(partners.map((p) => [p.id, p.name])),
    [partners],
  );

  const columns = useMemo<DataTableColumn<TransactionRow>[]>(
    () => [
      {
        key: "bookingDate",
        header: t("banking.col.bookingDate"),
        type: "date",
        width: "6.5rem",
        alwaysVisible: true,
      },
      { key: "accountLabel", header: t("banking.col.account"), type: "text", width: "9rem" },
      {
        key: "bankAccountId",
        header: `${t("banking.col.account")} (id)`,
        type: "enum",
        defaultHidden: true,
      },
      {
        key: "description",
        header: t("banking.col.description"),
        type: "text",
        width: "18rem",
        cell: (row) => (
          <span className="block truncate" title={row.description}>
            {row.description}
          </span>
        ),
      },
      {
        key: "counterpartyKey",
        header: t("banking.col.counterparty"),
        type: "text",
        width: "12rem",
        defaultHidden: true,
      },
      {
        key: "amount",
        header: t("banking.col.amount"),
        type: "money",
        width: "8rem",
        cell: (row) => (
          <span
            className={`tabular-nums ${row.amount.startsWith("-") ? "" : "text-green-700 dark:text-green-400"}`}
          >
            {formatCurrency(row.amount, row.currency as Currency)} {row.currency}
          </span>
        ),
      },
      {
        key: "currency",
        header: t("banking.col.currency"),
        type: "enum",
        width: "4rem",
        defaultHidden: true,
      },
      {
        key: "balance",
        header: t("banking.col.balance"),
        type: "money",
        width: "8rem",
        defaultHidden: true,
      },
      {
        key: "basLabel",
        header: t("banking.col.category"),
        type: "text",
        width: "11rem",
        cell: (row) =>
          row.basLabel ? (
            <span className="block truncate" title={row.basLabel}>
              {row.basLabel}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "basCode",
        header: `${t("banking.col.category")} (code)`,
        type: "enum",
        defaultHidden: true,
      },
      { key: "partnerName", header: t("banking.col.partner"), type: "text", width: "10rem" },
      {
        key: "partnerId",
        header: `${t("banking.col.partner")} (id)`,
        type: "enum",
        defaultHidden: true,
      },
      {
        key: "state",
        header: t("banking.col.state"),
        type: "enum",
        width: "9rem",
        cell: (row) => (
          <Badge variant="outline" className={STATE_STYLE[row.state]}>
            {t(`banking.state.${row.state}`)}
          </Badge>
        ),
      },
      { key: "note", header: t("banking.col.note"), type: "text", width: "10rem" },
      {
        key: "noDocumentNeeded",
        header: t("banking.col.noDocument"),
        type: "boolean",
        width: "6rem",
        defaultHidden: true,
      },
      {
        key: "categorisedBy",
        header: t("banking.col.categorisedBy"),
        type: "enum",
        width: "7rem",
        defaultHidden: true,
      },
      {
        key: "reference",
        header: t("banking.col.reference"),
        type: "text",
        width: "10rem",
        defaultHidden: true,
      },
      {
        key: "ownNotes",
        header: t("banking.col.ownNotes"),
        type: "text",
        width: "8rem",
        defaultHidden: true,
      },
      {
        key: "amountBase",
        header: t("banking.col.amountBase"),
        type: "money",
        width: "8rem",
        defaultHidden: true,
      },
      {
        key: "rate",
        header: t("banking.col.rate"),
        type: "number",
        width: "6rem",
        defaultHidden: true,
      },
      {
        key: "rateSource",
        header: t("banking.col.rateSource"),
        type: "enum",
        width: "6rem",
        defaultHidden: true,
      },
      {
        key: "allocated",
        header: t("banking.col.allocated"),
        type: "money",
        width: "7rem",
        defaultHidden: true,
      },
      {
        key: "bankImportId",
        header: t("banking.col.import"),
        type: "enum",
        width: "10rem",
        defaultHidden: true,
      },
      { key: "createdAt", header: "Imported", type: "date", width: "7rem", defaultHidden: true },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-xs" data-testid="account-balances">
        {balances.map((b) => (
          <button
            type="button"
            key={b.bankAccountId}
            className="rounded-md border px-3 py-1.5 text-left hover:bg-muted"
            onClick={() =>
              state.setFilter("bankAccountId", { kind: "in", values: [b.bankAccountId] })
            }
          >
            <span className="font-medium">{b.label}</span>
            <span className="ml-2 tabular-nums">
              {b.balance
                ? `${formatCurrency(b.balance, b.currency as Currency)} ${b.currency}`
                : "—"}
            </span>
            <span className="ml-2 text-muted-foreground">
              {b.balanceDate
                ? t("banking.balances.asOf", { date: b.balanceDate })
                : t("banking.balances.never")}
            </span>
          </button>
        ))}
      </div>
      {months && (
        <MonthsPanel
          overview={months}
          selectedMonth={selectedMonth}
          onSelectMonth={(month) =>
            state.setFilter("bookingDate", month ? { kind: "dates", months: [month] } : null)
          }
        />
      )}
      <DataTable
        tableKey="bank-transactions"
        columns={columns}
        result={result}
        state={state}
        filterSource={filterSource}
        valueLabel={(column, value) => {
          if (value === null) return "(Blanks)";
          if (column === "state") return t(`banking.state.${value as TransactionState}`);
          if (column === "bankAccountId") return accountLabels[value] ?? value;
          if (column === "basCode") return categoryLabels[value] ?? value;
          if (column === "partnerId") return partnerLabels[value] ?? value;
          if (column === "bankImportId") return importLabels[value] ?? value;
          if (column === "categorisedBy")
            return t(`journal.categorisedBy.${value as "manual" | "rule" | "partner_default"}`);
          if (column === "rateSource")
            return t(
              `journal.rateSource.${value as "same_currency" | "ecb_daily" | "ecb_nearest" | "manual"}`,
            );
          if (column === "noDocumentNeeded")
            return value === "true" ? t("common.yes") : t("common.no");
          return value;
        }}
        rowCurrency={(row) => row.currency as Currency}
        sumCurrency={result.rows[0]?.currency as Currency | undefined}
        onRowClick={(row) => setSelectedId(row.id)}
        searchPlaceholder={t("banking.search")}
        toolbar={
          <div className="flex gap-2">
            {canWrite && (
              <Button size="sm" onClick={() => setImportOpen(true)} data-testid="open-import">
                {t("banking.import.button")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/banking/inbox" />}
              data-testid="go-inbox"
            >
              {t("banking.nav.inbox")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/banking/imports" />}
            >
              {t("banking.nav.imports")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/banking/rules" />}
            >
              {t("banking.nav.rules")}
            </Button>
          </div>
        }
        emptyState={
          Object.keys(state.query.filters).length || state.query.search
            ? t("banking.emptyFiltered")
            : t("banking.empty")
        }
      />
      <TransactionPanel
        transactionId={selectedId}
        onClose={() => setSelectedId(null)}
        categories={categories}
        partners={partners}
        canWrite={canWrite}
        onChanged={() => router.refresh()}
      />
      {canWrite && (
        <ImportDialog open={importOpen} onOpenChange={setImportOpen} accounts={accounts} />
      )}
    </div>
  );
}
