// Read API of the invoices module. The list carries DERIVED columns (state, remaining, credited, partner
// name) that no `where` can express, so a list query runs in two steps: Prisma filters the stored columns,
// then the derived read model is computed over that set (allocations from `links`, issued credit notes,
// converted quotes) and the derived filters, the sort and the page are applied in memory. A solo company
// has hundreds of documents a year — the cap is 20 000 rows, far above that.
import { Prisma } from "@/generated/prisma/browser";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { buildDateHierarchy, buildWhere, countDistinct } from "@/kernel/list-query/prisma";
import type {
  ColumnMap,
  DateHierarchy,
  DistinctValue,
  Filter,
  ListQuery,
  ListResult,
  SortSpec,
} from "@/kernel/list-query/types";
import * as numbering from "@/modules/numbering";
import * as partners from "@/modules/partners";
import { deriveState, remainingAmount } from "./derive";
import { toInvoiceDto } from "./invoices";
import type { InvoiceDerived, InvoiceListRow, InvoiceType, InvoiceWithDerived } from "./types";

const D = Prisma.Decimal;

/** Columns of the list. `derived: true` ones are computed here, not stored. */
export const INVOICE_COLUMNS = {
  number: { type: "text", searchable: true },
  type: { type: "enum" },
  state: { type: "enum" },
  partnerId: { type: "enum" },
  partnerName: { type: "text", searchable: true },
  issueDate: { type: "date" },
  dueDate: { type: "date" },
  periodLabel: { type: "text", searchable: true },
  currency: { type: "enum" },
  totalAmount: { type: "money", sum: true },
  totalBase: { type: "money", sum: true },
  remaining: { type: "money", sum: true },
  credited: { type: "money" },
  declarationPeriod: { type: "enum" },
  language: { type: "enum" },
  issuedAt: { type: "date" },
  sentAt: { type: "date" },
  createdAt: { type: "date" },
  updatedAt: { type: "date" },
} as const satisfies ColumnMap;

export type InvoiceColumn = keyof typeof INVOICE_COLUMNS;
export const INVOICE_COLUMN_KEYS = Object.keys(INVOICE_COLUMNS) as InvoiceColumn[];
export const INVOICE_DEFAULT_SORT: SortSpec[] = [
  { col: "issueDate", dir: "desc" },
  { col: "createdAt", dir: "desc" },
];

const DERIVED: ReadonlySet<string> = new Set(["state", "partnerName", "remaining", "credited"]);
const STORED_COLUMNS: ColumnMap = Object.fromEntries(
  Object.entries(INVOICE_COLUMNS).filter(([k]) => !DERIVED.has(k)),
);
const ROW_CAP = 20_000;

// --- the derived read model ---

type Sums = {
  allocated: Map<string, string>;
  credited: Map<string, string>;
  converted: Map<string, string>;
};

/** Σ allocations, Σ issued credit notes and converted-quote numbers for a set of invoice ids — three queries. */
async function derivedSums(tx: TransactionClient, ids: readonly string[]): Promise<Sums> {
  const sums: Sums = { allocated: new Map(), credited: new Map(), converted: new Map() };
  if (ids.length === 0) return sums;
  const [links, credits, conversions] = await Promise.all([
    tx.link.groupBy({
      by: ["toId"],
      where: {
        toType: "invoice",
        toId: { in: [...ids] },
        kind: "justifies",
        allocatedAmount: { not: null },
      },
      _sum: { allocatedAmount: true },
    }),
    tx.invoice.groupBy({
      by: ["relatedInvoiceId"],
      where: { type: "credit_note", status: { not: "draft" }, relatedInvoiceId: { in: [...ids] } },
      _sum: { totalAmount: true },
    }),
    tx.invoice.findMany({
      where: { type: "invoice", status: { not: "draft" }, relatedInvoiceId: { in: [...ids] } },
      select: { relatedInvoiceId: true, number: true },
    }),
  ]);
  for (const l of links)
    sums.allocated.set(l.toId, (l._sum.allocatedAmount ?? new D(0)).toFixed(2));
  for (const c of credits)
    if (c.relatedInvoiceId)
      sums.credited.set(c.relatedInvoiceId, (c._sum.totalAmount ?? new D(0)).toFixed(2));
  for (const c of conversions)
    if (c.relatedInvoiceId && c.number) sums.converted.set(c.relatedInvoiceId, c.number);
  return sums;
}

function deriveFor(
  inv: {
    id: string;
    type: InvoiceType;
    status: "draft" | "issued" | "sent" | "accepted" | "declined";
    totalAmount: string;
    dueDate: string | null;
  },
  sums: Sums,
  today: string,
): InvoiceDerived {
  const allocated = sums.allocated.get(inv.id) ?? "0.00";
  const credited = inv.type === "invoice" ? (sums.credited.get(inv.id) ?? "0.00") : "0.00";
  const convertedTo = inv.type === "quote" ? (sums.converted.get(inv.id) ?? null) : null;
  return {
    state: deriveState(
      {
        type: inv.type,
        status: inv.status,
        totalAmount: inv.totalAmount,
        dueDate: inv.dueDate,
        allocated,
        credited,
        convertedTo,
      },
      today,
    ),
    allocated,
    remaining:
      inv.status === "draft" || inv.type === "quote"
        ? "0.00"
        : remainingAmount(inv.totalAmount, allocated, credited),
    credited,
    convertedTo,
  };
}

// --- single reads ---

export async function getInvoice(
  tx: TransactionClient,
  id: string,
  today: string,
): Promise<ServiceResult<InvoiceWithDerived>> {
  const row = await tx.invoice.findUnique({ where: { id }, include: { lines: true } });
  if (!row)
    return { error: { code: "NOT_FOUND", message: `Invoice not found: ${id}`, retryable: false } };
  const dto = toInvoiceDto(row);
  const sums = await derivedSums(tx, [id]);
  return { data: { ...dto, ...deriveFor(dto, sums, today) } };
}

/** "Will be VA26-004" — a read, no lock; the hint can be overtaken by a concurrent issue. */
export async function nextNumberHint(
  tx: TransactionClient,
  type: InvoiceType,
  partnerShortCode: string | null,
  issueDate: string,
): Promise<string | null> {
  if (!partnerShortCode) return null;
  const series =
    type === "quote"
      ? numbering.quoteSeries(partnerShortCode, issueDate)
      : type === "credit_note"
        ? numbering.creditNoteSeries(partnerShortCode, issueDate)
        : numbering.invoiceSeries(partnerShortCode, issueDate);
  const status = await numbering.peekSeries(tx, series);
  return numbering.formatSeriesNumber(series, status.data?.nextValue ?? 1);
}

/** Credit notes of an invoice, or the invoice converted from a quote — what the sheet shows as related. */
export async function relatedDocuments(
  tx: TransactionClient,
  id: string,
): Promise<
  { id: string; type: InvoiceType; number: string | null; status: string; totalAmount: string }[]
> {
  const rows = await tx.invoice.findMany({
    where: { relatedInvoiceId: id },
    select: { id: true, type: true, number: true, status: true, totalAmount: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ ...r, totalAmount: r.totalAmount.toFixed(2) }));
}

// --- the list (ListQuery contract on top of the derived model) ---

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

async function loadRows(
  tx: TransactionClient,
  q: ListQuery,
  today: string,
  options: { exceptColumn?: string } = {},
): Promise<InvoiceListRow[]> {
  // the search box spans stored AND derived columns, so it is evaluated in memory below, not in SQL
  const where = buildWhere({ ...q, search: undefined }, STORED_COLUMNS, {
    exceptColumn: options.exceptColumn,
  });
  const rows = await tx.invoice.findMany({
    where,
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: ROW_CAP,
    select: {
      id: true,
      type: true,
      status: true,
      number: true,
      partnerId: true,
      contractId: true,
      issueDate: true,
      dueDate: true,
      periodLabel: true,
      currency: true,
      language: true,
      totalAmount: true,
      totalBase: true,
      declarationPeriod: true,
      issuedAt: true,
      sentAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const [sums, names] = await Promise.all([
    derivedSums(
      tx,
      rows.map((r) => r.id),
    ),
    partners.partnerNames(tx, [...new Set(rows.map((r) => r.partnerId))]),
  ]);
  const list: InvoiceListRow[] = rows.map((r) => {
    const base = {
      id: r.id,
      type: r.type,
      status: r.status,
      number: r.number,
      partnerId: r.partnerId,
      partnerName: names.get(r.partnerId) ?? "",
      contractId: r.contractId,
      issueDate: iso(r.issueDate) as string,
      dueDate: iso(r.dueDate),
      periodLabel: r.periodLabel,
      currency: r.currency,
      language: r.language,
      totalAmount: r.totalAmount.toFixed(2),
      totalBase: r.totalBase ? r.totalBase.toFixed(2) : null,
      declarationPeriod: r.declarationPeriod,
      issuedAt: r.issuedAt,
      sentAt: r.sentAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
    const d = deriveFor(base, sums, today);
    return {
      ...base,
      state: d.state,
      allocated: d.allocated,
      remaining: d.remaining,
      credited: d.credited,
    };
  });
  // derived filters (and the search box over partnerName) are applied here
  return list.filter((row) => {
    for (const [col, f] of Object.entries(q.filters)) {
      if (!DERIVED.has(col) || col === options.exceptColumn) continue;
      if (!matches(row[col as keyof InvoiceListRow], f)) return false;
    }
    if (q.search && !searchHit(row, q.search)) return false;
    return true;
  });
}

function searchHit(row: InvoiceListRow, term: string): boolean {
  const t = term.toLowerCase();
  return [row.number, row.partnerName, row.periodLabel].some((v) =>
    (v ?? "").toLowerCase().includes(t),
  );
}

function matches(value: unknown, f: Filter): boolean {
  switch (f.kind) {
    case "in": {
      const v = value === null || value === undefined || value === "" ? null : String(value);
      return f.values.includes(v);
    }
    case "text": {
      const v = String(value ?? "").toLowerCase();
      const needle = (f.value ?? "").toLowerCase();
      if (f.op === "empty") return v === "";
      if (f.op === "notEmpty") return v !== "";
      if (f.op === "equals") return v === needle;
      if (f.op === "startsWith") return v.startsWith(needle);
      return v.includes(needle);
    }
    case "range": {
      if (f.empty) return value === null || value === undefined;
      if (value === null || value === undefined) return false;
      const d = new D(String(value));
      if (f.min !== undefined && d.lt(new D(f.min))) return false;
      if (f.max !== undefined && d.gt(new D(f.max))) return false;
      return true;
    }
    case "dates":
      return true; // no derived date columns
  }
}

function compare(a: unknown, b: unknown, type: string): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1; // blanks last
  if (b === null || b === undefined) return -1;
  if (type === "money" || type === "number") return new D(String(a)).cmp(new D(String(b)));
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b));
}

export async function listInvoices(
  tx: TransactionClient,
  q: ListQuery,
  today: string,
): Promise<ListResult<InvoiceListRow>> {
  const all = await loadRows(tx, q, today);
  const sort = q.sort.filter((s) => s.col in INVOICE_COLUMNS);
  const effective = sort.length ? sort : INVOICE_DEFAULT_SORT;
  all.sort((x, y) => {
    for (const s of effective) {
      const c = compare(
        x[s.col as keyof InvoiceListRow],
        y[s.col as keyof InvoiceListRow],
        INVOICE_COLUMNS[s.col as InvoiceColumn].type,
      );
      if (c !== 0) return s.dir === "asc" ? c : -c;
    }
    return 0;
  });
  const start = (q.page - 1) * q.pageSize;
  const sums: Record<string, string> = {};
  for (const [col, spec] of Object.entries(INVOICE_COLUMNS)) {
    if (!("sum" in spec) || !spec.sum) continue;
    sums[col] = all
      .reduce((s, r) => s.add(new D(String(r[col as keyof InvoiceListRow] ?? 0))), new D(0))
      .toFixed(2);
  }
  return { rows: all.slice(start, start + q.pageSize), total: all.length, sums };
}

export async function distinctInvoiceValues(
  tx: TransactionClient,
  column: InvoiceColumn,
  q: ListQuery,
  today: string,
): Promise<DistinctValue[]> {
  const rows = await loadRows(tx, q, today, { exceptColumn: column });
  return countDistinct(
    rows.map((r) => r[column as keyof InvoiceListRow]),
    INVOICE_COLUMNS[column],
  );
}

export async function invoiceDateHierarchy(
  tx: TransactionClient,
  column: InvoiceColumn,
  q: ListQuery,
  today: string,
): Promise<DateHierarchy> {
  if (INVOICE_COLUMNS[column].type !== "date") return { years: [], empty: 0 };
  const rows = await loadRows(tx, q, today, { exceptColumn: column });
  return buildDateHierarchy(
    rows.map((r) => r[column as keyof InvoiceListRow] as Date | string | null),
  );
}
