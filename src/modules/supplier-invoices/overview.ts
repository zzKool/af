// The supplier invoices page's hero (F164, Pulse everywhere): what the year's supplier invoices cost in the base
// against the same span last year, twelve months as bars (amber while something of the month is unpaid), the year
// split by category, the invoices without their document. Derived from the list's own rows — nothing stored.
// Pure — `supplierOverview` (queries.ts) reads.
import { Prisma } from "@/generated/prisma/browser";
import { lastMonths } from "@/kernel/clock/calendar";
import type { SupplierInvoiceListRow } from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export type SupplierOverviewRow = Pick<
  SupplierInvoiceListRow,
  "invoiceDate" | "amountBase" | "basLabel" | "basCode" | "cancelled" | "documentMissing" | "status"
>;

export type SupplierOverview = {
  year: string;
  costYear: string;
  /** January to today's day last year; null when nothing then */
  costLastYear: string | null;
  months: { month: string; base: string; open: boolean }[];
  categories: { label: string; base: string }[];
  others: string;
  missingDocuments: number;
};

const OPEN = new Set(["unpaid", "partially_paid", "overdue"]);

export function supplierOverviewFrom(
  rows: readonly SupplierOverviewRow[],
  today: string,
  top = 5,
): SupplierOverview {
  const live = rows.filter((r) => !r.cancelled);
  const year = today.slice(0, 4);
  const lastYear = String(Number(year) - 1);
  const sameDay = `${lastYear}${today.slice(4)}`;
  const sum = (list: readonly SupplierOverviewRow[]) =>
    list.reduce((s, r) => s.plus(r.amountBase), new D(0));
  const thisYear = live.filter((r) => r.invoiceDate.startsWith(year) && r.invoiceDate <= today);
  const lastSpan = live.filter(
    (r) => r.invoiceDate.startsWith(lastYear) && r.invoiceDate <= sameDay,
  );
  const byCategory = new Map<string, Dec>();
  for (const r of thisYear) {
    const label = r.basLabel || r.basCode;
    byCategory.set(label, (byCategory.get(label) ?? new D(0)).plus(r.amountBase));
  }
  const ranked = [...byCategory.entries()].sort((a, b) => b[1].comparedTo(a[1]));
  return {
    year,
    costYear: sum(thisYear).toFixed(2),
    costLastYear: lastSpan.length > 0 ? sum(lastSpan).toFixed(2) : null,
    months: lastMonths(today).map((month) => {
      const inMonth = live.filter((r) => r.invoiceDate.startsWith(month));
      return {
        month,
        base: sum(inMonth).toFixed(2),
        open: inMonth.some((r) => OPEN.has(r.status)),
      };
    }),
    categories: ranked.slice(0, top).map(([label, v]) => ({ label, base: v.toFixed(2) })),
    others: ranked
      .slice(top)
      .reduce((s, [, v]) => s.plus(v), new D(0))
      .toFixed(2),
    missingDocuments: live.filter((r) => r.documentMissing).length,
  };
}
