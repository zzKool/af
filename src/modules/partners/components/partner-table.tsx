"use client";

// The partners list on the kernel DataTable — the reference list page (phase-0 items 6 + 8).
// Rows come from the server page (URL = query); header filters fetch distinct values through the
// module's actions; create / deactivate / reactivate call the module's actions and refresh.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
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
  createPartnerAction,
  deactivatePartnerAction,
  distinctPartnersAction,
  partnerDateHierarchyAction,
  reactivatePartnerAction,
} from "@/modules/partners/partners.actions";
import type { PartnerDto } from "@/modules/partners/types";

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

const TYPE_COLORS: Record<string, string> = {
  client: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  vendor: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  employee: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

const PARTNER_TYPES = ["client", "vendor", "employee"] as const;

export function PartnerTable({ result }: { result: ListResult<PartnerRow> }) {
  const t = useT();
  const router = useRouter();
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newShortCode, setNewShortCode] = useState("");
  const [newTypes, setNewTypes] = useState<string[]>(["client"]);

  const { executeAsync: execCreate, isPending: isCreating } = useAction(createPartnerAction);
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
            const r = await execDeactivate({ id: row.id });
            if (r.serverError || r.data?.error) {
              throw new Error(
                r.serverError?.message ?? r.data?.error?.message ?? "Failed to deactivate",
              );
            }
            toast.success(t("partners.deactivated", { name: row.name }));
            router.refresh();
          },
          {
            description: t("partners.deactivateConfirm.description", { name: row.name }),
          },
        );
        return;
      } else {
        const r = await execReactivate({ id: row.id });
        if (r.serverError || r.data?.error) {
          toast.error(r.serverError?.message ?? r.data?.error?.message ?? "Failed to reactivate");
          return;
        }
        toast.success(t("partners.reactivated", { name: row.name }));
      }
      router.refresh();
    },
    [confirm, execDeactivate, execReactivate, router, t],
  );

  async function handleCreate() {
    if (!newName.trim() || newTypes.length === 0) return;
    const r = await execCreate({
      name: newName.trim(),
      shortCode: newShortCode.trim().toUpperCase(),
      types: newTypes as ("client" | "vendor" | "employee")[],
    });
    if (r.serverError || r.data?.error) {
      toast.error(r.serverError?.message ?? r.data?.error?.message ?? "Failed to create partner");
      return;
    }
    toast.success(t("partners.created"));
    setNewName("");
    setNewShortCode("");
    setNewTypes(["client"]);
    setShowCreate(false);
    router.refresh();
  }

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
        cell: (row) => (
          <div className="flex gap-1">
            {row.types.map((type) => (
              <Badge key={type} variant="outline" className={TYPE_COLORS[type] ?? ""}>
                {t(`partners.type.${type as (typeof PARTNER_TYPES)[number]}`)}
              </Badge>
            ))}
          </div>
        ),
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
        cell: (row) => (
          <Badge variant={row.isActive ? "default" : "secondary"}>
            {row.isActive ? t("partners.status.active") : t("partners.status.inactive")}
          </Badge>
        ),
      },
      { key: "createdAt", header: t("partners.col.created"), type: "date", width: "7rem" },
      {
        key: "updatedAt",
        header: t("partners.col.updated"),
        type: "date",
        width: "7rem",
        defaultHidden: true,
      },
      {
        key: "actions",
        header: "",
        type: "text",
        sortable: false,
        filterable: false,
        alwaysVisible: true,
        truncate: false,
        width: "7rem",
        align: "right",
        cell: (row) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={(e) => {
              e.stopPropagation();
              void toggleActive(row);
            }}
          >
            {row.isActive ? t("partners.deactivate") : t("partners.reactivate")}
          </Button>
        ),
      },
    ],
    [toggleActive, t],
  );

  return (
    <div className="flex flex-col gap-3">
      {showCreate && (
        <form
          className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <div className="min-w-56 flex-1">
            <label htmlFor="new-partner-name" className="mb-1 block text-xs font-medium">
              {t("partners.new.name")}
            </label>
            <Input
              id="new-partner-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("partners.new.namePlaceholder")}
              className="h-8"
              autoFocus
            />
          </div>
          <div className="w-28">
            <label htmlFor="new-partner-short" className="mb-1 block text-xs font-medium">
              {t("partners.new.shortCode")}
            </label>
            <Input
              id="new-partner-short"
              value={newShortCode}
              onChange={(e) => setNewShortCode(e.target.value.toUpperCase())}
              placeholder="VA"
              maxLength={6}
              className="h-8 uppercase"
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium">{t("partners.new.types")}</span>
            <div className="flex gap-3">
              {PARTNER_TYPES.map((type) => (
                <label key={type} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={newTypes.includes(type)}
                    onChange={(e) =>
                      setNewTypes((prev) =>
                        e.target.checked ? [...prev, type] : prev.filter((x) => x !== type),
                      )
                    }
                  />
                  {t(`partners.type.${type}`)}
                </label>
              ))}
            </div>
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={isCreating || !newName.trim() || newTypes.length === 0}
          >
            {isCreating ? t("partners.new.creating") : t("partners.new.create")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
            {t("common.cancel")}
          </Button>
        </form>
      )}

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
          if (column === "types")
            return t(`partners.type.${value as (typeof PARTNER_TYPES)[number]}`);
          return value;
        }}
        rowHref={(row) => `/partners/${row.id}`}
        searchPlaceholder={t("partners.search")}
        toolbar={
          !showCreate && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              {t("partners.add")}
            </Button>
          )
        }
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
