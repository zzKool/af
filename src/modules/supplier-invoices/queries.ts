// Read API of the supplier-invoices module (FR-005). The list runs in two steps: Prisma filters the stored
// columns, then the group, the supplier's name, the BAS label, Σ justifies allocations and the document are
// joined over that set and the derived status / filters / search / sort / page run in memory.
import { Prisma } from "@/generated/prisma/browser";
import { getAuditLog } from "@/kernel/audit/audit";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import { filterInMemory, finishList } from "@/kernel/list-query/memory";
import { buildDateHierarchy, buildWhere, countDistinct } from "@/kernel/list-query/prisma";
import type {
  ColumnMap,
  DateHierarchy,
  DistinctValue,
  ListQuery,
  ListResult,
  SortSpec,
} from "@/kernel/list-query/types";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import * as expenses from "@/modules/expenses";
import * as journal from "@/modules/journal";
import type { LinkDto } from "@/modules/linking";
import * as linking from "@/modules/linking";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { sumAllocated } from "./allocated";
import { historyEvent, type SupplierInvoiceHistoryEntry } from "./history";
import { supplierInvoiceListSums } from "./list-sums";
import { addDays, deriveSupplierInvoiceStatus, openAmount } from "./status";
import { toSupplierInvoiceDto } from "./supplier-invoices";
import type {
  SupplierInvoiceDto,
  SupplierInvoiceKpis,
  SupplierInvoiceListRow,
  SupplierInvoiceStatus,
  SupplierOption,
} from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export { copyLastPrefill, getSupplierInvoice } from "./supplier-invoices";

export const SUPPLIER_INVOICE_COLUMNS = {
  key: { type: "text", searchable: true },
  groupId: { type: "enum" },
  groupNumber: { type: "number" },
  groupDescription: { type: "text", searchable: true },
  partnerId: { type: "enum" },
  partnerName: { type: "enum", searchable: true },
  invoiceNumber: { type: "text", searchable: true },
  invoiceDate: { type: "date" },
  dueDate: { type: "date" },
  dueDateDefaulted: { type: "boolean" },
  daysOverdue: { type: "number" },
  currency: { type: "enum" },
  amountNet: { type: "money" },
  vatAmount: { type: "money" },
  amountTotal: { type: "money", sum: true },
  amountBase: { type: "money", sum: true },
  rateSource: { type: "enum" },
  paidAmount: { type: "money" },
  paidCurrency: { type: "enum" },
  basCode: { type: "enum" },
  basLabel: { type: "text" },
  alias: { type: "enum" },
  vatRegistrationId: { type: "enum" },
  status: { type: "enum" },
  allocated: { type: "money" },
  open: { type: "money", sum: true },
  documentMissing: { type: "boolean" },
  hasDocument: { type: "boolean" },
  note: { type: "text", searchable: true },
  cancelled: { type: "boolean" },
  createdAt: { type: "date" },
} as const satisfies ColumnMap;

export type SupplierInvoiceColumn = keyof typeof SUPPLIER_INVOICE_COLUMNS;
export const SUPPLIER_INVOICE_COLUMN_KEYS = Object.keys(
  SUPPLIER_INVOICE_COLUMNS,
) as SupplierInvoiceColumn[];
export const SUPPLIER_INVOICE_DEFAULT_SORT: SortSpec[] = [
  { col: "invoiceDate", dir: "desc" },
  { col: "key", dir: "desc" },
];

const DERIVED: ReadonlySet<string> = new Set([
  "groupNumber",
  "groupDescription",
  "partnerName",
  "basLabel",
  "daysOverdue",
  "status",
  "allocated",
  "open",
  "hasDocument",
]);
const STORED_COLUMNS: ColumnMap = Object.fromEntries(
  Object.entries(SUPPLIER_INVOICE_COLUMNS).filter(([k]) => !DERIVED.has(k)),
);
const ROW_CAP = 20_000;

type Facts = {
  /** Σ allocations per invoice — the one rule of `./allocated` (bank rows and journal entries alike) */
  allocated: Map<string, Dec>;
  /** the paying bank rows per invoice (their booking dates date a payment) */
  payers: Map<string, string[]>;
  /** invoices with a created_from document, or any document justifying them */
  hasDocument: Set<string>;
};

async function facts(tx: TransactionClient, ids: readonly string[]): Promise<Facts> {
  const f: Facts = { allocated: new Map(), payers: new Map(), hasDocument: new Set() };
  if (ids.length === 0) return f;
  const links = await tx.link.findMany({
    where: {
      OR: [
        { toType: "supplier_invoice", toId: { in: [...ids] } },
        { fromType: "supplier_invoice", fromId: { in: [...ids] }, kind: "created_from" },
      ],
    },
    select: {
      kind: true,
      fromType: true,
      fromId: true,
      toType: true,
      toId: true,
      allocatedAmount: true,
    },
  });
  f.allocated = sumAllocated(links);
  for (const l of links) {
    if (l.kind === "created_from") f.hasDocument.add(l.fromId);
    else if (l.kind === "justifies" && l.fromType === "bank_transaction") {
      f.payers.set(l.toId, [...(f.payers.get(l.toId) ?? []), l.fromId]);
    } else if (l.kind === "justifies" && l.fromType === "document") f.hasDocument.add(l.toId);
  }
  return f;
}

export function statusOf(
  si: Pick<SupplierInvoiceDto, "cancelled" | "amountTotal" | "paidAmount" | "dueDate">,
  f: Facts,
  id: string,
  today: string,
): { status: SupplierInvoiceStatus; daysOverdue: number; allocated: string; open: string } {
  const allocated = f.allocated.get(id) ?? new D(0);
  const total = si.paidAmount ?? si.amountTotal;
  const derived = deriveSupplierInvoiceStatus({
    cancelled: si.cancelled,
    total,
    allocated: allocated.toFixed(2),
    dueDate: si.dueDate,
    today,
  });
  return {
    ...derived,
    allocated: allocated.toFixed(2),
    open: si.cancelled ? "0.00" : openAmount(total, allocated).toFixed(2),
  };
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

async function loadRows(
  tx: TransactionClient,
  q: ListQuery,
  options: { exceptColumn?: string; groupId?: string; today?: string } = {},
): Promise<SupplierInvoiceListRow[]> {
  const where = buildWhere({ ...q, search: undefined }, STORED_COLUMNS, {
    exceptColumn: options.exceptColumn,
  });
  const rows = await tx.supplierInvoice.findMany({
    where: options.groupId ? { AND: [where, { groupId: options.groupId }] } : where,
    include: { group: true },
    orderBy: [{ invoiceDate: "desc" }, { key: "desc" }],
    take: ROW_CAP,
  });
  const today = options.today ?? todayIso();
  const [f, labels, names] = await Promise.all([
    facts(
      tx,
      rows.map((r) => r.id),
    ),
    settings.basLabels(
      tx,
      rows.map((r) => r.basCode),
    ),
    partners.partnerNames(
      tx,
      rows.map((r) => r.partnerId),
    ),
  ]);
  const list: SupplierInvoiceListRow[] = rows.map((r) => {
    const dto = toSupplierInvoiceDto(r);
    const derived = statusOf(dto, f, r.id, today);
    return {
      id: dto.id,
      key: dto.key,
      groupId: dto.groupId,
      groupNumber: r.group.number,
      groupDescription: r.group.description,
      partnerId: dto.partnerId,
      partnerName: names.get(dto.partnerId) ?? "?",
      invoiceNumber: dto.invoiceNumber,
      invoiceDate: dto.invoiceDate,
      dueDate: dto.dueDate,
      dueDateDefaulted: dto.dueDateDefaulted,
      currency: dto.currency,
      amountNet: dto.amountNet,
      vatAmount: dto.vatAmount,
      amountTotal: dto.amountTotal,
      amountBase: dto.amountBase,
      rateSource: dto.rateSource,
      paidAmount: dto.paidAmount,
      paidCurrency: dto.paidCurrency,
      basCode: dto.basCode,
      basLabel: labels.get(dto.basCode) ?? dto.basCode,
      alias: dto.alias,
      vatRegistrationId: dto.vatRegistrationId,
      ...derived,
      documentMissing: dto.documentMissing,
      hasDocument: f.hasDocument.has(r.id),
      note: dto.note,
      cancelled: dto.cancelled,
      createdAt: dto.createdAt,
    };
  });
  return filterInMemory(list, q, SUPPLIER_INVOICE_COLUMNS, {
    derived: DERIVED,
    search: searchHit,
    exceptColumn: options.exceptColumn,
  });
}

function searchHit(row: SupplierInvoiceListRow, term: string): boolean {
  const t = term.toLowerCase();
  return [
    row.key,
    row.partnerName,
    row.invoiceNumber,
    row.groupDescription,
    row.note,
    row.basLabel,
  ].some((v) => (v ?? "").toLowerCase().includes(t));
}

export async function listSupplierInvoices(
  tx: TransactionClient,
  q: ListQuery,
  options: { groupId?: string; today?: string } = {},
): Promise<ListResult<SupplierInvoiceListRow>> {
  const all = await loadRows(tx, q, options);
  const list = finishList(all, q, SUPPLIER_INVOICE_COLUMNS, SUPPLIER_INVOICE_DEFAULT_SORT);
  return { ...list, sums: supplierInvoiceListSums(all, list.sums) };
}

export async function distinctSupplierInvoiceValues(
  tx: TransactionClient,
  column: SupplierInvoiceColumn,
  q: ListQuery,
  options: { groupId?: string } = {},
): Promise<DistinctValue[]> {
  const rows = await loadRows(tx, q, { exceptColumn: column, ...options });
  return countDistinct(
    rows.map((r) => r[column as keyof SupplierInvoiceListRow]),
    SUPPLIER_INVOICE_COLUMNS[column],
  );
}

export async function supplierInvoiceDateHierarchy(
  tx: TransactionClient,
  column: SupplierInvoiceColumn,
  q: ListQuery,
  options: { groupId?: string } = {},
): Promise<DateHierarchy> {
  if (SUPPLIER_INVOICE_COLUMNS[column].type !== "date") return { years: [], empty: 0 };
  const rows = await loadRows(tx, q, { exceptColumn: column, ...options });
  return buildDateHierarchy(
    rows.map((r) => r[column as keyof SupplierInvoiceListRow] as Date | string | null),
  );
}

/** The group page's section: every invoice of the group, newest first (FR-005 `listForGroup`). */
export async function listForGroup(
  tx: TransactionClient,
  groupId: string,
): Promise<SupplierInvoiceListRow[]> {
  const q: ListQuery = { page: 1, pageSize: ROW_CAP, filters: {}, sort: [] };
  const list = await listSupplierInvoices(tx, q, { groupId });
  return list.rows;
}

// --- one invoice ---

/** One allocation onto the invoice — the panel's list sums to the detail's `allocated`. */
export type SupplierInvoicePayment = {
  linkId: string;
  /** the paying bank row; null when another payer (a journal entry) justifies the invoice */
  bankTransactionId: string | null;
  /** the payer's label when it is not a bank row */
  payerLabel: string | null;
  bookingDate: string | null;
  accountLabel: string | null;
  rowAmount: string | null;
  rowCurrency: string | null;
  allocated: string;
  currency: string;
  note: string | null;
};

export type SupplierInvoiceDetail = {
  invoice: SupplierInvoiceDto;
  groupLabel: string;
  partnerName: string;
  basLabel: string;
  vatRegistrationLabel: string | null;
  status: SupplierInvoiceStatus;
  daysOverdue: number;
  allocated: string;
  open: string;
  /** the currency the allocations are in (the paid currency once attached) */
  linkCurrency: string;
  document: { id: string; businessKey: string; fileName: string } | null;
  payments: SupplierInvoicePayment[];
  links: (LinkDto & { otherLabel: string | null })[];
  /** money facts may change (no payment, no link) */
  editable: boolean;
  /** the invoice's audit entries, newest first (the panel's History) */
  history: SupplierInvoiceHistoryEntry[];
};

export async function getSupplierInvoiceDetail(
  tx: TransactionClient,
  caller: CallerIdentity,
  id: string,
  today = todayIso(),
): Promise<ServiceResult<SupplierInvoiceDetail>> {
  const row = await tx.supplierInvoice.findUnique({
    where: { id },
    include: { group: true, lines: true },
  });
  if (!row) {
    return {
      error: { code: "NOT_FOUND", message: `Supplier invoice not found: ${id}`, retryable: false },
    };
  }
  const [f, labels, names, links, regs, history] = await Promise.all([
    facts(tx, [id]),
    settings.basLabels(tx, [row.basCode]),
    partners.partnerNames(tx, [row.partnerId]),
    linking.getLinksFor(tx, { type: "supplier_invoice", id }),
    row.vatRegistrationId ? settings.getVatRegistrations(tx, caller) : Promise.resolve(null),
    supplierInvoiceHistory(tx, id),
  ]);
  const dto = toSupplierInvoiceDto(row);
  const derived = statusOf(dto, f, id, today);
  const all = links.data ?? [];
  const withLabels = await Promise.all(
    all.map(async (l) => {
      const other = l.from.type === "supplier_invoice" && l.from.id === id ? l.to : l.from;
      const linkable = linking.getLinkable(other.type);
      const summary = linkable ? await linkable.summary(tx, other.id) : null;
      return { ...l, otherLabel: summary?.label ?? null };
    }),
  );
  const origin = all.find((l) => l.kind === "created_from" && l.from.id === id);
  let document: SupplierInvoiceDetail["document"] = null;
  if (origin) {
    const d = await tx.document.findUnique({
      where: { id: origin.to.id },
      select: { id: true, businessKey: true, fileName: true },
    });
    document = d ?? null;
  }
  const payments: SupplierInvoicePayment[] = [];
  for (const l of withLabels) {
    if (l.kind !== "justifies" || l.to.id !== id || l.allocatedAmount === null) continue;
    const t =
      l.from.type === "bank_transaction" ? await banking.getBankTransaction(tx, l.from.id) : null;
    payments.push({
      linkId: l.id,
      bankTransactionId: l.from.type === "bank_transaction" ? l.from.id : null,
      payerLabel: l.from.type === "bank_transaction" ? null : l.otherLabel,
      bookingDate: t?.bookingDate ?? null,
      accountLabel: t?.accountLabel ?? null,
      rowAmount: t?.amount ?? null,
      rowCurrency: t?.currency ?? null,
      allocated: new D(l.allocatedAmount).toFixed(2),
      currency: l.currency ?? dto.paidCurrency ?? dto.currency,
      note: l.note,
    });
  }
  payments.sort((a, b) => (a.bookingDate ?? "").localeCompare(b.bookingDate ?? ""));
  const reg = regs?.data?.find((r) => r.id === row.vatRegistrationId) ?? null;
  return {
    data: {
      invoice: dto,
      groupLabel: expenses.groupLabel(row.group),
      partnerName: names.get(row.partnerId) ?? "?",
      basLabel: labels.get(row.basCode) ?? row.basCode,
      vatRegistrationLabel: reg ? `${reg.country} ${reg.vatNumber}` : null,
      ...derived,
      linkCurrency: dto.paidCurrency ?? dto.currency,
      document,
      payments,
      links: withLabels,
      editable: !row.cancelled && !row.paidAmount && payments.length === 0,
      history,
    },
  };
}

const HISTORY_LIMIT = 50;

/** The invoice's history, newest first — each audit entry named by `historyEvent`. */
export async function supplierInvoiceHistory(
  tx: TransactionClient,
  id: string,
): Promise<SupplierInvoiceHistoryEntry[]> {
  const entries = await getAuditLog(tx, {
    entityType: "supplier_invoice",
    entityId: id,
    limit: HISTORY_LIMIT,
  });
  return entries.map((e) => ({
    id: e.id,
    event: historyEvent(e),
    at: e.createdAt.toISOString(),
    source: e.source,
  }));
}

// --- KPIs (US3) ---

export const DUE_SOON_DAYS = 14;

/** Open, overdue, due within 14 days, paid this month — SEK, non-cancelled invoices (US3). */
export async function kpis(
  tx: TransactionClient,
  today = todayIso(),
): Promise<SupplierInvoiceKpis> {
  const rows = await tx.supplierInvoice.findMany({
    where: { cancelled: false },
    select: {
      id: true,
      amountTotal: true,
      amountBase: true,
      paidAmount: true,
      dueDate: true,
      cancelled: true,
    },
  });
  const f = await facts(
    tx,
    rows.map((r) => r.id),
  );
  const horizon = addDays(today, DUE_SOON_DAYS);
  const month = today.slice(0, 7);
  const out: SupplierInvoiceKpis = {
    openBase: "0.00",
    openCount: 0,
    overdueBase: "0.00",
    overdueCount: 0,
    dueSoonBase: "0.00",
    dueSoonCount: 0,
    paidThisMonthBase: "0.00",
    paidThisMonthCount: 0,
  };
  let open = new D(0);
  let overdue = new D(0);
  let dueSoon = new D(0);
  let paidThisMonth = new D(0);
  const paidIds: string[] = [];
  for (const r of rows) {
    const dueDate = r.dueDate.toISOString().slice(0, 10);
    const total = (r.paidAmount ?? r.amountTotal).toFixed(2);
    const { status } = deriveSupplierInvoiceStatus({
      cancelled: false,
      total,
      allocated: (f.allocated.get(r.id) ?? new D(0)).toFixed(2),
      dueDate,
      today,
    });
    if (status === "paid") {
      paidIds.push(r.id);
      continue;
    }
    // the open SEK: the base pro rata of what is still open in the invoice currency
    const openShare = openAmount(total, f.allocated.get(r.id) ?? new D(0)).div(new D(total));
    const openBase = r.amountBase.mul(openShare).toDecimalPlaces(2, D.ROUND_HALF_UP);
    open = open.plus(openBase);
    out.openCount += 1;
    if (status === "overdue") {
      overdue = overdue.plus(openBase);
      out.overdueCount += 1;
    } else if (dueDate <= horizon) {
      dueSoon = dueSoon.plus(openBase);
      out.dueSoonCount += 1;
    }
  }
  // paid this month: the last payment row of a paid invoice was booked this month
  if (paidIds.length > 0) {
    const txIds = [...new Set(paidIds.flatMap((id) => f.payers.get(id) ?? []))];
    const bookings = await tx.bankTransaction.findMany({
      where: { id: { in: txIds } },
      select: { id: true, bookingDate: true },
    });
    const booked = new Map(bookings.map((b) => [b.id, b.bookingDate.toISOString().slice(0, 10)]));
    const base = new Map(rows.map((r) => [r.id, r.amountBase]));
    for (const id of paidIds) {
      const last = (f.payers.get(id) ?? [])
        .map((t) => booked.get(t) ?? "")
        .sort()
        .at(-1);
      if (last?.startsWith(month)) {
        paidThisMonth = paidThisMonth.plus(base.get(id) ?? new D(0));
        out.paidThisMonthCount += 1;
      }
    }
  }
  out.openBase = open.toFixed(2);
  out.overdueBase = overdue.toFixed(2);
  out.dueSoonBase = dueSoon.toFixed(2);
  out.paidThisMonthBase = paidThisMonth.toFixed(2);
  return out;
}

// --- pickers ---

export type PayableTransaction = {
  id: string;
  bookingDate: string;
  amount: string;
  currency: string;
  description: string;
  bankAccountId: string;
  accountLabel: string;
  amountBase: string | null;
  /** |amount| − Σ its justifies allocations (what the row can still pay) */
  remaining: string;
};

/**
 * Outgoing rows on main accounts with something left to allocate — the *Link payment* picker (US2). Rows of
 * `currency` first (same-currency allocations), then the others (cross-currency attach).
 */
export async function payableTransactions(
  tx: TransactionClient,
  currency?: string,
  limit = 200,
): Promise<PayableTransaction[]> {
  const rows = await tx.bankTransaction.findMany({
    where: { amount: { lt: 0 }, bankAccount: { role: "main" } },
    include: { bankAccount: true },
    orderBy: [{ bookingDate: "desc" }],
    take: limit * 2,
  });
  const ids = rows.map((r) => r.id);
  const [entries, links, settling] = await Promise.all([
    journal.entriesForSources(tx, "bank_transaction", ids),
    tx.link.findMany({
      where: { fromType: "bank_transaction", fromId: { in: ids }, allocatedAmount: { not: null } },
      select: { fromId: true, allocatedAmount: true },
    }),
    tx.settlement.findMany({
      where: { bankTransactionId: { in: ids }, status: "active" },
      select: { bankTransactionId: true },
    }),
  ]);
  const used = new Map<string, Dec>();
  for (const l of links) {
    used.set(l.fromId, (used.get(l.fromId) ?? new D(0)).plus(l.allocatedAmount as Dec));
  }
  const taken = new Set(settling.map((s) => s.bankTransactionId));
  const out = rows
    .filter((r) => !taken.has(r.id))
    .map((r) => {
      const remaining = r.amount.abs().minus(used.get(r.id) ?? new D(0));
      return {
        id: r.id,
        bookingDate: r.bookingDate.toISOString().slice(0, 10),
        amount: r.amount.toFixed(2),
        currency: r.currency,
        description: r.description,
        bankAccountId: r.bankAccountId,
        accountLabel: banking.accountLabel(r.bankAccount),
        amountBase: entries.get(r.id)?.amountBase ?? null,
        remaining: remaining.toFixed(2),
      };
    })
    .filter((r) => new D(r.remaining).gt(0));
  if (currency) {
    out.sort((a, b) => Number(b.currency === currency) - Number(a.currency === currency));
  }
  return out.slice(0, limit);
}

/** Vendors — the supplier picker of the new dialog, with the pre-fill facts (FR-007). */
export async function supplierOptions(tx: TransactionClient): Promise<SupplierOption[]> {
  const list = await partners.getPartners(tx, { types: ["vendor"] });
  return (list.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    defaultCurrency: p.defaultCurrency,
    defaultBasCategoryCode: p.defaultBasCategoryCode,
    paymentTermsDays: p.paymentTermsDays,
  }));
}

export type CandidateDocument = {
  id: string;
  businessKey: string;
  fileName: string;
  status: string;
};

/** Uploaded invoice / expense documents that nothing was created from yet — the new dialog's document picker. */
export async function candidateDocuments(
  tx: TransactionClient,
  caller: CallerIdentity,
): Promise<CandidateDocument[]> {
  const list = await documents.getDocuments(
    tx,
    caller,
    { prefixType: ["invoice", "expense"] },
    { field: "createdAt", direction: "desc" },
    { page: 1, pageSize: 200 },
  );
  const items = (list.data?.items ?? []).filter((d) => d.status !== "generated");
  if (items.length === 0) return [];
  const taken = new Set(
    (
      await tx.link.findMany({
        where: { kind: "created_from", toType: "document", toId: { in: items.map((d) => d.id) } },
        select: { toId: true },
      })
    ).map((l) => l.toId),
  );
  return items
    .filter((d) => !taken.has(d.id))
    .map((d) => ({ id: d.id, businessKey: d.businessKey, fileName: d.fileName, status: d.status }));
}

// --- VAT read model (US4) ---

export type InputVatForPeriod = {
  registrationId: string;
  from: string;
  to: string;
  /** Σ stored vat_amount in the invoice currency, per currency */
  perCurrency: { currency: string; vatAmount: string; amountNet: string; count: number }[];
  /** Σ SEK base of the totals (what the declarations' SEK columns read) */
  amountBase: string;
  /** Σ vat_amount × (amountBase / amountTotal) — the VAT share of the stored base, SEK */
  vatBase: string;
  count: number;
};

/**
 * Σ the STORED VAT (and base) of the non-cancelled invoices under a registration, by invoice date (US4). Nothing
 * is recomputed from rates — the declarations read what was written once.
 */
export async function inputVatForPeriod(
  tx: TransactionClient,
  input: { registrationId: string; from: string; to: string },
): Promise<InputVatForPeriod> {
  const rows = await tx.supplierInvoice.findMany({
    where: {
      vatRegistrationId: input.registrationId,
      cancelled: false,
      invoiceDate: {
        gte: new Date(`${input.from}T00:00:00Z`),
        lte: new Date(`${input.to}T00:00:00Z`),
      },
    },
    select: {
      currency: true,
      vatAmount: true,
      amountNet: true,
      amountTotal: true,
      amountBase: true,
    },
  });
  const per = new Map<string, { vat: Dec; net: Dec; count: number }>();
  let base = new D(0);
  let vatBase = new D(0);
  for (const r of rows) {
    const p = per.get(r.currency) ?? { vat: new D(0), net: new D(0), count: 0 };
    per.set(r.currency, {
      vat: p.vat.plus(r.vatAmount),
      net: p.net.plus(r.amountNet),
      count: p.count + 1,
    });
    base = base.plus(r.amountBase);
    if (r.amountTotal.gt(0)) {
      vatBase = vatBase.plus(
        r.vatAmount.mul(r.amountBase).div(r.amountTotal).toDecimalPlaces(2, D.ROUND_HALF_UP),
      );
    }
  }
  return {
    registrationId: input.registrationId,
    from: input.from,
    to: input.to,
    perCurrency: [...per.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, v]) => ({
        currency,
        vatAmount: v.vat.toFixed(2),
        amountNet: v.net.toFixed(2),
        count: v.count,
      })),
    amountBase: base.toFixed(2),
    vatBase: vatBase.toFixed(2),
    count: rows.length,
  };
}

export type InputVatSource = {
  id: string;
  key: string;
  partnerName: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  amountNet: string;
  vatAmount: string;
  /** D23: flagged by hand when a purchase falls under CH acquisition tax (ref 383); never set by default */
  acquisition: boolean;
};

/** The non-cancelled invoices under a registration by invoice date, one row each — the return's drill-down (ref 400). */
export async function inputVatSources(
  tx: TransactionClient,
  input: { registrationId: string; from: string; to: string },
): Promise<InputVatSource[]> {
  const rows = await tx.supplierInvoice.findMany({
    where: {
      vatRegistrationId: input.registrationId,
      cancelled: false,
      invoiceDate: {
        gte: new Date(`${input.from}T00:00:00Z`),
        lte: new Date(`${input.to}T00:00:00Z`),
      },
    },
    orderBy: [{ invoiceDate: "asc" }, { key: "asc" }],
    select: {
      id: true,
      key: true,
      partnerId: true,
      invoiceNumber: true,
      invoiceDate: true,
      currency: true,
      amountNet: true,
      vatAmount: true,
    },
  });
  const names = await partners.partnerNames(tx, [...new Set(rows.map((r) => r.partnerId))]);
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    partnerName: names.get(r.partnerId) ?? "",
    invoiceNumber: r.invoiceNumber,
    invoiceDate: r.invoiceDate.toISOString().slice(0, 10),
    currency: r.currency,
    amountNet: r.amountNet.toFixed(2),
    vatAmount: r.vatAmount.toFixed(2),
    acquisition: false,
  }));
}
