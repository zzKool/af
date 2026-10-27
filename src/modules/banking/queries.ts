// Read API of the banking module. The transactions list carries DERIVED columns (state from links + the row's
// flag; the labels of its category and partner) that no `where` can express, so it runs in two steps like the
// invoices list: Prisma filters the stored columns, the labels and allocations are joined over that set, and
// the derived filters / search / sort / page run in memory (cap 20 000 rows).
import { Prisma } from "@/generated/prisma/browser";
import { addDays } from "@/kernel/clock/calendar";
import { mapInOrder, type TransactionClient } from "@/kernel/db/tenant-client";
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
import { isSettled } from "@/kernel/money/settlement";
import type { LinkDto } from "@/modules/linking";
import * as linking from "@/modules/linking";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { accountLabel } from "./bank-accounts";
import { type BalanceRow, balanceChain, type Completeness } from "./completeness";
import { iso, toImportDto, toTransactionDto } from "./dto";
import { withImplicitRates } from "./implicit-rate";
import { type LinkFacts, linkFactsOf, type RowForFacts } from "./link-facts";
import { listRules } from "./rules";
import { proposeTransfers } from "./transfer-pairs";
import type {
  AccountBalance,
  BankAccountRole,
  BankImportDto,
  BankTransactionDto,
  OutgoingMainRow,
  RuleListRow,
  TransactionListRow,
  TransactionState,
  TransactionStateFacts,
  TransferProposal,
  WindowRow,
} from "./types";

export { getBankAccounts, getBankFormats } from "./bank-accounts";
export { listRules } from "./rules";
export { proposeTransfers } from "./transfer-pairs";

const D = Prisma.Decimal;
type Dec = InstanceType<typeof Prisma.Decimal>;

export const TRANSACTION_COLUMNS = {
  bookingDate: { type: "date" },
  bankAccountId: { type: "enum" },
  accountLabel: { type: "enum" },
  description: { type: "text", searchable: true },
  counterpartyKey: { type: "text", searchable: true },
  amount: { type: "money", sum: true },
  currency: { type: "enum" },
  balance: { type: "money" },
  reference: { type: "text", searchable: true },
  ownNotes: { type: "text", searchable: true },
  amountBase: { type: "money", sum: true },
  rate: { type: "number" },
  rateSource: { type: "enum" },
  basCode: { type: "enum" },
  basLabel: { type: "text" },
  partnerId: { type: "enum" },
  partnerName: { type: "text", searchable: true },
  note: { type: "text", searchable: true },
  noDocumentNeeded: { type: "boolean" },
  categorisedBy: { type: "enum" },
  state: { type: "enum" },
  allocated: { type: "money" },
  bankImportId: { type: "enum" },
  createdAt: { type: "date" },
} as const satisfies ColumnMap;

export type TransactionColumn = keyof typeof TRANSACTION_COLUMNS;
export const TRANSACTION_COLUMN_KEYS = Object.keys(TRANSACTION_COLUMNS) as TransactionColumn[];
export const TRANSACTION_DEFAULT_SORT: SortSpec[] = [
  { col: "bookingDate", dir: "desc" },
  { col: "createdAt", dir: "desc" },
];

// `rate` is stored but filtered in memory: a `number` column over a Decimal(18,6) keeps the in-memory semantics
const DERIVED: ReadonlySet<string> = new Set([
  "accountLabel",
  "rate",
  "basLabel",
  "partnerName",
  "state",
  "allocated",
]);
const STORED_COLUMNS: ColumnMap = Object.fromEntries(
  Object.entries(TRANSACTION_COLUMNS).filter(([k]) => !DERIVED.has(k)),
);
const ROW_CAP = 20_000;

// --- the derived state ---

/**
 * What each transaction has allocated FROM it, in its own currency (allocating kinds — `justifies`, `settles`;
 * a cross-currency link counts by the share of the row's base it took, F114), and which ones sit in a transfer
 * link — one query through linking's read API (lessons audit 22), the Months panel's `linkFactsOf` rule.
 */
async function linkFacts(tx: TransactionClient, rows: readonly RowForFacts[]): Promise<LinkFacts> {
  if (rows.length === 0) return { allocated: new Map(), transfer: new Set() };
  const links = await linking.linksTouching(
    tx,
    "bank_transaction",
    rows.map((r) => r.id),
  );
  return linkFactsOf(links, rows);
}

/**
 * The account each of `transactionIds` was booked on, as its label (`accountLabel`: the alias, else number +
 * currency), in one query. Ids that are not this tenant's transactions are absent.
 */
export async function accountAliasesFor(
  tx: TransactionClient,
  transactionIds: readonly string[],
): Promise<Map<string, string>> {
  if (transactionIds.length === 0) return new Map();
  const rows = await tx.bankTransaction.findMany({
    where: { id: { in: [...transactionIds] } },
    select: {
      id: true,
      bankAccount: { select: { accountAlias: true, accountNumber: true, currency: true } },
    },
  });
  return new Map(rows.map((r) => [r.id, accountLabel(r.bankAccount)]));
}

/**
 * `no_document` when the flag is set or the row is a transfer leg (the other statement row is its proof — derived
 * from the `transfer` link, never written on the entry: F65); `linked` when Σ ≥ |amount| − tolerance; `partial`
 * when Σ > 0; else `open`.
 */
export function deriveTransactionState(input: {
  amount: string;
  allocated: string;
  inTransfer: boolean;
  noDocumentNeeded: boolean;
}): TransactionState {
  if (input.noDocumentNeeded || input.inTransfer) return "no_document";
  const abs = new D(input.amount).abs();
  const allocated = new D(input.allocated);
  if (allocated.lte(0)) return "open";
  if (isSettled(abs, [allocated])) return "linked";
  return "partial";
}

// --- the list ---

async function loadRows(
  tx: TransactionClient,
  q: ListQuery,
  options: { exceptColumn?: string } = {},
): Promise<TransactionListRow[]> {
  const where = buildWhere({ ...q, search: undefined }, STORED_COLUMNS, {
    exceptColumn: options.exceptColumn,
  });
  const rows = await tx.bankTransaction.findMany({
    where,
    orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
    take: ROW_CAP,
    include: {
      bankAccount: { select: { accountAlias: true, accountNumber: true, currency: true } },
    },
  });
  const dtos = await withImplicitRates(tx, rows.map(toTransactionDto));
  const facts = await linkFacts(tx, rows);
  const partnerIds = [...new Set(rows.flatMap((r) => (r.partnerId ? [r.partnerId] : [])))];
  const codes = rows.flatMap((r) => (r.basCode ? [r.basCode] : []));
  const names = await partners.partnerNames(tx, partnerIds);
  const labels = await settings.basLabels(tx, codes);
  const list: TransactionListRow[] = rows.map((r, i) => {
    const dto = dtos[i] as (typeof dtos)[number];
    const allocated = facts.allocated.get(r.id) ?? "0.00";
    return {
      id: r.id,
      bankAccountId: r.bankAccountId,
      accountLabel: accountLabel(r.bankAccount),
      bankImportId: r.bankImportId,
      bookingDate: dto.bookingDate,
      description: r.description,
      counterpartyKey: r.counterpartyKey,
      amount: dto.amount,
      currency: r.currency,
      balance: dto.balance,
      reference: r.reference,
      ownNotes: r.ownNotes,
      amountBase: dto.amountBase,
      rate: dto.rate,
      rateSource: dto.rateSource,
      bankImplicitRate: dto.bankImplicitRate,
      basCode: r.basCode,
      basLabel: r.basCode ? (labels.get(r.basCode) ?? r.basCode) : null,
      partnerId: r.partnerId,
      partnerName: r.partnerId ? (names.get(r.partnerId) ?? null) : null,
      note: r.note,
      noDocumentNeeded: r.noDocumentNeeded,
      categorisedBy: r.categorisedBy,
      state: deriveTransactionState({
        amount: dto.amount,
        allocated,
        inTransfer: facts.transfer.has(r.id),
        noDocumentNeeded: r.noDocumentNeeded,
      }),
      allocated,
      createdAt: r.createdAt,
    };
  });
  return filterInMemory(list, q, TRANSACTION_COLUMNS, {
    derived: DERIVED,
    search: searchHit,
    exceptColumn: options.exceptColumn,
  });
}

function searchHit(row: TransactionListRow, term: string): boolean {
  const t = term.toLowerCase();
  return [
    row.description,
    row.counterpartyKey,
    row.reference,
    row.ownNotes,
    row.partnerName,
    row.note,
    row.basLabel,
  ].some((v) => (v ?? "").toLowerCase().includes(t));
}

/** The accounts a rule may be bound to (F116 PR C1): the statement accounts — a private instrument has no rows. */
export async function ruleAccountOptions(
  tx: TransactionClient,
): Promise<{ id: string; label: string }[]> {
  const rows = await tx.bankAccount.findMany({
    where: { bankFormatId: { not: null } },
    select: { id: true, accountAlias: true, accountNumber: true, currency: true },
    orderBy: [{ role: "asc" }, { currency: "asc" }],
  });
  return rows.map((a) => ({ id: a.id, label: accountLabel(a) }));
}

/** The ids of the main accounts (SEK / CHF) — what the inbox and the settle page consider. */
export async function listMainAccountIds(tx: TransactionClient): Promise<string[]> {
  const rows = await tx.bankAccount.findMany({ where: { role: "main" }, select: { id: true } });
  return rows.map((r) => r.id);
}

export async function listTransactions(
  tx: TransactionClient,
  q: ListQuery,
): Promise<ListResult<TransactionListRow>> {
  const all = await loadRows(tx, q);
  return finishList(all, q, TRANSACTION_COLUMNS, TRANSACTION_DEFAULT_SORT);
}

export async function distinctTransactionValues(
  tx: TransactionClient,
  column: TransactionColumn,
  q: ListQuery,
): Promise<DistinctValue[]> {
  const rows = await loadRows(tx, q, { exceptColumn: column });
  return countDistinct(
    rows.map((r) => r[column as keyof TransactionListRow]),
    TRANSACTION_COLUMNS[column],
  );
}

export async function transactionDateHierarchy(
  tx: TransactionClient,
  column: TransactionColumn,
  q: ListQuery,
): Promise<DateHierarchy> {
  if (TRANSACTION_COLUMNS[column].type !== "date") return { years: [], empty: 0 };
  const rows = await loadRows(tx, q, { exceptColumn: column });
  return buildDateHierarchy(
    rows.map((r) => r[column as keyof TransactionListRow] as Date | string | null),
  );
}

// --- the read API other modules call instead of reading `bank_transactions` (lessons audit 23) ---

/**
 * Outgoing rows on main accounts, newest first, with their base — what the settle / attach pickers (expenses)
 * and the *Link payment* picker (supplier invoices) start from. Each caller filters its own (rows that already
 * settle, rows with nothing left to allocate), so it asks for more than it shows.
 */
export async function outgoingMainRows(
  tx: TransactionClient,
  limit: number,
): Promise<OutgoingMainRow[]> {
  const rows = await tx.bankTransaction.findMany({
    where: { amount: { lt: 0 }, bankAccount: { role: "main" } },
    include: { bankAccount: true },
    orderBy: [{ bookingDate: "desc" }, { id: "asc" }],
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    bookingDate: r.bookingDate.toISOString().slice(0, 10),
    amount: r.amount.toFixed(2),
    currency: r.currency,
    description: r.description,
    bankAccountId: r.bankAccountId,
    accountLabel: accountLabel(r.bankAccount),
    amountBase: r.amountBase.toFixed(2),
  }));
}

/**
 * Outgoing rows of the given accounts booked inside `[from, to]` (inclusive) that still have something left to
 * justify, with every text field Nordea gave and the owner's facts a matcher reads (F94: the subscriptions module's
 * row candidates — it never reads `bank_transactions` itself). Oldest first; a row whose state is *linked* or
 * *no document* is dropped (its `noDocumentNeeded` flag is still reported on the rest).
 */
export async function outgoingRowsInWindow(
  tx: TransactionClient,
  q: { bankAccountIds: readonly string[]; from: string; to: string },
): Promise<WindowRow[]> {
  if (q.bankAccountIds.length === 0 || q.from > q.to) return [];
  const rows = await tx.bankTransaction.findMany({
    where: {
      amount: { lt: 0 },
      bankAccountId: { in: [...q.bankAccountIds] },
      bookingDate: { gte: new Date(`${q.from}T00:00:00Z`), lte: new Date(`${q.to}T00:00:00Z`) },
    },
    orderBy: [{ bookingDate: "asc" }, { id: "asc" }],
  });
  if (rows.length === 0) return [];
  const states = await transactionStates(
    tx,
    rows.map((r) => r.id),
  );
  const out: WindowRow[] = [];
  for (const r of rows) {
    const state = states.get(r.id);
    if (state && (state.state === "linked" || state.state === "no_document")) continue;
    const abs = r.amount.abs();
    out.push({
      id: r.id,
      bankAccountId: r.bankAccountId,
      bookingDate: r.bookingDate.toISOString().slice(0, 10),
      amount: abs.toFixed(2),
      currency: r.currency,
      amountBase: r.amountBase.abs().toFixed(2),
      texts: [r.name, r.message, r.additionalDetails, r.sender, r.recipient, r.description].filter(
        (t): t is string => !!t && t.trim() !== "",
      ),
      description: r.description,
      partnerId: r.partnerId,
      basCode: r.basCode,
      noDocumentNeeded: r.noDocumentNeeded,
      remaining: abs.minus(state?.allocated ?? "0").toFixed(2),
    });
  }
  return out;
}

/** Booking dates (`YYYY-MM-DD`) of bank rows by id; an unknown id is absent. */
export async function bookingDates(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.bankTransaction.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, bookingDate: true },
  });
  return new Map(rows.map((r) => [r.id, r.bookingDate.toISOString().slice(0, 10)]));
}

/**
 * The derived state of each of `ids` with its allocation and transfer facts — the rule `deriveTransactionState`
 * applies, read in three queries (rows, allocations, transfer links). An unknown id is absent.
 */
export async function transactionStates(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<Map<string, TransactionStateFacts>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx.bankTransaction.findMany({
    where: { id: { in: unique } },
    select: { id: true, amount: true, currency: true, amountBase: true, noDocumentNeeded: true },
  });
  const facts = await linkFacts(tx, rows);
  return new Map(
    rows.map((r) => {
      const allocated = facts.allocated.get(r.id) ?? "0.00";
      const inTransfer = facts.transfer.has(r.id);
      const state = deriveTransactionState({
        amount: r.amount.toFixed(2),
        allocated,
        inTransfer,
        noDocumentNeeded: r.noDocumentNeeded,
      });
      return [r.id, { state, allocated, inTransfer }];
    }),
  );
}

/** The first booking date (`YYYY-MM-DD`) of any bank row, or null before the first import. */
export async function firstBookingDate(tx: TransactionClient): Promise<string | null> {
  const first = await tx.bankTransaction.findFirst({
    orderBy: { bookingDate: "asc" },
    select: { bookingDate: true },
  });
  return first ? first.bookingDate.toISOString().slice(0, 10) : null;
}

// --- single reads ---

export type TransactionDetail = {
  /** the row with its facts and the transfer pair's implied rate (D44) */
  transaction: BankTransactionDto & { bankImplicitRate: string | null };
  accountLabel: string;
  state: TransactionState;
  allocated: string;
  links: (LinkDto & { otherLabel: string | null })[];
  transfers: TransferProposal[];
  import: BankImportDto | null;
};

/** The bare row with its account label — what another module needs to copy a bank fact (the expenses attach, the settlement). */
export async function getBankTransaction(
  tx: TransactionClient,
  id: string,
): Promise<(BankTransactionDto & { accountLabel: string; accountRole: BankAccountRole }) | null> {
  const row = await tx.bankTransaction.findUnique({
    where: { id },
    include: { bankAccount: true },
  });
  if (!row) return null;
  return {
    ...toTransactionDto(row),
    accountLabel: accountLabel(row.bankAccount),
    accountRole: row.bankAccount.role as BankAccountRole,
  };
}

export async function getTransaction(
  tx: TransactionClient,
  id: string,
): Promise<ServiceResult<TransactionDetail>> {
  const row = await tx.bankTransaction.findUnique({
    where: { id },
    include: { bankAccount: true, bankImport: true },
  });
  if (!row)
    return {
      error: { code: "NOT_FOUND", message: `Bank transaction not found: ${id}`, retryable: false },
    };
  const [transaction] = await withImplicitRates(tx, [toTransactionDto(row)]);
  const facts = await linkFacts(tx, [row]);
  const links = await linking.getLinksFor(tx, { type: "bank_transaction", id });
  const transfers = await proposeTransfers(tx, id);
  const allocated = facts.allocated.get(id) ?? "0.00";
  const withLabels = await mapInOrder(links.data ?? [], async (l) => {
    const other = l.from.type === "bank_transaction" && l.from.id === id ? l.to : l.from;
    const linkable = linking.getLinkable(other.type);
    const summary = linkable ? await linkable.summary(tx, other.id) : null;
    return { ...l, otherLabel: summary?.label ?? null };
  });
  return {
    data: {
      transaction: transaction as NonNullable<typeof transaction>,
      accountLabel: accountLabel(row.bankAccount),
      state: deriveTransactionState({
        amount: row.amount.toFixed(2),
        allocated,
        inTransfer: facts.transfer.has(id),
        noDocumentNeeded: row.noDocumentNeeded,
      }),
      allocated,
      links: withLabels,
      transfers: transfers.data ?? [],
      import: row.bankImport ? toImportDto(row.bankImport) : null,
    },
  };
}

// --- imports, rules, accounts ---

export async function listImports(
  tx: TransactionClient,
): Promise<(BankImportDto & { accountLabel: string })[]> {
  const rows = await tx.bankImport.findMany({
    include: {
      bankAccount: { select: { accountAlias: true, accountNumber: true, currency: true } },
    },
    orderBy: { importedAt: "desc" },
  });
  return rows.map((r) => ({ ...toImportDto(r), accountLabel: accountLabel(r.bankAccount) }));
}

export async function listRulesWithLabels(tx: TransactionClient): Promise<RuleListRow[]> {
  const rules = await listRules(tx);
  const partnerIds = [...new Set(rules.flatMap((r) => (r.partnerId ? [r.partnerId] : [])))];
  const names = await partners.partnerNames(tx, partnerIds);
  const labels = await settings.basLabels(
    tx,
    rules.flatMap((r) => (r.basCode ? [r.basCode] : [])),
  );
  return rules.map((r) => ({
    ...r,
    partnerName: r.partnerId ? (names.get(r.partnerId) ?? null) : null,
    basLabel: r.basCode ? (labels.get(r.basCode) ?? r.basCode) : null,
  }));
}

// --- the imports and rules pages as DataTables: a handful of rows, so filtered / sorted / paged in memory ---

type MemoryRow = object;

/** The ListQuery side of a small list: every column evaluated on the loaded rows (same semantics as SQL). */
function memoryTable<Row extends MemoryRow>(
  columns: ColumnMap,
  defaultSort: SortSpec[],
  search: (row: Row, term: string) => boolean,
) {
  const derived: ReadonlySet<string> = new Set(Object.keys(columns));
  const filtered = (rows: Row[], q: ListQuery, exceptColumn?: string) =>
    filterInMemory(rows, q, columns, { derived, search, exceptColumn });
  return {
    list: (rows: Row[], q: ListQuery): ListResult<Row> =>
      finishList(filtered(rows, q), q, columns, defaultSort),
    distinct: (rows: Row[], column: string, q: ListQuery): DistinctValue[] =>
      countDistinct(
        filtered(rows, q, column).map((r) => (r as Record<string, unknown>)[column]),
        columns[column],
      ),
    dates: (rows: Row[], column: string, q: ListQuery): DateHierarchy =>
      columns[column]?.type === "date"
        ? buildDateHierarchy(
            filtered(rows, q, column).map(
              (r) => (r as Record<string, unknown>)[column] as Date | string | null,
            ),
          )
        : { years: [], empty: 0 },
  };
}

export const IMPORT_COLUMNS = {
  fileName: { type: "text", searchable: true },
  accountLabel: { type: "enum" },
  periodFrom: { type: "date" },
  recordCount: { type: "number" },
  importedCount: { type: "number" },
  duplicateCount: { type: "number" },
  errorCount: { type: "number" },
  importedAt: { type: "date" },
} as const satisfies ColumnMap;
export type ImportColumn = keyof typeof IMPORT_COLUMNS;
export const IMPORT_COLUMN_KEYS = Object.keys(IMPORT_COLUMNS) as ImportColumn[];
export const IMPORT_DEFAULT_SORT: SortSpec[] = [{ col: "importedAt", dir: "desc" }];
export type ImportListRow = BankImportDto & { accountLabel: string };

const importsTable = memoryTable<ImportListRow>(IMPORT_COLUMNS, IMPORT_DEFAULT_SORT, (r, term) =>
  r.fileName.toLowerCase().includes(term.toLowerCase()),
);

export async function listImportsPage(
  tx: TransactionClient,
  q: ListQuery,
): Promise<ListResult<ImportListRow>> {
  return importsTable.list(await listImports(tx), q);
}

export async function distinctImportValues(
  tx: TransactionClient,
  column: ImportColumn,
  q: ListQuery,
): Promise<DistinctValue[]> {
  return importsTable.distinct(await listImports(tx), column, q);
}

export async function importDateHierarchy(
  tx: TransactionClient,
  column: ImportColumn,
  q: ListQuery,
): Promise<DateHierarchy> {
  return importsTable.dates(await listImports(tx), column, q);
}

export const RULE_COLUMNS = {
  name: { type: "text", searchable: true },
  matchType: { type: "enum" },
  matchPattern: { type: "text", searchable: true },
  matchField: { type: "enum" },
  basLabel: { type: "enum" },
  partnerName: { type: "enum" },
  noDocumentNeeded: { type: "boolean" },
  priority: { type: "number" },
  isActive: { type: "boolean" },
  ruleSource: { type: "enum" },
  hitCount: { type: "number" },
  lastHitAt: { type: "date" },
} as const satisfies ColumnMap;
export type RuleColumn = keyof typeof RULE_COLUMNS;
export const RULE_COLUMN_KEYS = Object.keys(RULE_COLUMNS) as RuleColumn[];
/** the order the rules run in (`listRules`: priority first) */
export const RULE_DEFAULT_SORT: SortSpec[] = [
  { col: "priority", dir: "desc" },
  { col: "name", dir: "asc" },
];

const rulesTable = memoryTable<RuleListRow>(RULE_COLUMNS, RULE_DEFAULT_SORT, (r, term) => {
  const t = term.toLowerCase();
  return [r.name, r.matchPattern, r.basLabel, r.partnerName].some((v) =>
    (v ?? "").toLowerCase().includes(t),
  );
});

export async function listRulesPage(
  tx: TransactionClient,
  q: ListQuery,
): Promise<ListResult<RuleListRow>> {
  return rulesTable.list(await listRulesWithLabels(tx), q);
}

export async function distinctRuleValues(
  tx: TransactionClient,
  column: RuleColumn,
  q: ListQuery,
): Promise<DistinctValue[]> {
  return rulesTable.distinct(await listRulesWithLabels(tx), column, q);
}

export async function ruleDateHierarchy(
  tx: TransactionClient,
  column: RuleColumn,
  q: ListQuery,
): Promise<DateHierarchy> {
  return rulesTable.dates(await listRulesWithLabels(tx), column, q);
}

/**
 * The balance chain of each account (F115): the first and last balanced day the chain holds between, the gaps.
 * Every row of the account, one query per call — a solo company's accounts hold a few thousand rows.
 */
export async function accountCompleteness(
  tx: TransactionClient,
  accountIds?: readonly string[],
): Promise<Map<string, Completeness>> {
  const rows = await tx.bankTransaction.findMany({
    where: accountIds ? { bankAccountId: { in: [...accountIds] } } : undefined,
    select: { bankAccountId: true, bookingDate: true, amount: true, balance: true, rowIndex: true },
  });
  const byAccount = new Map<string, BalanceRow[]>();
  for (const r of rows) {
    const list = byAccount.get(r.bankAccountId) ?? [];
    list.push({
      bookingDate: iso(r.bookingDate) as string,
      amount: r.amount,
      balance: r.balance,
      rowIndex: r.rowIndex,
    });
    byAccount.set(r.bankAccountId, list);
  }
  const out = new Map<string, Completeness>();
  for (const [id, list] of byAccount) out.set(id, balanceChain(list));
  return out;
}

/** Each account with the balance of its latest booking date that has one (no stored running balance). */
export async function accountBalances(tx: TransactionClient): Promise<AccountBalance[]> {
  const accounts = await tx.bankAccount.findMany({
    orderBy: [{ role: "asc" }, { currency: "asc" }],
    include: {
      imports: { orderBy: { importedAt: "desc" }, take: 1, select: { importedAt: true } },
    },
  });
  const out: AccountBalance[] = [];
  for (const a of accounts) {
    const last = await tx.bankTransaction.findFirst({
      where: { bankAccountId: a.id, balance: { not: null } },
      orderBy: [{ bookingDate: "desc" }, { rowIndex: "asc" }],
      select: { balance: true, bookingDate: true },
    });
    out.push({
      bankAccountId: a.id,
      label: accountLabel(a),
      currency: a.currency,
      role: a.role as BankAccountRole,
      balance: last?.balance ? last.balance.toFixed(2) : null,
      balanceDate: last ? iso(last.bookingDate) : null,
      lastImportAt: a.imports[0]?.importedAt ?? null,
    });
  }
  return out;
}

// --- the accountant package's raw rows (specs/accountant-package/spec.md FR-002) ---

export type RawPeriodRow = BankTransactionDto & {
  accountLabel: string;
  accountRole: BankAccountRole;
  accountCurrency: string;
  importFileName: string;
  /** the account's CSV conventions — the package writes its statements the way the bank did */
  delimiter: string;
  decimalSeparator: string;
};

/**
 * The bank rows of a period with their raw columns, account and source file, for the package's `bank-statements/`
 * and its *Bank statement* sheet. `by: "booking"` selects on the booking date (the main accounts), `by: "import"`
 * on the import's time (the savings export joins the package of the month it was imported in, D31).
 * Ordered booking date ascending, then the file's row order — the deterministic order of R6.
 */
export async function rawRowsForPeriod(
  tx: TransactionClient,
  period: { from: string; to: string; by: "booking" | "import"; role?: BankAccountRole },
): Promise<RawPeriodRow[]> {
  const from = new Date(`${period.from}T00:00:00Z`);
  const toExclusive = new Date(`${addDays(period.to, 1)}T00:00:00Z`);
  const rows = await tx.bankTransaction.findMany({
    where: {
      ...(period.by === "booking"
        ? { bookingDate: { gte: from, lt: toExclusive } }
        : { bankImport: { importedAt: { gte: from, lt: toExclusive } } }),
      ...(period.role ? { bankAccount: { role: period.role } } : {}),
    },
    include: {
      bankAccount: { include: { bankFormat: true } },
      bankImport: { select: { fileName: true, importedAt: true } },
    },
    orderBy: [{ bookingDate: "asc" }, { bankImport: { importedAt: "asc" } }, { rowIndex: "asc" }],
  });
  return rows.map((r) => ({
    ...toTransactionDto(r),
    accountLabel: accountLabel(r.bankAccount),
    accountRole: r.bankAccount.role as BankAccountRole,
    accountCurrency: r.bankAccount.currency,
    importFileName: r.bankImport.fileName,
    // a row is always on a statement account — a private instrument has no rows (CHECK + no format)
    delimiter: r.bankAccount.bankFormat?.delimiter ?? ";",
    decimalSeparator: r.bankAccount.bankFormat?.decimalSeparator ?? ",",
  }));
}
