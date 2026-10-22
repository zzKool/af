"use client";

// The payments section of the supplier-invoice panel: the linked payments (remove), and *Link payment* — rows of
// the invoice currency first with an optional allocation; a row in another currency attaches the D-g way.
import { useAction } from "next-safe-action/hooks";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import type { PayableTransaction } from "@/modules/supplier-invoices/queries";
import {
  attachSupplierPaymentAction,
  detachSupplierPaymentAction,
  recordSupplierPaymentAction,
  removeSupplierPaymentAction,
} from "@/modules/supplier-invoices/supplier-invoices.actions";
import { money, NONE, type SupplierInvoicePanelDetail } from "./supplier-invoice-panel-shared";

export function SupplierInvoicePaymentsSection({
  detail,
  payable,
  canWrite,
  onChanged,
}: {
  detail: SupplierInvoicePanelDetail;
  /** bank rows the invoice can be paid from, loaded with the detail */
  payable: PayableTransaction[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const ids = useId();
  const [payId, setPayId] = useState(NONE);
  const [payAmount, setPayAmount] = useState("");
  const { executeAsync: record, isPending: recording } = useAction(recordSupplierPaymentAction);
  const { executeAsync: attach, isPending: attaching } = useAction(attachSupplierPaymentAction);
  const { executeAsync: removePay } = useAction(removeSupplierPaymentAction);
  const { executeAsync: detach, isPending: detaching } = useAction(detachSupplierPaymentAction);

  const si = detail.invoice;
  const selectedRow = payable.find((p) => p.id === payId);
  const crossCurrency = !!selectedRow && selectedRow.currency !== detail.linkCurrency;

  async function linkPayment() {
    if (payId === NONE) return;
    const row = payable.find((p) => p.id === payId);
    if (!row) return;
    const r =
      row.currency === detail.linkCurrency
        ? await record({
            invoiceId: si.id,
            bankTransactionId: payId,
            amount: payAmount.trim() || undefined,
          })
        : await attach({ invoiceId: si.id, bankTransactionId: payId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("supplierInvoices.panel.paymentLinked"));
    setPayId(NONE);
    setPayAmount("");
    onChanged();
  }

  async function unlinkPayment(linkId: string) {
    const r = si.paidAmount
      ? await detach({ invoiceId: si.id })
      : await removePay({ invoiceId: si.id, linkId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("supplierInvoices.panel.paymentRemoved"));
    onChanged();
  }

  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">{t("supplierInvoices.panel.payments")}</h3>
      {detail.payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("supplierInvoices.panel.noPayments")}</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm" data-testid="payments">
          {detail.payments.map((p) => (
            <li key={p.linkId} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="min-w-0 truncate">
                {p.bankTransactionId ? (
                  <>
                    {p.bookingDate ?? "?"} · {p.accountLabel ?? ""}
                    {p.rowAmount ? ` · ${money(p.rowAmount, p.rowCurrency ?? p.currency)}` : ""}
                  </>
                ) : (
                  (p.payerLabel ?? "?")
                )}
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
  );
}
