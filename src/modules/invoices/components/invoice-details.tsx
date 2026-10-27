"use client";

// The document page's side panel, D40 (F71): the amount and its derived state on top, then collapsible
// sections — About this document (the facts and the money, on screen in formatMoney), Proof (the bank rows
// that pay it), Related documents, the internal note. The printed sheet beside it keeps its own format.
import Link from "next/link";
import type { ReactNode } from "react";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { DetailsGrid, DetailsSection } from "@/kernel/ui/details-section";
import { StateLabel } from "@/kernel/ui/state-label";
import { CodeChip, Tag } from "@/kernel/ui/tags";
import type { InvoiceState, InvoiceStatus, InvoiceType } from "../types";
import { InvoiceLinks } from "./invoice-links";
import { InvoiceStateLabel } from "./invoice-state-label";

export type DetailsInvoice = {
  id: string;
  type: InvoiceType;
  status: InvoiceStatus;
  state: InvoiceState;
  partnerName: string | null;
  issueDate: string;
  dueDate: string | null;
  periodLabel: string | null;
  currency: string;
  totalAmount: string;
  allocated: string;
  remaining: string;
  /** Σ what the paying rows gave, in base (F114) */
  allocatedBase: string;
  /** signed, derived (F114): > 0 a gain (3960), < 0 a loss (7960) on a receivable; null without a base */
  fxDifference: string | null;
  credited: string;
  baseCurrency: string;
  totalBase: string | null;
  rateToBase: string | null;
  rateSource: string | null;
  rateDate: string | null;
  declarationPeriod: string | null;
  internalNote: string | null;
};

export type RelatedDocument = {
  id: string;
  type: InvoiceType;
  number: string | null;
  currency: string;
  totalAmount: string;
};

export function InvoiceDetails({
  invoice: inv,
  related,
  declared,
  canWrite,
}: {
  invoice: DetailsInvoice;
  related: RelatedDocument[];
  /** the quarter's declaration, when its row exists (derived, D-e) */
  declared: { declaredAt: string; paidAt: string | null } | null;
  canWrite: boolean;
}) {
  const t = useT();
  const money = (amount: string) => formatMoney(amount, inv.currency);
  const issued = inv.status !== "draft";
  const dueLabel = inv.type === "quote" ? null : t("invoices.col.dueDate");

  const about: [ReactNode, ReactNode][] = [
    [t("invoices.col.partner"), inv.partnerName || null],
    [t("invoices.col.type"), t(`invoices.type.${inv.type}`)],
    [
      t("invoices.col.issueDate"),
      <span key="date" className="tabular-nums">
        {inv.issueDate}
      </span>,
    ],
    ...(dueLabel
      ? ([
          [
            dueLabel,
            inv.dueDate && (
              <span key="due" className="tabular-nums">
                {inv.dueDate}
              </span>
            ),
          ],
        ] as [ReactNode, ReactNode][])
      : []),
    [t("invoices.col.period"), inv.periodLabel],
    [
      t("invoices.col.total"),
      <span key="total" className="tabular-nums">
        {money(inv.totalAmount)}
      </span>,
    ],
  ];
  if (issued && inv.type === "invoice") {
    about.push([
      t("invoices.state.paid"),
      <span key="paid" className="tabular-nums" data-testid="invoice-payment">
        {money(inv.allocated)}
      </span>,
    ]);
    if (Number(inv.credited) > 0)
      about.push([
        t("invoices.col.credited"),
        <span key="credited" className="tabular-nums">
          {money(inv.credited)}
        </span>,
      ]);
    about.push([
      t("invoices.col.remaining"),
      // data-amount: the plain figure for the e2e that pays it from a bank row
      <span
        key="remaining"
        className="tabular-nums"
        data-testid="invoice-remaining"
        data-amount={inv.remaining}
      >
        {money(inv.remaining)}
      </span>,
    ]);
  }
  if (inv.totalBase && inv.rateToBase)
    about.push([
      t("invoices.col.totalBase"),
      <span key="base" className="text-muted-foreground">
        {t("invoices.base", {
          currency: inv.baseCurrency,
          amount: formatMoney(inv.totalBase, null, { bare: true }),
          rate: inv.rateToBase,
          source: inv.rateSource ?? "",
          date: inv.rateDate ?? "",
        })}
      </span>,
    ]);
  // F114: what the bank gave in base once something is paid, and the FX difference when there is one
  if (inv.totalBase && Number(inv.allocated) > 0)
    about.push([
      t("invoices.detail.paidBase"),
      <span key="paid-base" className="tabular-nums" data-testid="invoice-paid-base">
        {t("invoices.detail.paidBaseValue", {
          currency: inv.baseCurrency,
          amount: formatMoney(inv.allocatedBase, null, { bare: true }),
        })}
        {inv.fxDifference && Number(inv.fxDifference) !== 0 && (
          <span className="text-muted-foreground" data-testid="invoice-fx-difference">
            {" · "}
            {t("invoices.detail.fxDifference", {
              amount: formatMoney(inv.fxDifference, null, { bare: true }),
              code: Number(inv.fxDifference) > 0 ? "3960" : "7960",
            })}
          </span>
        )}
      </span>,
    ]);
  if (inv.declarationPeriod)
    about.push([
      t("invoices.col.declarationPeriod"),
      <span key="vat" className="flex flex-wrap items-center gap-1.5">
        <Link
          href={`/exports?period=${encodeURIComponent(inv.declarationPeriod)}`}
          className="hover:underline"
        >
          <Tag>{inv.declarationPeriod}</Tag>
        </Link>
        {/* "declared" is derived: the quarter has a declaration row */}
        {declared && (
          <span data-testid="invoice-declared">
            <StateLabel
              family="done"
              state={
                declared.paidAt
                  ? t("invoices.declaredPaid", { date: declared.declaredAt, paid: declared.paidAt })
                  : t("invoices.declared", { date: declared.declaredAt })
              }
            />
          </span>
        )}
      </span>,
    ]);

  return (
    <div className="flex flex-col gap-1" data-testid="invoice-details">
      <div className="flex flex-col gap-1 pb-2">
        <div className="text-[22px] leading-7 font-semibold tabular-nums">
          {money(inv.totalAmount)}
        </div>
        <InvoiceStateLabel state={inv.state} />
      </div>
      <DetailsSection title={t(`invoices.type.${inv.type}`)}>
        <DetailsGrid rows={about} />
      </DetailsSection>
      {issued && inv.type !== "quote" && (
        <InvoiceLinks invoiceId={inv.id} currency={inv.currency} canWrite={canWrite} />
      )}
      {related.length > 0 && (
        <DetailsSection title={t("invoices.related")}>
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {related.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <Link href={`/invoices/${r.id}`} className="hover:underline">
                  {r.number ? (
                    <CodeChip>{r.number}</CodeChip>
                  ) : (
                    <span className="text-muted-foreground">{t("invoices.state.draft")}</span>
                  )}
                </Link>
                <Tag>{t(`invoices.type.${r.type}`)}</Tag>
                <span className="ml-auto tabular-nums">
                  {formatMoney(r.totalAmount, r.currency)}
                </span>
              </li>
            ))}
          </ul>
        </DetailsSection>
      )}
      {inv.internalNote && (
        <DetailsSection title={t("invoices.form.internalNote")}>
          <p className="text-[13px] whitespace-pre-wrap">{inv.internalNote}</p>
        </DetailsSection>
      )}
    </div>
  );
}
