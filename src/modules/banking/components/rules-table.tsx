"use client";

// The categorisation rules (US2) as a DataTable (D20, D40), in the order they run (priority first). The name is
// the row's link to its edit dialog; ⋮ → Edit / Delete. The title row's New rule and Apply rules are
// `header-actions.tsx`.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import type { ListResult } from "@/kernel/list-query/types";
import { DataTable, type DataTableColumn, useListQuery } from "@/kernel/ui/data-table";
import { Tag } from "@/kernel/ui/tags";
import {
  deleteRuleAction,
  distinctRulesAction,
  ruleDateHierarchyAction,
} from "@/modules/banking/banking.actions";
import type { RuleListRow } from "@/modules/banking/types";
import type { CategoryOption, PartnerOption } from "@/modules/journal/ui";
import { filterSourceOf } from "./filter-source";
import { RuleDialog } from "./rule-dialog";

export type RuleRow = Omit<RuleListRow, "lastHitAt" | "createdAt" | "updatedAt"> & {
  lastHitAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const COLUMN_KEYS = [
  "name",
  "matchType",
  "matchPattern",
  "matchField",
  "basLabel",
  "partnerName",
  "noDocumentNeeded",
  "priority",
  "isActive",
  "ruleSource",
  "hitCount",
  "lastHitAt",
] as const;
const DEFAULT_SORT = [
  { col: "priority", dir: "desc" as const },
  { col: "name", dir: "asc" as const },
];

export function RulesTable({
  result,
  categories,
  partners,
  canWrite,
}: {
  result: ListResult<RuleRow>;
  categories: CategoryOption[];
  partners: PartnerOption[];
  canWrite: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const state = useListQuery({ columns: COLUMN_KEYS, defaultSort: DEFAULT_SORT });
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [toDelete, setToDelete] = useState<RuleRow | null>(null);
  const { executeAsync: remove, isPending: deleting } = useAction(deleteRuleAction);
  const filterSource = useMemo(
    () => filterSourceOf(distinctRulesAction, ruleDateHierarchyAction),
    [],
  );

  async function confirmDelete() {
    if (!toDelete) return;
    const r = await remove({ id: toDelete.id });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("banking.rules.deleted"));
    setToDelete(null);
    router.refresh();
  }

  const columns = useMemo<DataTableColumn<RuleRow>[]>(() => {
    const yesNo = (v: boolean) => (v ? t("common.yes") : t("common.no"));
    return [
      {
        key: "name",
        header: t("banking.rules.col.name"),
        type: "text",
        width: "12rem",
        alwaysVisible: true,
        cell: (row) =>
          canWrite ? (
            <button
              type="button"
              className="block max-w-full truncate text-left text-primary hover:text-primary-hover hover:underline"
              onClick={() => setEditing(row)}
              title={row.name}
            >
              {row.name}
            </button>
          ) : (
            <span className="block truncate" title={row.name}>
              {row.name}
            </span>
          ),
      },
      {
        key: "matchType",
        header: t("banking.rules.col.type"),
        type: "enum",
        width: "7.5rem",
        cell: (row) => t(`banking.rules.type.${row.matchType}`),
      },
      {
        key: "matchPattern",
        header: t("banking.rules.col.pattern"),
        type: "text",
        width: "12rem",
        cell: (row) => (
          <span className="block truncate font-mono text-xs" title={row.matchPattern}>
            {row.matchPattern}
          </span>
        ),
      },
      {
        key: "matchField",
        header: t("banking.rules.col.field"),
        type: "enum",
        width: "8rem",
        defaultHidden: true,
        cell: (row) => t(`banking.rules.field.${row.matchField}`),
      },
      {
        key: "basLabel",
        header: t("banking.rules.col.category"),
        type: "enum",
        width: "12rem",
      },
      {
        key: "partnerName",
        header: t("banking.rules.col.partner"),
        type: "enum",
        width: "9rem",
      },
      {
        key: "noDocumentNeeded",
        header: t("banking.rules.col.noDocument"),
        type: "boolean",
        width: "8rem",
        cell: (row) => yesNo(row.noDocumentNeeded),
      },
      {
        key: "priority",
        header: t("banking.rules.col.priority"),
        type: "number",
        width: "6rem",
      },
      {
        key: "isActive",
        header: t("banking.rules.col.active"),
        type: "boolean",
        width: "5.5rem",
        cell: (row) => yesNo(row.isActive),
      },
      {
        key: "ruleSource",
        header: t("banking.rules.col.source"),
        type: "enum",
        width: "6.5rem",
        cell: (row) => <Tag>{t(`banking.rules.source.${row.ruleSource}`)}</Tag>,
      },
      {
        key: "hitCount",
        header: t("banking.rules.col.hits"),
        type: "number",
        width: "5rem",
        defaultHidden: true,
      },
      {
        key: "lastHitAt",
        header: t("banking.rules.col.lastHit"),
        type: "date",
        width: "7rem",
        defaultHidden: true,
      },
    ];
  }, [t, canWrite]);

  return (
    <>
      <DataTable
        tableKey="bank-rules"
        columns={columns}
        result={result}
        state={state}
        filterSource={filterSource}
        valueLabel={(column, value) => {
          if (value === null) return t("common.blanks");
          if (column === "matchType")
            return t(`banking.rules.type.${value as RuleRow["matchType"]}`);
          if (column === "matchField")
            return t(`banking.rules.field.${value as RuleRow["matchField"]}`);
          if (column === "ruleSource")
            return t(`banking.rules.source.${value as RuleRow["ruleSource"]}`);
          if (column === "noDocumentNeeded" || column === "isActive")
            return value === "true" ? t("common.yes") : t("common.no");
          return value;
        }}
        rowActions={
          canWrite
            ? (row) => [
                { label: t("common.edit"), onClick: () => setEditing(row) },
                { label: t("common.delete"), destructive: true, onClick: () => setToDelete(row) },
              ]
            : undefined
        }
        emptyState={t("banking.rules.empty")}
      />
      {canWrite && (
        <RuleDialog
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          rule={editing}
          categories={categories}
          partners={partners}
          onSaved={() => router.refresh()}
        />
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        description={t("banking.rules.deleteConfirm", { name: toDelete?.name ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void confirmDelete()}
        isLoading={deleting}
      />
    </>
  );
}
