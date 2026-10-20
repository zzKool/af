// ListQuery ⇄ URL search params. Pure, shared by the client hook (useListQuery) and server pages.
// Human-readable so a filtered view can be pasted into a chat:
//   ?page=2&size=50&sort=name:asc,createdAt:desc&q=acme
//   &f.types=in:client|vendor          &f.name=text:contains:acme
//   &f.amount=range:0:1000             &f.date=dates:2026|2026-09-15|from=2026-01-01|to=2026-03-31
// Values inside a list are encoded with encodeURIComponent, so `|` and `:` in data survive.
import {
  DEFAULT_PAGE_SIZE,
  type Filter,
  type ListQuery,
  PAGE_SIZE_OPTIONS,
  type SortDir,
  type SortSpec,
  type TextOp,
} from "./types";

const FILTER_PREFIX = "f.";
const BLANK = "~blank~";
const TEXT_OPS: TextOp[] = ["contains", "startsWith", "equals", "empty", "notEmpty"];

const enc = (s: string) => encodeURIComponent(s);
const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function serializeFilter(f: Filter): string {
  switch (f.kind) {
    case "in":
      return `in:${f.values.map((v) => (v === null ? BLANK : enc(v))).join("|")}`;
    case "text":
      return f.value === undefined ? `text:${f.op}` : `text:${f.op}:${enc(f.value)}`;
    case "range":
      return f.empty ? "range:empty" : `range:${f.min ?? ""}:${f.max ?? ""}`;
    case "dates": {
      if (f.empty) return "dates:empty";
      const tokens = [
        ...(f.years ?? []).map(String),
        ...(f.months ?? []),
        ...(f.days ?? []),
        ...(f.from ? [`from=${f.from}`] : []),
        ...(f.to ? [`to=${f.to}`] : []),
      ];
      return `dates:${tokens.join("|")}`;
    }
  }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;
const YEAR = /^\d{4}$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

export function parseFilter(raw: string): Filter | null {
  const colon = raw.indexOf(":");
  if (colon < 0) return null;
  const kind = raw.slice(0, colon);
  const rest = raw.slice(colon + 1);
  switch (kind) {
    case "in": {
      if (rest === "") return null;
      const values = rest.split("|").map((v) => (v === BLANK ? null : dec(v)));
      return { kind: "in", values };
    }
    case "text": {
      const c = rest.indexOf(":");
      const op = (c < 0 ? rest : rest.slice(0, c)) as TextOp;
      if (!TEXT_OPS.includes(op)) return null;
      const value = c < 0 ? undefined : dec(rest.slice(c + 1));
      if ((op === "empty" || op === "notEmpty") !== (value === undefined)) return null;
      return value === undefined ? { kind: "text", op } : { kind: "text", op, value };
    }
    case "range": {
      if (rest === "empty") return { kind: "range", empty: true };
      const [min, max] = rest.split(":");
      if ((min && !DECIMAL.test(min)) || (max && !DECIMAL.test(max))) return null;
      if (!min && !max) return null;
      return { kind: "range", ...(min ? { min } : {}), ...(max ? { max } : {}) };
    }
    case "dates": {
      if (rest === "empty") return { kind: "dates", empty: true };
      const years: number[] = [];
      const months: string[] = [];
      const days: string[] = [];
      let from: string | undefined;
      let to: string | undefined;
      for (const token of rest.split("|").filter(Boolean)) {
        if (YEAR.test(token)) years.push(Number(token));
        else if (ISO_MONTH.test(token)) months.push(token);
        else if (ISO_DAY.test(token)) days.push(token);
        else if (token.startsWith("from=") && ISO_DAY.test(token.slice(5))) from = token.slice(5);
        else if (token.startsWith("to=") && ISO_DAY.test(token.slice(3))) to = token.slice(3);
        else return null;
      }
      if (!years.length && !months.length && !days.length && !from && !to) return null;
      return {
        kind: "dates",
        ...(years.length ? { years } : {}),
        ...(months.length ? { months } : {}),
        ...(days.length ? { days } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      };
    }
    default:
      return null;
  }
}

export function serializeSort(sort: SortSpec[]): string {
  return sort.map((s) => `${s.col}:${s.dir}`).join(",");
}

export function parseSort(raw: string | null | undefined, allowed?: readonly string[]): SortSpec[] {
  if (!raw) return [];
  const out: SortSpec[] = [];
  for (const part of raw.split(",")) {
    const [col, dir = "asc"] = part.split(":");
    if (!col || (dir !== "asc" && dir !== "desc")) continue;
    if (allowed && !allowed.includes(col)) continue;
    out.push({ col, dir: dir as SortDir });
  }
  return out;
}

export interface ParseOptions {
  /** Columns that may be sorted or filtered; others in the URL are dropped. */
  columns?: readonly string[];
  defaultSort?: SortSpec[];
  defaultPageSize?: number;
}

/** Tolerant: anything malformed is ignored, so a stale link still opens the page. */
export function parseListQuery(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  options: ParseOptions = {},
): ListQuery {
  const get = (k: string): string | undefined => {
    if (params instanceof URLSearchParams) return params.get(k) ?? undefined;
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const keys = params instanceof URLSearchParams ? [...params.keys()] : Object.keys(params);

  const page = Math.max(1, Number.parseInt(get("page") ?? "1", 10) || 1);
  const sizeRaw = Number.parseInt(get("size") ?? "", 10);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(sizeRaw)
    ? sizeRaw
    : (options.defaultPageSize ?? DEFAULT_PAGE_SIZE);
  const sort = parseSort(get("sort"), options.columns);
  const search = get("q")?.trim() || undefined;

  const filters: Record<string, Filter> = {};
  for (const key of keys) {
    if (!key.startsWith(FILTER_PREFIX)) continue;
    const col = key.slice(FILTER_PREFIX.length);
    if (options.columns && !options.columns.includes(col)) continue;
    const raw = get(key);
    const f = raw ? parseFilter(raw) : null;
    if (f) filters[col] = f;
  }

  return {
    page,
    pageSize,
    sort: sort.length ? sort : (options.defaultSort ?? []),
    filters,
    ...(search ? { search } : {}),
  };
}

/** Only what differs from the defaults goes into the URL, so a clean table has a clean address. */
export function serializeListQuery(q: ListQuery, options: ParseOptions = {}): URLSearchParams {
  const p = new URLSearchParams();
  if (q.page > 1) p.set("page", String(q.page));
  if (q.pageSize !== (options.defaultPageSize ?? DEFAULT_PAGE_SIZE))
    p.set("size", String(q.pageSize));
  const defaultSort = serializeSort(options.defaultSort ?? []);
  const sort = serializeSort(q.sort);
  if (sort && sort !== defaultSort) p.set("sort", sort);
  if (q.search) p.set("q", q.search);
  for (const [col, f] of Object.entries(q.filters))
    p.set(`${FILTER_PREFIX}${col}`, serializeFilter(f));
  return p;
}
