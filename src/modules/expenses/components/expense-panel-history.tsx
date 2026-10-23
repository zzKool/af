"use client";

// The History of the expense panel (D40, collapsed by default): one line per audited write, newest first —
// when, created / updated, and the fields an update changed, named with the labels the form already uses.
import { useT } from "@/kernel/i18n/use-t";
import { Tag } from "@/kernel/ui/tags";
import type { HistoryField } from "@/modules/expenses/history";
import type { ExpensePanelDetail } from "./expense-panel-shared";

/** `2026-10-23 14:05` in the viewer's time zone — dates stay yyyy-mm-dd (D40). */
export function localStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ExpenseHistoryList({ detail }: { detail: ExpensePanelDetail }) {
  const t = useT();
  const label: Record<HistoryField, string> = {
    date: t("expenses.form.date"),
    description: t("expenses.form.descriptionField"),
    basCode: t("expenses.form.category"),
    amount: t("expenses.form.amount"),
    currency: t("expenses.form.currency"),
    vatAmount: t("expenses.col.vat"),
    paymentSourceId: t("expenses.form.paidBy"),
    paidAmount: t("expenses.col.paid"),
    documentMissing: t("expenses.form.documentMissing"),
    partnerId: t("expenses.partner"),
    note: t("expenses.form.note"),
  };
  if (detail.history.length === 0) return <p className="text-[13px] text-muted-foreground">—</p>;
  return (
    <ol className="flex flex-col gap-1.5 text-[13px]" data-testid="expense-history">
      {detail.history.map((h) => (
        <li key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-muted-foreground tabular-nums">{localStamp(h.at)}</span>
          <span>{t(`dashboard.briefing.action.${h.action}`)}</span>
          {h.fields.map((f) => (
            <Tag key={f}>{label[f]}</Tag>
          ))}
        </li>
      ))}
    </ol>
  );
}
