"use client";

// The transactions workbench (D20, D40, D76 Pulse): on the ground — the account cards (balance, completeness, the
// month's bar), the Months panel, then the list in its card: the segments *All · Needs you · Done · No proof
// needed* with their counts, the DataTable on TRANSACTION_COLUMNS — each row with a bar in its state's colour,
// the three dots (proof · partner · category) and the derived state as a <StateLabel>, the money in the row's
// currency (`formatMoney`, signed), Month and Account as quick filters, a ⋮ per row — and the docked work surface
// for the selected row (F131 §6.2), highlighted in the list. The title row's actions are `header-actions.tsx`.
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useT } from "@/kernel/i18n/use-t";
import type { InFilter, ListResult } from "@/kernel/list-query/types";
import { formatMoney } from "@/kernel/money/format-money";
import type { Currency } from "@/kernel/nav/constants";
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilterSource,
  useListQuery,
} from "@/kernel/ui/data-table";
import { Tag } from "@/kernel/ui/tags";
import { cn } from "@/lib/utils";
import {
  distinctTransactionsAction,
  transactionDateHierarchyAction,
} from "@/modules/banking/banking.actions";
import type { TransactionColumn } from "@/modules/banking/queries";
import { transactionStateFamily } from "@/modules/banking/state-family";
import { rowSteps } from "@/modules/banking/steps";
import type {
  BankMonthsOverview,
  TransactionListRow,
  TransactionState,
} from "@/modules/banking/types";
import { type JustifyOptions, ProposedCode } from "@/modules/linking/ui";
import { type AccountCardBalance, AccountCards } from "./account-cards";
import type { CategoryOption, PartnerOption } from "./categorise-form";
import { DayStrip } from "./day-strip";
import type { AccountOption } from "./import-dialog";
import { StepDots, StepDotsLegend } from "./step-dots";
import { TransactionPanel } from "./transaction-panel";
import { TransactionStateLabel } from "./transaction-state";

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
  "basFrom",
  "partnerId",
  "partnerName",
  "partnerFrom",
  "mixed",
  "proposedBasCode",
  "proposedSource",
  "proposedConfidence",
  "note",
  "noDocumentNeeded",
  "categorisedBy",
  "state",
  "allocated",
  "bankImportId",
  "createdAt",
] as const;
/** the list's segments (D76): which derived states each one shows — *Needs you* = the four still to justify */
export const SEGMENTS = {
  all: [],
  need: ["open", "partial", "linked_no_partner", "no_document_no_partner"],
  done: ["linked"],
  noProof: ["no_document"],
} as const satisfies Record<string, readonly TransactionState[]>;
type Segment = keyof typeof SEGMENTS;

const DEFAULT_SORT = [
  { col: "bookingDate", dir: "desc" as const },
  { col: "createdAt", dir: "desc" as const },
];

/** The owner's column order (2026-11-08); a column not named here keeps its place after them. */
const COLUMN_ORDER = [
  "bookingDate",
  "partnerName",
  "counterpartyKey",
  "accountLabel",
  "bankAccountId",
  "description",
  "currency",
  "balance",
  "basLabel",
  "basCode",
  "basFrom",
  "partnerId",
  "partnerFrom",
  "mixed",
  "proposedBasCode",
  "proposedSource",
  "proposedConfidence",
  "note",
  "noDocumentNeeded",
  "categorisedBy",
  "reference",
  "ownNotes",
  "amount",
  "steps",
  "state",
  "amountBase",
  "rate",
  "rateSource",
  "allocated",
  "bankImportId",
  "createdAt",
];

function inOrder<C extends { key: string }>(columns: C[]): C[] {
  const rank = (k: string) => {
    const i = COLUMN_ORDER.indexOf(k);
    return i < 0 ? COLUMN_ORDER.length : i;
  };
  return [...columns].sort((a, b) => rank(a.key) - rank(b.key));
}

export function TransactionTable({
  result,
  balances,
  accounts,
  categories,
  partners,
  justifyOptions = null,
  importLabels,
  canWrite,
  initialSelectedId,
  months,
  stateCounts = {},
}: {
  result: ListResult<TransactionRow>;
  balances: AccountCardBalance[];
  accounts: AccountOption[];
  categories: CategoryOption[];
  partners: PartnerOption[];
  /** the Justify panel's option lists (F97); null hides it */
  justifyOptions?: JustifyOptions | null;
  /** import id → file name, for the Import filter's values */
  importLabels: Record<string, string>;
  canWrite: boolean;
  /** `?open=<id>` — the panel opens on this row (the graph's "Open") */
  initialSelectedId?: string | null;
  /** the Months panel (F69) — omitted, no panel */
  months?: BankMonthsOverview;
  /** rows per derived state under every filter but the state's own — the segments' counts */
  stateCounts?: Partial<Record<TransactionState, number>>;
}) {
  const t = useT();
  const router = useRouter();
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);

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
  // D76: the day strip's day — the date filter on exactly one day
  const selectedDay =
    dateFilter?.kind === "dates" && dateFilter.days?.length === 1 && !dateFilter.months?.length
      ? dateFilter.days[0]
      : null;

  const accountLabels = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.label])),
    [accounts],
  );
  const accountFilter = state.query.filters.accountLabel;
  const activeAccounts = accountFilter?.kind === "in" ? accountFilter.values : [];
  const categoryLabels = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.code, c.label])),
    [categories],
  );
  const partnerLabels = useMemo(
    () => Object.fromEntries(partners.map((p) => [p.id, p.name])),
    [partners],
  );

  // The list's default columns are the owner's own layout (2026-11-08, his screenshot of the chooser): **Date ·
  // Partner · Counterparty · Category · Reference · Own notes · Amount · Checks · State · Imported**, in that
  // order (`COLUMN_ORDER`). The rest stays one click away in the column chooser; a saved layout wins as always.
  const columns = useMemo<DataTableColumn<TransactionRow>[]>(
    () =>
      inOrder([
        {
          key: "bookingDate",
          header: t("banking.col.bookingDate"),
          type: "date",
          width: "6rem",
          alwaysVisible: true,
          quickFilter: true,
          cell: (row) => (
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {row.bookingDate}
            </span>
          ),
        },
        {
          key: "counterpartyKey",
          header: t("banking.col.counterparty"),
          type: "text",
          width: "11rem",
          // D76: who in bold (the partner when there is one, else the bank's key), the bank's text under it
          cell: (row) => (
            <span className="flex min-w-0 flex-col" title={row.description}>
              <span className="truncate font-semibold">
                {row.partnerName ?? row.counterpartyKey}
              </span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {row.description}
              </span>
            </span>
          ),
        },
        {
          key: "steps",
          header: t("banking.col.steps"),
          type: "text",
          width: "5rem",
          sortable: false,
          filterable: false,
          // D76: proof · partner · category as three dots (derived, display only — no server column)
          cell: (row) => (
            <StepDots
              steps={rowSteps({
                state: row.state,
                partnerId: row.partnerId,
                basCode: row.basCode,
                proposedBasCode: row.proposedBasCode,
              })}
            />
          ),
        },
        {
          key: "state",
          header: t("banking.col.state"),
          type: "enum",
          width: "8.5rem",
          cell: (row) => <TransactionStateLabel state={row.state} variant="chip" />,
        },
        {
          key: "amount",
          header: t("banking.col.amount"),
          type: "money",
          width: "8rem",
          // D76: the amount in mono, bold (the base amount is the work surface's)
          cell: (row) => (
            <span
              className={cn(
                "font-mono font-semibold tabular-nums",
                !row.amount.startsWith("-") && "text-state-done",
              )}
            >
              {formatMoney(row.amount, row.currency, { signed: true })}
            </span>
          ),
        },
        {
          key: "accountLabel",
          header: t("banking.col.account"),
          type: "enum",
          width: "9rem",
          quickFilter: true,
          defaultHidden: true,
        },
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
          defaultHidden: true,
          cell: (row) => (
            <span className="block truncate" title={row.description}>
              {row.description}
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
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate" title={row.basLabel}>
                  {row.basLabel}
                </span>
                {/* F129: the proofs disagree — the larger allocation's account shows, the tag says so */}
                {row.mixed && <Tag>{t("banking.facts.mixed")}</Tag>}
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
        {
          key: "basFrom",
          header: t("banking.col.basFrom"),
          type: "enum",
          width: "7rem",
          defaultHidden: true,
        },
        {
          key: "partnerName",
          header: t("banking.col.partner"),
          type: "text",
          width: "10rem",
        },
        {
          key: "partnerId",
          header: `${t("banking.col.partner")} (id)`,
          type: "enum",
          defaultHidden: true,
        },
        {
          key: "partnerFrom",
          header: t("banking.col.partnerFrom"),
          type: "enum",
          width: "7rem",
          defaultHidden: true,
        },
        {
          key: "mixed",
          header: t("banking.col.mixed"),
          type: "boolean",
          width: "6rem",
          defaultHidden: true,
        },
        // F98 (the owner's answer 3): the current category proposal — code + its family, filterable, sortable
        {
          key: "proposedBasCode",
          header: t("banking.col.proposed"),
          type: "enum",
          width: "7.5rem",
          defaultHidden: true,
          cell: (row) =>
            row.proposedBasCode && row.proposedConfidence !== null ? (
              <ProposedCode
                code={row.proposedBasCode}
                confidence={row.proposedConfidence}
                source={row.proposedSource}
              />
            ) : null,
        },
        {
          key: "proposedSource",
          header: `${t("banking.col.proposed")} (${t("banking.col.proposedSource")})`,
          type: "enum",
          defaultHidden: true,
        },
        {
          key: "proposedConfidence",
          header: `${t("banking.col.proposed")} (${t("banking.col.proposedConfidence")})`,
          type: "number",
          defaultHidden: true,
        },
        // F131: the work surface takes ≈ 55 % of the canvas — the note lives in the panel's facts zone; the column
        // stays a click away in the chooser (lessons F71: a module with more columns than the canvas uses the chooser)
        {
          key: "note",
          header: t("banking.col.note"),
          type: "text",
          width: "10rem",
          defaultHidden: true,
        },
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
        },
        {
          key: "ownNotes",
          header: t("banking.col.ownNotes"),
          type: "text",
          width: "8rem",
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
        {
          key: "createdAt",
          header: t("banking.imports.col.date"),
          type: "date",
          width: "7rem",
        },
      ]),
    [t],
  );

  // the segments (D76): the state filter as four buttons, each with its count under the other filters
  const stateFilter = state.query.filters.state;
  const stateValues = stateFilter?.kind === "in" ? stateFilter.values : [];
  const sameSet = (a: readonly string[], b: readonly (string | null)[]) =>
    a.length === b.length && a.every((v) => b.includes(v));
  const activeSegment = (Object.keys(SEGMENTS) as Segment[]).find((k) =>
    sameSet(SEGMENTS[k], stateValues),
  );
  const countOf = (k: Segment) =>
    k === "all"
      ? Object.values(stateCounts).reduce((n, c) => n + (c ?? 0), 0)
      : SEGMENTS[k].reduce((n, st) => n + (stateCounts[st] ?? 0), 0);
  const segments = (
    <>
      <fieldset
        className="m-0 inline-flex min-w-0 gap-0.5 rounded-[10px] border border-subtle bg-surface-2 p-[3px]"
        data-testid="state-segments"
      >
        <legend className="sr-only">{t("banking.segments.label")}</legend>
        {(Object.keys(SEGMENTS) as Segment[]).map((k) => {
          const on = activeSegment === k;
          return (
            <button
              type="button"
              key={k}
              aria-pressed={on}
              onClick={() =>
                state.setFilter(
                  "state",
                  k === "all"
                    ? null
                    : ({ kind: "in", values: [...SEGMENTS[k]] } satisfies InFilter),
                )
              }
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-[7px] px-3 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on
                  ? "bg-action font-semibold text-action-fg"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground",
              )}
            >
              {t(`banking.segments.${k}`)}
              <span className="text-[11px] tabular-nums opacity-80" data-public>
                {countOf(k)}
              </span>
            </button>
          );
        })}
      </fieldset>
    </>
  );

  // the bars count the Month filter's month, else the newest month with rows
  const cardsMonth =
    selectedMonth ??
    selectedDay?.slice(0, 7) ??
    [...(months?.months ?? [])].reverse().find((m) => m.justified + m.toJustify > 0)?.month ??
    null;

  // the open row's place in the page, for the work surface's ↑ ↓
  const index = selectedId ? result.rows.findIndex((r) => r.id === selectedId) : -1;
  const nav =
    index >= 0
      ? {
          index,
          total: result.rows.length,
          prev: index > 0 ? () => setSelectedId(result.rows[index - 1]?.id ?? null) : undefined,
          next:
            index < result.rows.length - 1
              ? () => setSelectedId(result.rows[index + 1]?.id ?? null)
              : undefined,
        }
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <AccountCards
        compact={!!selectedId}
        balances={balances}
        months={months}
        month={cardsMonth}
        activeLabels={activeAccounts.filter((v): v is string => v !== null)}
        onToggle={(label) => {
          const active = activeAccounts.length === 1 && activeAccounts[0] === label;
          state.setFilter("accountLabel", active ? null : { kind: "in", values: [label] });
        }}
      />
      {/* a row open: the strip folds away, the list stays near the top (the cards go to one line) */}
      {months && !selectedId && (
        <DayStrip
          overview={months}
          month={cardsMonth ?? months.to}
          selectedMonth={selectedMonth}
          selectedDay={selectedDay}
          onSelectMonth={(month) =>
            state.setFilter("bookingDate", month ? { kind: "dates", months: [month] } : null)
          }
          onSelectDay={(day) =>
            state.setFilter(
              "bookingDate",
              day
                ? { kind: "dates", days: [day] }
                : { kind: "dates", months: [cardsMonth ?? months.to] },
            )
          }
        />
      )}
      <section
        className="flex flex-col gap-3 pulse-card px-4 pt-3.5 pb-2"
        aria-label={t("banking.list")}
      >
        <DataTable
          lead={segments}
          toolbar={<StepDotsLegend />}
          tableKey="bank-transactions"
          columns={columns}
          result={result}
          state={state}
          filterSource={filterSource}
          valueLabel={(column, value) => {
            if (value === null) return t("common.blanks");
            if (column === "state") return t(`banking.state.${value as TransactionState}`);
            if (column === "bankAccountId") return accountLabels[value] ?? value;
            if (column === "basCode") return categoryLabels[value] ?? value;
            if (column === "partnerId") return partnerLabels[value] ?? value;
            if (column === "bankImportId") return importLabels[value] ?? value;
            if (column === "categorisedBy")
              return t(`banking.categorisedBy.${value as "manual" | "rule" | "partner_default"}`);
            if (column === "rateSource")
              return t(
                `banking.rateSource.${value as "same_currency" | "ecb_daily" | "ecb_nearest" | "manual"}`,
              );
            if (column === "noDocumentNeeded" || column === "mixed")
              return value === "true" ? t("common.yes") : t("common.no");
            if (column === "basFrom" || column === "partnerFrom")
              return t(`banking.facts.from.${value as "row" | "proof"}`);
            return value;
          }}
          rowCurrency={(row) => row.currency as Currency}
          sumCurrency={result.rows[0]?.currency as Currency | undefined}
          onRowClick={(row) => setSelectedId(row.id)}
          searchPlaceholder={t("banking.search")}
          rowAccent={(row) => transactionStateFamily(row.state)}
          activeRowId={selectedId}
          rowActions={(row) => [
            { label: t("banking.rowActions.open"), onClick: () => setSelectedId(row.id) },
            {
              label: t("banking.rowActions.sameCounterparty"),
              onClick: () => state.setSearch(row.counterpartyKey),
            },
          ]}
          emptyState={
            Object.keys(state.query.filters).length || state.query.search
              ? t("banking.emptyFiltered")
              : t("banking.empty")
          }
        />
      </section>
      <TransactionPanel
        transactionId={selectedId}
        nav={nav}
        onClose={() => setSelectedId(null)}
        categories={categories}
        partners={partners}
        justifyOptions={justifyOptions}
        canWrite={canWrite}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}
