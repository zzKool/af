"use client";

// The expenses pages' title-row actions (D40: secondary buttons, then one primary).
//   /expenses                Groups · Settlements · Settle · [New expense]
//   /expenses/groups         [New group]
//   /expenses/groups/[id]    Edit · [Add expense]
//   /expenses/settlements    [Settle]
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import { useNewParam } from "@/kernel/ui/shell/use-new-param";
import type {
  CategoryOption,
  DocumentOption,
  ExpenseGroupKind,
  GroupOption,
  SourceOption,
} from "@/modules/expenses/types";
import { GroupDialog } from "./groups-table";
import { NewExpenseDialog } from "./new-expense-dialog";

export type NewExpenseOptions = {
  groups: GroupOption[];
  categories: CategoryOption[];
  sources: SourceOption[];
  documents: DocumentOption[];
};

/** The primary that opens the New expense dialog — on the list, or pre-set to a group on its page. */
export function NewExpenseButton({
  options,
  groupId,
  label,
}: {
  options: NewExpenseOptions;
  groupId?: string;
  label?: string;
}) {
  const t = useT();
  // `?new=1` — the sidebar's **+ New → Expense** (F73) — opens the dialog; closing drops the param
  const [open, setOpen] = useNewParam();
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="open-new-expense">
        {label ?? t("expenses.new")}
      </Button>
      <NewExpenseDialog
        open={open}
        onOpenChange={setOpen}
        groups={options.groups}
        categories={options.categories}
        sources={options.sources}
        documents={options.documents}
        defaultGroupId={groupId}
      />
    </>
  );
}

export function ExpensesActions({
  options,
  canWrite,
}: {
  options: NewExpenseOptions;
  canWrite: boolean;
}) {
  const t = useT();
  return (
    <>
      <Button variant="outline" nativeButton={false} render={<Link href="/expenses/groups" />}>
        {t("expenses.nav.groups")}
      </Button>
      <Button variant="outline" nativeButton={false} render={<Link href="/expenses/settlements" />}>
        {t("expenses.nav.settlements")}
      </Button>
      {canWrite && (
        <>
          <Button variant="outline" nativeButton={false} render={<Link href="/expenses/settle" />}>
            {t("expenses.nav.settle")}
          </Button>
          <NewExpenseButton options={options} />
        </>
      )}
    </>
  );
}

export function GroupsActions() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="open-new-group">
        {t("expenses.groups.new")}
      </Button>
      {open && <GroupDialog open onOpenChange={setOpen} />}
    </>
  );
}

/** The group page: edit its description / kind, then add an expense to it. */
export function GroupHeaderActions({
  group,
  options,
  canWrite,
}: {
  group: { id: string; description: string; kind: ExpenseGroupKind; hasTrip: boolean };
  options: NewExpenseOptions;
  canWrite: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!canWrite) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="edit-group">
        {t("expenses.group.edit")}
      </Button>
      {open && <GroupDialog open onOpenChange={setOpen} group={group} />}
      <NewExpenseButton
        options={options}
        groupId={group.id}
        label={t("expenses.group.addExpense")}
      />
    </>
  );
}

export function SettlementsActions() {
  const t = useT();
  return (
    <Button nativeButton={false} render={<Link href="/expenses/settle" />}>
      {t("expenses.nav.settle")}
    </Button>
  );
}
