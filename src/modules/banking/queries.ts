// Read API of the banking module. The transactions list carries DERIVED columns (state from links + the
// journal flag; category, partner, note, base from the journal entry) that no `where` can express, so it runs
// in two steps like the invoices list: Prisma filters the stored columns, the journal facts and allocations
// are joined over that set, and the derived filters / search / sort / page run in memory (cap 20 000 rows).
import { Prisma } from "@/generated/prisma/browser";
import { addDays } from "@/kernel/clock/calendar";
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
import { isSettled } from "@/kernel/money/settlement";
import * as journal from "@/modules/journal";
import type { LinkDto } from "@/modules/linking";
import * as linking from "@/modules/linking";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { accountLabel } from "./bank-accounts";
import { toImportDto, toTransactionDto } from "./import";
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
} from "./types";

export { getBankAccounts, getBankFormats } from "./bank-accounts";
export { listRules } from "./rules";
export { proposeTransfers } from "./transfer-pairs";

const D = Prisma.Decimal;

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

const DERIVED: ReadonlySet<string> = new Set([
  "accountLabel",
  "amountBase",
  "rate",
  "rateSource",
  "basCode",
  "basLabel",
  "partnerId",
  "partnerName",
  "note",
  "noDocumentNeeded",
  "categorisedBy",
  "state",
  "allocated",
]);
const STORED_COLUMNS: ColumnMap = Object.fromEntries(
  Object.entries(TRANSACTION_COLUMNS).filter(([k]) => !DERIVED.has(k)),
);
const ROW_CAP = 20_000;

// --- the derived state ---

type LinkFacts = { allocated: Map<string, string>; transfer: Set<string> };

/**
 * Σ allocations FROM each transaction (allocating kinds — `justifies`, `settles`) and which ones sit in a transfer
 * link — two queries through linking's read API (lessons audit 22).
 */
async function linkFacts(tx: TransactionClient, ids: readonly string[]): Promise<LinkFacts> {
  if (ids.length === 0) return { allocated: new Map(), transfer: new Set() };
  const [allocated, transfers] = await Promise.all([
    linking.allocatedFrom(tx, "bank_transaction", ids),
    linking.linksTouching(tx, "bank_transaction", ids, { kinds: ["transfer"] }),
  ]);
  const transfer = new Set<string>();
  for (const t of transfers) for (const end of [t.from, t.to]) transfer.add(end.id);
  return { allocated, transfer };
}

/**
 * The account each of `transactionIds` was booked on, as its label (`accountLabel`: the alias, else number +
 * currency), in one query — the journal's *Source* column (journal T006) reads it instead of banking's tables.
 * Ids that are not this tenant's transactions are absent.
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

const iso = (d: Date): string => d.toISOString().slice(0, 10);

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
  const ids = rows.map((r) => r.id);
  const [entries, facts] = await Promise.all([
    journal.entriesForSources(tx, "bank_transaction", ids),
    linkFacts(tx, ids),
  ]);
  const partnerIds = [
    ...new Set([...entries.values()].flatMap((e) => (e.partnerId ? [e.partnerId] : []))),
  ];
  const codes = [...entries.values()].flatMap((e) => (e.basCode ? [e.basCode] : []));
  const [names, labels] = await Promise.all([
    partners.partnerNames(tx, partnerIds),
    settings.basLabels(tx, codes),
  ]);
  const list: TransactionListRow[] = rows.map((r) => {
    const e = entries.get(r.id) ?? null;
    const allocated = facts.allocated.get(r.id) ?? "0.00";
    return {
      id: r.id,
      bankAccountId: r.bankAccountId,
      accountLabel: accountLabel(r.bankAccount),
      bankImportId: r.bankImportId,
      bookingDate: iso(r.bookingDate),
      description: r.description,
      counterpartyKey: r.counterpartyKey,
      amount: r.amount.toFixed(2),
      currency: r.currency,
      balance: r.balance ? r.balance.toFixed(2) : null,
      reference: r.reference,
      ownNotes: r.ownNotes,
      journalEntryId: e?.id ?? null,
      amountBase: e?.amountBase ?? null,
      rate: e?.rate ?? null,
      rateSource: e?.rateSource ?? null,
      bankImplicitRate: e?.bankImplicitRate ?? null,
      basCode: e?.basCode ?? null,
      basLabel: e?.basCode ? (labels.get(e.basCode) ?? e.basCode) : null,
      partnerId: e?.partnerId ?? null,
      partnerName: e?.partnerId ? (names.get(e.partnerId) ?? null) : null,
      note: e?.note ?? null,
      noDocumentNeeded: e?.noDocumentNeeded ?? false,
      categorisedBy: e?.categorisedBy ?? null,
      state: deriveTransactionState({
        amount: r.amount.toFixed(2),
        allocated,
        inTransfer: facts.transfer.has(r.id),
        noDocumentNeeded: e?.noDocumentNeeded ?? false,
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
 * Outgoing rows on main accounts, newest first, with their journal base — what the settle / attach pickers
 * (expenses) and the *Link payment* picker (supplier invoices) start from. Each caller filters its own (rows that
 * already settle, rows with nothing left to allocate), so it asks for more than it shows.
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
  const entries = await journal.entriesForSources(
    tx,
    "bank_transaction",
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    bookingDate: r.bookingDate.toISOString().slice(0, 10),
    amount: r.amount.toFixed(2),
    currency: r.currency,
    description: r.description,
    bankAccountId: r.bankAccountId,
    accountLabel: accountLabel(r.bankAccount),
    amountBase: entries.get(r.id)?.amountBase ?? null,
  }));
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
 * applies, read in three queries (rows, journal entries, links). An unknown id is absent.
 */
export async function transactionStates(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<Map<string, TransactionStateFacts>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const [rows, entries, facts] = await Promise.all([
    tx.bankTransaction.findMany({
      where: { id: { in: unique } },
      select: { id: true, amount: true },
    }),
    journal.entriesForSources(tx, "bank_transaction", unique),
    linkFacts(tx, unique),
  ]);
  return new Map(
    rows.map((r) => {
      const allocated = facts.allocated.get(r.id) ?? "0.00";
      const inTransfer = facts.transfer.has(r.id);
      const state = deriveTransactionState({
        amount: r.amount.toFixed(2),
        allocated,
        inTransfer,
        noDocumentNeeded: entries.get(r.id)?.noDocumentNeeded ?? false,
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
  transaction: BankTransactionDto;
  accountLabel: string;
  entry: journal.JournalEntryDto | null;
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
  const [entries, facts, links, transfers] = await Promise.all([
    journal.entriesForSources(tx, "bank_transaction", [id]),
    linkFacts(tx, [id]),
    linking.getLinksFor(tx, { type: "bank_transaction", id }),
    proposeTransfers(tx, id),
  ]);
  const entry = entries.get(id) ?? null;
  const allocated = facts.allocated.get(id) ?? "0.00";
  const withLabels = await Promise.all(
    (links.data ?? []).map(async (l) => {
      const other = l.from.type === "bank_transaction" && l.from.id === id ? l.to : l.from;
      const linkable = linking.getLinkable(other.type);
      const summary = linkable ? await linkable.summary(tx, other.id) : null;
      return { ...l, otherLabel: summary?.label ?? null };
    }),
  );
  return {
    data: {
      transaction: toTransactionDto(row),
      accountLabel: accountLabel(row.bankAccount),
      entry,
      state: deriveTransactionState({
        amount: row.amount.toFixed(2),
        allocated,
        inTransfer: facts.transfer.has(id),
        noDocumentNeeded: entry?.noDocumentNeeded ?? false,
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
  const [names, labels] = await Promise.all([
    partners.partnerNames(tx, partnerIds),
    settings.basLabels(
      tx,
      rules.flatMap((r) => (r.basCode ? [r.basCode] : [])),
    ),
  ]);
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
    delimiter: r.bankAccount.bankFormat.delimiter,
    decimalSeparator: r.bankAccount.bankFormat.decimalSeparator,
  }));
}
