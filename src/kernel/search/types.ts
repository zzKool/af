// The shapes of the global search (F93, D56) — plain, client-safe types. Modules return them from their
// `search<Kind>Hits` functions; the app's composition root collects them; the shell's palette renders them.
// The kernel never imports a module: a kind is a name here, nothing more.

/** One group of the palette per kind, in this order when nothing else decides (see `orderGroups`). */
export const SEARCH_KINDS = [
  "partner",
  "invoice",
  "supplier_invoice",
  "expense",
  "settlement",
  "document",
  "bank_transaction",
] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

/** How well a hit matches — lower is better (spec *Ranking*). */
export const RANK = {
  exactKey: 0,
  keyPrefix: 1,
  amount: 2,
  keyOrName: 3,
  text: 4,
} as const;

export type SearchRank = (typeof RANK)[keyof typeof RANK];

export type SearchHit = {
  kind: SearchKind;
  id: string;
  /** the business key (`VA23-INV-001`, `Ex213-Tr-01`, a short code); null when the entity has none (a bank row, a draft) */
  key: string | null;
  label: string;
  /** ISO date (yyyy-mm-dd) that dates the entity; null when none fits (a partner) */
  date: string | null;
  /** decimal string, signed as the entity stores it */
  amount?: string;
  currency?: string;
  /** the deep link that opens the entity (`/invoices/<id>`, `/expenses?open=<id>`) */
  href: string;
  rank: SearchRank;
};

export type SearchGroup = {
  kind: SearchKind;
  /** at most `GROUP_SIZE`, best first */
  hits: SearchHit[];
  /** more matches exist than shown */
  more: boolean;
  /** the module's list filtered by the query (`/invoices?q=…`) */
  seeAllHref: string;
};

/** Hits shown per group. */
export const GROUP_SIZE = 5;
/** Rows one module query reads before ranking (newest first) — enough for the exact key to surface. */
export const CANDIDATE_LIMIT = 50;
/** Entity search starts at this many characters (pages filter from the first one). */
export const MIN_QUERY_LENGTH = 2;

/** The palette's server call — the app's `globalSearchAction` (next-safe-action result: `{ data: { data } }`). */
export type RunSearch = (input: {
  q: string;
}) => Promise<{ data?: { data?: SearchGroup[] } } | undefined>;
