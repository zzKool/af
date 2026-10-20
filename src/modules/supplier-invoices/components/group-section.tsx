"use client";

// The group page's section (US3): the group's supplier invoices as a compact list — the full table with its
// filters lives on /supplier-invoices (one URL query per page), each row links there by key.
import Link from "next/link";
import { useT } from "@/kernel/i18n/use-t";
import { formatCurrency } from "@/kernel/money/format-currency";
import type { Currency } from "@/kernel/nav/constants";
import type { SupplierInvoiceListRow } from "@/modules/supplier-invoices/types";
import { SupplierInvoiceStatusBadge } from "./status-badge";

export type GroupSectionRow = Omit<SupplierInvoiceListRow, "createdAt"> & { createdAt: string };

export function SupplierInvoiceGroupSection({ rows }: { rows: GroupSectionRow[] }) {
  const t = useT();
  if (rows.length === 0) return null;
  return (
    <section data-testid="group-supplier-invoices">
      <h2 className="mb-2 text-sm font-medium">
        {t("supplierInvoices.group.title", { count: rows.length })}
      </h2>
      <ul className="divide-y rounded-md border text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
            <Link
              href={`/supplier-invoices?q=${encodeURIComponent(r.key)}`}
              className="font-mono text-xs hover:underline"
            >
              {r.key}
            </Link>
            <span className="min-w-0 flex-1 truncate">
              {r.partnerName} · {r.invoiceNumber} · {r.invoiceDate}
            </span>
            <span className="tabular-nums">
              {formatCurrency(r.amountTotal, r.currency as Currency)} {r.currency}
            </span>
            <SupplierInvoiceStatusBadge status={r.status} daysOverdue={r.daysOverdue} />
          </li>
        ))}
      </ul>
    </section>
  );
}
