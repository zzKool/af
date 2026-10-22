# UI conventions

Version 2 · 2026-10-20 · Decisions D19 and D20 in [[feature-inventory]]. Applies to every page. **Built** (phase-0 item 8): the shell (`kernel/ui/shell`: sidebar, topbar, `ListPage` / `EntityPage` / `WorkPage` / `PageHeader`), the `DataTable` (`kernel/ui/data-table`) and the `ListQuery` contract (`kernel/list-query`), first used by [[partners]]. Column order / width / visibility persist per user since 2026-10-21 (`kernel/ui/data-table/preferences.tsx` + `table_preferences`). Still to come: virtualised body. The documents library migrated onto it on 2026-10-20 (the legacy table is gone). The list page's **side panel** is `components/ui/sheet.tsx` (first used by the banking workbench and the journal, then the expenses list); forms that interrupt (import, rule, manual entry, new expense, new group) use `components/ui/dialog.tsx`. The first **work page** is `/expenses/settle` (`WorkPage`: the open expenses left, the refund row and the confirmation right).

## Layout — full width, dense, app not website

v2 centred pages in `max-w-5xl`. v3 is a working tool for managing a company: screens are wide, dense and consistent.

```
┌─ sidebar (collapsible, 240 → 56 px) ─┬─ topbar: breadcrumb · tenant · search · user ─┐
│ nav by module, role-filtered         │ page header: title · primary actions · filters │
│                                      │────────────────────────────────────────────────│
│                                      │ content: fills the viewport width              │
│                                      │  list pages   → DataTable, sticky header,      │
│                                      │                 virtualised rows, side panel   │
│                                      │  entity pages → header card + tabs             │
│                                      │  work pages   → split panes (list | detail)    │
└──────────────────────────────────────┴────────────────────────────────────────────────┘
```

Rules
- No `max-w-*` on page containers; padding `p-4`/`p-6`; content stretches. Reading-length limits apply only to prose (settings help text, notes).
- Three page archetypes and nothing else: **list** (DataTable + optional side panel for the selected row), **entity** (header + tabs: overview, documents, links, audit), **work** (split panes for linking, review, settlement — list left, detail right, keyboard navigable).
- Density: 13–14 px table text, 36 px rows, numbers right-aligned in tabular figures, dates `yyyy-mm-dd`, currencies with code (`1 234.50 CHF`).
- Keyboard first on work pages: `j/k` move, `enter` open, `l` link, `u` undo (v1 inbox UX, H7).
- Dark mode via tokens from day one; no hardcoded colours.
- Sidebar hides by role; the server enforces (both required, constitution §6).

## DataTable — Excel-style headers, server-side

Every list in the app is one component. v1's `advanced-table/` (checkbox, column, date-hierarchy and number-range filters, 1 870 lines) is the behaviour reference (H13); v2's `DataTable` + `table-preferences` is the code base to extend.

### Behaviour
- **Server-side** paging, sorting, filtering: the table never holds more than one page; filters become a typed `ListQuery` passed to the module's `queries.ts`.
- **Header filter per column, typed**:

  | column type | filter UI | query |
  |---|---|---|
  | enum / text with few values | checkbox list of **distinct values with counts**, search box, select all / clear | `in` |
  | free text | contains / starts with / equals / empty | `ilike` |
  | number / money | range (min–max), equals, empty; presets (> 0, < 0) | `between` |
  | date | **hierarchy tree year → month → day** with tri-state checkboxes, plus presets (this month, last month, quarter, year, custom range) | `between` sets |
  | boolean / status | checkbox list | `in` |
  | relation (partner, category) | checkbox list of distinct linked names, searchable | `in` ids |

- **Distinct values are computed server-side** on the already-filtered set (Excel semantics: filtering one column narrows the options of the others), capped at 500 with "search to narrow" beyond; `queries.ts` exposes `distinct(column, currentFilters)`.
- Active filters shown as chips above the table; one click removes; "clear all".
- Filter + sort + page state lives in the **URL** (shareable, back-button safe); column visibility, order and width persist **per user per table** (`table_preferences`, v2 — built): the app layout loads the user's rows once and provides them (`TablePreferencesProvider` with `upsertTablePreferenceAction`); `useTableLayout(tableKey, columns)` starts from the server's copy, else the browser's (`localStorage` `af.table.<key>.layout`, the v1 `.hidden` key is read once), else the columns' defaults, and writes every change to storage at once and to the server debounced (600 ms). Order: drag a header onto another, or ↑ / ↓ in the *Columns* menu (the keyboard path); columns with no header (row actions) are pinned last. Width: the handle on a header's right edge (pointer drag, or ← / → by 8 px when focused; 48–1200 px); a column with a width truncates. *Reset layout* in the menu when anything differs from the defaults. Pure helpers in `layout.ts` (`orderColumns`, `moveColumn`, `dropColumn`, `normalizeLayout` — a stored layout is validated, unknown keys dropped, new columns appended).
- Row selection with bulk actions (link, categorise, export CSV of the current filter).
- Sticky header, virtualised body, loading skeleton, empty state with the active filters named.
- Footer: row count of the filtered set, sum of money columns on the filtered set (server-side).

### Contract (`src/kernel/list-query`)
```ts
type ListQuery = { page; pageSize; sort: { col; dir }[]; filters: Record<col, Filter>; search? }
type Filter =
  | { kind: "in"; values: (string | null)[] }                                  // enum, boolean, relation; null = blanks
  | { kind: "text"; op: contains | startsWith | equals | empty | notEmpty; value? }
  | { kind: "range"; min?; max?; empty? }                                       // number, money (decimal strings)
  | { kind: "dates"; years?; months?; days?; from?; to?; empty? }               // hierarchy ∪, intersected with from/to
queries.list(tx, q): { rows: Dto[]; total; sums? }
queries.distinct(tx, col, q): { value; count }[]          // over the set filtered by the OTHER columns
queries.dateHierarchy(tx, col, q): { years → months → days with counts; empty }
```
- `codec.ts` — URL ⇄ ListQuery (`?page=2&size=50&sort=name:asc&q=acme&f.types=in:client|vendor&f.date=dates:2026|from=2026-01-01`), tolerant of garbage.
- `prisma.ts` — `buildWhere(q, columns, { exceptColumn, base })`, `buildOrderBy`, `paginate`, `countDistinct`, `buildDateHierarchy`.
- `schema.ts` — Zod `listQuerySchema` for the actions that serve header filters.
- A module declares `COLUMNS: ColumnMap` (`{ type, field?, array?, searchable?, sum? }`) once in `queries.ts`; see [[partners]] for the reference implementation and its tests.

### The component (`src/kernel/ui/data-table`)
`<DataTable tableKey columns result state filterSource valueLabel rowHref|onRowClick selectable bulkActions toolbar emptyState />` with `state = useListQuery({ columns, defaultSort })`. Columns: `{ key, header, type, filterable?, sortable?, align?, width?, cell?, truncate?, defaultHidden?, alwaysVisible? }`. Header = sort button (shift-click adds a secondary key) + filter trigger (filled when active) → `TextFilter` / `RangeFilter` / `CheckboxFilter` / `DateFilter` popovers; chips above; footer with count, sums, page size, pager; Columns menu (visibility, order and *Reset layout*, remembered per `tableKey` per user).

## i18n — UI strings

English is the key set: `src/kernel/i18n/dictionaries/en.ts` (`as const`); every other dictionary is `Record<MessageKey, string>` typed against it (`fr.ts`, `sv.ts` — the Swedish one follows BAS / Skatteverket terminology and the v1 printed-invoice strings in `specs/invoices/fixtures/invoice-strings.sv.json`; a new language is one file + one line in `translate.ts`, no code change). Keys are `<module>.<area>.<name>`; `{name}` placeholders are filled by the caller. Client components call `useT()`; server components either build a `translator(locale)` from the user's preferences or render `<Msg k="…" />` (`kernel/i18n/msg.tsx`, a client leaf that reads the LocaleProvider) for a heading. Since 2026-10-21 every module string is in the dictionary — the partners and contracts components, the settings hub and the section headings included; the settings forms (company, BAS categories, VAT registrations, bank accounts, my preferences) followed the same day. The document review page (header, footer, the sections, line items), the preview and the upload zone followed. The login / register pages and the error fallbacks followed on 2026-10-22 (F04): `app/(auth)/layout.tsx` has no user yet, so it resolves the language on the server from the browser's `Accept-Language` — the first tag by quality that has a dictionary (`uiLanguageFromAcceptLanguage` in `kernel/i18n/locale.ts`: `de-CH,fr;q=0.9` → fr) — and hands it to a `LocaleProvider`, so the server and client renders agree. Register errors are keys (`registerErrorKey`), never Better Auth's raw English message; the tenant made at registration is named in that language (`auth.register.orgName`). The breadcrumb names the nav items and the known sub-pages (`CRUMB_KEYS` in `topbar.tsx`); anything else shows its URL segment.

- Client components: `const t = useT(); t("contracts.rates.title")` — the language comes from `LocaleProvider` (user preference, else the browser), `fr-CH` → fr, anything without a dictionary → en.
- Server components, PDFs, jobs: `translate(locale, key, params)` or `translator(locale)`.
- Services return English messages (logs, tests, API) and, when a client may want to re-render them, `AppError.details` with the facts (`{from, to}`, `{n}`); the component picks the key.
- A module adds its keys to **both** dictionaries in the same PR (`translate.pure.test.ts` fails on a missing key). Dictionaries are a shared file (constitution §5): one PR at a time.
- Partners / documents / settings still carry English literals from v2 — migrate them when a page is next touched, not in bulk.
