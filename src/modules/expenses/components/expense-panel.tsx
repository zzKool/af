"use client";

// The side panel of one expense: the facts (saved on change), the money (editable while open), the document,
// the links, the settlements it took part in, attach / detach the bank row (company-paid), delete.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatCurrency } from "@/kernel/money/format-currency";
import { CURRENCIES, type Currency } from "@/kernel/nav/constants";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";
import {
  attachBankTransactionAction,
  deleteExpenseAction,
  detachBankTransactionAction,
  getExpenseAction,
  updateExpenseAction,
} from "@/modules/expenses/expenses.actions";
import type { ExpenseDetail } from "@/modules/expenses/queries";
import type { CategoryOption, SourceOption, TransactionOption } from "@/modules/expenses/types";
import { StatusBadge } from "./status-badge";

type Detail = Omit<ExpenseDetail, "expense" | "group" | "links"> & {
  expense: Omit<ExpenseDetail["expense"], "createdAt" | "updatedAt"> & {
    createdAt: string;
    updatedAt: string;
  };
  group: Omit<ExpenseDetail["group"], "createdAt" | "updatedAt"> & {
    createdAt: string;
    updatedAt: string;
  };
  links: (Omit<ExpenseDetail["links"][number], "createdAt"> & { createdAt: string })[];
};

const money = (amount: string, currency: string) =>
  `${formatCurrency(amount, currency as Currency)} ${currency}`;
const NONE = "__none__";

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
  const ids = useId();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [attachId, setAttachId] = useState(NONE);
  const { executeAsync: load } = useAction(getExpenseAction);
  const { executeAsync: update, isPending: saving } = useAction(updateExpenseAction);
  const { executeAsync: attach, isPending: attaching } = useAction(attachBankTransactionAction);
  const { executeAsync: detach, isPending: detaching } = useAction(detachBankTransactionAction);
  const { executeAsync: remove } = useAction(deleteExpenseAction);
  const deleteDialog = useConfirmDialog({
    title: t("expenses.panel.delete"),
    variant: "destructive",
    confirmLabel: t("common.delete"),
  });

  // money fields (editable while open)
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("SEK");
  const [date, setDate] = useState("");
  const [sourceId, setSourceId] = useState("");
  // facts
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");

  const reload = useCallback(async () => {
    if (!expenseId) return;
    const r = await load({ id: expenseId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (d) {
      const detail = d as unknown as Detail;
      setDetail(detail);
      setAmount(detail.expense.amount);
      setCurrency(detail.expense.currency);
      setDate(detail.expense.date);
      setSourceId(detail.expense.paymentSourceId);
      setDescription(detail.expense.description);
      setNote(detail.expense.note ?? "");
    }
  }, [expenseId, load]);

  useEffect(() => {
    setDetail(null);
    setAttachId(NONE);
    void reload();
  }, [reload]);

  function changed() {
    void reload();
    onChanged?.();
    router.refresh();
  }

  async function save(patch: Parameters<typeof update>[0]["data"]) {
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

  async function attachRow() {
    if (!detail || attachId === NONE) return;
    const r = await attach({ expenseId: detail.expense.id, bankTransactionId: attachId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("expenses.panel.attached"));
    setAttachId(NONE);
    changed();
  }

  async function detachRow() {
    if (!detail) return;
    const r = await detach({ expenseId: detail.expense.id });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("expenses.panel.detached"));
    changed();
  }

  const e = detail?.expense;
  const isOpen =
    !!detail && detail.settlements.every((s) => s.status !== "active") && !e?.paidAmount;
  const companyPaid = detail?.paymentSource.kind === "bank_account";
  const attachable = transactions.filter(
    (tx) =>
      tx.bankAccountId === sources.find((s) => s.id === detail?.paymentSource.id)?.bankAccountId,
  );

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
                      amount: amount.trim(),
                      currency: currency as (typeof CURRENCIES)[number],
                      date,
                      paymentSourceId: sourceId,
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
                      value={amount}
                      onChange={(ev) => setAmount(ev.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${ids}-ccy`} className="mb-1 block text-xs font-medium">
                      {t("expenses.form.currency")}
                    </label>
                    <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
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
                      value={date}
                      onChange={(ev) => setDate(ev.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${ids}-src`} className="mb-1 block text-xs font-medium">
                      {t("expenses.form.paidBy")}
                    </label>
                    <Select value={sourceId} onValueChange={(v) => v && setSourceId(v)}>
                      <SelectTrigger id={`${ids}-src`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sources.map((s) => (
                          <SelectItem
                            key={s.id}
                            value={s.id}
                            disabled={!s.isActive && s.id !== sourceId}
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
              {canWrite && companyPaid && (
                <div className="mt-3 flex flex-wrap items-end gap-2" data-testid="attach-row">
                  {e.paidAmount ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void detachRow()}
                      disabled={detaching}
                      data-testid="detach-bank-row"
                    >
                      {t("expenses.panel.detach")}
                    </Button>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <label htmlFor={`${ids}-attach`} className="mb-1 block text-xs font-medium">
                          {t("expenses.panel.attachPick")}
                        </label>
                        <Select value={attachId} onValueChange={(v) => setAttachId(v ?? NONE)}>
                          <SelectTrigger id={`${ids}-attach`} className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>—</SelectItem>
                            {attachable.map((tx) => (
                              <SelectItem key={tx.id} value={tx.id}>
                                {tx.bookingDate} · {money(tx.amount, tx.currency)} ·{" "}
                                {tx.description}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => void attachRow()}
                        disabled={attaching || attachId === NONE}
                        data-testid="attach-bank-row"
                      >
                        {t("expenses.panel.attach")}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">{t("expenses.panel.facts")}</h3>
              {canWrite ? (
                <div className="grid gap-3" data-testid="facts-form">
                  <div>
                    <label htmlFor={`${ids}-desc`} className="mb-1 block text-xs font-medium">
                      {t("expenses.form.descriptionField")}
                    </label>
                    <Input
                      id={`${ids}-desc`}
                      value={description}
                      onChange={(ev) => setDescription(ev.target.value)}
                      onBlur={() => {
                        if (description.trim() && description.trim() !== e.description)
                          void save({ description: description.trim() });
                      }}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${ids}-cat`} className="mb-1 block text-xs font-medium">
                      {t("expenses.form.category")}
                    </label>
                    <Select
                      value={e.basCode}
                      onValueChange={(v) => v && v !== e.basCode && void save({ basCode: v })}
                      disabled={saving}
                    >
                      <SelectTrigger id={`${ids}-cat`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(categories.some((c) => c.code === e.basCode)
                          ? categories
                          : [{ code: e.basCode, label: detail.basLabel }, ...categories]
                        ).map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("expenses.form.aliasWarning")}
                    </p>
                  </div>
                  <div>
                    <label htmlFor={`${ids}-note`} className="mb-1 block text-xs font-medium">
                      {t("expenses.form.note")}
                    </label>
                    <Input
                      id={`${ids}-note`}
                      value={note}
                      onChange={(ev) => setNote(ev.target.value)}
                      onBlur={() => {
                        if ((note.trim() || null) !== (e.note ?? null))
                          void save({ note: note.trim() || null });
                      }}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`${ids}-missing`}
                      checked={e.documentMissing}
                      onCheckedChange={(c) => void save({ documentMissing: c === true })}
                      disabled={saving}
                      aria-label={t("expenses.form.documentMissing")}
                    />
                    <span>{t("expenses.form.documentMissing")}</span>
                  </label>
                </div>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">{t("expenses.form.descriptionField")}</dt>
                  <dd>{e.description}</dd>
                  <dt className="text-muted-foreground">{t("expenses.form.note")}</dt>
                  <dd>{e.note ?? "—"}</dd>
                </dl>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">{t("expenses.panel.document")}</h3>
              {detail.document ? (
                <p className="text-sm">
                  <Link
                    href={`/documents/${detail.document.id}`}
                    className="font-mono text-xs hover:underline"
                  >
                    {detail.document.fileName}
                  </Link>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {e.documentMissing
                    ? t("expenses.document.missing")
                    : t("expenses.form.noDocument")}
                </p>
              )}
            </section>

            {detail.settlements.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-medium">{t("expenses.panel.settlements")}</h3>
                <ul className="divide-y rounded-md border text-sm">
                  {detail.settlements.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span>
                        <Link
                          href={`/expenses/settlements`}
                          className="font-mono text-xs hover:underline"
                        >
                          {s.number}
                        </Link>
                        {s.bookingDate ? ` · ${s.bookingDate}` : ""}
                        {s.status === "cancelled"
                          ? ` · ${t("expenses.settlements.status.cancelled")}`
                          : ""}
                      </span>
                      <span className="tabular-nums">
                        {formatCurrency(s.allocatedBase, "SEK")} SEK
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-sm font-medium">{t("expenses.panel.links")}</h3>
              {detail.links.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("expenses.panel.noLinks")}</p>
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {detail.links.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span className="truncate">
                        <Badge variant="outline" className="mr-2">
                          {l.kind}
                        </Badge>
                        {l.otherLabel ?? `${l.to.type} ${l.to.id}`}
                      </span>
                      {l.allocatedAmount && (
                        <span className="shrink-0 tabular-nums">
                          {money(l.allocatedAmount, l.currency ?? e.currency)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {canWrite && isOpen && detail.links.length === 0 && (
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
