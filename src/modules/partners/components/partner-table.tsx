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

const VALUE_LABELS: Record<string, Record<string, string>> = {
  isActive: { true: "Active", false: "Inactive" },
};

export function PartnerTable({ result }: { result: ListResult<PartnerRow> }) {
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
    title: "Deactivate Partner",
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
            toast.success(`${row.name} deactivated`);
            router.refresh();
          },
          {
            description: `Deactivate ${row.name}? Their contracts stay; new ones cannot be created.`,
          },
        );
        return;
      } else {
        const r = await execReactivate({ id: row.id });
        if (r.serverError || r.data?.error) {
          toast.error(r.serverError?.message ?? r.data?.error?.message ?? "Failed to reactivate");
          return;
        }
        toast.success(`${row.name} reactivated`);
      }
      router.refresh();
    },
    [confirm, execDeactivate, execReactivate, router],
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
    toast.success("Partner created");
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
        header: "Name",
        type: "text",
        width: "16rem",
        alwaysVisible: true,
        cell: (row) => (
          <Link href={`/partners/${row.id}`} className="font-medium hover:underline">
            {row.name}
          </Link>
        ),
      },
      { key: "shortCode", header: "Short", type: "text", width: "5rem" },
      {
        key: "types",
        header: "Types",
        type: "enum",
        sortable: false,
        truncate: false,
        width: "10rem",
        cell: (row) => (
          <div className="flex gap-1">
            {row.types.map((t) => (
              <Badge key={t} variant="outline" className={TYPE_COLORS[t] ?? ""}>
                {t}
              </Badge>
            ))}
          </div>
        ),
      },
      { key: "orgNumber", header: "Org number", type: "text", width: "9rem" },
      { key: "vatNumber", header: "VAT number", type: "text", width: "9rem", defaultHidden: true },
      { key: "defaultCurrency", header: "Currency", type: "enum", width: "6rem" },
      {
        key: "defaultBasCategoryCode",
        header: "BAS",
        type: "enum",
        width: "5rem",
        defaultHidden: true,
      },
      { key: "email", header: "Email", type: "text", width: "14rem" },
      {
        key: "isActive",
        header: "Status",
        type: "boolean",
        width: "6rem",
        cell: (row) => (
          <Badge variant={row.isActive ? "default" : "secondary"}>
            {row.isActive ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      { key: "createdAt", header: "Created", type: "date", width: "7rem" },
      { key: "updatedAt", header: "Updated", type: "date", width: "7rem", defaultHidden: true },
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
            {row.isActive ? "Deactivate" : "Reactivate"}
          </Button>
        ),
      },
    ],
    [toggleActive],
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
              Name
            </label>
            <Input
              id="new-partner-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Partner name"
              className="h-8"
              autoFocus
            />
          </div>
          <div className="w-28">
            <label htmlFor="new-partner-short" className="mb-1 block text-xs font-medium">
              Short code
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
            <span className="mb-1 block text-xs font-medium">Types</span>
            <div className="flex gap-3">
              {["client", "vendor", "employee"].map((type) => (
                <label key={type} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={newTypes.includes(type)}
                    onChange={(e) =>
                      setNewTypes((prev) =>
                        e.target.checked ? [...prev, type] : prev.filter((t) => t !== type),
                      )
                    }
                  />
                  {type}
                </label>
              ))}
            </div>
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={isCreating || !newName.trim() || newTypes.length === 0}
          >
            {isCreating ? "Creating…" : "Create"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
            Cancel
          </Button>
        </form>
      )}

      <DataTable
        tableKey="partners"
        columns={columns}
        result={result}
        state={state}
        filterSource={filterSource}
        valueLabel={(column, value) =>
          value === null ? "(Blanks)" : (VALUE_LABELS[column]?.[value] ?? value)
        }
        rowHref={(row) => `/partners/${row.id}`}
        searchPlaceholder="Search name, short code, org/VAT number, email…"
        toolbar={
          !showCreate && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              Add partner
            </Button>
          )
        }
        emptyState={
          Object.keys(state.query.filters).length || state.query.search
            ? "No partners match the active filters."
            : "No partners yet. Add your first partner."
        }
      />

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
