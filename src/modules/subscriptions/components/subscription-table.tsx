"use client";

// The subscriptions list (F94 FR-013, D40 kit): the DataTable on SUBSCRIPTION_COLUMNS — name, vendor, what it
// becomes, cadence, the next expected date and amount, the current period's state, the periods that need the owner —
// *Active / Ended* and state as quick filters, ⋮ row actions, and the docked panel with the period timeline. The
// title row holds *New subscription* and *Confirm all exact*.
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useT } from "@/kernel/i18n/use-t";
import type { ListResult } from "@/kernel/list-query/types";
import { formatMoney } from "@/kernel/money/format-money";
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilterSource,
  type RowAction,
  useListQuery,
} from "@/kernel/ui/data-table";
import { CountBadge, Tag } from "@/kernel/ui/tags";
import type { SubscriptionColumn } from "../queries";
import {
  distinctSubscriptionsAction,
  subscriptionDateHierarchyAction,
} from "../subscriptions.actions";
import type { Becomes, Cadence, PeriodState, SubscriptionListRow } from "../types";
import { PeriodStateLabel } from "./period-state";
import { SubscriptionPanel } from "./subscription-panel";

const COLUMN_KEYS = [
  "name",
  "partnerName",
  "becomes",
  "cadence",
  "basCode",
  "groupLabel",
  "paymentSourceLabel",
  "startDate",
  "endDate",
  "active",
  "nextDate",
  "expectedAmount",
  "expectedCurrency",
  "currentState",
  "attention",
] as const;
const DEFAULT_SORT = [
  { col: "active", dir: "desc" as const },
  { col: "nextDate", dir: "asc" as const },
  { col: "name", dir: "asc" as const },
];

export function SubscriptionTable({
  result,
  canWrite,
  initialSelectedId,
}: {
  result: ListResult<SubscriptionListRow>;
  canWrite: boolean;
  initialSelectedId?: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);

  const filterSource = useMemo<DataTableFilterSource>(
    () => ({
      distinct: async (column, query) => {
        const r = await distinctSubscriptionsAction({
          column: column as SubscriptionColumn,
          query,
        });
        if (r.serverError) throw new Error(r.serverError.message ?? "Failed to load values");
        const d = r.data;
        if (d && "error" in d) throw new Error(d.error.message);
        return d?.data ?? [];
      },
      dateHierarchy: async (column, query) => {
        const r = await subscriptionDateHierarchyAction({
          column: column as "startDate" | "endDate" | "nextDate",
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

  const columns = useMemo<DataTableColumn<SubscriptionListRow>[]>(
    () => [
      {
        key: "name",
        header: t("subscriptions.col.name"),
        type: "text",
        width: "12rem",
        alwaysVisible: true,
        cell: (row) => <span className="block truncate font-medium">{row.name}</span>,
      },
      {
        key: "partnerName",
        header: t("subscriptions.col.vendor"),
        type: "enum",
        width: "11rem",
        cell: (row) => <span className="block truncate">{row.partnerName ?? "—"}</span>,
      },
      {
        key: "becomes",
        header: t("subscriptions.col.becomes"),
        type: "enum",
        width: "8rem",
        cell: (row) => <Tag>{t(`subscriptions.becomes.${row.becomes}`)}</Tag>,
      },
      {
        key: "cadence",
        header: t("subscriptions.col.cadence"),
        type: "enum",
        width: "6rem",
        cell: (row) => t(`subscriptions.cadence.${row.cadence}`),
      },
      {
        key: "nextDate",
        header: t("subscriptions.col.next"),
        type: "date",
        width: "7rem",
        cell: (row) => <span className="tabular-nums">{row.nextDate ?? "—"}</span>,
      },
      {
        key: "expectedAmount",
        header: t("subscriptions.col.expected"),
        type: "money",
        width: "8rem",
        cell: (row) =>
          row.expectedAmount && row.expectedCurrency ? (
            <span className="tabular-nums" data-amount>
              {formatMoney(row.expectedAmount, row.expectedCurrency)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "currentState",
        header: t("subscriptions.col.state"),
        type: "enum",
        width: "9rem",
        cell: (row) => (row.currentState ? <PeriodStateLabel state={row.currentState} /> : "—"),
      },
      {
        key: "attention",
        header: t("subscriptions.col.attention"),
        type: "number",
        width: "6rem",
        cell: (row) => (row.attention > 0 ? <CountBadge count={row.attention} /> : null),
      },
      {
        key: "basCode",
        header: t("subscriptions.col.category"),
        type: "enum",
        width: "6rem",
        defaultHidden: true,
      },
      {
        key: "groupLabel",
        header: t("subscriptions.col.group"),
        type: "text",
        width: "11rem",
        defaultHidden: true,
      },
      {
        key: "paymentSourceLabel",
        header: t("subscriptions.col.payer"),
        type: "enum",
        width: "8rem",
      },
      {
        key: "startDate",
        header: t("subscriptions.col.start"),
        type: "date",
        width: "7rem",
        defaultHidden: true,
      },
      {
        key: "endDate",
        header: t("subscriptions.col.end"),
        type: "date",
        width: "7rem",
        defaultHidden: true,
      },
      {
        key: "active",
        header: t("subscriptions.col.active"),
        type: "boolean",
        width: "6rem",
        quickFilter: true,
        defaultHidden: true,
      },
      {
        key: "expectedCurrency",
        header: t("subscriptions.col.currency"),
        type: "enum",
        defaultHidden: true,
      },
    ],
    [t],
  );

  const rowActions = (row: SubscriptionListRow): RowAction[] => [
    { label: t("common.open"), onClick: () => setSelectedId(row.id) },
    {
      label: t("subscriptions.action.openGroup"),
      onClick: () => router.push(`/expenses/groups/${row.groupId}`),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        tableKey="subscriptions"
        columns={columns}
        result={result}
        state={state}
        filterSource={filterSource}
        valueLabel={(column, value) => {
          if (value === null) return t("common.blanks");
          if (column === "becomes") return t(`subscriptions.becomes.${value as Becomes}`);
          if (column === "cadence") return t(`subscriptions.cadence.${value as Cadence}`);
          if (column === "currentState") return t(`subscriptions.state.${value as PeriodState}`);
          if (column === "active")
            return value === "true" ? t("subscriptions.active") : t("subscriptions.ended");
          return value;
        }}
        onRowClick={(row) => setSelectedId(row.id)}
        rowActions={rowActions}
        searchPlaceholder={t("subscriptions.search")}
        emptyState={
          Object.keys(state.query.filters).length || state.query.search
            ? t("subscriptions.emptyFiltered")
            : t("subscriptions.empty")
        }
      />
      <SubscriptionPanel
        subscriptionId={selectedId}
        onClose={() => setSelectedId(null)}
        canWrite={canWrite}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}
