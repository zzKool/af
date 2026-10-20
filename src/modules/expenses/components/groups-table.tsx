"use client";

// Expense groups: the list with totals, "new group", delete (empty groups only).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  createExpenseGroupAction,
  deleteExpenseGroupAction,
  updateExpenseGroupAction,
} from "@/modules/expenses/expenses.actions";
import type { GroupListRow } from "@/modules/expenses/queries";
import { EXPENSE_GROUP_KINDS, type ExpenseGroupKind } from "@/modules/expenses/types";

export type GroupRow = Omit<GroupListRow, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export function GroupDialog({
  open,
  onOpenChange,
  group,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** editing an existing group; omitted = new */
  group?: { id: string; description: string; kind: ExpenseGroupKind; hasTrip: boolean };
  onSaved?: (group: { id: string; number: number }) => void;
}) {
  const t = useT();
  const ids = useId();
  const router = useRouter();
  const [description, setDescription] = useState(group?.description ?? "");
  const [kind, setKind] = useState<ExpenseGroupKind>(group?.kind ?? "batch");
  const { executeAsync: create, isPending: creating } = useAction(createExpenseGroupAction);
  const { executeAsync: update, isPending: updating } = useAction(updateExpenseGroupAction);

  async function submit() {
    const r = group
      ? await update({ id: group.id, data: { description: description.trim(), kind } })
      : await create({ description: description.trim(), kind });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const saved = r?.data?.data;
    toast.success(
      group
        ? t("expenses.groups.updated")
        : t("expenses.groups.created", { number: saved?.number ?? "" }),
    );
    if (!group) setDescription("");
    onOpenChange(false);
    if (saved) onSaved?.(saved);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="group-dialog">
        <DialogHeader>
          <DialogTitle>
            {group ? t("expenses.group.edit") : t("expenses.groups.form.title")}
          </DialogTitle>
          <DialogDescription>{t("expenses.form.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div>
            <label htmlFor={`${ids}-desc`} className="mb-1 block text-xs font-medium">
              {t("expenses.groups.form.description")}
            </label>
            <Input
              id={`${ids}-desc`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              data-testid="group-description"
            />
          </div>
          <div>
            <label htmlFor={`${ids}-kind`} className="mb-1 block text-xs font-medium">
              {t("expenses.groups.form.kind")}
            </label>
            <Select
              value={kind}
              onValueChange={(v) => v && setKind(v as ExpenseGroupKind)}
              disabled={group?.hasTrip}
            >
              <SelectTrigger id={`${ids}-kind`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_GROUP_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`expenses.groups.kind.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={creating || updating} data-testid="save-group">
              {group ? t("common.save") : t("expenses.groups.form.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GroupsTable({ rows, canWrite }: { rows: GroupRow[]; canWrite: boolean }) {
  const t = useT();
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(false);
  const { executeAsync: remove } = useAction(deleteExpenseGroupAction);
  const deleteDialog = useConfirmDialog({
    title: t("expenses.groups.delete"),
    variant: "destructive",
    confirmLabel: t("common.delete"),
  });

  return (
    <div className="flex flex-col gap-3">
      {canWrite && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setNewOpen(true)} data-testid="open-new-group">
            {t("expenses.groups.new")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href="/expenses" />}
          >
            {t("expenses.title")}
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("expenses.groups.empty")}</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">{t("expenses.groups.col.number")}</TableHead>
                <TableHead>{t("expenses.groups.col.description")}</TableHead>
                <TableHead className="w-20">{t("expenses.groups.col.kind")}</TableHead>
                <TableHead className="w-20 text-right">{t("expenses.groups.col.count")}</TableHead>
                <TableHead className="w-40">{t("expenses.groups.col.perCurrency")}</TableHead>
                <TableHead className="w-28 text-right">{t("expenses.groups.col.total")}</TableHead>
                <TableHead className="w-28 text-right">{t("expenses.groups.col.open")}</TableHead>
                {canWrite && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((g) => (
                <TableRow key={g.id} data-testid="group-row">
                  <TableCell className="tabular-nums">{g.number}</TableCell>
                  <TableCell>
                    <Link href={`/expenses/groups/${g.id}`} className="hover:underline">
                      {g.description}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`expenses.groups.kind.${g.kind}`)}</Badge>
                    {g.hasTrip && <span className="ml-1 text-xs text-muted-foreground">✈</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{g.expenseCount}</TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {g.perCurrency
                      .map(
                        (c) => `${formatCurrency(c.amount, c.currency as Currency)} ${c.currency}`,
                      )
                      .join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(g.totalBase, "SEK")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(g.openBase, "SEK")}
                  </TableCell>
                  {canWrite && (
                    <TableCell>
                      {g.expenseCount === 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            deleteDialog.confirm(
                              async () => {
                                const r = await remove({ id: g.id });
                                const error = extractError(r);
                                if (error) throw new Error(error);
                                toast.success(t("expenses.groups.deleted"));
                                router.refresh();
                              },
                              {
                                description: t("expenses.groups.deleteConfirm", {
                                  number: g.number,
                                }),
                              },
                            )
                          }
                        >
                          {t("common.delete")}
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ConfirmDialog {...deleteDialog.dialogProps} />
      {canWrite && <GroupDialog open={newOpen} onOpenChange={setNewOpen} />}
    </div>
  );
}

/** The group page's header actions: edit the description / kind. */
export function GroupHeaderActions({
  group,
  canWrite,
}: {
  group: { id: string; description: string; kind: ExpenseGroupKind; hasTrip: boolean };
  canWrite: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!canWrite) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="edit-group">
        {t("expenses.group.edit")}
      </Button>
      {open && <GroupDialog open onOpenChange={setOpen} group={group} />}
    </>
  );
}
