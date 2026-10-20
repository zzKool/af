// ListQuery → Prisma. Server-only (imports the generated client for Decimal).
// A module's `queries.ts` declares its ColumnMap once and calls:
//   const where = buildWhere(q, COLUMNS);          // every filter + search
//   const orderBy = buildOrderBy(q, COLUMNS, [{ col: "name", dir: "asc" }]);
//   const { skip, take } = paginate(q);
//   distinct(rows-of-the-column-after-other-filters) for header checkbox lists
import { Prisma } from "@/generated/prisma/client";
import type {
  ColumnMap,
  ColumnSpec,
  DateHierarchy,
  DatesFilter,
  DistinctValue,
  Filter,
  InFilter,
  ListQuery,
  RangeFilter,
  SortSpec,
  TextFilter,
} from "./types";
import { DISTINCT_CAP } from "./types";

type Where = Record<string, unknown>;

function fieldOf(col: string, spec: ColumnSpec): string {
  return spec.field ?? col;
}

function numberValue(spec: ColumnSpec, s: string): number | Prisma.Decimal {
  return spec.type === "money" ? new Prisma.Decimal(s) : Number(s);
}

function inWhere(field: string, spec: ColumnSpec, f: InFilter): Where {
  const values = f.values.filter((v): v is string => v !== null);
  const blanks = f.values.includes(null);
  const typed: unknown[] =
    spec.type === "boolean"
      ? values.map((v) => v === "true")
      : spec.type === "number"
        ? values.map(Number)
        : values;
  if (spec.array) {
    // Array column: rows having any of the values; blanks = empty array.
    const parts: Where[] = [];
    if (typed.length) parts.push({ [field]: { hasSome: typed } });
    if (blanks) parts.push({ [field]: { isEmpty: true } });
    return parts.length === 1 ? parts[0] : { OR: parts };
  }
  const parts: Where[] = [];
  if (spec.type === "boolean") {
    // Prisma's boolean filter has no `in`: one equals per value (at most two).
    for (const v of typed) parts.push({ [field]: v });
  } else if (typed.length) {
    parts.push({ [field]: { in: typed } });
  }
  if (blanks) parts.push({ [field]: null });
  if (parts.length === 0) return { [field]: { in: [] } }; // selects nothing, as an empty checkbox list should
  return parts.length === 1 ? parts[0] : { OR: parts };
}

function textWhere(field: string, f: TextFilter): Where {
  switch (f.op) {
    case "contains":
      return { [field]: { contains: f.value ?? "", mode: "insensitive" } };
    case "startsWith":
      return { [field]: { startsWith: f.value ?? "", mode: "insensitive" } };
    case "equals":
      return { [field]: { equals: f.value ?? "", mode: "insensitive" } };
    case "empty":
      return { OR: [{ [field]: null }, { [field]: "" }] };
    case "notEmpty":
      return { AND: [{ [field]: { not: null } }, { [field]: { not: "" } }] };
  }
}

function rangeWhere(field: string, spec: ColumnSpec, f: RangeFilter): Where {
  if (f.empty) return { [field]: null };
  const cond: Record<string, unknown> = {};
  if (f.min !== undefined) cond.gte = numberValue(spec, f.min);
  if (f.max !== undefined) cond.lte = numberValue(spec, f.max);
  return { [field]: cond };
}

const DAY_MS = 86_400_000;
function dayStart(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
function nextDay(iso: string): Date {
  return new Date(dayStart(iso).getTime() + DAY_MS);
}
function monthStart(ym: string): Date {
  return new Date(`${ym}-01T00:00:00.000Z`);
}
function nextMonth(ym: string): Date {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? new Date(Date.UTC(y + 1, 0, 1)) : new Date(Date.UTC(y, m, 1));
}

/** Dates are compared in UTC day boundaries — the app stores @db.Date / Timestamptz at midnight UTC. */
function datesWhere(field: string, f: DatesFilter): Where {
  if (f.empty) return { [field]: null };
  const union: Where[] = [];
  for (const y of f.years ?? []) {
    union.push({
      [field]: { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) },
    });
  }
  for (const m of f.months ?? []) union.push({ [field]: { gte: monthStart(m), lt: nextMonth(m) } });
  for (const d of f.days ?? []) union.push({ [field]: { gte: dayStart(d), lt: nextDay(d) } });
  const parts: Where[] = [];
  if (union.length === 1) parts.push(union[0]);
  else if (union.length > 1) parts.push({ OR: union });
  const bounds: Record<string, Date> = {};
  if (f.from) bounds.gte = dayStart(f.from);
  if (f.to) bounds.lt = nextDay(f.to);
  if (Object.keys(bounds).length) parts.push({ [field]: bounds });
  if (parts.length === 0) return {};
  return parts.length === 1 ? parts[0] : { AND: parts };
}

export function filterWhere(col: string, spec: ColumnSpec, f: Filter): Where {
  const field = fieldOf(col, spec);
  switch (f.kind) {
    case "in":
      return inWhere(field, spec, f);
    case "text":
      return textWhere(field, f);
    case "range":
      return rangeWhere(field, spec, f);
    case "dates":
      return datesWhere(field, f);
  }
}

export interface WhereOptions {
  /** Leave this column's own filter out — Excel semantics for its distinct values. */
  exceptColumn?: string;
  /** Always-on conditions of the module (tenant scoping is RLS, not this). */
  base?: Where;
}

/** Every filter (and the search box over `searchable` columns) as one Prisma `where`. */
export function buildWhere(q: ListQuery, columns: ColumnMap, options: WhereOptions = {}): Where {
  const parts: Where[] = [];
  if (options.base && Object.keys(options.base).length) parts.push(options.base);
  for (const [col, f] of Object.entries(q.filters)) {
    if (col === options.exceptColumn) continue;
    const spec = columns[col];
    if (!spec) continue;
    const w = filterWhere(col, spec, f);
    if (Object.keys(w).length) parts.push(w);
  }
  if (q.search) {
    const term = q.search;
    const searchable = Object.entries(columns).filter(([, s]) => s.searchable);
    if (searchable.length) {
      parts.push({
        OR: searchable.map(([col, spec]) =>
          spec.array
            ? { [fieldOf(col, spec)]: { has: term } }
            : { [fieldOf(col, spec)]: { contains: term, mode: "insensitive" } },
        ),
      });
    }
  }
  if (parts.length === 0) return {};
  return parts.length === 1 ? parts[0] : { AND: parts };
}

export function buildOrderBy(
  q: ListQuery,
  columns: ColumnMap,
  fallback: SortSpec[],
): Record<string, "asc" | "desc">[] {
  const sort = q.sort.filter((s) => columns[s.col]);
  const effective = sort.length ? sort : fallback;
  return effective.map((s) => ({ [fieldOf(s.col, columns[s.col] ?? { type: "text" })]: s.dir }));
}

export function paginate(q: ListQuery): { skip: number; take: number } {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

// --- distinct values (header checkbox lists) ---

/**
 * Counts per value over `rows` (the column's values after every OTHER filter), blanks as null,
 * most frequent first, capped. Array columns are unnested. The caller fetched
 * `select: { [field]: true }` with `buildWhere(q, columns, { exceptColumn: col })`.
 */
export function countDistinct(values: unknown[], spec: ColumnSpec): DistinctValue[] {
  const counts = new Map<string | null, number>();
  const bump = (v: unknown) => {
    const key = v === null || v === undefined || v === "" ? null : String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const v of values) {
    if (spec.array && Array.isArray(v)) {
      if (v.length === 0) bump(null);
      else for (const x of v) bump(x);
    } else bump(v);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (a.value === null ? 1 : b.value === null ? -1 : a.value.localeCompare(b.value)),
    )
    .slice(0, DISTINCT_CAP);
}

/** Year → month → day counts over `dates` (the column's values after every other filter). */
export function buildDateHierarchy(dates: (Date | string | null)[]): DateHierarchy {
  let empty = 0;
  const years = new Map<number, Map<string, Map<string, number>>>();
  for (const d of dates) {
    if (!d) {
      empty++;
      continue;
    }
    const iso = (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
    const year = Number(iso.slice(0, 4));
    const month = iso.slice(0, 7);
    const months = years.get(year) ?? new Map<string, Map<string, number>>();
    const days = months.get(month) ?? new Map<string, number>();
    days.set(iso, (days.get(iso) ?? 0) + 1);
    months.set(month, days);
    years.set(year, months);
  }
  const sum = (m: Iterable<number>) => [...m].reduce((a, b) => a + b, 0);
  return {
    empty,
    years: [...years.entries()]
      .sort(([a], [b]) => b - a)
      .map(([year, months]) => {
        const monthList = [...months.entries()]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([month, days]) => ({
            month,
            count: sum(days.values()),
            days: [...days.entries()]
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([day, count]) => ({ day, count })),
          }));
        return { year, count: monthList.reduce((a, m) => a + m.count, 0), months: monthList };
      }),
  };
}
