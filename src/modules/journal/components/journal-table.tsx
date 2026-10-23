"use client";

// The ledger (D20, D40 kit — F71): DataTable on JOURNAL_COLUMNS with the derived Proof as a <StateLabel> (one map,
// `state-family.ts`), money through `formatMoney` (+ `data-amount`, the plain decimal), the account / source and the
// BAS code as <Tag>s, the counterparty key as a <CodeChip>, Date (month) and Account as quick filters, ⋮ row actions
// (open the bank row · delete a manual entry), and the docked panel in sections: About · Proof · Categorisation ·
// History. The page's one primary, *New entry*, sits in the title row (`new-entry-button.tsx`).
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
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
import { formatMoney } from "@/kernel/money/format-money";
import type { Currency } from "@/kernel/nav/constants";
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilterSource,
  useListQuery,
} from "@/kernel/ui/data-table";
import { DetailsGrid, DetailsSection } from "@/kernel/ui/details-section";
import { CodeChip, Tag } from "@/kernel/ui/tags";
import { basName } from "@/modules/journal/bas-name";
import {
  deleteManualEntryAction,
  distinctJournalValuesAction,
  journalDateHierarchyAction,
} from "@/modules/journal/journal.actions";
import type { JournalColumn } from "@/modules/journal/queries";
import type { JournalListRow, LinksState } from "@/modules/journal/types";
import { CategoriseForm, type CategoryOption, type PartnerOption } from "./categorise-form";
import { EntryHistory } from "./entry-history";
import { EntryLinks } from "./entry-links";
import { JournalProofLabel } from "./proof-state";

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
  "accountAlias",
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
  canWrite,
}: {
  result: ListResult<JournalRow>;
  categories: CategoryOption[];
  partners: PartnerOption[];
  canWrite: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });
  const [selected, setSelected] = useState<JournalRow | null>(null);
  // the manual entry a Delete (⋮ or the panel) asks to confirm
  const [toDelete, setToDelete] = useState<JournalRow | null>(null);
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
        quickFilter: true,
      },
      {
        key: "sourceType",
        header: t("journal.col.source"),
        type: "enum",
        width: "9rem",
        // the bank account's alias (T006) — *Nordea CHF* rather than *Bank*; the filter keeps Bank / Manual
        cell: (row) => (
          <Tag className="max-w-full truncate">
            {row.accountAlias ?? t(`journal.source.${row.sourceType}`)}
          </Tag>
        ),
      },
      {
        // the Account quick filter (F71): one value per bank account, a manual entry under *Manual*
        key: "accountAlias",
        header: t("journal.col.account"),
        type: "enum",
        width: "8rem",
        defaultHidden: true,
        quickFilter: true,
        cell: (row) => row.accountAlias ?? t("journal.source.manual"),
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
        cell: (row) => (row.counterpartyKey ? <CodeChip>{row.counterpartyKey}</CodeChip> : null),
      },
      {
        key: "basLabel",
        header: t("journal.col.category"),
        type: "text",
        width: "11rem",
        cell: (row) =>
          row.basCode ? (
            <span className="flex min-w-0 items-center gap-1.5" title={row.basLabel ?? undefined}>
              <Tag>{row.basCode}</Tag>
              <span className="truncate">{basName(row.basCode, row.basLabel)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "basCode",
        header: t("journal.col.categoryCode"),
        type: "enum",
        defaultHidden: true,
        cell: (row) => (row.basCode ? <Tag>{row.basCode}</Tag> : null),
      },
      { key: "partnerName", header: t("journal.col.partner"), type: "text", width: "10rem" },
      {
        key: "partnerId",
        header: t("journal.col.partnerId"),
        type: "enum",
        defaultHidden: true,
      },
      {
        key: "amount",
        header: t("journal.col.amount"),
        type: "money",
        width: "8rem",
        cell: (row) => <Amount value={row.amount} currency={row.currency} signed />,
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
        cell: (row) => <Amount value={row.amountBase} currency="SEK" />,
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
          row.noDocumentNeeded ? t("common.yes") : <span className="text-muted-foreground">—</span>,
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
        cell: (row) => <JournalProofLabel state={row.linksState} testId="journal-links-state" />,
      },
      {
        key: "createdAt",
        header: t("journal.col.created"),
        type: "date",
        width: "7rem",
        defaultHidden: true,
      },
      {
        key: "updatedAt",
        header: t("journal.col.updated"),
        type: "date",
        width: "7rem",
        defaultHidden: true,
      },
    ],
    [t],
  );

  async function confirmDelete() {
    if (!toDelete) return;
    const r = await remove({ id: toDelete.id });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("journal.manual.deleted"));
    if (selected?.id === toDelete.id) setSelected(null);
    setToDelete(null);
    router.refresh();
  }

  // About this entry: the locked money facts and where it came from (the owner's facts are the form below)
  function aboutRows(e: JournalRow): [ReactNode, ReactNode][] {
    return [
      [t("journal.col.amountBase"), <Amount key="base" value={e.amountBase} currency="SEK" />],
      [
        t("journal.col.rate"),
        <span key="rate" className="tabular-nums">
          {e.rate} · {t(`journal.rateSource.${e.rateSource}`)}
          {e.rateDate && e.rateDate !== e.entryDate ? ` · ${e.rateDate}` : ""}
        </span>,
      ],
      // the transfer pair's own rate, beside the ECB one — informational, never the base (T007)
      ...(e.bankImplicitRate
        ? ([
            [
              t("journal.col.implicitRate"),
              <span key="implicit" className="tabular-nums" data-testid="journal-implicit-rate">
                {e.bankImplicitRate}
              </span>,
            ],
          ] as [ReactNode, ReactNode][])
        : []),
      [
        t("journal.col.counterparty"),
        e.counterpartyKey ? <CodeChip key="cp">{e.counterpartyKey}</CodeChip> : null,
      ],
      [
        t("journal.col.categorisedBy"),
        e.categorisedBy ? t(`journal.categorisedBy.${e.categorisedBy}`) : null,
      ],
      [t("journal.col.created"), e.createdAt.slice(0, 10)],
    ];
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
          // a manual entry has no account: its blank is *Manual*, not *(Blanks)*
          if (value === null)
            return column === "accountAlias" ? t("journal.source.manual") : t("common.blanks");
          if (column === "sourceType")
            return t(`journal.source.${value as "bank_transaction" | "manual"}`);
          if (column === "basCode") return categoryLabels[value] ?? value;
          if (column === "partnerId") return partnerLabels[value] ?? value;
          if (column === "categorisedBy")
            return t(`journal.categorisedBy.${value as "manual" | "rule"}`);
          if (column === "rateSource")
            return t(
              `journal.rateSource.${value as "same_currency" | "ecb_daily" | "ecb_nearest" | "manual"}`,
            );
          if (column === "linksState") return t(`journal.linksState.${value as LinksState}`);
          if (column === "accountAlias") return value;
          if (column === "noDocumentNeeded")
            return value === "true" ? t("common.yes") : t("common.no");
          return value;
        }}
        rowCurrency={(row) => row.currency as Currency}
        sumCurrency="SEK"
        onRowClick={(row) => setSelected(row)}
        rowActions={(row) =>
          row.sourceType === "bank_transaction"
            ? row.sourceId
              ? [
                  {
                    label: t("journal.panel.openTransaction"),
                    // the banking workbench opens its panel on `?open=` (linking's entityHref for a bank row)
                    onClick: () => router.push(`/banking?open=${row.sourceId}`),
                  },
                ]
              : []
            : canWrite
              ? [
                  {
                    label: t("journal.manual.delete"),
                    destructive: true,
                    onClick: () => setToDelete(row),
                  },
                ]
              : []
        }
        searchPlaceholder={t("journal.search")}
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
                  <Amount value={selected.amount} currency={selected.currency} signed />
                  <JournalProofLabel state={selected.linksState} testId="journal-panel-state" />
                </SheetTitle>
                <SheetDescription className="flex flex-wrap items-center gap-1.5">
                  <Tag>
                    <span data-testid="journal-panel-source">
                      {selected.accountAlias ?? t(`journal.source.${selected.sourceType}`)}
                    </span>
                  </Tag>
                  <span className="min-w-0 break-words">{selected.description}</span>
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col">
                <DetailsSection title={t("details.about")}>
                  <DetailsGrid rows={aboutRows(selected)} />
                </DetailsSection>
                <EntryLinks
                  entry={selected}
                  canWrite={canWrite}
                  onChanged={() => router.refresh()}
                />
                <DetailsSection title={t("journal.panel.categorise")}>
                  <div className="grid gap-3">
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
                    {canWrite && selected.sourceType === "manual" && (
                      <div>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setToDelete(selected)}
                        >
                          {t("journal.manual.delete")}
                        </Button>
                      </div>
                    )}
                  </div>
                </DetailsSection>
                {/* keyed by the entry and its last write, so a save re-reads the trail */}
                <EntryHistory key={`${selected.id}:${selected.updatedAt}`} entryId={selected.id} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        description={t("journal.manual.deleteConfirm")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void confirmDelete()}
        isLoading={deleting}
      />
    </>
  );
}

/** On-screen money (D40): `formatMoney`, the plain decimal on `data-amount` for tests; a signed amount shows "+"
 * and the done colour when it is money in (as the bank rows do). */
function Amount({
  value,
  currency,
  signed = false,
}: {
  value: string;
  currency: string;
  signed?: boolean;
}) {
  const incoming = signed && !value.startsWith("-") && Number(value) !== 0;
  return (
    <span data-amount={value} className={`tabular-nums ${incoming ? "text-state-done" : ""}`}>
      {formatMoney(value, currency, { signed })}
    </span>
  );
}
