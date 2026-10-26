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
import type { StateFamily } from "@/kernel/ui/state-label";
import * as banking from "@/modules/banking";
import * as documents from "@/modules/documents";
import type { LinkDto } from "@/modules/linking";
import * as linking from "@/modules/linking";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { isExpenseOpen, toExpenseDto } from "./expenses";
import { groupLabel, toGroupDto } from "./groups";
import { expenseHistory, type HistoryEntry } from "./history";
import { activeSettlementTransactionIds, allocatedByExpense, toSettlementDto } from "./settlements";
import { expenseStateFamily } from "./state-family";
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
  // the partner (F87): the id filters in SQL (the partner page's deep link), the name is what the owner reads
  partnerId: { type: "enum" },
  partnerName: { type: "enum", searchable: true },
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
  reverseCharge: { type: "boolean" },
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
  "partnerName",
  "groupNumber",
  "groupDescription",
  "basLabel",
  "paymentSourceLabel",
  "paymentSourceKind",
  "status",
  "allocatedBase",
  "openBase",
  "hasDocument",
  "reverseCharge",
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
  /** expenses made from a document that says the buyer pays the VAT (D54, F91) — a tag, nothing computed */
  reverseCharge: Set<string>;
};

async function facts(tx: TransactionClient, ids: readonly string[]): Promise<Facts> {
  const f: Facts = {
    allocated: new Map(),
    justified: new Map(),
    hasDocument: new Set(),
    reverseCharge: new Set(),
  };
  if (ids.length === 0) return f;
  const allocated = await allocatedByExpense(tx, ids);
  const links = await linking.linksTouching(tx, "expense", ids, {
    kinds: ["created_from", "justifies"],
  });
  f.allocated = allocated;
  const origin = new Map<string, string>(); // expense → the document it was made from
  for (const l of links) {
    if (l.kind === "created_from") {
      if (l.from.type === "expense") {
        f.hasDocument.add(l.from.id);
        origin.set(l.from.id, l.to.id);
      }
    } else if (l.to.type !== "expense") {
      // a justifies link FROM an expense proves something else, not this expense
    } else if (l.from.type === "bank_transaction" && l.allocatedAmount) {
      f.justified.set(l.to.id, (f.justified.get(l.to.id) ?? new D(0)).plus(l.allocatedAmount));
    } else if (l.from.type === "document") f.hasDocument.add(l.to.id);
  }
  const flagged = await documents.reverseChargeDocumentIds(tx, [...origin.values()]);
  for (const [expenseId, documentId] of origin) {
    if (flagged.has(documentId)) f.reverseCharge.add(expenseId);
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
  options: { exceptColumn?: string; groupId?: string; ids?: readonly string[] } = {},
): Promise<ExpenseListRow[]> {
  const where = buildWhere({ ...q, search: undefined }, STORED_COLUMNS, {
    exceptColumn: options.exceptColumn,
  });
  const rows = await tx.expense.findMany({
    where: {
      AND: [
        where,
        ...(options.groupId ? [{ groupId: options.groupId }] : []),
        ...(options.ids ? [{ id: { in: [...options.ids] } }] : []),
      ],
    },
    include: { group: true, paymentSource: true },
    orderBy: [{ date: "desc" }, { key: "desc" }],
    take: ROW_CAP,
  });
  const f = await facts(
    tx,
    rows.map((r) => r.id),
  );
  const labels = await settings.basLabels(
    tx,
    rows.map((r) => r.basCode),
  );
  const names = await partners.partnerNames(tx, [
    ...new Set(rows.flatMap((r) => (r.partnerId ? [r.partnerId] : []))),
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
      partnerId: dto.partnerId,
      partnerName: dto.partnerId ? (names.get(dto.partnerId) ?? null) : null,
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
      reverseCharge: f.reverseCharge.has(r.id),
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
  return [
    row.key,
    row.description,
    row.groupDescription,
    row.note,
    row.basLabel,
    row.partnerName,
  ].some((v) => (v ?? "").toLowerCase().includes(t));
}

/**
 * The list rows of `ids` — status, document, payer — whatever the list's filters (F94: the subscriptions module
 * reads the expenses attributed to its periods through this, never the table). An unknown id is absent.
 */
export async function expenseRowsByIds(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<ExpenseListRow[]> {
  if (ids.length === 0) return [];
  return loadRows(tx, { page: 1, pageSize: ROW_CAP, filters: {}, sort: [] }, { ids });
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
  /** the expense's partner (F87) — a deactivated one stays shown, greyed */
  partner: { id: string; name: string; isActive: boolean } | null;
  status: ExpenseStatus;
  allocatedBase: string;
  openBase: string;
  /** the money facts may still change (`isExpenseOpen`, D37) — the panel reads this, never its own copy */
  isOpen: boolean;
  /** the document it was made from; `reverseCharge` — it says the buyer pays the VAT (D54, F91) */
  document: { id: string; businessKey: string; fileName: string; reverseCharge: boolean } | null;
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
    include: { group: true, paymentSource: true },
  });
  if (!row)
    return { error: { code: "NOT_FOUND", message: `Expense not found: ${id}`, retryable: false } };
  // its own read: Prisma loads an include's relations in parallel on the tx, and a third one queues
  // behind the client's running query — pg's "already executing" warning (F53)
  const settlementLines = await tx.settlementLine.findMany({
    where: { expenseId: id },
    include: { settlement: true },
  });
  const f = await facts(tx, [id]);
  const labels = await settings.basLabels(tx, [row.basCode]);
  const withLabels = await linking.linksWithLabels(tx, { type: "expense", id });
  const isOpen = await isExpenseOpen(tx, id);
  const audit = await getAuditLog(tx, { entityType: "expense", entityId: id, limit: 20 });
  const partner = row.partnerId ? await partners.getPartner(tx, row.partnerId) : null;
  const dto = toExpenseDto(row);
  const derived = statusOf(dto, row.paymentSource.kind as PaymentSourceKind, f, id);
  const origin = withLabels.find((l) => l.kind === "created_from" && l.from.id === id);
  let document: ExpenseDetail["document"] = null;
  if (origin) {
    const d = (await documents.getDocument(tx, origin.to.id)).data;
    document = d
      ? {
          id: d.id,
          businessKey: d.businessKey,
          fileName: d.fileName,
          reverseCharge: f.reverseCharge.has(id),
        }
      : null;
  }
  const bookingDates = await banking.bookingDates(
    tx,
    settlementLines.map((l) => l.settlement.bankTransactionId),
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
      partner: partner?.data
        ? { id: partner.data.id, name: partner.data.name, isActive: partner.data.isActive }
        : null,
      ...derived,
      isOpen,
      document,
      links: withLabels,
      settlements: settlementLines.map((l) => ({
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

// --- spend per partner (F87, FR-006) — the partner page composes this read; partners never import expenses ---

export type PartnerExpenseRow = Pick<
  ExpenseListRow,
  | "id"
  | "key"
  | "date"
  | "groupNumber"
  | "description"
  | "basCode"
  | "basLabel"
  | "amount"
  | "currency"
  | "amountBase"
  | "baseProvisional"
  | "status"
> & {
  /** the D40 family of the state, so the partner page draws it without importing expenses' UI */
  stateFamily: StateFamily;
};

export type PartnerExpenses = {
  /** newest first, at most `PARTNER_EXPENSE_ROWS` — the list behind *Open in Expenses* has them all */
  rows: PartnerExpenseRow[];
  count: number;
  /** Σ amount_base of every expense of the partner — the same base the list's footer sums */
  totalBase: string;
  /** a base in the total is the ECB estimate of a company-paid expense not yet attached (`*`) */
  anyProvisional: boolean;
};

export const PARTNER_EXPENSE_ROWS = 25;

export async function expensesForPartner(
  tx: TransactionClient,
  partnerId: string,
): Promise<PartnerExpenses> {
  const all = await loadRows(tx, {
    page: 1,
    pageSize: ROW_CAP,
    sort: EXPENSE_DEFAULT_SORT,
    filters: { partnerId: { kind: "in", values: [partnerId] } },
  });
  let total = new D(0);
  for (const r of all) total = total.plus(r.amountBase);
  return {
    rows: all.slice(0, PARTNER_EXPENSE_ROWS).map((r) => ({
      id: r.id,
      key: r.key,
      date: r.date,
      groupNumber: r.groupNumber,
      description: r.description,
      basCode: r.basCode,
      basLabel: r.basLabel,
      amount: r.amount,
      currency: r.currency,
      amountBase: r.amountBase,
      baseProvisional: r.baseProvisional,
      status: r.status,
      stateFamily: expenseStateFamily(r.status),
    })),
    count: all.length,
    totalBase: total.toFixed(2),
    anyProvisional: all.some((r) => r.baseProvisional),
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
