// Read API of the journal module. The ledger list carries two joined labels (partner name, BAS label) that
// no `where` can express, so it runs in two steps like the invoices list: Prisma filters the stored columns,
// the labels are joined over that set, and the derived filters / search / sort / page run in memory.
import type { TransactionClient } from "@/kernel/db/tenant-client";
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
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { withImplicitRates } from "./implicit-rate";
import { toJournalEntryDto } from "./journal";
import { linksStates } from "./links-state";
import type { JournalListRow } from "./types";

export { entriesForSources, getJournalEntry } from "./journal";

export const JOURNAL_COLUMNS = {
  entryDate: { type: "date" },
  sourceType: { type: "enum" },
  description: { type: "text", searchable: true },
  counterpartyKey: { type: "text", searchable: true },
  basCode: { type: "enum" },
  basLabel: { type: "text" },
  partnerId: { type: "enum" },
  partnerName: { type: "text", searchable: true },
  amount: { type: "money" },
  currency: { type: "enum" },
  amountBase: { type: "money", sum: true },
  rate: { type: "number" },
  rateSource: { type: "enum" },
  bankImplicitRate: { type: "number" },
  noDocumentNeeded: { type: "boolean" },
  categorisedBy: { type: "enum" },
  note: { type: "text", searchable: true },
  linksState: { type: "enum" },
  createdAt: { type: "date" },
  updatedAt: { type: "date" },
} as const satisfies ColumnMap;

export type JournalColumn = keyof typeof JOURNAL_COLUMNS;
export const JOURNAL_COLUMN_KEYS = Object.keys(JOURNAL_COLUMNS) as JournalColumn[];
export const JOURNAL_DEFAULT_SORT: SortSpec[] = [
  { col: "entryDate", dir: "desc" },
  { col: "createdAt", dir: "desc" },
];

// derived on read — filtered in memory: the bank implicit rate from the transfer link (T005), the links state (T004)
const DERIVED: ReadonlySet<string> = new Set([
  "partnerName",
  "basLabel",
  "bankImplicitRate",
  "linksState",
]);
const STORED_COLUMNS: ColumnMap = Object.fromEntries(
  Object.entries(JOURNAL_COLUMNS).filter(([k]) => !DERIVED.has(k)),
);
const ROW_CAP = 20_000;

async function loadRows(
  tx: TransactionClient,
  q: ListQuery,
  options: { exceptColumn?: string } = {},
): Promise<JournalListRow[]> {
  const where = buildWhere({ ...q, search: undefined }, STORED_COLUMNS, {
    exceptColumn: options.exceptColumn,
  });
  const rows = await tx.journalEntry.findMany({
    where,
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take: ROW_CAP,
  });
  const partnerIds = [...new Set(rows.flatMap((r) => (r.partnerId ? [r.partnerId] : [])))];
  const codes = rows.flatMap((r) => (r.basCode ? [r.basCode] : []));
  const [names, labels] = await Promise.all([
    partners.partnerNames(tx, partnerIds),
    settings.basLabels(tx, codes),
  ]);
  const entries = await withImplicitRates(tx, rows.map(toJournalEntryDto));
  const states = await linksStates(tx, entries);
  const list: JournalListRow[] = entries.map((r) => ({
    ...r,
    linksState: states.get(r.id)?.state ?? "none",
    partnerName: r.partnerId ? (names.get(r.partnerId) ?? null) : null,
    basLabel: r.basCode ? (labels.get(r.basCode) ?? r.basCode) : null,
  }));
  return filterInMemory(list, q, JOURNAL_COLUMNS, {
    derived: DERIVED,
    search: searchHit,
    exceptColumn: options.exceptColumn,
  });
}

function searchHit(row: JournalListRow, term: string): boolean {
  const t = term.toLowerCase();
  return [row.description, row.counterpartyKey, row.partnerName, row.note, row.basLabel].some((v) =>
    (v ?? "").toLowerCase().includes(t),
  );
}

export async function listJournalEntries(
  tx: TransactionClient,
  q: ListQuery,
): Promise<ListResult<JournalListRow>> {
  const all = await loadRows(tx, q);
  return finishList(all, q, JOURNAL_COLUMNS, JOURNAL_DEFAULT_SORT);
}

export async function distinctJournalValues(
  tx: TransactionClient,
  column: JournalColumn,
  q: ListQuery,
): Promise<DistinctValue[]> {
  const rows = await loadRows(tx, q, { exceptColumn: column });
  return countDistinct(
    rows.map((r) => r[column as keyof JournalListRow]),
    JOURNAL_COLUMNS[column],
  );
}

export async function journalDateHierarchy(
  tx: TransactionClient,
  column: JournalColumn,
  q: ListQuery,
): Promise<DateHierarchy> {
  if (JOURNAL_COLUMNS[column].type !== "date") return { years: [], empty: 0 };
  const rows = await loadRows(tx, q, { exceptColumn: column });
  return buildDateHierarchy(
    rows.map((r) => r[column as keyof JournalListRow] as Date | string | null),
  );
}
