"use client";

// The money section of the expense panel: the SEK base line, then the money form while the expense is open
// (amount, currency, date, paid by — saved on *Save*) or the locked read-out. `children` is the bank-row block.
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/kernel/i18n/use-t";
import { formatCurrency } from "@/kernel/money/format-currency";
import { CURRENCIES } from "@/kernel/nav/constants";
import type { SourceOption } from "@/modules/expenses/types";
import { type ExpensePanelDetail, money, type SaveExpense } from "./expense-panel-shared";

export function ExpenseMoneySection({
  detail,
  sources,
  canWrite,
  isOpen,
  save,
  saving,
  children,
}: {
  detail: ExpensePanelDetail;
  sources: SourceOption[];
  canWrite: boolean;
  /** no active settlement and no bank row attached */
  isOpen: boolean;
  save: SaveExpense;
  saving: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  const ids = useId();
  const e = detail.expense;

  // the form is put back to the saved values on every reload of the panel
  const fromDetail = () => ({
    amount: e.amount,
    currency: e.currency as string,
    date: e.date,
    sourceId: e.paymentSourceId,
  });
  const [form, setForm] = useState(fromDetail);
  const [loaded, setLoaded] = useState(detail);
  if (loaded !== detail) {
    setLoaded(detail);
    setForm(fromDetail());
  }
  const set = (patch: Partial<ReturnType<typeof fromDetail>>) =>
    setForm((f) => ({ ...f, ...patch }));

  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">{t("expenses.panel.money")}</h3>
      <p className="mb-2 text-xs text-muted-foreground tabular-nums">
        {t("expenses.panel.base", {
          base: formatCurrency(e.amountBase, "SEK"),
          rate: e.rate,
          source:
            e.rateSource === "bank"
              ? t("expenses.rateSource.bank")
              : t(`journal.rateSource.${e.rateSource}`),
        })}
        {e.baseProvisional ? ` · ${t("expenses.panel.provisional")}` : ""}
        {e.paidAmount
          ? ` · ${t("expenses.panel.paid", { amount: money(e.paidAmount, e.paidCurrency ?? "SEK") })}`
          : ""}
      </p>
      {canWrite && isOpen ? (
        <form
          className="grid grid-cols-2 gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            void save({
              amount: form.amount.trim(),
              currency: form.currency as (typeof CURRENCIES)[number],
              date: form.date,
              paymentSourceId: form.sourceId,
            });
          }}
        >
          <div>
            <label htmlFor={`${ids}-amount`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.amount")}
            </label>
            <Input
              id={`${ids}-amount`}
              inputMode="decimal"
              value={form.amount}
              onChange={(ev) => set({ amount: ev.target.value })}
            />
          </div>
          <div>
            <label htmlFor={`${ids}-ccy`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.currency")}
            </label>
            <Select value={form.currency} onValueChange={(v) => v && set({ currency: v })}>
              <SelectTrigger id={`${ids}-ccy`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor={`${ids}-date`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.date")}
            </label>
            <Input
              id={`${ids}-date`}
              type="date"
              value={form.date}
              onChange={(ev) => set({ date: ev.target.value })}
            />
          </div>
          <div>
            <label htmlFor={`${ids}-src`} className="mb-1 block text-xs font-medium">
              {t("expenses.form.paidBy")}
            </label>
            <Select value={form.sourceId} onValueChange={(v) => v && set({ sourceId: v })}>
              <SelectTrigger id={`${ids}-src`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem
                    key={s.id}
                    value={s.id}
                    disabled={!s.isActive && s.id !== form.sourceId}
                  >
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex justify-end">
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={saving}
              data-testid="save-money"
            >
              {t("expenses.panel.save")}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t("expenses.form.date")}</dt>
          <dd>{e.date}</dd>
          <dt className="text-muted-foreground">{t("expenses.form.paidBy")}</dt>
          <dd>{detail.paymentSource.label}</dd>
          {canWrite && !isOpen && (
            <dd className="col-span-2 text-xs text-muted-foreground">
              {t("expenses.panel.moneyLocked")}
            </dd>
          )}
        </dl>
      )}
      {children}
    </section>
  );
}
