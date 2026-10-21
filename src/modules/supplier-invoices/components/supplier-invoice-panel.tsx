"use client";

// The side panel of one supplier invoice: the facts (saved on change), the money (editable while unpaid and
// unlinked), the payments with *Link payment* (rows of the invoice currency first; another currency attaches the
// row the D-g way), the document, the lines, the links, cancel / uncancel, delete.
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
import { GraphLink } from "@/modules/linking/ui";
import type {
  PayableTransaction,
  SupplierInvoiceDetail,
} from "@/modules/supplier-invoices/queries";
import {
  attachSupplierPaymentAction,
  cancelSupplierInvoiceAction,
  deleteSupplierInvoiceAction,
  detachSupplierPaymentAction,
  getSupplierInvoiceAction,
  payableTransactionsAction,
  recordSupplierPaymentAction,
  removeSupplierPaymentAction,
  uncancelSupplierInvoiceAction,
  updateSupplierInvoiceAction,
} from "@/modules/supplier-invoices/supplier-invoices.actions";
import type {
  CategoryOption,
  RegistrationOption,
  SupplierOption,
} from "@/modules/supplier-invoices/types";
import { SupplierInvoiceStatusBadge } from "./status-badge";

type Detail = Omit<SupplierInvoiceDetail, "invoice" | "links"> & {
  invoice: Omit<SupplierInvoiceDetail["invoice"], "createdAt" | "updatedAt" | "cancelledAt"> & {
    createdAt: string;
    updatedAt: string;
    cancelledAt: string | null;
  };
  links: (Omit<SupplierInvoiceDetail["links"][number], "createdAt"> & { createdAt: string })[];
};

const money = (amount: string, currency: string) =>
  `${formatCurrency(amount, currency as Currency)} ${currency}`;
const NONE = "__none__";

export function SupplierInvoicePanel({
  invoiceId,
  onClose,
  categories,
  suppliers,
  registrations,
  canWrite,
  onChanged,
}: {
  invoiceId: string | null;
  onClose: () => void;
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  registrations: RegistrationOption[];
  canWrite: boolean;
  onChanged?: () => void;
}) {
  const t = useT();
  const ids = useId();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [payable, setPayable] = useState<PayableTransaction[]>([]);
  const [payId, setPayId] = useState(NONE);
  const [payAmount, setPayAmount] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const { executeAsync: load } = useAction(getSupplierInvoiceAction);
  const { executeAsync: loadPayable } = useAction(payableTransactionsAction);
  const { executeAsync: update, isPending: saving } = useAction(updateSupplierInvoiceAction);
  const { executeAsync: record, isPending: recording } = useAction(recordSupplierPaymentAction);
  const { executeAsync: attach, isPending: attaching } = useAction(attachSupplierPaymentAction);
  const { executeAsync: removePay } = useAction(removeSupplierPaymentAction);
  const { executeAsync: detach, isPending: detaching } = useAction(detachSupplierPaymentAction);
  const { executeAsync: cancel, isPending: cancelling } = useAction(cancelSupplierInvoiceAction);
  const { executeAsync: uncancel } = useAction(uncancelSupplierInvoiceAction);
  const { executeAsync: remove } = useAction(deleteSupplierInvoiceAction);
  const deleteDialog = useConfirmDialog({
    title: t("supplierInvoices.panel.delete"),
    variant: "destructive",
    confirmLabel: t("common.delete"),
  });
  const cancelDialog = useConfirmDialog({
    title: t("supplierInvoices.panel.cancel"),
    variant: "destructive",
    confirmLabel: t("supplierInvoices.panel.cancel"),
  });

  // money fields (editable while open)
  const [partnerId, setPartnerId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState("SEK");
  const [amountNet, setAmountNet] = useState("");
  const [vatAmount, setVatAmount] = useState("");
  const [amountTotal, setAmountTotal] = useState("");
  // facts
  const [note, setNote] = useState("");

  const reload = useCallback(async () => {
    if (!invoiceId) return;
    const r = await load({ id: invoiceId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (d) {
      const detail = d as unknown as Detail;
      setDetail(detail);
      setPartnerId(detail.invoice.partnerId);
      setInvoiceNumber(detail.invoice.invoiceNumber);
      setInvoiceDate(detail.invoice.invoiceDate);
      setDueDate(detail.invoice.dueDate);
      setCurrency(detail.invoice.currency);
      setAmountNet(detail.invoice.amountNet);
      setVatAmount(detail.invoice.vatAmount);
      setAmountTotal(detail.invoice.amountTotal);
      setNote(detail.invoice.note ?? "");
      if (!detail.invoice.cancelled && detail.open !== "0.00") {
        const p = await loadPayable({ currency: detail.linkCurrency });
        const rows = p?.data && "data" in p.data ? p.data.data : [];
        setPayable(rows ?? []);
      } else {
        setPayable([]);
      }
    }
  }, [invoiceId, load, loadPayable]);

  useEffect(() => {
    setDetail(null);
    setPayId(NONE);
    setPayAmount("");
    setCancelReason("");
    void reload();
  }, [reload]);

  function changed() {
    void reload();
    onChanged?.();
    router.refresh();
  }

  async function save(patch: Parameters<typeof update>[0]["data"]) {
    if (!detail) return;
    const r = await update({ id: detail.invoice.id, data: patch });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      void reload();
      return;
    }
    toast.success(t("supplierInvoices.panel.saved"));
    changed();
  }

  async function linkPayment() {
    if (!detail || payId === NONE) return;
    const row = payable.find((p) => p.id === payId);
    if (!row) return;
    const r =
      row.currency === detail.linkCurrency
        ? await record({
            invoiceId: detail.invoice.id,
            bankTransactionId: payId,
            amount: payAmount.trim() || undefined,
          })
        : await attach({ invoiceId: detail.invoice.id, bankTransactionId: payId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("supplierInvoices.panel.paymentLinked"));
    setPayId(NONE);
    setPayAmount("");
    changed();
  }

  async function unlinkPayment(linkId: string) {
    if (!detail) return;
    const r = detail.invoice.paidAmount
      ? await detach({ invoiceId: detail.invoice.id })
      : await removePay({ invoiceId: detail.invoice.id, linkId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("supplierInvoices.panel.paymentRemoved"));
    changed();
  }

  const si = detail?.invoice;
  const editable = !!detail?.editable && canWrite;
  const selectedRow = payable.find((p) => p.id === payId);
  const crossCurrency = !!selectedRow && !!detail && selectedRow.currency !== detail.linkCurrency;

  return (
    <Sheet open={!!invoiceId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent data-testid="supplier-invoice-panel">
        {si && detail ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono" data-testid="panel-key">
                  {si.key}
                </span>
                <span className="tabular-nums" data-testid="panel-amount">
                  {money(si.amountTotal, si.currency)}
                </span>
                <SupplierInvoiceStatusBadge
                  status={detail.status}
                  daysOverdue={detail.daysOverdue}
                  testId="panel-status"
                />
              </SheetTitle>
              <SheetDescription>
                {detail.partnerName} · {si.invoiceNumber} ·{" "}
                <Link href={`/expenses/groups/${si.groupId}`} className="hover:underline">
                  {detail.groupLabel}
                </Link>{" "}
                · {detail.basLabel}
              </SheetDescription>
            </SheetHeader>

            <section>
              <h3 className="mb-2 text-sm font-medium">{t("supplierInvoices.panel.money")}</h3>
              <p className="mb-2 text-xs text-muted-foreground tabular-nums">
                {t("supplierInvoices.panel.base", {
                  base: formatCurrency(si.amountBase, "SEK"),
                  rate: si.rate,
                  source:
                    si.rateSource === "bank"
                      ? t("expenses.rateSource.bank")
                      : t(`journal.rateSource.${si.rateSource}`),
                })}
                {si.paidAmount
                  ? ` · ${t("supplierInvoices.panel.paidBy", { amount: money(si.paidAmount, si.paidCurrency ?? "SEK") })}`
                  : ""}
                {` · ${t("supplierInvoices.panel.open", { amount: money(detail.open, detail.linkCurrency) })}`}
              </p>
              {editable ? (
                <form
                  className="grid grid-cols-2 gap-2"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    void save({
                      partnerId,
                      invoiceNumber: invoiceNumber.trim(),
                      invoiceDate,
                      dueDate,
                      currency: currency as (typeof CURRENCIES)[number],
                      amountNet: amountNet.trim(),
                      vatAmount: vatAmount.trim() || "0",
                      amountTotal: amountTotal.trim(),
                    });
                  }}
                >
                  <div className="col-span-2">
                    <label htmlFor={`${ids}-supplier`} className="mb-1 block text-xs font-medium">
                      {t("supplierInvoices.form.supplier")}
                    </label>
                    <Select value={partnerId} onValueChange={(v) => v && setPartnerId(v)}>
                      <SelectTrigger id={`${ids}-supplier`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(suppliers.some((s) => s.id === partnerId)
                          ? suppliers
                          : [
                              { id: partnerId, name: detail.partnerName } as SupplierOption,
                              ...suppliers,
                            ]
                        ).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label htmlFor={`${ids}-number`} className="mb-1 block text-xs font-medium">
                      {t("supplierInvoices.form.number")}
                    </label>
                    <Input
                      id={`${ids}-number`}
                      value={invoiceNumber}
                      onChange={(ev) => setInvoiceNumber(ev.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${ids}-ccy`} className="mb-1 block text-xs font-medium">
                      {t("supplierInvoices.form.currency")}
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
                      {t("supplierInvoices.form.invoiceDate")}
                    </label>
                    <Input
                      id={`${ids}-date`}
                      type="date"
                      value={invoiceDate}
                      onChange={(ev) => setInvoiceDate(ev.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${ids}-due`} className="mb-1 block text-xs font-medium">
                      {t("supplierInvoices.form.dueDate")}
                    </label>
                    <Input
                      id={`${ids}-due`}
                      type="date"
                      value={dueDate}
                      onChange={(ev) => setDueDate(ev.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${ids}-net`} className="mb-1 block text-xs font-medium">
                      {t("supplierInvoices.form.net")}
                    </label>
                    <Input
                      id={`${ids}-net`}
                      inputMode="decimal"
                      value={amountNet}
                      onChange={(ev) => setAmountNet(ev.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${ids}-vat`} className="mb-1 block text-xs font-medium">
                      {t("supplierInvoices.form.vat")}
                    </label>
                    <Input
                      id={`${ids}-vat`}
                      inputMode="decimal"
                      value={vatAmount}
                      onChange={(ev) => setVatAmount(ev.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${ids}-total`} className="mb-1 block text-xs font-medium">
                      {t("supplierInvoices.form.total")}
                    </label>
                    <Input
                      id={`${ids}-total`}
                      inputMode="decimal"
                      value={amountTotal}
                      onChange={(ev) => setAmountTotal(ev.target.value)}
                    />
                  </div>
                  <div className="flex items-end justify-end">
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      data-testid="save-money"
                    >
                      {t("supplierInvoices.panel.save")}
                    </Button>
                  </div>
                </form>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">
                    {t("supplierInvoices.form.invoiceDate")}
                  </dt>
                  <dd>{si.invoiceDate}</dd>
                  <dt className="text-muted-foreground">{t("supplierInvoices.form.dueDate")}</dt>
                  <dd>
                    {si.dueDate}
                    {si.dueDateDefaulted ? ` · ${t("supplierInvoices.panel.dueDefaulted")}` : ""}
                  </dd>
                  <dt className="text-muted-foreground">{t("supplierInvoices.form.net")}</dt>
                  <dd className="tabular-nums">{money(si.amountNet, si.currency)}</dd>
                  <dt className="text-muted-foreground">{t("supplierInvoices.form.vat")}</dt>
                  <dd className="tabular-nums">{money(si.vatAmount, si.currency)}</dd>
                  {canWrite && !si.cancelled && (
                    <dd className="col-span-2 text-xs text-muted-foreground">
                      {t("supplierInvoices.panel.moneyLocked")}
                    </dd>
                  )}
                </dl>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">{t("supplierInvoices.panel.payments")}</h3>
              {detail.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("supplierInvoices.panel.noPayments")}
                </p>
              ) : (
                <ul className="divide-y rounded-md border text-sm" data-testid="payments">
                  {detail.payments.map((p) => (
                    <li
                      key={p.linkId}
                      className="flex items-center justify-between gap-2 px-3 py-1.5"
                    >
                      <span className="min-w-0 truncate">
                        {p.bookingDate ?? "?"} · {p.accountLabel ?? ""}
                        {p.rowAmount ? ` · ${money(p.rowAmount, p.rowCurrency ?? p.currency)}` : ""}
                        {p.note ? (
                          <span className="ml-1 text-xs text-muted-foreground">({p.note})</span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums">{money(p.allocated, p.currency)}</span>
                        {canWrite && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void unlinkPayment(p.linkId)}
                            disabled={detaching}
                            data-testid="remove-payment"
                          >
                            {t("supplierInvoices.panel.removePayment")}
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {canWrite && !si.cancelled && detail.open !== "0.00" && !si.paidAmount && (
                <div className="mt-3 grid gap-2" data-testid="link-payment">
                  <div>
                    <label htmlFor={`${ids}-pay`} className="mb-1 block text-xs font-medium">
                      {t("supplierInvoices.panel.pickRow")}
                    </label>
                    <Select value={payId} onValueChange={(v) => setPayId(v ?? NONE)}>
                      <SelectTrigger id={`${ids}-pay`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>—</SelectItem>
                        {payable.map((tx) => (
                          <SelectItem key={tx.id} value={tx.id}>
                            {tx.bookingDate} · {money(tx.amount, tx.currency)}
                            {tx.remaining !== tx.amount.replace("-", "")
                              ? ` (${money(tx.remaining, tx.currency)} ${t("supplierInvoices.panel.left")})`
                              : ""}{" "}
                            · {tx.description}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedRow && !crossCurrency && (
                    <div>
                      <label htmlFor={`${ids}-payamt`} className="mb-1 block text-xs font-medium">
                        {t("supplierInvoices.panel.allocation", { currency: detail.linkCurrency })}
                      </label>
                      <Input
                        id={`${ids}-payamt`}
                        inputMode="decimal"
                        value={payAmount}
                        onChange={(ev) => setPayAmount(ev.target.value)}
                        placeholder={detail.open}
                      />
                    </div>
                  )}
                  {crossCurrency && (
                    <p className="text-xs text-muted-foreground">
                      {t("supplierInvoices.panel.crossCurrency", {
                        rowCurrency: selectedRow.currency,
                        currency: detail.linkCurrency,
                      })}
                    </p>
                  )}
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => void linkPayment()}
                      disabled={recording || attaching || payId === NONE}
                      data-testid="link-payment-run"
                    >
                      {crossCurrency
                        ? t("supplierInvoices.panel.attachRow")
                        : t("supplierInvoices.panel.linkPayment")}
                    </Button>
                  </div>
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">{t("supplierInvoices.panel.facts")}</h3>
              {canWrite && !si.cancelled ? (
                <div className="grid gap-3" data-testid="facts-form">
                  <div>
                    <label htmlFor={`${ids}-cat`} className="mb-1 block text-xs font-medium">
                      {t("supplierInvoices.form.category")}
                    </label>
                    <Select
                      value={si.basCode}
                      onValueChange={(v) => v && v !== si.basCode && void save({ basCode: v })}
                      disabled={saving}
                    >
                      <SelectTrigger id={`${ids}-cat`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(categories.some((c) => c.code === si.basCode)
                          ? categories
                          : [{ code: si.basCode, label: detail.basLabel }, ...categories]
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
                    <label htmlFor={`${ids}-reg`} className="mb-1 block text-xs font-medium">
                      {t("supplierInvoices.form.registration")}
                    </label>
                    <Select
                      value={si.vatRegistrationId ?? NONE}
                      onValueChange={(v) => {
                        const next = !v || v === NONE ? null : v;
                        if (next !== si.vatRegistrationId) void save({ vatRegistrationId: next });
                      }}
                      disabled={saving}
                    >
                      <SelectTrigger id={`${ids}-reg`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>
                          {t("supplierInvoices.form.noRegistration")}
                        </SelectItem>
                        {registrations.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label htmlFor={`${ids}-note`} className="mb-1 block text-xs font-medium">
                      {t("supplierInvoices.form.note")}
                    </label>
                    <Input
                      id={`${ids}-note`}
                      value={note}
                      onChange={(ev) => setNote(ev.target.value)}
                      onBlur={() => {
                        if ((note.trim() || null) !== (si.note ?? null))
                          void save({ note: note.trim() || null });
                      }}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`${ids}-missing`}
                      checked={si.documentMissing}
                      onCheckedChange={(c) => void save({ documentMissing: c === true })}
                      disabled={saving}
                      aria-label={t("supplierInvoices.form.documentMissing")}
                    />
                    <span>{t("supplierInvoices.form.documentMissing")}</span>
                  </label>
                </div>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">
                    {t("supplierInvoices.form.registration")}
                  </dt>
                  <dd>{detail.vatRegistrationLabel ?? "—"}</dd>
                  <dt className="text-muted-foreground">{t("supplierInvoices.form.note")}</dt>
                  <dd>{si.note ?? "—"}</dd>
                  {si.cancelled && (
                    <>
                      <dt className="text-muted-foreground">
                        {t("supplierInvoices.panel.cancelledReason")}
                      </dt>
                      <dd>{si.cancelledReason ?? "—"}</dd>
                    </>
                  )}
                </dl>
              )}
            </section>

            {si.lines.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-medium">{t("supplierInvoices.panel.lines")}</h3>
                <ul className="divide-y rounded-md border text-sm">
                  {si.lines.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span className="truncate">
                        {l.lineNo}. {l.description}{" "}
                        <span className="text-xs text-muted-foreground">
                          · {l.basCode} · {l.vatRate}%
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {money(l.amountNet, si.currency)} + {money(l.vatAmount, si.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-sm font-medium">{t("supplierInvoices.panel.document")}</h3>
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
                  {si.documentMissing
                    ? t("supplierInvoices.form.documentMissing")
                    : t("supplierInvoices.form.noDocument")}
                </p>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">{t("supplierInvoices.panel.links")}</h3>
                <GraphLink self={{ type: "supplier_invoice", id: si.id }} />
              </div>
              {detail.links.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("supplierInvoices.panel.noLinks")}
                </p>
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
                          {money(l.allocatedAmount, l.currency ?? si.currency)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {canWrite && (
              <div className="flex flex-wrap justify-end gap-2">
                {si.cancelled ? (
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="uncancel-invoice"
                    onClick={async () => {
                      const r = await uncancel({ id: si.id });
                      const error = extractError(r);
                      if (error) toast.error(error);
                      else {
                        toast.success(t("supplierInvoices.panel.uncancelled"));
                        changed();
                      }
                    }}
                  >
                    {t("supplierInvoices.panel.uncancel")}
                  </Button>
                ) : (
                  detail.payments.length === 0 && (
                    <>
                      <div className="flex items-end gap-2">
                        <div>
                          <label
                            htmlFor={`${ids}-reason`}
                            className="mb-1 block text-xs font-medium"
                          >
                            {t("supplierInvoices.panel.cancelReason")}
                          </label>
                          <Input
                            id={`${ids}-reason`}
                            value={cancelReason}
                            onChange={(ev) => setCancelReason(ev.target.value)}
                            data-testid="cancel-reason"
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={cancelling || !cancelReason.trim()}
                          data-testid="cancel-invoice"
                          onClick={() =>
                            cancelDialog.confirm(
                              async () => {
                                const r = await cancel({ id: si.id, reason: cancelReason.trim() });
                                const error = extractError(r);
                                if (error) throw new Error(error);
                                toast.success(t("supplierInvoices.panel.cancelled"));
                                changed();
                              },
                              {
                                description: t("supplierInvoices.panel.cancelConfirm", {
                                  key: si.key,
                                }),
                              },
                            )
                          }
                        >
                          {t("supplierInvoices.panel.cancel")}
                        </Button>
                      </div>
                      {detail.links.length === 0 && (
                        <Button
                          size="sm"
                          variant="destructive"
                          data-testid="delete-invoice"
                          onClick={() =>
                            deleteDialog.confirm(
                              async () => {
                                const r = await remove({ id: si.id });
                                const error = extractError(r);
                                if (error) throw new Error(error);
                                toast.success(t("supplierInvoices.panel.deleted"));
                                onClose();
                                onChanged?.();
                                router.refresh();
                              },
                              {
                                description: t("supplierInvoices.panel.deleteConfirm", {
                                  key: si.key,
                                }),
                              },
                            )
                          }
                        >
                          {t("supplierInvoices.panel.delete")}
                        </Button>
                      )}
                    </>
                  )
                )}
              </div>
            )}
            <ConfirmDialog {...deleteDialog.dialogProps} />
            <ConfirmDialog {...cancelDialog.dialogProps} />
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
