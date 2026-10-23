// Read API of the expenses module (FR-005, FR-006, FR-011). The list runs in two steps: Prisma filters the stored
// columns, then the group, the payer, the BAS label, Σ settlement lines, Σ justifies allocations and the document
// are joined over that set and the derived status / filters / search / sort / page run in memory.
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
import type { LinkDto } from "@/modules/linking";
import * as linking from "@/modules/linking";
import * as settings from "@/modules/settings";
import { isExpenseOpen, toExpenseDto } from "./expenses";
import { groupLabel, toGroupDto } from "./groups";
import { expenseHistory, type HistoryEntry } from "./history";
import { activeSettlementTransactionIds, allocatedByExpense, toSettlementDto } from "./settlements";
import { deriveExpenseStatus, owedBase } from "./status";
import type {
  DocumentOption,
  ExpenseDto,
  ExpenseGroupDto,
  ExpenseListRow,
  ExpenseStatus,
  LedgerSnapshot,
  LedgerSource,
  PaymentSourceKind,
  SettlementDto,
} from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export { getExpense } from "./expenses";
export { getGroup } from "./groups";
export { getPaymentSource, listPaymentSources } from "./payment-sources";
export { getSettlement, openPrivateExpenses, proposeSettlement } from "./settlements";
export { resolveStatement } from "./statement";

export const EXPENSE_COLUMNS = {
  key: { type: "text", searchable: true },
  groupId: { type: "enum" },
  groupNumber: { type: "number" },
  groupDescription: { type: "text", searchable: true },
  date: { type: "date" },
  description: { type: "text", searchable: true },
  kind: { type: "enum" },
  basCode: { type: "enum" },
  basLabel: { type: "text" },
  alias: { type: "enum" },
  // no Σ: a set mixes SEK, CHF, EUR and the footer labels every sum with one currency — the base columns carry
  // the totals (lessons, F71 invoices: *the kit's footer has one currency for every Σ*)
  amount: { type: "money" },
  currency: { type: "enum" },
  amountBase: { type: "money", sum: true },
  baseProvisional: { type: "boolean" },
  rateSource: { type: "enum" },
  paidAmount: { type: "money" },
  paidCurrency: { type: "enum" },
  paymentSourceId: { type: "enum" },
  paymentSourceLabel: { type: "enum" },
  paymentSourceKind: { type: "enum" },
  status: { type: "enum" },
  allocatedBase: { type: "money" },
  openBase: { type: "money", sum: true },
  documentMissing: { type: "boolean" },
  hasDocument: { type: "boolean" },
  note: { type: "text", searchable: true },
  vatAmount: { type: "money" },
  createdAt: { type: "date" },
} as const satisfies ColumnMap;

export type ExpenseColumn = keyof typeof EXPENSE_COLUMNS;
export const EXPENSE_COLUMN_KEYS = Object.keys(EXPENSE_COLUMNS) as ExpenseColumn[];
export const EXPENSE_DEFAULT_SORT: SortSpec[] = [
  { col: "date", dir: "desc" },
  { col: "key", dir: "desc" },
];

const DERIVED: ReadonlySet<string> = new Set([
  "groupNumber",
  "groupDescription",
  "basLabel",
  "paymentSourceLabel",
  "paymentSourceKind",
  "status",
  "allocatedBase",
  "openBase",
  "hasDocument",
]);
const STORED_COLUMNS: ColumnMap = Object.fromEntries(
  Object.entries(EXPENSE_COLUMNS).filter(([k]) => !DERIVED.has(k)),
);
const ROW_CAP = 20_000;

type Facts = {
  /** Σ active settlement lines per expense, SEK (`allocatedByExpense`) */
  allocated: Map<string, Dec>;
  /** Σ justifies allocations onto the expense (company-paid), in the paid currency */
  justified: Map<string, Dec>;
  /** expenses with a created_from document, or any document justifying them */
  hasDocument: Set<string>;
};

async function facts(tx: TransactionClient, ids: readonly string[]): Promise<Facts> {
  const f: Facts = { allocated: new Map(), justified: new Map(), hasDocument: new Set() };
  if (ids.length === 0) return f;
  const [allocated, links] = await Promise.all([
    allocatedByExpense(tx, ids),
    linking.linksTouching(tx, "expense", ids, { kinds: ["created_from", "justifies"] }),
  ]);
  f.allocated = allocated;
  for (const l of links) {
    if (l.kind === "created_from") {
      if (l.from.type === "expense") f.hasDocument.add(l.from.id);
    } else if (l.to.type !== "expense") {
      // a justifies link FROM an expense proves something else, not this expense
    } else if (l.from.type === "bank_transaction" && l.allocatedAmount) {
      f.justified.set(l.to.id, (f.justified.get(l.to.id) ?? new D(0)).plus(l.allocatedAmount));
    } else if (l.from.type === "document") f.hasDocument.add(l.to.id);
  }
  return f;
}

export function statusOf(
  e: Pick<ExpenseDto, "amountBase" | "paidAmount">,
  sourceKind: PaymentSourceKind,
  f: Facts,
  id: string,
): { status: ExpenseStatus; allocatedBase: string; openBase: string } {
  const allocated = f.allocated.get(id) ?? new D(0);
  const status = deriveExpenseStatus({
    paidByPrivate: sourceKind === "private",
    amountBase: e.amountBase,
    allocatedBase: allocated.toFixed(2),
    paidAmount: e.paidAmount,
    justifiedAmount: (f.justified.get(id) ?? new D(0)).toFixed(2),
  });
  return {
    status,
    allocatedBase: allocated.toFixed(2),
    openBase: sourceKind === "private" ? owedBase(e.amountBase, allocated).toFixed(2) : "0.00",
  };
}

async function loadRows(
  tx: TransactionClient,
  q: ListQuery,
  options: { exceptColumn?: string; groupId?: string } = {},
): Promise<ExpenseListRow[]> {
  const where = buildWhere({ ...q, search: undefined }, STORED_COLUMNS, {
    exceptColumn: options.exceptColumn,
  });
  const rows = await tx.expense.findMany({
    where: options.groupId ? { AND: [where, { groupId: options.groupId }] } : where,
    include: { group: true, paymentSource: true },
    orderBy: [{ date: "desc" }, { key: "desc" }],
    take: ROW_CAP,
  });
  const [f, labels] = await Promise.all([
    facts(
      tx,
      rows.map((r) => r.id),
    ),
    settings.basLabels(
      tx,
      rows.map((r) => r.basCode),
    ),
  ]);
  const list: ExpenseListRow[] = rows.map((r) => {
    const dto = toExpenseDto(r);
    const derived = statusOf(dto, r.paymentSource.kind as PaymentSourceKind, f, r.id);
    return {
      id: dto.id,
      key: dto.key,
      groupId: dto.groupId,
      groupNumber: r.group.number,
      groupDescription: r.group.description,
      date: dto.date,
      description: dto.description,
      kind: dto.kind,
      basCode: dto.basCode,
      basLabel: labels.get(dto.basCode) ?? dto.basCode,
      alias: dto.alias,
      amount: dto.amount,
      currency: dto.currency,
      amountBase: dto.amountBase,
      baseProvisional: dto.baseProvisional,
      rateSource: dto.rateSource,
      paidAmount: dto.paidAmount,
      paidCurrency: dto.paidCurrency,
      paymentSourceId: dto.paymentSourceId,
      paymentSourceLabel: r.paymentSource.label,
      paymentSourceKind: r.paymentSource.kind as PaymentSourceKind,
      ...derived,
      documentMissing: dto.documentMissing,
      hasDocument: f.hasDocument.has(r.id),
      note: dto.note,
      vatAmount: dto.vatAmount,
      createdAt: dto.createdAt,
    };
  });
  return filterInMemory(list, q, EXPENSE_COLUMNS, {
    derived: DERIVED,
    search: searchHit,
    exceptColumn: options.exceptColumn,
  });
}

function searchHit(row: ExpenseListRow, term: string): boolean {
  const t = term.toLowerCase();
  return [row.key, row.description, row.groupDescription, row.note, row.basLabel].some((v) =>
    (v ?? "").toLowerCase().includes(t),
  );
}

export async function listExpenses(
  tx: TransactionClient,
  q: ListQuery,
  options: { groupId?: string } = {},
): Promise<ListResult<ExpenseListRow>> {
  const all = await loadRows(tx, q, options);
  return finishList(all, q, EXPENSE_COLUMNS, EXPENSE_DEFAULT_SORT);
}

export async function distinctExpenseValues(
  tx: TransactionClient,
  column: ExpenseColumn,
  q: ListQuery,
  options: { groupId?: string } = {},
): Promise<DistinctValue[]> {
  const rows = await loadRows(tx, q, { exceptColumn: column, ...options });
  return countDistinct(
    rows.map((r) => r[column as keyof ExpenseListRow]),
    EXPENSE_COLUMNS[column],
  );
}

export async function expenseDateHierarchy(
  tx: TransactionClient,
  column: ExpenseColumn,
  q: ListQuery,
  options: { groupId?: string } = {},
): Promise<DateHierarchy> {
  if (EXPENSE_COLUMNS[column].type !== "date") return { years: [], empty: 0 };
  const rows = await loadRows(tx, q, { exceptColumn: column, ...options });
  return buildDateHierarchy(
    rows.map((r) => r[column as keyof ExpenseListRow] as Date | string | null),
  );
}

// --- one expense ---

export type ExpenseDetail = {
  expense: ExpenseDto;
  group: ExpenseGroupDto;
  groupLabel: string;
  paymentSource: { id: string; label: string; kind: PaymentSourceKind; currency: string };
  basLabel: string;
  status: ExpenseStatus;
  allocatedBase: string;
  openBase: string;
  /** the money facts may still change (`isExpenseOpen`, D37) — the panel reads this, never its own copy */
  isOpen: boolean;
  document: { id: string; businessKey: string; fileName: string } | null;
  links: (LinkDto & { otherLabel: string | null })[];
  settlements: {
    id: string;
    number: string;
    allocatedBase: string;
    status: string;
    bookingDate: string | null;
  }[];
  /** the panel's History: the expense's audit trail, newest first */
  history: HistoryEntry[];
};

type IsoDates<T, K extends keyof T> = Omit<T, K> & { [P in K]: string };

/** `ExpenseDetail` as the panel's action returns it: the timestamps as ISO strings (lessons audit 29). */
export type ExpenseDetailView = Omit<ExpenseDetail, "expense" | "group" | "links"> & {
  expense: IsoDates<ExpenseDetail["expense"], "createdAt" | "updatedAt">;
  group: IsoDates<ExpenseDetail["group"], "createdAt" | "updatedAt">;
  links: IsoDates<ExpenseDetail["links"][number], "createdAt">[];
};

export function toExpenseDetailView(d: ExpenseDetail): ExpenseDetailView {
  return {
    ...d,
    expense: {
      ...d.expense,
      createdAt: d.expense.createdAt.toISOString(),
      updatedAt: d.expense.updatedAt.toISOString(),
    },
    group: {
      ...d.group,
      createdAt: d.group.createdAt.toISOString(),
      updatedAt: d.group.updatedAt.toISOString(),
    },
    links: d.links.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
  };
}

export async function getExpenseDetail(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<ExpenseDetail>> {
  const row = await tx.expense.findUnique({
    where: { id },
    include: {
      group: true,
      paymentSource: true,
      settlementLines: { include: { settlement: true } },
    },
  });
  if (!row)
    return { error: { code: "NOT_FOUND", message: `Expense not found: ${id}`, retryable: false } };
  const [f, labels, withLabels, isOpen, audit] = await Promise.all([
    facts(tx, [id]),
    settings.basLabels(tx, [row.basCode]),
    linking.linksWithLabels(tx, { type: "expense", id }),
    isExpenseOpen(tx, id),
    getAuditLog(tx, { entityType: "expense", entityId: id, limit: 20 }),
  ]);
  const dto = toExpenseDto(row);
  const derived = statusOf(dto, row.paymentSource.kind as PaymentSourceKind, f, id);
  const origin = withLabels.find((l) => l.kind === "created_from" && l.from.id === id);
  let document: ExpenseDetail["document"] = null;
  if (origin) {
    const d = (await documents.getDocument(tx, origin.to.id)).data;
    document = d ? { id: d.id, businessKey: d.businessKey, fileName: d.fileName } : null;
  }
  const bookingDates = await banking.bookingDates(
    tx,
    row.settlementLines.map((l) => l.settlement.bankTransactionId),
  );
  return {
    data: {
      expense: dto,
      group: toGroupDto(row.group),
      groupLabel: groupLabel(row.group),
      paymentSource: {
        id: row.paymentSource.id,
        label: row.paymentSource.label,
        kind: row.paymentSource.kind as PaymentSourceKind,
        currency: row.paymentSource.currency,
      },
      basLabel: labels.get(row.basCode) ?? row.basCode,
      ...derived,
      isOpen,
      document,
      links: withLabels,
      settlements: row.settlementLines.map((l) => ({
        id: l.settlement.id,
        number: l.settlement.number,
        allocatedBase: l.allocatedBase.toFixed(2),
        status: l.settlement.status,
        bookingDate: bookingDates.get(l.settlement.bankTransactionId) ?? null,
      })),
      history: expenseHistory(audit),
    },
  };
}

// --- groups ---

export type GroupListRow = ExpenseGroupDto & {
  label: string;
  expenseCount: number;
  totalBase: string;
  openBase: string;
  perCurrency: { currency: string; amount: string }[];
  hasTrip: boolean;
};

export async function listGroups(tx: TransactionClient): Promise<GroupListRow[]> {
  const groups = await tx.expenseGroup.findMany({
    include: { expenses: { include: { paymentSource: true } }, trip: { select: { id: true } } },
    orderBy: { number: "desc" },
  });
  const f = await facts(
    tx,
    groups.flatMap((g) => g.expenses.map((e) => e.id)),
  );
  return groups.map((g) => {
    const perCurrency = new Map<string, Dec>();
    let total = new D(0);
    let open = new D(0);
    for (const e of g.expenses) {
      perCurrency.set(e.currency, (perCurrency.get(e.currency) ?? new D(0)).plus(e.amount));
      total = total.plus(e.amountBase);
      if (e.paymentSource.kind === "private") {
        open = open.plus(owedBase(e.amountBase, f.allocated.get(e.id) ?? new D(0)));
      }
    }
    return {
      ...toGroupDto(g),
      label: groupLabel(g),
      expenseCount: g.expenses.length,
      totalBase: total.toFixed(2),
      openBase: open.toFixed(2),
      perCurrency: [...perCurrency.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) })),
      hasTrip: g.trip !== null,
    };
  });
}

export async function getGroupDetail(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<GroupListRow>> {
  const rows = await listGroups(tx);
  const g = rows.find((r) => r.id === id);
  if (!g)
    return {
      error: { code: "NOT_FOUND", message: `Expense group not found: ${id}`, retryable: false },
    };
  return { data: g };
}

// --- settlements ---

export type SettlementListRow = SettlementDto & {
  paymentSourceLabel: string;
  bookingDate: string | null;
  lineCount: number;
};

export async function listSettlements(tx: TransactionClient): Promise<SettlementListRow[]> {
  const rows = await tx.settlement.findMany({
    include: { lines: true, paymentSource: true },
    orderBy: [{ createdAt: "desc" }],
  });
  const out: SettlementListRow[] = [];
  for (const r of rows) {
    const t = await banking.getBankTransaction(tx, r.bankTransactionId);
    out.push({
      ...toSettlementDto(r),
      paymentSourceLabel: r.paymentSource.label,
      bookingDate: t?.bookingDate ?? null,
      lineCount: r.lines.length,
    });
  }
  return out;
}

export type SettleableTransaction = banking.OutgoingMainRow;

/** Outgoing rows on main accounts that do not settle anything yet — the settle page's picker (US5) and the attach picker. */
export async function settleableTransactions(
  tx: TransactionClient,
  limit = 200,
): Promise<SettleableTransaction[]> {
  const taken = await activeSettlementTransactionIds(tx);
  const rows = await banking.outgoingMainRows(tx, limit + taken.size);
  return rows.filter((r) => !taken.has(r.id)).slice(0, limit);
}

// --- the ledger ---

export async function ledgerSnapshot(tx: TransactionClient): Promise<LedgerSnapshot> {
  const sources = await tx.paymentSource.findMany({
    include: { expenses: { select: { id: true, amountBase: true, paidAmount: true } } },
    orderBy: [{ kind: "asc" }, { label: "asc" }],
  });
  const f = await facts(
    tx,
    sources.flatMap((s) => s.expenses.map((e) => e.id)),
  );
  const out: LedgerSource[] = [];
  let totalOpen = new D(0);
  let totalAllocated = new D(0);
  let totalCount = 0;
  let awaitingLink = 0;
  for (const s of sources) {
    if (s.kind !== "private") {
      for (const e of s.expenses) {
        const status = deriveExpenseStatus({
          paidByPrivate: false,
          amountBase: e.amountBase.toFixed(2),
          allocatedBase: "0.00",
          paidAmount: e.paidAmount ? e.paidAmount.toFixed(2) : null,
          justifiedAmount: (f.justified.get(e.id) ?? new D(0)).toFixed(2),
        });
        if (status === "awaiting_link") awaitingLink += 1;
      }
      continue;
    }
    let open = new D(0);
    let allocated = new D(0);
    let count = 0;
    for (const e of s.expenses) {
      const a = f.allocated.get(e.id) ?? new D(0);
      allocated = allocated.plus(a);
      const o = owedBase(e.amountBase, a);
      if (!o.isZero()) {
        open = open.plus(o);
        count += 1;
      }
    }
    out.push({
      paymentSourceId: s.id,
      label: s.label,
      currency: s.currency,
      openBase: open.toFixed(2),
      allocatedBase: allocated.toFixed(2),
      openCount: count,
    });
    totalOpen = totalOpen.plus(open);
    totalAllocated = totalAllocated.plus(allocated);
    totalCount += count;
  }
  return {
    total: {
      openBase: totalOpen.toFixed(2),
      allocatedBase: totalAllocated.toFixed(2),
      openCount: totalCount,
    },
    sources: out,
    awaitingLinkCount: awaitingLink,
  };
}

// --- the receipts that can become an expense ---

/**
 * The receipts the new-expense dialog may pick: uploaded expense documents still waiting in the inbox — the
 * documents module's one rule (nothing created from them, not filed, not archived, paged after filtering).
 */
export async function candidateDocuments(
  tx: TransactionClient,
  caller: CallerIdentity,
): Promise<DocumentOption[]> {
  const docs = await documents.candidateDocuments(tx, caller, ["expense"]);
  return docs.map((d) => ({
    id: d.id,
    businessKey: d.businessKey,
    fileName: d.fileName,
    status: d.status,
  }));
}

export type ExpenseVatSource = {
  id: string;
  key: string;
  description: string;
  date: string;
  currency: string;
  amount: string;
  vatAmount: string;
};

/** The expenses carrying VAT under a registration, by date — the Swiss return's drill-down (ref 400, D23). */
export async function inputVatSources(
  tx: TransactionClient,
  input: { registrationId: string; from: string; to: string },
): Promise<ExpenseVatSource[]> {
  const rows = await tx.expense.findMany({
    where: {
      vatRegistrationId: input.registrationId,
      vatAmount: { not: null },
      date: { gte: new Date(`${input.from}T00:00:00Z`), lte: new Date(`${input.to}T00:00:00Z`) },
    },
    orderBy: [{ date: "asc" }, { key: "asc" }],
    select: {
      id: true,
      key: true,
      description: true,
      date: true,
      currency: true,
      amount: true,
      vatAmount: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    description: r.description,
    date: r.date.toISOString().slice(0, 10),
    currency: r.currency,
    amount: r.amount.toFixed(2),
    vatAmount: (r.vatAmount ?? new D(0)).toFixed(2),
  }));
}
