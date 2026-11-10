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
import { type EffectiveFacts, effectiveFactsOf, type ProofFact } from "./effective";
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
import { STATEMENT_ROLES } from "./types";

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
  // the effective category and partner (F129, D73): typed on the row, else the proof's — derived, filtered in memory
  basCode: { type: "enum" },
  basLabel: { type: "text" },
  basFrom: { type: "enum" },
  partnerId: { type: "enum" },
  partnerName: { type: "text", searchable: true },
  partnerFrom: { type: "enum" },
  mixed: { type: "boolean" },
  // F98: the current category proposal (derived, from linking's proposals) — code, source, confidence
  proposedBasCode: { type: "enum" },
  proposedSource: { type: "enum" },
  proposedConfidence: { type: "number" },
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

// `rate` is stored but filtered in memory: a `number` column over a Decimal(18,6) keeps the in-memory semantics;
// the category and the partner are effective values since F129 (the proof's when none is typed), so they join
const DERIVED: ReadonlySet<string> = new Set([
  "accountLabel",
  "rate",
  "basCode",
  "basLabel",
  "basFrom",
  "partnerId",
  "partnerName",
  "partnerFrom",
  "mixed",
  "proposedBasCode",
  "proposedSource",
  "proposedConfidence",
  "state",
  "allocated",
]);
const STORED_COLUMNS: ColumnMap = Object.fromEntries(
  Object.entries(TRANSACTION_COLUMNS).filter(([k]) => !DERIVED.has(k)),
);
const ROW_CAP = 20_000;

// --- the derived state ---

/** A row as the shared read needs it: the link facts' columns and the typed partner / category. */
export type RowForRowFacts = RowForFacts & {
  partnerId: string | null;
  basCode: string | null;
  /** who typed them — a rule's values yield to a proof's (D82) */
  categorisedBy: string | null;
};

export type RowFacts = LinkFacts & {
  /** per row, the effective partner and category (by hand, else the proof's, else a rule's) and their source */
  effective: Map<string, EffectiveFacts>;
  /** the rows with a proof — a `justifies` or `settles` link from them (D82: a rule never speaks for one) */
  proven: Set<string>;
};

/**
 * The one read every page derives a row's state from (F129 FR-005): the links touching the rows once (Σ allocated
 * FROM each row in its currency, the transfer legs — `linkFactsOf`, F114), then the facts of what the allocating
 * links point at, one `factsMany` per target type through linking's registry (banking reads no other module's
 * table), the owner's partner once (a `settles` link pays him back) → `effectiveFactsOf` per row. The list, the
 * panel, the Months panel, the sidebar's count and `transactionStates` all read it.
 */
export async function rowFacts(
  tx: TransactionClient,
  rows: readonly RowForRowFacts[],
): Promise<RowFacts> {
  const effective = new Map<string, EffectiveFacts>();
  if (rows.length === 0)
    return { allocated: new Map(), transfer: new Set(), effective, proven: new Set() };
  const links = await linking.linksTouching(
    tx,
    "bank_transaction",
    rows.map((r) => r.id),
  );
  const facts = linkFactsOf(links, rows);

  // the allocating links FROM the rows, in creation order; their targets' facts by type
  const rowIds = new Set(rows.map((r) => r.id));
  const allocating = links
    .filter(
      (l) =>
        l.from.type === "bank_transaction" &&
        rowIds.has(l.from.id) &&
        (l.kind === "justifies" || l.kind === "settles"),
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const idsByType = new Map<linking.LinkableType, Set<string>>();
  for (const l of allocating)
    idsByType.set(l.to.type, (idsByType.get(l.to.type) ?? new Set()).add(l.to.id));
  const targetFacts = new Map<string, { partnerId: string | null; basCode: string | null }>();
  for (const [type, ids] of idsByType) {
    const linkable = linking.getLinkable(type);
    // a type without a bulk read (a document, a partner) carries no partner or account to inherit
    if (!linkable?.factsMany) continue;
    for (const f of await linkable.factsMany(tx, [...ids]))
      targetFacts.set(`${type}:${f.id}`, {
        partnerId: f.partnerId ?? null,
        basCode: f.basCode ?? null,
      });
  }
  // the owner of the rows' tenant — named, not left to RLS (a read run as the migration role sees every tenant, T026)
  const settledRow = allocating.find((l) => l.kind === "settles")?.from.id;
  const tenantId = settledRow
    ? (
        await tx.bankTransaction.findUnique({
          where: { id: settledRow },
          select: { tenantId: true },
        })
      )?.tenantId
    : undefined;
  const owner = settledRow ? await partners.systemPartner(tx, "owner", tenantId) : null;

  const proofsByRow = new Map<string, ProofFact[]>();
  for (const l of allocating) {
    const target = targetFacts.get(`${l.to.type}:${l.to.id}`);
    const list = proofsByRow.get(l.from.id) ?? [];
    list.push({
      kind: l.kind as ProofFact["kind"],
      allocatedBase: l.allocatedBase,
      partnerId: target?.partnerId ?? null,
      basCode: target?.basCode ?? null,
    });
    proofsByRow.set(l.from.id, list);
  }
  for (const r of rows)
    effective.set(
      r.id,
      effectiveFactsOf(
        { partnerId: r.partnerId, basCode: r.basCode, categorisedBy: r.categorisedBy },
        proofsByRow.get(r.id) ?? [],
        owner?.id ?? null,
      ),
    );
  return { ...facts, effective, proven: new Set(proofsByRow.keys()) };
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

/** The account roles whose rows need no partner to be justified: the other statement is the proof (D13 / F65). */
const NO_PARTNER_ROLES: ReadonlySet<string> = new Set<BankAccountRole>(["savings"]);

/**
 * The one place a row's state is derived (F129 FR-006, D73): a transfer leg is `no_document` (the other statement
 * row is its proof — from the `transfer` link, never written on the row: F65); a flagged row is `no_document` with
 * a partner (typed or effective), `no_document_no_partner` without one — unless it sits on a savings account, whose
 * statement is the proof; else `linked` / `linked_no_partner` when Σ ≥ |amount| − tolerance; `partial` when Σ > 0;
 * else `open`. Four of the six states are still *to justify* (`needsProof`).
 */
export function deriveTransactionState(input: {
  amount: string;
  allocated: string;
  inTransfer: boolean;
  noDocumentNeeded: boolean;
  /** the effective partner (typed, else the proof's) — `effectiveFactsOf` */
  partnerId: string | null;
  accountRole: BankAccountRole;
}): TransactionState {
  if (input.inTransfer) return "no_document";
  const named = input.partnerId !== null || NO_PARTNER_ROLES.has(input.accountRole);
  if (input.noDocumentNeeded) return named ? "no_document" : "no_document_no_partner";
  const abs = new D(input.amount).abs();
  const allocated = new D(input.allocated);
  if (allocated.lte(0)) return "open";
  if (isSettled(abs, [allocated])) return named ? "linked" : "linked_no_partner";
  return "partial";
}

/** `deriveTransactionState` from the shared read's facts for one row. */
function stateOf(
  r: { id: string; amount: string; noDocumentNeeded: boolean },
  facts: RowFacts,
  accountRole: BankAccountRole,
): { state: TransactionState; allocated: string; inTransfer: boolean; effective: EffectiveFacts } {
  const allocated = facts.allocated.get(r.id) ?? "0.00";
  const inTransfer = facts.transfer.has(r.id);
  const effective = facts.effective.get(r.id) ?? {
    partnerId: null,
    partnerFrom: null,
    basCode: null,
    basFrom: null,
    mixed: false,
  };
  return {
    state: deriveTransactionState({
      amount: r.amount,
      allocated,
      inTransfer,
      noDocumentNeeded: r.noDocumentNeeded,
      partnerId: effective.partnerId,
      accountRole,
    }),
    allocated,
    inTransfer,
    effective,
  };
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
      bankAccount: {
        select: { accountAlias: true, accountNumber: true, currency: true, role: true },
      },
    },
  });
  const dtos = await withImplicitRates(tx, rows.map(toTransactionDto));
  const facts = await rowFacts(tx, rows);
  const effectiveOf = (id: string) => facts.effective.get(id);
  const partnerIds = [
    ...new Set(
      rows.flatMap((r) =>
        effectiveOf(r.id)?.partnerId ? [effectiveOf(r.id)?.partnerId as string] : [],
      ),
    ),
  ];
  const codes = rows.flatMap((r) =>
    effectiveOf(r.id)?.basCode ? [effectiveOf(r.id)?.basCode as string] : [],
  );
  const names = await partners.partnerNames(tx, partnerIds);
  const labels = await settings.basLabels(tx, codes);
  // a row whose category or partner is derived lacks nothing: no proposal shows for it (F129) — the effective
  // facts only, never the typed copy (a rule's guess on a proven row is not what the row says, D82)
  const proposals = await linking.currentForRows(
    tx,
    rows.map((r) => ({
      id: r.id,
      basCode: effectiveOf(r.id)?.basCode ?? null,
      partnerId: effectiveOf(r.id)?.partnerId ?? null,
      categorisedBy: r.categorisedBy,
    })),
  );
  const list: TransactionListRow[] = rows.map((r, i) => {
    const dto = dtos[i] as (typeof dtos)[number];
    const derived = stateOf(
      { id: r.id, amount: dto.amount, noDocumentNeeded: r.noDocumentNeeded },
      facts,
      r.bankAccount.role as BankAccountRole,
    );
    const eff = derived.effective;
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
      basCode: eff.basCode,
      basLabel: eff.basCode ? (labels.get(eff.basCode) ?? eff.basCode) : null,
      basFrom: eff.basFrom,
      partnerId: eff.partnerId,
      partnerName: eff.partnerId ? (names.get(eff.partnerId) ?? null) : null,
      partnerFrom: eff.partnerFrom,
      mixed: eff.mixed,
      ...proposedColumns(proposals.get(r.id)),
      note: r.note,
      noDocumentNeeded: r.noDocumentNeeded,
      categorisedBy: r.categorisedBy,
      state: derived.state,
      allocated: derived.allocated,
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
    // nothing left to allocate, or flagged — a partner missing does not make it a candidate again
    if (state && state.state !== "open" && state.state !== "partial") continue;
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
 * The derived state of each of `ids` with the facts it comes from — the allocation, the transfer leg, the effective
 * partner (with its name) and category (F129) — the rule `deriveTransactionState` applies, through the shared read.
 * An unknown id is absent.
 */
export async function transactionStates(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<Map<string, TransactionStateFacts>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx.bankTransaction.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      amount: true,
      currency: true,
      amountBase: true,
      noDocumentNeeded: true,
      partnerId: true,
      basCode: true,
      categorisedBy: true,
      bankAccount: { select: { role: true } },
    },
  });
  const facts = await rowFacts(tx, rows);
  const names = await partners.partnerNames(tx, [
    ...new Set(
      rows.flatMap((r) => {
        const id = facts.effective.get(r.id)?.partnerId;
        return id ? [id] : [];
      }),
    ),
  ]);
  return new Map(
    rows.map((r) => {
      const d = stateOf(
        { id: r.id, amount: r.amount.toFixed(2), noDocumentNeeded: r.noDocumentNeeded },
        facts,
        r.bankAccount.role as BankAccountRole,
      );
      return [
        r.id,
        {
          state: d.state,
          allocated: d.allocated,
          inTransfer: d.inTransfer,
          ...d.effective,
          partnerName: d.effective.partnerId ? (names.get(d.effective.partnerId) ?? null) : null,
        },
      ];
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
  /** the effective partner and category with their source (F129): the panel says *from the proof* */
  effective: EffectiveFacts & { partnerName: string | null; basLabel: string | null };
  allocated: string;
  /** each link with the other side's label and, for an expense / invoice, the documents behind it (F152) */
  links: (LinkDto & { otherLabel: string | null; documents: { id: string; label: string }[] })[];
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
  const facts = await rowFacts(tx, [row]);
  const derived = stateOf(
    { id, amount: row.amount.toFixed(2), noDocumentNeeded: row.noDocumentNeeded },
    facts,
    row.bankAccount.role as BankAccountRole,
  );
  const eff = derived.effective;
  const partnerName = eff.partnerId
    ? ((await partners.partnerNames(tx, [eff.partnerId])).get(eff.partnerId) ?? null)
    : null;
  const basLabel = eff.basCode
    ? ((await settings.basLabels(tx, [eff.basCode])).get(eff.basCode) ?? eff.basCode)
    : null;
  const links = await linking.getLinksFor(tx, { type: "bank_transaction", id });
  const transfers = await proposeTransfers(tx, id);
  const allocated = derived.allocated;
  const withLabels = await mapInOrder(links.data ?? [], async (l) => {
    const other = l.from.type === "bank_transaction" && l.from.id === id ? l.to : l.from;
    const linkable = linking.getLinkable(other.type);
    const summary = linkable ? await linkable.summary(tx, other.id) : null;
    // the proof's paper (the owner, 2026-11-09: "I upload a document and cannot open it from there"): the row links
    // the expense or supplier invoice the document became — its documents ride along, to open from the row
    const documents: { id: string; label: string }[] = [];
    if (other.type !== "document" && other.type !== "bank_transaction") {
      const docLinkable = linking.getLinkable("document");
      for (const dl of await linking.linksTouching(tx, other.type, [other.id])) {
        const doc =
          dl.from.type === "document" ? dl.from : dl.to.type === "document" ? dl.to : null;
        if (!doc || documents.some((d) => d.id === doc.id)) continue;
        const docSummary = docLinkable ? await docLinkable.summary(tx, doc.id) : null;
        documents.push({ id: doc.id, label: docSummary?.label ?? doc.id });
      }
    }
    return { ...l, otherLabel: summary?.label ?? null, documents };
  });
  return {
    data: {
      transaction: transaction as NonNullable<typeof transaction>,
      accountLabel: accountLabel(row.bankAccount),
      state: derived.state,
      effective: { ...eff, partnerName, basLabel },
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

/**
 * The statement accounts' balances at the end of each of `days` (F138, the home's cash line): per account the
 * balance of the latest booking date on or before the day that has one — the rule of `accountBalances`, the file's
 * first row of that date — null before the account's first balance. Pure on the rows it reads: one query.
 */
export async function balanceHistory(
  tx: TransactionClient,
  days: readonly string[],
): Promise<
  Array<
    Omit<AccountBalance, "balance" | "balanceDate" | "lastImportAt"> & {
      balances: (string | null)[];
    }
  >
> {
  const accounts = await tx.bankAccount.findMany({
    where: { role: { in: [...STATEMENT_ROLES] } },
    orderBy: [{ role: "asc" }, { currency: "asc" }],
  });
  const rows = await tx.bankTransaction.findMany({
    where: { bankAccountId: { in: accounts.map((a) => a.id) }, balance: { not: null } },
    orderBy: [{ bookingDate: "asc" }, { rowIndex: "desc" }],
    select: { bankAccountId: true, bookingDate: true, balance: true },
  });
  // per account, per booking date: the last row in this order = the file's first row of that date
  const byAccount = new Map<string, Array<{ day: string; balance: string }>>();
  for (const r of rows) {
    const list = byAccount.get(r.bankAccountId) ?? [];
    const day = iso(r.bookingDate) as string;
    const entry = { day, balance: r.balance?.toFixed(2) ?? "0.00" };
    if (list.at(-1)?.day === day) list[list.length - 1] = entry;
    else list.push(entry);
    byAccount.set(r.bankAccountId, list);
  }
  return accounts.map((a) => {
    const list = byAccount.get(a.id) ?? [];
    return {
      bankAccountId: a.id,
      label: accountLabel(a),
      currency: a.currency,
      role: a.role as BankAccountRole,
      balances: days.map((d) => {
        let found: string | null = null;
        for (const e of list) {
          if (e.day > d) break;
          found = e.balance;
        }
        return found;
      }),
    };
  });
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

/** F98: the list's three *Proposed* cells from the row's current category proposal (none → nulls). */
function proposedColumns(proposals: linking.ProposalDto[] | undefined) {
  const bas = proposals?.find((p) => p.kind === "bas");
  return {
    proposedBasCode: bas && bas.kind === "bas" ? bas.payload.basCode : null,
    proposedSource: bas?.source ?? null,
    proposedConfidence: bas ? bas.confidence : null,
  };
}
