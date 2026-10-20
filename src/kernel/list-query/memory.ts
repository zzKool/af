// ListQuery in memory — the second step of a two-step list (invoices, banking, journal): Prisma filters the
// stored columns (`buildWhere`), the module computes its DERIVED columns over that set (links, journal facts,
// partner names), and this file applies the derived filters, the free-text search, the sort, the page and
// the footer sums to the resulting rows. Same semantics as prisma.ts, evaluated on plain values:
// Decimal strings for money, ISO strings or Dates for dates, strings for enums/text.
import { Prisma } from "@/generated/prisma/client";
import type { ColumnMap, Filter, ListQuery, ListResult, SortSpec } from "./types";

const D = Prisma.Decimal;

function isoDay(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** Does one value satisfy one filter? `type` is the column's ColumnType. */
export function matchesFilter(value: unknown, f: Filter, type: string): boolean {
  switch (f.kind) {
    case "in": {
      const v =
        value === null || value === undefined || value === ""
          ? null
          : type === "boolean"
            ? String(Boolean(value))
            : String(value);
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
      if (f.empty) return value === null || value === undefined || value === "";
      if (value === null || value === undefined || value === "") return false;
      const d = new D(String(value));
      if (f.min !== undefined && d.lt(new D(f.min))) return false;
      if (f.max !== undefined && d.gt(new D(f.max))) return false;
      return true;
    }
    case "dates": {
      const day = isoDay(value);
      if (f.empty) return day === null;
      if (day === null) return false;
      const union = [
        ...(f.years ?? []).map((y) => String(y)),
        ...(f.months ?? []),
        ...(f.days ?? []),
      ];
      if (union.length && !union.some((prefix) => day.startsWith(prefix))) return false;
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      return true;
    }
  }
}

/** Sort comparison by column type; blanks last. */
export function compareValues(a: unknown, b: unknown, type: string): number {
  const blankA = a === null || a === undefined || a === "";
  const blankB = b === null || b === undefined || b === "";
  if (blankA) return blankB ? 0 : 1;
  if (blankB) return -1;
  if (type === "money" || type === "number") return new D(String(a)).cmp(new D(String(b)));
  if (type === "date") return (isoDay(a) ?? "").localeCompare(isoDay(b) ?? "");
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

export interface MemoryListOptions<Row> {
  /** the columns whose filters are evaluated here (the others were applied in SQL) */
  derived: ReadonlySet<string>;
  /** the free-text search over the row (when the search spans derived columns it must run here) */
  search?: (row: Row, term: string) => boolean;
  /** Excel semantics for distinct values: ignore this column's own filter */
  exceptColumn?: string;
}

/** Apply the derived filters and the search to rows already filtered on their stored columns. */
export function filterInMemory<Row extends object>(
  rows: Row[],
  q: ListQuery,
  columns: ColumnMap,
  options: MemoryListOptions<Row>,
): Row[] {
  return rows.filter((row) => {
    for (const [col, f] of Object.entries(q.filters)) {
      if (!options.derived.has(col) || col === options.exceptColumn) continue;
      const spec = columns[col];
      if (!spec) continue;
      if (!matchesFilter((row as Record<string, unknown>)[col], f, spec.type)) return false;
    }
    if (q.search && options.search && !options.search(row, q.search)) return false;
    return true;
  });
}

/** Sort, page and sum the whole filtered set (sums over every row, not only the page). */
export function finishList<Row extends object>(
  rows: Row[],
  q: ListQuery,
  columns: ColumnMap,
  defaultSort: SortSpec[],
): ListResult<Row> {
  const sort = q.sort.filter((s) => s.col in columns);
  const effective = sort.length ? sort : defaultSort;
  const sorted = [...rows].sort((x, y) => {
    for (const s of effective) {
      const c = compareValues(
        (x as Record<string, unknown>)[s.col],
        (y as Record<string, unknown>)[s.col],
        columns[s.col]?.type ?? "text",
      );
      if (c !== 0) return s.dir === "asc" ? c : -c;
    }
    return 0;
  });
  const start = (q.page - 1) * q.pageSize;
  const sums: Record<string, string> = {};
  for (const [col, spec] of Object.entries(columns)) {
    if (!spec.sum) continue;
    sums[col] = sorted
      .reduce((s, r) => s.add(new D(String((r as Record<string, unknown>)[col] ?? 0))), new D(0))
      .toFixed(2);
  }
  return { rows: sorted.slice(start, start + q.pageSize), total: sorted.length, sums };
}
