"use client";

// The ledger (D20): DataTable on JOURNAL_COLUMNS, sums of the SEK base on the filtered set, a side panel with
// the categorise form, "New entry" for manual facts (delete from the panel).
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { extractError } from "@/kernel/errors/extract-error";
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
import { StateLabel } from "@/kernel/ui/state-label";
import {
  deleteManualEntryAction,
  distinctJournalValuesAction,
  journalDateHierarchyAction,
} from "@/modules/journal/journal.actions";
import type { JournalColumn } from "@/modules/journal/queries";
import { LINKS_STATE_FAMILY } from "@/modules/journal/state-family";
import type { JournalListRow, LinksState } from "@/modules/journal/types";
import { CategoriseForm, type CategoryOption, type PartnerOption } from "./categorise-form";
import { EntryLinks } from "./entry-links";
import { ManualEntryDialog } from "./manual-entry-dialog";

export type JournalRow = Omit<JournalListRow, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

const COLUMN_KEYS = [
  "entryDate",
  "sourceType",
  "description",
  "counterpartyKey",
  "basCode",
  "basLabel",
  "partnerId",
  "partnerName",
  "amount",
  "currency",
  "amountBase",
  "rate",
  "rateSource",
  "bankImplicitRate",
  "noDocumentNeeded",
  "categorisedBy",
  "note",
  "linksState",
  "createdAt",
  "updatedAt",
] as const;
const DEFAULT_SORT = [
  { col: "entryDate", dir: "desc" as const },
  { col: "createdAt", dir: "desc" as const },
];

export function JournalTable({
  result,
  categories,
  partners,
  today,
  canWrite,
}: {
  result: ListResult<JournalRow>;
  categories: CategoryOption[];
  partners: PartnerOption[];
  today: string;
  canWrite: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });
  const [selected, setSelected] = useState<JournalRow | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { executeAsync: remove, isPending: deleting } = useAction(deleteManualEntryAction);

  const filterSource = useMemo<DataTableFilterSource>(
    () => ({
      distinct: async (column, query) => {
        const r = await distinctJournalValuesAction({ column: column as JournalColumn, query });
        if (r.serverError) throw new Error(r.serverError.message ?? "Failed to load values");
        const d = r.data;
        if (d && "error" in d) throw new Error(d.error.message);
        return d?.data ?? [];
      },
      dateHierarchy: async (column, query) => {
        const r = await journalDateHierarchyAction({ column: column as JournalColumn, query });
        if (r.serverError) throw new Error(r.serverError.message ?? "Failed to load dates");
        const d = r.data;
        if (d && "error" in d) throw new Error(d.error.message);
        return d?.data ?? { years: [], empty: 0 };
      },
    }),
    [],
  );

  const categoryLabels = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.code, c.label])),
    [categories],
  );
  const partnerLabels = useMemo(
    () => Object.fromEntries(partners.map((p) => [p.id, p.name])),
    [partners],
  );

  const columns = useMemo<DataTableColumn<JournalRow>[]>(
    () => [
      {
        key: "entryDate",
        header: t("journal.col.entryDate"),
        type: "date",
        width: "6.5rem",
        alwaysVisible: true,
      },
      {
        key: "sourceType",
        header: t("journal.col.source"),
        type: "enum",
        width: "5.5rem",
        cell: (row) => t(`journal.source.${row.sourceType}`),
      },
      {
        key: "description",
        header: t("journal.col.description"),
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
        header: t("journal.col.counterparty"),
        type: "text",
        width: "12rem",
        defaultHidden: true,
      },
      {
        key: "basLabel",
        header: t("journal.col.category"),
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
        header: `${t("journal.col.category")} (code)`,
        type: "enum",
        defaultHidden: true,
      },
      { key: "partnerName", header: t("journal.col.partner"), type: "text", width: "10rem" },
      {
        key: "partnerId",
        header: `${t("journal.col.partner")} (id)`,
        type: "enum",
        defaultHidden: true,
      },
      {
        key: "amount",
        header: t("journal.col.amount"),
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
        header: t("journal.col.currency"),
        type: "enum",
        width: "4rem",
        defaultHidden: true,
      },
      {
        key: "amountBase",
        header: t("journal.col.amountBase"),
        type: "money",
        width: "8rem",
        cell: (row) => (
          <span className="tabular-nums">{formatCurrency(row.amountBase, "SEK")} SEK</span>
        ),
      },
      {
        key: "rate",
        header: t("journal.col.rate"),
        type: "number",
        width: "6rem",
        defaultHidden: true,
      },
      {
        key: "rateSource",
        header: t("journal.col.rateSource"),
        type: "enum",
        width: "6rem",
        defaultHidden: true,
        cell: (row) => t(`journal.rateSource.${row.rateSource}`),
      },
      {
        key: "bankImplicitRate",
        header: t("journal.col.implicitRate"),
        type: "number",
        width: "6rem",
        defaultHidden: true,
      },
      {
        key: "noDocumentNeeded",
        header: t("journal.col.noDocument"),
        type: "boolean",
        width: "6rem",
        cell: (row) =>
          row.noDocumentNeeded ? (
            <Badge variant="outline">{t("common.yes")}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "categorisedBy",
        header: t("journal.col.categorisedBy"),
        type: "enum",
        width: "7rem",
        defaultHidden: true,
        cell: (row) => (row.categorisedBy ? t(`journal.categorisedBy.${row.categorisedBy}`) : "—"),
      },
      { key: "note", header: t("journal.col.note"), type: "text", width: "12rem" },
      {
        // derived from links on every read, never typed (T004)
        key: "linksState",
        header: t("journal.col.linksState"),
        type: "enum",
        width: "8.5rem",
        cell: (row) => (
          <span
            data-testid="journal-links-state"
            data-state={row.linksState}
            className="inline-flex"
          >
            <StateLabel
              family={LINKS_STATE_FAMILY[row.linksState]}
              state={t(`journal.linksState.${row.linksState}`)}
            />
          </span>
        ),
      },
      { key: "createdAt", header: "Created", type: "date", width: "7rem", defaultHidden: true },
      { key: "updatedAt", header: "Updated", type: "date", width: "7rem", defaultHidden: true },
    ],
    [t],
  );

  async function deleteSelected() {
    if (!selected) return;
    const r = await remove({ id: selected.id });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("journal.manual.deleted"));
    setConfirmDelete(false);
    setSelected(null);
    router.refresh();
  }

  return (
    <>
      <DataTable
        tableKey="journal"
        columns={columns}
        result={result}
        state={state}
        filterSource={filterSource}
        valueLabel={(column, value) => {
          if (value === null) return "(Blanks)";
          if (column === "sourceType")
            return t(`journal.source.${value as "bank_transaction" | "manual"}`);
          if (column === "basCode") return categoryLabels[value] ?? value;
          if (column === "partnerId") return partnerLabels[value] ?? value;
          if (column === "categorisedBy")
            return t(`journal.categorisedBy.${value as "manual" | "rule" | "partner_default"}`);
          if (column === "rateSource")
            return t(
              `journal.rateSource.${value as "same_currency" | "ecb_daily" | "ecb_nearest" | "manual"}`,
            );
          if (column === "linksState") return t(`journal.linksState.${value as LinksState}`);
          if (column === "noDocumentNeeded")
            return value === "true" ? t("common.yes") : t("common.no");
          return value;
        }}
        rowCurrency={(row) => row.currency as Currency}
        sumCurrency="SEK"
        onRowClick={(row) => setSelected(row)}
        searchPlaceholder={t("journal.search")}
        toolbar={
          canWrite && (
            <Button size="sm" onClick={() => setNewOpen(true)} data-testid="new-entry">
              {t("journal.new")}
            </Button>
          )
        }
        emptyState={
          Object.keys(state.query.filters).length || state.query.search
            ? t("journal.emptyFiltered")
            : t("journal.empty")
        }
      />
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent data-testid="journal-panel">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">{selected.entryDate}</span>
                  <span className="tabular-nums">
                    {formatCurrency(selected.amount, selected.currency as Currency)}{" "}
                    {selected.currency}
                  </span>
                  <Badge variant="outline">{t(`journal.source.${selected.sourceType}`)}</Badge>
                </SheetTitle>
                <SheetDescription>
                  {selected.description} · {formatCurrency(selected.amountBase, "SEK")} SEK ·{" "}
                  {t(`journal.rateSource.${selected.rateSource}`)} {selected.rate}
                  {/* the transfer pair's own rate, beside the ECB one — informational, never the base (T007) */}
                  {selected.bankImplicitRate && (
                    <span data-testid="journal-implicit-rate">
                      {" "}
                      · {t("journal.col.implicitRate")} {selected.bankImplicitRate}
                    </span>
                  )}
                </SheetDescription>
              </SheetHeader>
              <CategoriseForm
                entry={selected}
                categories={categories}
                partners={partners}
                canWrite={canWrite}
                onSaved={(e) => {
                  setSelected({
                    ...selected,
                    ...e,
                    createdAt: selected.createdAt,
                    updatedAt: selected.updatedAt,
                  });
                  router.refresh();
                }}
              />
              <EntryLinks entry={selected} canWrite={canWrite} onChanged={() => router.refresh()} />
              {canWrite && selected.sourceType === "manual" && (
                <div>
                  <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}>
                    {t("journal.manual.delete")}
                  </Button>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
      {canWrite && (
        <ManualEntryDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          today={today}
          categories={categories}
          partners={partners}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        description={t("journal.manual.deleteConfirm")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void deleteSelected()}
        isLoading={deleting}
      />
    </>
  );
}
