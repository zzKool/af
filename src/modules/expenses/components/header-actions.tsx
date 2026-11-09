"use client";

// The expenses pages' title-row actions (D40: secondary buttons, then one primary).
//   /expenses                Groups · Settlements · Settle · [New expense]
//   /expenses/groups         [New group]
//   /expenses/groups/[id]    Edit · [Add expense]
//   /expenses/settlements    [Settle]
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { useNewParam } from "@/kernel/ui/shell/use-new-param";
import type {
  CategoryOption,
  DocumentOption,
  ExpenseGroupKind,
  GroupOption,
  SourceOption,
} from "@/modules/expenses/types";
import { announceDockedPanel, useOtherDockedPanel } from "./dock-channel";
import { EXPENSES_BASE } from "./expense-table";
import { GroupDialog } from "./groups-table";
import { NewExpensePanel } from "./new-expense-dialog";

export type NewExpenseOptions = {
  groups: GroupOption[];
  categories: CategoryOption[];
  sources: SourceOption[];
  documents: DocumentOption[];
  basHistory?: Record<string, { code: string; count: number }[]>;
};

/**
 * The primary that opens the new-expense form — on the list, or pre-set to a group on its page. F170: the form docks
 * beside the list (the board *Pulse — Expenses*), one panel at a time with the row's details (`dock-channel`).
 */
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
  // `?new=1` — the sidebar's **+ New → Expense** (F73) — opens the form; closing drops the param
  const [open, setOpen] = useNewParam();
  // one panel in the dock (F170): the form opening closes the row's details; a row picked closes the form
  useEffect(() => {
    if (open) announceDockedPanel("new");
  }, [open]);
  useOtherDockedPanel("new", () => setOpen(false));
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="open-new-expense">
        {label ?? t("expenses.new")}
      </Button>
      <NewExpensePanel
        open={open}
        onOpenChange={setOpen}
        groups={options.groups}
        categories={options.categories}
        sources={options.sources}
        basHistory={options.basHistory}
        documents={options.documents}
        defaultGroupId={groupId}
      />
    </>
  );
}

export function ExpensesActions({
  options,
  canWrite,
  owedBase,
}: {
  options: NewExpenseOptions;
  canWrite: boolean;
  /** F154: what the company owes the owner, in the base — *Settle 4 078.20 SEK*, the board's button */
  owedBase?: string;
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
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/expenses/settle" data-testid="expenses-settle" />}
          >
            {owedBase && Number(owedBase) > 0
              ? t("expenses.settleAmount", { amount: formatMoney(owedBase, EXPENSES_BASE) })
              : t("expenses.nav.settle")}
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
