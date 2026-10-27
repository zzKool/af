"use client";

// The payments section of the supplier-invoice panel (F114, D60): the payments ARE the links — each the row, what it
// pays in the invoice's currency, the base it gave; the FX difference derived beside them — and *Link payment*: the
// scored rows first, a search over the rest (the `PaymentPicker`, F97 US2), an optional allocation in the invoice's
// currency whatever the row's. The linking inbox sends the owner here for a payment (D37, F58):
// `?open=<invoice>&attach=<bank row>` preselects it.
import { useSearchParams } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { PaymentPicker } from "@/modules/linking/ui";
import type { PayableTransaction } from "@/modules/supplier-invoices/queries";
import {
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
  const params = useSearchParams();
  const [payId, setPayId] = useState(() => {
    const wanted = params.get("open") === detail.invoice.id ? params.get("attach") : null;
    return wanted && payable.some((p) => p.id === wanted) ? wanted : NONE;
  });
  const [payAmount, setPayAmount] = useState("");
  const { executeAsync: record, isPending: recording } = useAction(recordSupplierPaymentAction);
  const { executeAsync: removePay, isPending: removing } = useAction(removeSupplierPaymentAction);

  const si = detail.invoice;
  const selectedRow = payable.find((p) => p.id === payId);
  const crossCurrency = !!selectedRow && selectedRow.currency !== detail.linkCurrency;

  async function linkPayment() {
    if (payId === NONE) return;
    const r = await record({
      invoiceId: si.id,
      bankTransactionId: payId,
      amount: payAmount.trim() || undefined,
    });
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
    const r = await removePay({ invoiceId: si.id, linkId });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("supplierInvoices.panel.paymentRemoved"));
    onChanged();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold text-muted-foreground">
        {t("supplierInvoices.panel.payments")}
      </h4>
      {detail.payments.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          {t("supplierInvoices.panel.noPayments")}
        </p>
      ) : (
        <ul className="divide-y divide-subtle rounded-md border text-[13px]" data-testid="payments">
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
                <span className="tabular-nums" data-amount>
                  {money(p.allocated, p.currency)}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("supplierInvoices.panel.paymentBase", {
                    base: formatMoney(p.allocatedBase, null),
                  })}
                </span>
                {canWrite && (
                  <Button
                    size="sm"
                    variant="link"
                    onClick={() => void unlinkPayment(p.linkId)}
                    disabled={removing}
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
      {Number(detail.fxDifference) !== 0 && (
        <p className="text-xs text-muted-foreground tabular-nums" data-testid="fx-difference">
          {t("supplierInvoices.panel.fxDifference", {
            amount: formatMoney(detail.fxDifference, null),
            code: Number(detail.fxDifference) > 0 ? "7960" : "3960",
          })}
        </p>
      )}
      {canWrite && !si.cancelled && detail.open !== "0.00" && (
        <div className="mt-2 grid gap-2" data-testid="link-payment">
          <div>
            <span className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.panel.pickRow")}
            </span>
            <PaymentPicker
              entity={{ type: "supplier_invoice", id: si.id }}
              rows={payable}
              value={payId === NONE ? null : payId}
              onChange={(id) => setPayId(id ?? NONE)}
              refreshKey={detail.payments.length}
            />
          </div>
          {selectedRow && (
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
              disabled={recording || payId === NONE}
              data-testid="link-payment-run"
            >
              {t("supplierInvoices.panel.linkPayment")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
