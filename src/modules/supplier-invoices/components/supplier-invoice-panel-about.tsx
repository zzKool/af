"use client";

// The panel's *About* (D40 details panel): a key–value grid of what the invoice is — its group, the money
// read-out (dates, net, VAT while the money is written; always the base, what the bank paid and what is open), the
// facts once they are read-only (the accountant, a cancelled invoice) and why it was cancelled.
import Link from "next/link";
import type { ReactNode } from "react";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { DetailsGrid } from "@/kernel/ui/details-section";
import { money, type SupplierInvoicePanelDetail } from "./supplier-invoice-panel-shared";

export function SupplierInvoiceAbout({
  detail,
  canWrite,
}: {
  detail: SupplierInvoicePanelDetail;
  canWrite: boolean;
}) {
  const t = useT();
  const si = detail.invoice;
  const amount = (key: string, value: string, currency: string) => (
    <span key={key} className="tabular-nums" data-amount>
      {money(value, currency)}
    </span>
  );
  const factsReadOnly = !canWrite || si.cancelled;

  const rows: [ReactNode, ReactNode][] = [
    [
      t("supplierInvoices.col.group"),
      <Link
        key="group"
        href={`/expenses/groups/${si.groupId}`}
        className="text-primary hover:underline"
      >
        {detail.groupLabel}
      </Link>,
    ],
  ];
  if (!detail.editable) {
    rows.push(
      [
        t("supplierInvoices.form.invoiceDate"),
        <span key="date" className="tabular-nums">
          {si.invoiceDate}
        </span>,
      ],
      [
        t("supplierInvoices.form.dueDate"),
        <span key="due" className="tabular-nums">
          {si.dueDate}
          {si.dueDateDefaulted ? (
            <span className="text-muted-foreground">
              {` · ${t("supplierInvoices.panel.dueDefaulted")}`}
            </span>
          ) : null}
        </span>,
      ],
      [t("supplierInvoices.form.net"), amount("net", si.amountNet, si.currency)],
      [t("supplierInvoices.form.vat"), amount("vat", si.vatAmount, si.currency)],
    );
  }
  rows.push([
    t("supplierInvoices.col.amountBase"),
    <span key="base" className="tabular-nums" data-testid="panel-base">
      {t("supplierInvoices.panel.base", {
        base: formatMoney(si.amountBase, null, { bare: true }),
        rate: si.rate,
        source:
          si.rateSource === "bank"
            ? t("expenses.rateSource.bank")
            : t(`journal.rateSource.${si.rateSource}`),
      })}
    </span>,
  ]);
  if (si.paidAmount)
    rows.push([
      t("supplierInvoices.col.paid"),
      amount("paid", si.paidAmount, si.paidCurrency ?? si.currency),
    ]);
  if (!si.cancelled)
    rows.push([t("supplierInvoices.col.open"), amount("open", detail.open, detail.linkCurrency)]);
  if (factsReadOnly) {
    rows.push(
      [t("supplierInvoices.col.category"), detail.basLabel],
      [t("supplierInvoices.col.registration"), detail.vatRegistrationLabel],
      [t("supplierInvoices.form.note"), si.note],
    );
  }
  if (si.cancelled) rows.push([t("supplierInvoices.panel.cancelledReason"), si.cancelledReason]);

  return (
    <div className="flex flex-col gap-2">
      <DetailsGrid rows={rows} />
      {canWrite && !si.cancelled && !detail.editable && (
        <p className="text-xs text-muted-foreground">{t("supplierInvoices.panel.moneyLocked")}</p>
      )}
    </div>
  );
}
