// Read API of the partners module — the reference implementation of the ListQuery contract (D20):
// one ColumnMap, list() with paging/sorting/filters/search, distinct() and dateHierarchy() for the
// DataTable's header filters. Other modules copy this shape (module-slice skill).
import type { TransactionClient } from "@/kernel/db/tenant-client";
import {
  buildDateHierarchy,
  buildOrderBy,
  buildWhere,
  countDistinct,
  paginate,
} from "@/kernel/list-query/prisma";
import type {
  ColumnMap,
  DateHierarchy,
  DistinctValue,
  ListQuery,
  ListResult,
  SortSpec,
} from "@/kernel/list-query/types";
import { toPartnerDto } from "./partners";
import type { PartnerDto } from "./types";

export { listPartnerContacts } from "./contacts";
export { getPartner, getPartners, searchPartners } from "./partners";

/** id → name for a set of partners (list pages of other modules label their partner column with it). */
export async function partnerNames(
  tx: TransactionClient,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.partner.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Columns the partners list can show, sort and filter. Keys are what the URL and the table use. */
export const PARTNER_COLUMNS = {
  name: { type: "text", searchable: true },
  shortCode: { type: "text", searchable: true },
  types: { type: "enum", array: true },
  orgNumber: { type: "text", searchable: true },
  vatNumber: { type: "text", searchable: true },
  defaultCurrency: { type: "enum" },
  defaultBasCategoryCode: { type: "enum" },
  email: { type: "text", searchable: true },
  isActive: { type: "boolean" },
  createdAt: { type: "date" },
  updatedAt: { type: "date" },
} as const satisfies ColumnMap;

export type PartnerColumn = keyof typeof PARTNER_COLUMNS;
export const PARTNER_COLUMN_KEYS = Object.keys(PARTNER_COLUMNS) as PartnerColumn[];
export const PARTNER_DEFAULT_SORT: SortSpec[] = [{ col: "name", dir: "asc" }];

/** One page of partners for the list page. */
export async function listPartners(
  tx: TransactionClient,
  q: ListQuery,
): Promise<ListResult<PartnerDto>> {
  const where = buildWhere(q, PARTNER_COLUMNS);
  const rows = await tx.partner.findMany({
    where,
    orderBy: buildOrderBy(q, PARTNER_COLUMNS, PARTNER_DEFAULT_SORT),
    ...paginate(q),
  });
  const total = await tx.partner.count({ where });
  return { rows: rows.map(toPartnerDto), total };
}

/** Values of `column` with counts, over the set filtered by every OTHER column (Excel semantics). */
export async function distinctPartnerValues(
  tx: TransactionClient,
  column: PartnerColumn,
  q: ListQuery,
): Promise<DistinctValue[]> {
  const spec = PARTNER_COLUMNS[column];
  const where = buildWhere(q, PARTNER_COLUMNS, { exceptColumn: column });
  const rows = await tx.partner.findMany({ where, select: { [column]: true }, take: 20_000 });
  return countDistinct(
    rows.map((r) => (r as Record<string, unknown>)[column]),
    spec,
  );
}

/** Year → month → day counts of a date column, over the set filtered by every other column. */
export async function partnerDateHierarchy(
  tx: TransactionClient,
  column: PartnerColumn,
  q: ListQuery,
): Promise<DateHierarchy> {
  if (PARTNER_COLUMNS[column].type !== "date") return { years: [], empty: 0 };
  const where = buildWhere(q, PARTNER_COLUMNS, { exceptColumn: column });
  const rows = await tx.partner.findMany({ where, select: { [column]: true }, take: 20_000 });
  return buildDateHierarchy(rows.map((r) => (r as unknown as Record<string, Date | null>)[column]));
}
