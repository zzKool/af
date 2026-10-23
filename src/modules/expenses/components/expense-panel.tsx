"use client";

// The side panel of one expense: loads the detail and saves patches; the sections render it —
// money (editable while open) with the bank row (company-paid) · facts and document · settlements · links —
// and the panel ends with delete.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
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
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  deleteExpenseAction,
  getExpenseAction,
  updateExpenseAction,
} from "@/modules/expenses/expenses.actions";
import type { CategoryOption, SourceOption, TransactionOption } from "@/modules/expenses/types";
import { ExpenseDocumentSection, ExpenseFactsSection } from "./expense-panel-facts";
import { ExpenseLinksSection } from "./expense-panel-links";
import { ExpenseMoneySection } from "./expense-panel-money";
import { ExpenseAttachRow, ExpenseSettlementsSection } from "./expense-panel-payments";
import { type ExpensePanelDetail, type ExpensePatch, money } from "./expense-panel-shared";
import { StatusBadge } from "./status-badge";

export function ExpensePanel({
  expenseId,
  onClose,
  categories,
  sources,
  transactions,
  canWrite,
  onChanged,
}: {
  expenseId: string | null;
  onClose: () => void;
  categories: CategoryOption[];
  sources: SourceOption[];
  /** outgoing rows not settling anything — the attach picker filters them on the payer's account */
  transactions: TransactionOption[];
  canWrite: boolean;
  onChanged?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [detail, setDetail] = useState<ExpensePanelDetail | null>(null);
  const { executeAsync: load } = useAction(getExpenseAction);
  const { executeAsync: update, isPending: saving } = useAction(updateExpenseAction);
  const { executeAsync: remove } = useAction(deleteExpenseAction);
  const deleteDialog = useConfirmDialog({
    title: t("expenses.panel.delete"),
    variant: "destructive",
    confirmLabel: t("common.delete"),
  });

  const reload = useCallback(async () => {
    if (!expenseId) return;
    const r = await load({ id: expenseId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (d) setDetail(d as unknown as ExpensePanelDetail);
  }, [expenseId, load]);

  useEffect(() => {
    setDetail(null);
    void reload();
  }, [reload]);

  function changed() {
    void reload();
    onChanged?.();
    router.refresh();
  }

  async function save(patch: ExpensePatch) {
    if (!detail) return;
    const r = await update({ id: detail.expense.id, data: patch });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      void reload();
      return;
    }
    toast.success(t("expenses.panel.saved"));
    changed();
  }

  const e = detail?.expense;
  const isOpen = !!detail?.isOpen;

  return (
    <Sheet open={!!expenseId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent data-testid="expense-panel">
        {e && detail ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono" data-testid="panel-key">
                  {e.key}
                </span>
                <span className="tabular-nums" data-testid="panel-amount">
                  {money(e.amount, e.currency)}
                </span>
                <StatusBadge status={detail.status} testId="panel-status" />
              </SheetTitle>
              <SheetDescription>
                <Link href={`/expenses/groups/${e.groupId}`} className="hover:underline">
                  {detail.groupLabel}
                </Link>{" "}
                · {t(`expenses.kind.${e.kind}`)} · {detail.basLabel}
              </SheetDescription>
            </SheetHeader>

            <ExpenseMoneySection
              detail={detail}
              sources={sources}
              canWrite={canWrite}
              isOpen={isOpen}
              save={save}
              saving={saving}
            >
              <ExpenseAttachRow
                detail={detail}
                sources={sources}
                transactions={transactions}
                canWrite={canWrite}
                onChanged={changed}
              />
            </ExpenseMoneySection>
            <ExpenseFactsSection
              detail={detail}
              categories={categories}
              canWrite={canWrite}
              save={save}
              saving={saving}
            />
            <ExpenseDocumentSection detail={detail} />
            <ExpenseSettlementsSection detail={detail} />
            <ExpenseLinksSection detail={detail} />

            {canWrite && isOpen && detail.links.every((l) => l.kind === "created_from") && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="destructive"
                  data-testid="delete-expense"
                  onClick={() =>
                    deleteDialog.confirm(
                      async () => {
                        const r = await remove({ id: e.id });
                        const error = extractError(r);
                        if (error) throw new Error(error);
                        toast.success(t("expenses.panel.deleted"));
                        onClose();
                        onChanged?.();
                        router.refresh();
                      },
                      { description: t("expenses.panel.deleteConfirm", { key: e.key }) },
                    )
                  }
                >
                  {t("expenses.panel.delete")}
                </Button>
              </div>
            )}
            <ConfirmDialog {...deleteDialog.dialogProps} />
          </>
        ) : (
          <SheetHeader>
            <SheetTitle>…</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
