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
import { fxDifference } from "@/kernel/money/settlement";
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
import { activeSettlementTransactionIds, settlementDtos } from "./settlements";
import { expenseStateFamily } from "./state-family";
import { deriveExpenseStatus, openBase, openOn } from "./status";
import type {
  DocumentOption,
  ExpenseDto,
  ExpenseGroupDto,
  ExpenseListRow,
  ExpenseStatus,
  LedgerSnapshot,
  LedgerSource,
  PayerKind,
  SettlementDto,
} from "./types";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export { getExpense } from "./expenses";
export { getGroup } from "./groups";
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
  rateSource: { type: "enum" },
  paidFromAccountId: { type: "enum" },
  payerLabel: { type: "enum" },
  payerKind: { type: "enum" },
  status: { type: "enum" },
  allocated: { type: "money" },
  open: { type: "money" },
  allocatedBase: { type: "money", sum: true },
  openBase: { type: "money", sum: true },
  fxDifference: { type: "money", sum: true },
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
  "payerLabel",
  "payerKind",
  "status",
  "allocated",
  "open",
  "allocatedBase",
  "openBase",
  "fxDifference",
  "hasDocument",
  "reverseCharge",
]);
const STORED_COLUMNS: ColumnMap = Object.fromEntries(
  Object.entries(EXPENSE_COLUMNS).filter(([k]) => !DERIVED.has(k)),
);
const ROW_CAP = 20_000;

type Facts = {
  /** the allocating links onto each expense — `justifies` from the paying row, `settles` from the refund row (F114) */
  allocations: Map<string, linking.AllocationOnto[]>;
  /** expenses with a created_from document, or any document justifying them */
  hasDocument: Set<string>;
  /** expenses made from a document that says the buyer pays the VAT (D54, F91) — a tag, nothing computed */
  reverseCharge: Set<string>;
};

async function facts(tx: TransactionClient, ids: readonly string[]): Promise<Facts> {
  const f: Facts = { allocations: new Map(), hasDocument: new Set(), reverseCharge: new Set() };
  if (ids.length === 0) return f;
  f.allocations = await linking.allocationsOnto(tx, "expense", ids);
  const links = await linking.linksTouching(tx, "expense", ids, {
    kinds: ["created_from", "justifies"],
  });
  const origin = new Map<string, string>(); // expense → the document it was made from
  for (const l of links) {
    if (l.kind === "created_from") {
      if (l.from.type === "expense") {
        f.hasDocument.add(l.from.id);
        origin.set(l.from.id, l.to.id);
      }
    } else if (l.to.type === "expense" && l.from.type === "document") f.hasDocument.add(l.to.id);
  }
  const flagged = await documents.reverseChargeDocumentIds(tx, [...origin.values()]);
  for (const [expenseId, documentId] of origin) {
    if (flagged.has(documentId)) f.reverseCharge.add(expenseId);
  }
  return f;
}

/** The derived money of one expense from its links (F114): status, what is allocated and open, the FX difference. */
export type DerivedMoney = {
  status: ExpenseStatus;
  allocated: string;
  open: string;
  allocatedBase: string;
  openBase: string;
  fxDifference: string;
};

export function statusOf(
  e: Pick<ExpenseDto, "amount" | "amountBase">,
  payerKind: PayerKind,
  f: Facts,
  id: string,
): DerivedMoney {
  const allocations = f.allocations.get(id) ?? [];
  const fx = fxDifference(e.amount, e.amountBase, allocations);
  const status = deriveExpenseStatus({
    paidByPrivate: payerKind === "private",
    amount: e.amount,
    allocated: fx.allocated.toFixed(2),
  });
  return {
    status,
    allocated: fx.allocated.toFixed(2),
    open: openOn(e.amount, fx.allocated).toFixed(2),
    allocatedBase: fx.allocatedBase.toFixed(2),
    openBase:
      payerKind === "private" ? openBase(e.amount, e.amountBase, allocations).toFixed(2) : "0.00",
    fxDifference: fx.allocated.gt(0) ? fx.difference.toFixed(2) : "0.00",
  };
}

const PAYER_SELECT = {
  select: { id: true, accountAlias: true, accountNumber: true, currency: true, role: true },
} as const;
type PayerRow = {
  id: string;
  accountAlias: string | null;
  accountNumber: string;
  currency: string;
  role: string;
};
const payerKindOf = (a: PayerRow): PayerKind =>
  a.role === "owner_private" ? "private" : "bank_account";

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
    include: { group: true, paidFromAccount: PAYER_SELECT },
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
    const derived = statusOf(dto, payerKindOf(r.paidFromAccount), f, r.id);
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
      rateSource: dto.rateSource,
      paidFromAccountId: dto.paidFromAccountId,
      payerLabel: banking.accountLabel(r.paidFromAccount),
      payerKind: payerKindOf(r.paidFromAccount),
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
  payer: { id: string; label: string; kind: PayerKind; currency: string };
  basLabel: string;
  /** the expense's partner (F87) — a deactivated one stays shown, greyed */
  partner: { id: string; name: string; isActive: boolean } | null;
  status: ExpenseStatus;
  allocated: string;
  open: string;
  allocatedBase: string;
  openBase: string;
  fxDifference: string;
  /** the money facts may still change (`isExpenseOpen`, D37) — the panel reads this, never its own copy */
  isOpen: boolean;
  /** the document it was made from; `reverseCharge` — it says the buyer pays the VAT (D54, F91) */
  document: { id: string; businessKey: string; fileName: string; reverseCharge: boolean } | null;
  links: (LinkDto & { otherLabel: string | null })[];
  /** the payments (F114): one per allocating link — the row, what it pays, the base it gave */
  payments: {
    linkId: string;
    kind: "justifies" | "settles";
    bankTransactionId: string;
    bookingDate: string | null;
    rowLabel: string | null;
    allocatedAmount: string;
    currency: string;
    allocatedBase: string;
  }[];
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
    include: { group: true, paidFromAccount: PAYER_SELECT },
  });
  if (!row)
    return { error: { code: "NOT_FOUND", message: `Expense not found: ${id}`, retryable: false } };
  const f = await facts(tx, [id]);
  const labels = await settings.basLabels(tx, [row.basCode]);
  const withLabels = await linking.linksWithLabels(tx, { type: "expense", id });
  const isOpen = await isExpenseOpen(tx, id);
  const audit = await getAuditLog(tx, { entityType: "expense", entityId: id, limit: 20 });
  const partner = row.partnerId ? await partners.getPartner(tx, row.partnerId) : null;
  const dto = toExpenseDto(row);
  const payerKind = payerKindOf(row.paidFromAccount);
  const derived = statusOf(dto, payerKind, f, id);
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
  // the payments: the allocating links from bank rows, with the row's date; the settlements those rows carry
  const paymentLinks = withLabels.filter(
    (l) =>
      l.from.type === "bank_transaction" &&
      l.to.id === id &&
      l.allocatedAmount &&
      (l.kind === "justifies" || l.kind === "settles"),
  );
  const rowIds = paymentLinks.map((l) => l.from.id);
  const bookingDates = await banking.bookingDates(tx, rowIds);
  const settlements = await settlementsForRows(tx, rowIds);
  return {
    data: {
      expense: dto,
      group: toGroupDto(row.group),
      groupLabel: groupLabel(row.group),
      payer: {
        id: row.paidFromAccount.id,
        label: banking.accountLabel(row.paidFromAccount),
        kind: payerKind,
        currency: row.paidFromAccount.currency,
      },
      basLabel: labels.get(row.basCode) ?? row.basCode,
      partner: partner?.data
        ? { id: partner.data.id, name: partner.data.name, isActive: partner.data.isActive }
        : null,
      ...derived,
      isOpen,
      document,
      links: withLabels,
      payments: paymentLinks.map((l) => ({
        linkId: l.id,
        kind: l.kind as "justifies" | "settles",
        bankTransactionId: l.from.id,
        bookingDate: bookingDates.get(l.from.id) ?? null,
        rowLabel: l.otherLabel,
        allocatedAmount: l.allocatedAmount ?? "0.00",
        currency: l.currency ?? dto.currency,
        allocatedBase: l.allocatedBase ?? "0.00",
      })),
      settlements: paymentLinks
        .filter((l) => l.kind === "settles")
        .flatMap((l) => {
          const st = settlements.get(l.from.id);
          return st
            ? [
                {
                  id: st.id,
                  number: st.number,
                  allocatedBase: l.allocatedBase ?? "0.00",
                  status: st.status,
                  bookingDate: bookingDates.get(l.from.id) ?? null,
                },
              ]
            : [];
        }),
      history: expenseHistory(audit),
    },
  };
}

/** The active settlement of each refund row, by row id (one active per row — the partial unique index). */
async function settlementsForRows(
  tx: TransactionClient,
  rowIds: readonly string[],
): Promise<Map<string, { id: string; number: string; status: string }>> {
  if (rowIds.length === 0) return new Map();
  const rows = await tx.settlement.findMany({
    where: { bankTransactionId: { in: [...new Set(rowIds)] } },
    select: { id: true, number: true, status: true, bankTransactionId: true },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const out = new Map<string, { id: string; number: string; status: string }>();
  for (const r of rows) if (!out.has(r.bankTransactionId)) out.set(r.bankTransactionId, r);
  return out;
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
      status: r.status,
      stateFamily: expenseStateFamily(r.status),
    })),
    count: all.length,
    totalBase: total.toFixed(2),
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
    include: {
      expenses: { include: { paidFromAccount: PAYER_SELECT } },
      trip: { select: { id: true } },
    },
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
      if (payerKindOf(e.paidFromAccount) === "private") {
        open = open.plus(openBase(e.amount, e.amountBase, f.allocations.get(e.id) ?? []));
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
  /** the payer(s) of the refunded expenses — one label, or several joined */
  payerLabel: string;
  lineCount: number;
};

export async function listSettlements(tx: TransactionClient): Promise<SettlementListRow[]> {
  const rows = await tx.settlement.findMany({ orderBy: [{ createdAt: "desc" }] });
  const dtos = await settlementDtos(tx, rows);
  const expenseIds = [...new Set(dtos.flatMap((d) => d.lines.map((l) => l.expenseId)))];
  const payers = await tx.expense.findMany({
    where: { id: { in: expenseIds } },
    select: { id: true, paidFromAccount: PAYER_SELECT },
  });
  const payerOf = new Map(payers.map((e) => [e.id, banking.accountLabel(e.paidFromAccount)]));
  return dtos.map((d) => ({
    ...d,
    payerLabel: [...new Set(d.lines.map((l) => payerOf.get(l.expenseId) ?? ""))]
      .filter(Boolean)
      .join(", "),
    lineCount: d.lines.length,
  }));
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
  const payers = await banking.payerAccounts(tx);
  const rows = await tx.expense.findMany({
    select: { id: true, amount: true, amountBase: true, paidFromAccountId: true },
  });
  const f = await facts(
    tx,
    rows.map((e) => e.id),
  );
  const out: LedgerSource[] = [];
  let totalOpen = new D(0);
  let totalAllocated = new D(0);
  let totalCount = 0;
  let awaitingLink = 0;
  for (const p of payers) {
    const own = rows.filter((e) => e.paidFromAccountId === p.id);
    if (p.kind !== "private") {
      for (const e of own) {
        const fx = fxDifference(e.amount, e.amountBase, f.allocations.get(e.id) ?? []);
        const status = deriveExpenseStatus({
          paidByPrivate: false,
          amount: e.amount.toFixed(2),
          allocated: fx.allocated.toFixed(2),
        });
        if (status === "awaiting_link") awaitingLink += 1;
      }
      continue;
    }
    let open = new D(0);
    let allocated = new D(0);
    let count = 0;
    for (const e of own) {
      const allocations = f.allocations.get(e.id) ?? [];
      allocated = allocated.plus(allocations.reduce((acc, a) => acc.plus(a.base), new D(0)));
      const o = openBase(e.amount, e.amountBase, allocations);
      if (!o.isZero()) {
        open = open.plus(o);
        count += 1;
      }
    }
    out.push({
      paidFromAccountId: p.id,
      label: p.label,
      currency: p.currency,
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
