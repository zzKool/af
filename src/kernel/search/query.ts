// The pure rules of the global search (F93, D56): reading a query (text + amount), ranking a hit, building and
// ordering the groups. No database, no module — every module's `search.ts` calls these the same way.
import {
  GROUP_SIZE,
  MIN_QUERY_LENGTH,
  RANK,
  SEARCH_KINDS,
  type SearchGroup,
  type SearchHit,
  type SearchKind,
  type SearchRank,
} from "./types";

export type SearchQuery = {
  /** the trimmed query, as typed — what `contains` filters use */
  text: string;
  /** the query read as an amount, a positive decimal string with two decimals (`"1250.00"`); null when it is not one */
  amount: string | null;
};

// spaces (incl. no-break U+00A0, narrow no-break U+202F, thin U+2009) and apostrophes group thousands
const GROUP_SEPARATORS = /[\s   '’]/g;

/**
 * An amount as people type it: `1250`, `1 250`, `1250.00`, `1250,00`, `1'250`, `1,250.00`, `1.250,00`, `−1250`.
 * A `.` or `,` followed by exactly three digits groups thousands; followed by one or two it is the decimal mark.
 * Returns the absolute value with two decimals, or null when the text is not an amount.
 */
export function parseAmount(raw: string): string | null {
  const s = raw
    .trim()
    .replace(/^[-−+]/, "")
    .replace(GROUP_SEPARATORS, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const m = /^(\d{1,3}(?:[.,]\d{3})*|\d+)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = m[1].replace(/[.,]/g, "").replace(/^0+(?=\d)/, "");
  const decimals = (m[2] ?? "").padEnd(2, "0");
  return `${whole}.${decimals}`;
}

/** The query as the modules use it; null when it is too short for an entity search. */
export function parseSearchQuery(raw: string): SearchQuery | null {
  const text = raw.trim();
  if (text.length < MIN_QUERY_LENGTH) return null;
  return { text, amount: parseAmount(text) };
}

/** `"-1250.5"`, `"1250.50"` → `"1250.50"` (absolute, two decimals) — equality of amounts whatever their sign or scale. */
function canonical(decimal: string): string | null {
  const m = /^[-−+]?(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!m) return null;
  const decimals = (m[2] ?? "").padEnd(2, "0");
  if (/[1-9]/.test(decimals.slice(2))) return null; // sub-cent: never equal to a typed amount
  return `${m[1].replace(/^0+(?=\d)/, "")}.${decimals.slice(0, 2)}`;
}

export function amountEquals(a: string, b: string): boolean {
  const x = canonical(a);
  return x !== null && x === canonical(b);
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export type RankInput = {
  /** keys that rank 0 when equal and 1 when they start with the query (business key, short code, supplier number) */
  keys?: (string | null | undefined)[];
  /** names that rank 3 when they contain the query (partner name, description) — keys count here too */
  names?: (string | null | undefined)[];
  /** other texts that rank 4 when they contain the query */
  texts?: (string | null | undefined)[];
  /** amounts that rank 2 when equal to the query's amount (either sign) */
  amounts?: (string | null | undefined)[];
};

/** The best rank of an entity for a query; null when nothing matches (the module's filter let it through anyway). */
export function rankOf(q: SearchQuery, input: RankInput): SearchRank | null {
  const needle = fold(q.text);
  const keys = (input.keys ?? []).filter((k): k is string => !!k).map(fold);
  if (keys.some((k) => k === needle)) return RANK.exactKey;
  if (keys.some((k) => k.startsWith(needle))) return RANK.keyPrefix;
  if (q.amount && (input.amounts ?? []).some((a) => !!a && amountEquals(a, q.amount as string))) {
    return RANK.amount;
  }
  const names = (input.names ?? []).filter((n): n is string => !!n).map(fold);
  if ([...keys, ...names].some((n) => n.includes(needle))) return RANK.keyOrName;
  const texts = (input.texts ?? []).filter((t): t is string => !!t).map(fold);
  if (texts.some((t) => t.includes(needle))) return RANK.text;
  return null;
}

/** Best rank first, then newest, then by key — the shown hits and whether more exist. */
export function toGroup(kind: SearchKind, hits: SearchHit[], seeAllHref: string): SearchGroup {
  const sorted = [...hits].sort(
    (a, b) =>
      a.rank - b.rank ||
      (b.date ?? "").localeCompare(a.date ?? "") ||
      (a.key ?? a.label).localeCompare(b.key ?? b.label),
  );
  return { kind, hits: sorted.slice(0, GROUP_SIZE), more: sorted.length > GROUP_SIZE, seeAllHref };
}

/** An empty group — a role that may not read the kind, or nothing to search. */
export function emptyGroup(kind: SearchKind, seeAllHref: string): SearchGroup {
  return { kind, hits: [], more: false, seeAllHref };
}

/** `/invoices` + query → `/invoices?q=VA23` — the module's list, filtered by its own search. */
export function seeAllHref(listPath: string, q: SearchQuery | string): string {
  const text = typeof q === "string" ? q.trim() : q.text;
  return `${listPath}?q=${encodeURIComponent(text)}`;
}

/** Non-empty groups, the one with the best hit first; ties in `SEARCH_KINDS` order. */
export function orderGroups(groups: SearchGroup[]): SearchGroup[] {
  const best = (g: SearchGroup) => Math.min(...g.hits.map((h) => h.rank));
  return groups
    .filter((g) => g.hits.length > 0)
    .sort(
      (a, b) => best(a) - best(b) || SEARCH_KINDS.indexOf(a.kind) - SEARCH_KINDS.indexOf(b.kind),
    );
}

/** True when the group holds an exact key — such groups come before the Pages group. */
export function hasExactKey(group: SearchGroup): boolean {
  return group.hits.some((h) => h.rank === RANK.exactKey);
}

/** ISO date of a stored `Date` (a `@db.Date` or a timestamp) — the hit's `date`. */
export function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
