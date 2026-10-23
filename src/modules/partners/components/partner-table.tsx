"use client";

// The partners list on the kernel DataTable — the reference list page (phase-0 items 6 + 8).
// Rows come from the server page (URL = query); header filters fetch distinct values through the
// module's actions; deactivate / reactivate sit in the row's ⋮ menu (D40) and refresh. Creating is the
// title row's primary (`NewPartnerButton`), not a button in the table.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import type { ListResult } from "@/kernel/list-query/types";
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilterSource,
  useListQuery,
} from "@/kernel/ui/data-table";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  deactivatePartnerAction,
  distinctPartnersAction,
  partnerDateHierarchyAction,
  reactivatePartnerAction,
} from "@/modules/partners/partners.actions";
import type { PartnerDto } from "@/modules/partners/types";
import { isPartnerType, PartnerStateLabel, PartnerTypeTags } from "./partner-labels";

/** What the page hands over: Dates serialised, nothing else. */
export type PartnerRow = Omit<PartnerDto, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

const COLUMN_KEYS = [
  "name",
  "shortCode",
  "types",
  "orgNumber",
  "vatNumber",
  "defaultCurrency",
  "defaultBasCategoryCode",
  "email",
  "isActive",
  "createdAt",
  "updatedAt",
] as const;
const DEFAULT_SORT = [{ col: "name", dir: "asc" as const }];

export function PartnerTable({ result }: { result: ListResult<PartnerRow> }) {
  const t = useT();
  const router = useRouter();
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });
  const { executeAsync: execDeactivate } = useAction(deactivatePartnerAction);
  const { executeAsync: execReactivate } = useAction(reactivatePartnerAction);
  const { dialogProps, confirm } = useConfirmDialog({
    title: t("partners.deactivateConfirm.title"),
    variant: "destructive",
  });

  const filterSource = useMemo<DataTableFilterSource>(
    () => ({
      distinct: async (column, query) => {
        const r = await distinctPartnersAction({ column, query });
        if (r.serverError) throw new Error(r.serverError.message ?? "Failed to load values");
        return r.data?.data ?? [];
      },
      dateHierarchy: async (column, query) => {
        const r = await partnerDateHierarchyAction({ column, query });
        if (r.serverError) throw new Error(r.serverError.message ?? "Failed to load dates");
        return r.data?.data ?? { years: [], empty: 0 };
      },
    }),
    [],
  );

  const toggleActive = useCallback(
    async (row: PartnerRow) => {
      if (row.isActive) {
        confirm(
          async () => {
            const error = extractError(await execDeactivate({ id: row.id }));
            if (error) throw new Error(error);
            toast.success(t("partners.deactivated", { name: row.name }));
            router.refresh();
          },
          {
            description: t("partners.deactivateConfirm.description", { name: row.name }),
          },
        );
        return;
      } else {
        const error = extractError(await execReactivate({ id: row.id }));
        if (error) {
          toast.error(error);
          return;
        }
        toast.success(t("partners.reactivated", { name: row.name }));
      }
      router.refresh();
    },
    [confirm, execDeactivate, execReactivate, router, t],
  );

  const columns = useMemo<DataTableColumn<PartnerRow>[]>(
    () => [
      {
        key: "name",
        header: t("partners.col.name"),
        type: "text",
        width: "16rem",
        alwaysVisible: true,
        cell: (row) => (
          <Link href={`/partners/${row.id}`} className="font-medium hover:underline">
            {row.name}
          </Link>
        ),
      },
      { key: "shortCode", header: t("partners.col.shortCode"), type: "text", width: "5rem" },
      {
        key: "types",
        header: t("partners.col.types"),
        type: "enum",
        sortable: false,
        truncate: false,
        width: "10rem",
        quickFilter: true,
        cell: (row) => <PartnerTypeTags types={row.types} />,
      },
      { key: "orgNumber", header: t("partners.col.orgNumber"), type: "text", width: "9rem" },
      {
        key: "vatNumber",
        header: t("partners.col.vatNumber"),
        type: "text",
        width: "9rem",
        defaultHidden: true,
      },
      { key: "defaultCurrency", header: t("partners.col.currency"), type: "enum", width: "6rem" },
      {
        key: "defaultBasCategoryCode",
        header: t("partners.col.bas"),
        type: "enum",
        width: "5rem",
        defaultHidden: true,
      },
      { key: "email", header: t("partners.col.email"), type: "text", width: "14rem" },
      {
        key: "isActive",
        header: t("partners.col.status"),
        type: "boolean",
        width: "6rem",
        cell: (row) => <PartnerStateLabel isActive={row.isActive} />,
      },
      { key: "createdAt", header: t("partners.col.created"), type: "date", width: "7rem" },
      {
        key: "updatedAt",
        header: t("partners.col.updated"),
        type: "date",
        width: "7rem",
        defaultHidden: true,
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        tableKey="partners"
        columns={columns}
        result={result}
        state={state}
        filterSource={filterSource}
        valueLabel={(column, value) => {
          if (value === null) return t("common.blanks");
          if (column === "isActive")
            return value === "true" ? t("partners.status.active") : t("partners.status.inactive");
          if (column === "types" && isPartnerType(value)) return t(`partners.type.${value}`);
          return value;
        }}
        rowHref={(row) => `/partners/${row.id}`}
        rowActions={(row) => [
          {
            label: row.isActive ? t("partners.deactivate") : t("partners.reactivate"),
            destructive: row.isActive,
            onClick: () => void toggleActive(row),
          },
        ]}
        searchPlaceholder={t("partners.search")}
        emptyState={
          Object.keys(state.query.filters).length || state.query.search
            ? t("partners.emptyFiltered")
            : t("partners.empty")
        }
      />

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
