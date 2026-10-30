// The BAS picker's rules (F125), pure and client-safe: what a query matches, and how the list is grouped — the
// suggestions first (each with its source), then the owner's favourites, then the chart by class in the order the
// context reads it (a cost: the cost classes first). Every account appears once.
import type { BasOption, BasSuggestion } from "../types";

/** Which way the money goes where the picker is used — decides which BAS classes lead. */
export type BasDirection = "cost" | "income" | "any";

/** The BAS classes as the picker groups them: 5 and 6 are both *other external costs*. */
export type BasClassGroup = "1" | "2" | "3" | "4" | "56" | "7" | "8";

const CLASS_ORDER: Record<BasDirection, BasClassGroup[]> = {
  cost: ["4", "56", "7", "8", "1", "2", "3"],
  income: ["3", "8", "1", "2", "4", "56", "7"],
  any: ["1", "2", "3", "4", "56", "7", "8"],
};

export type BasGroup =
  | { kind: "suggested"; key: "suggested"; items: BasPickItem[] }
  | { kind: "favourites"; key: "favourites"; items: BasPickItem[] }
  | { kind: "class"; key: BasClassGroup; items: BasPickItem[] };

/** An option as the list shows it: the suggestion that put it on top, when one did. */
export type BasPickItem = BasOption & { suggestion?: BasSuggestion };

/** Lower case, accents off, one space — so `Lokalhyra`, `lokal hyra` and `LOKALHYRA` meet. */
export function foldText(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The short code: the option's own, else the `(Alias)` its one-line label ends with (older `{ code, label }` callers). */
export function aliasOf(o: Pick<BasOption, "alias" | "label">): string | null {
  if (o.alias !== undefined) return o.alias;
  return /\(([^()]+)\)\s*$/.exec(o.label)?.[1] ?? null;
}

/** The name: the option's own, else its label without the `654 · ` prefix and the `(Alias)` suffix. */
export function nameOf(o: Pick<BasOption, "code" | "name" | "label">): string {
  if (o.name) return o.name;
  return o.label
    .replace(new RegExp(`^${o.code}\\s*[·—-]\\s*`), "")
    .replace(/\s*\([^()]+\)\s*$/, "")
    .trim();
}

export function classGroupOf(o: Pick<BasOption, "code" | "classNum">): BasClassGroup {
  const n = o.classNum ?? Number(o.code[0]);
  if (n === 5 || n === 6) return "56";
  return String(n) as BasClassGroup;
}

/**
 * A query matches an account when the code starts with it (`65`, `654`) or every word of it appears in the English
 * name, the Swedish name or the short code — in any order (`it serv`, `tjänster it`, `acc`).
 */
export function matchesBas(o: BasOption, query: string): boolean {
  const q = foldText(query);
  if (!q) return true;
  if (/^\d+$/.test(q)) return o.code.startsWith(q);
  const hay = foldText([o.code, nameOf(o), o.nameSv ?? "", aliasOf(o) ?? ""].join(" "));
  return q.split(" ").every((w) => hay.includes(w));
}

/** The grouped list for the query: suggested · favourites · the classes in the direction's order; empty groups out. */
export function groupBasOptions(
  options: readonly BasOption[],
  opts: { query?: string; suggestions?: readonly BasSuggestion[]; direction?: BasDirection } = {},
): BasGroup[] {
  const query = opts.query ?? "";
  const byCode = new Map(options.map((o) => [o.code, o]));
  const taken = new Set<string>();
  const suggested: BasPickItem[] = [];
  for (const s of opts.suggestions ?? []) {
    const o = byCode.get(s.code);
    if (!o || taken.has(o.code) || !matchesBas(o, query)) continue;
    taken.add(o.code);
    suggested.push({ ...o, suggestion: s });
  }
  const visible = options.filter((o) => !taken.has(o.code) && matchesBas(o, query));
  // favourites lead only when nothing is typed — a query reads the chart, in its order
  const favourites = query.trim() ? [] : visible.filter((o) => o.favourite);
  for (const f of favourites) taken.add(f.code);
  const groups: BasGroup[] = [];
  if (suggested.length) groups.push({ kind: "suggested", key: "suggested", items: suggested });
  if (favourites.length) groups.push({ kind: "favourites", key: "favourites", items: favourites });
  for (const key of CLASS_ORDER[opts.direction ?? "any"]) {
    const items = visible.filter((o) => !taken.has(o.code) && classGroupOf(o) === key);
    if (items.length) groups.push({ kind: "class", key, items });
  }
  return groups;
}
