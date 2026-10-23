"use client";

// The group page's section (US3): the group's supplier invoices as a compact list — the full table with its
// filters lives on /supplier-invoices (one URL query per page), each key opens it there (the row found, its panel open).
import Link from "next/link";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { CodeChip } from "@/kernel/ui/tags";
import type { SupplierInvoiceListRow } from "@/modules/supplier-invoices/types";
import { SupplierInvoiceStateLabel } from "./state-label";

export type GroupSectionRow = Omit<SupplierInvoiceListRow, "createdAt"> & { createdAt: string };

export function SupplierInvoiceGroupSection({ rows }: { rows: GroupSectionRow[] }) {
  const t = useT();
  if (rows.length === 0) return null;
  return (
    <section data-testid="group-supplier-invoices">
      <h2 className="mb-2 text-sm font-medium">
        {t("supplierInvoices.group.title", { count: rows.length })}
      </h2>
      <ul className="divide-y divide-subtle rounded-md border text-[13px]">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
            <Link
              href={`/supplier-invoices?q=${encodeURIComponent(r.key)}&open=${r.id}`}
              className="hover:underline"
            >
              <CodeChip>{r.key}</CodeChip>
            </Link>
            <span className="min-w-0 flex-1 truncate">
              {r.partnerName} · {r.invoiceNumber} · {r.invoiceDate}
            </span>
            <span className="tabular-nums" data-amount>
              {formatMoney(r.amountTotal, r.currency)}
            </span>
            <SupplierInvoiceStateLabel status={r.status} daysOverdue={r.daysOverdue} />
          </li>
        ))}
      </ul>
    </section>
  );
}
