"use client";

// The side panel of one expense (D40 details panel): loads the detail and saves patches. The title line — key,
// amount, state — then About (group, date, category, payer, the base and the bank's amount) · Proof (the receipt,
// the bank row of a company-paid expense, the settlements, the links) · Money (editable while open) · Facts ·
// History (collapsed); the panel ends with delete.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import type { ReactNode } from "react";
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
import { formatMoney } from "@/kernel/money/format-money";
import { DetailsGrid, DetailsSection } from "@/kernel/ui/details-section";
import { CodeChip, Tag } from "@/kernel/ui/tags";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  deleteExpenseAction,
  getExpenseAction,
  updateExpenseAction,
} from "@/modules/expenses/expenses.actions";
import type { CategoryOption, SourceOption, TransactionOption } from "@/modules/expenses/types";
import { ExpenseDocumentAttach } from "./expense-panel-document";
import { ExpenseDocumentLine, ExpenseFactsSection } from "./expense-panel-facts";
import { ExpenseHistoryList } from "./expense-panel-history";
import { ExpenseLinksList } from "./expense-panel-links";
import { ExpenseMoneySection } from "./expense-panel-money";
import { ExpenseAttachRow, ExpenseSettlementsList } from "./expense-panel-payments";
import { type ExpensePanelDetail, type ExpensePatch, money } from "./expense-panel-shared";
import { ExpenseStateLabel } from "./expense-state";

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
    if (d) setDetail(d);
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
                <span
                  className="text-[22px] leading-7 font-semibold tabular-nums"
                  data-testid="panel-amount"
                >
                  {money(e.amount, e.currency)}
                </span>
                <ExpenseStateLabel status={detail.status} testId="panel-status" />
                {detail.document?.reverseCharge && (
                  <span data-testid="panel-reverse-charge" className="inline-flex">
                    <Tag>{t("common.reverseCharge")}</Tag>
                  </span>
                )}
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-1.5">
                <span data-testid="panel-key" className="inline-flex">
                  <CodeChip>{e.key}</CodeChip>
                </span>
                <span className="min-w-0 break-words text-foreground">{e.description}</span>
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col">
              <DetailsSection title={t("details.about")}>
                <DetailsGrid rows={aboutRows(detail, t)} />
              </DetailsSection>

              <DetailsSection title={t("details.proof")}>
                <div className="flex flex-col gap-3">
                  <ExpenseDocumentLine detail={detail} />
                  <ExpenseDocumentAttach detail={detail} canWrite={canWrite} onChanged={changed} />
                  <ExpenseAttachRow
                    detail={detail}
                    sources={sources}
                    transactions={transactions}
                    canWrite={canWrite}
                    onChanged={changed}
                  />
                  <ExpenseSettlementsList detail={detail} />
                  <ExpenseLinksList detail={detail} />
                </div>
              </DetailsSection>

              {canWrite && (
                <DetailsSection title={t("expenses.panel.money")}>
                  <ExpenseMoneySection
                    detail={detail}
                    sources={sources}
                    canWrite={canWrite}
                    isOpen={isOpen}
                    save={save}
                    saving={saving}
                  />
                </DetailsSection>
              )}

              <DetailsSection title={t("expenses.panel.facts")}>
                <ExpenseFactsSection
                  detail={detail}
                  categories={categories}
                  canWrite={canWrite}
                  save={save}
                  saving={saving}
                />
              </DetailsSection>

              <DetailsSection title={t("details.history")} defaultOpen={false}>
                <ExpenseHistoryList detail={detail} />
              </DetailsSection>
            </div>

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

type T = ReturnType<typeof useT>;

/** About this expense: where it sits, who paid, and its money facts as written (the base, the rate, the bank). */
function aboutRows(detail: ExpensePanelDetail, t: T): [ReactNode, ReactNode][] {
  const e = detail.expense;
  const rateSource =
    e.rateSource === "bank"
      ? t("expenses.rateSource.bank")
      : t(`journal.rateSource.${e.rateSource}`);
  const rows: [ReactNode, ReactNode][] = [
    [
      t("expenses.col.group"),
      <Link
        key="group"
        href={`/expenses/groups/${e.groupId}`}
        className="text-primary hover:underline"
      >
        {detail.groupLabel}
      </Link>,
    ],
    [
      t("expenses.form.date"),
      <span key="date" className="tabular-nums">
        {e.date}
      </span>,
    ],
    [t("expenses.form.kind"), <Tag key="kind">{t(`expenses.kind.${e.kind}`)}</Tag>],
    [t("expenses.form.category"), detail.basLabel],
    [
      t("expenses.partner"),
      detail.partner ? (
        <Link
          key="partner"
          href={`/partners/${detail.partner.id}`}
          className={
            detail.partner.isActive ? "text-primary hover:underline" : "text-muted-foreground"
          }
          data-testid="panel-partner"
        >
          {detail.partner.isActive
            ? detail.partner.name
            : t("expenses.partnerInactive", { name: detail.partner.name })}
        </Link>
      ) : (
        <span key="partner" className="text-muted-foreground">
          {t("expenses.partnerNone")}
        </span>
      ),
    ],
    [t("expenses.form.paidBy"), <Tag key="payer">{detail.paymentSource.label}</Tag>],
    [
      t("expenses.col.amountBase"),
      <span key="base" className="tabular-nums" data-testid="panel-base">
        {t("expenses.panel.base", {
          base: formatMoney(e.amountBase, "SEK", { bare: true }),
          rate: e.rate,
          source: rateSource,
        })}
        {e.baseProvisional ? ` · ${t("expenses.panel.provisional")}` : ""}
      </span>,
    ],
  ];
  if (e.paidAmount)
    rows.push([
      t("expenses.col.paid"),
      <span key="paid" className="tabular-nums">
        {money(e.paidAmount, e.paidCurrency ?? "SEK")}
      </span>,
    ]);
  if (detail.paymentSource.kind === "private")
    rows.push(
      [
        t("expenses.col.allocated"),
        <span key="alloc" className="tabular-nums">
          {formatMoney(detail.allocatedBase, "SEK")}
        </span>,
      ],
      [
        t("expenses.col.open"),
        <span key="open" className="tabular-nums">
          {formatMoney(detail.openBase, "SEK")}
        </span>,
      ],
    );
  if (e.vatAmount)
    rows.push([
      t("expenses.col.vat"),
      <span key="vat" className="tabular-nums">
        {money(e.vatAmount, e.currency)}
      </span>,
    ]);
  return rows;
}
