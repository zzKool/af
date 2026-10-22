"use client";

// The money section of the supplier-invoice panel: the SEK base / paid / open line, then the money form while
// the invoice is editable (supplier, number, currency, dates, net, VAT, total — saved on *Save*) or the locked
// read-out.
import { useId, useState } from "react";
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
import type { SupplierOption } from "@/modules/supplier-invoices/types";
import {
  money,
  type SaveSupplierInvoice,
  type SupplierInvoicePanelDetail,
} from "./supplier-invoice-panel-shared";

export function SupplierInvoiceMoneySection({
  detail,
  suppliers,
  canWrite,
  editable,
  save,
  saving,
}: {
  detail: SupplierInvoicePanelDetail;
  suppliers: SupplierOption[];
  canWrite: boolean;
  /** unpaid, unlinked and the caller can write */
  editable: boolean;
  save: SaveSupplierInvoice;
  saving: boolean;
}) {
  const t = useT();
  const ids = useId();
  const si = detail.invoice;

  // the form is put back to the saved values on every reload of the panel
  const fromDetail = () => ({
    partnerId: si.partnerId,
    invoiceNumber: si.invoiceNumber,
    invoiceDate: si.invoiceDate,
    dueDate: si.dueDate,
    currency: si.currency as string,
    amountNet: si.amountNet,
    vatAmount: si.vatAmount,
    amountTotal: si.amountTotal,
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
              partnerId: form.partnerId,
              invoiceNumber: form.invoiceNumber.trim(),
              invoiceDate: form.invoiceDate,
              dueDate: form.dueDate,
              currency: form.currency as (typeof CURRENCIES)[number],
              amountNet: form.amountNet.trim(),
              vatAmount: form.vatAmount.trim() || "0",
              amountTotal: form.amountTotal.trim(),
            });
          }}
        >
          <div className="col-span-2">
            <label htmlFor={`${ids}-supplier`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.supplier")}
            </label>
            <Select value={form.partnerId} onValueChange={(v) => v && set({ partnerId: v })}>
              <SelectTrigger id={`${ids}-supplier`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(suppliers.some((s) => s.id === form.partnerId)
                  ? suppliers
                  : [
                      { id: form.partnerId, name: detail.partnerName } as SupplierOption,
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
              value={form.invoiceNumber}
              onChange={(ev) => set({ invoiceNumber: ev.target.value })}
            />
          </div>
          <div>
            <label htmlFor={`${ids}-ccy`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.currency")}
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
              {t("supplierInvoices.form.invoiceDate")}
            </label>
            <Input
              id={`${ids}-date`}
              type="date"
              value={form.invoiceDate}
              onChange={(ev) => set({ invoiceDate: ev.target.value })}
            />
          </div>
          <div>
            <label htmlFor={`${ids}-due`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.dueDate")}
            </label>
            <Input
              id={`${ids}-due`}
              type="date"
              value={form.dueDate}
              onChange={(ev) => set({ dueDate: ev.target.value })}
            />
          </div>
          <div>
            <label htmlFor={`${ids}-net`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.net")}
            </label>
            <Input
              id={`${ids}-net`}
              inputMode="decimal"
              value={form.amountNet}
              onChange={(ev) => set({ amountNet: ev.target.value })}
            />
          </div>
          <div>
            <label htmlFor={`${ids}-vat`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.vat")}
            </label>
            <Input
              id={`${ids}-vat`}
              inputMode="decimal"
              value={form.vatAmount}
              onChange={(ev) => set({ vatAmount: ev.target.value })}
            />
          </div>
          <div>
            <label htmlFor={`${ids}-total`} className="mb-1 block text-xs font-medium">
              {t("supplierInvoices.form.total")}
            </label>
            <Input
              id={`${ids}-total`}
              inputMode="decimal"
              value={form.amountTotal}
              onChange={(ev) => set({ amountTotal: ev.target.value })}
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
          <dt className="text-muted-foreground">{t("supplierInvoices.form.invoiceDate")}</dt>
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
  );
}
