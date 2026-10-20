# Harvest — kernel-ui-datatable (H13: DataTable header filters — Excel-style)
Sources read (af_core, commit a2fe220, code only — no git in the checkout):
`components/advanced-table/DataTable.tsx` (the component every list page used; `filterFns`, toolbar, header dropdown, export) · `advanced-table.tsx` + `table-toolbar.tsx` + `column-filter.tsx` (an earlier, generic variant; exported, used by nobody) · `checkbox-filter.tsx` · `number-range-filter.tsx` · `date-hierarchy-filter.tsx` · `simple-table.tsx` · `types.ts` · `utils.ts` (`buildDateHierarchy`, `getQuickDateFilters`, `formatNumber`, `exportToCSV`, `MONTH_NAMES`) · `index.ts` · `app/api/exchange-rates/available-values/route.ts`, `available-dates/route.ts` · `app/api/currencies/available/route.ts` (not a filter endpoint, see B1) · `app/api/exchange-rates/route.ts` (query params) · `app/api/banking/inbox-transactions/route.ts` (`filterOptions`) · `app/api/documents/inbox/route.ts` (`getFilterOptions`) · `app/dashboard/exchange-rates/page.tsx` (2 007 lines: the only page with server-side filtering, user-saved preferences, its own inline date tree) · consumers: `partners/page.tsx`, `supplier-invoices/SupplierInvoicesClient.tsx`, `banking/transactions/TransactionsClient.tsx`, `expenses/ExpensesClient.tsx`, `documents/inbox/InboxClient.tsx`, `time-entries/page.tsx` (filterConfig and `filterFn` declarations) · `components/rate-range-filter.tsx` · `lib/utils/date.ts` (`formatDateWithLocale`) · `prisma/schema.prisma` `UserSettings.advancedTablePreferences` (l.170) · `scripts/migrate-advanced-table-preferences.ts`.
v3 side read: `docs/ui-conventions.md` (D19/D20 target + contract), `src/kernel/ui/data-table.tsx` + test, `src/modules/settings/table-preferences.ts`, `prisma/schema/settings.prisma` `TablePreference`, `docs/document-library.md`, `docs/user-preferences.md`.

## 1. What the feature is for (owner's terms)
Every list in the app (transactions, documents, invoices, expenses, rates) should filter like an Excel column header: click the header, tick the values you want from a list that shows what exists (with how many), pick dates by year → month → day, give a min/max for amounts, type "contains" for text, and have the other columns' lists shrink to what remains. Filters, sort and page must survive a refresh and be shareable as a URL; column choices stay per user. v1 built the header UI (1 870 lines over nine files) but filtered mostly in the browser on whatever page was loaded; v3 keeps the UI behaviour and moves all of it server-side on top of v2's `DataTable` (D20).

## 2. Behaviour — rules as numbered statements

### 2.1 Filter model per column type (v1 `DataTable.tsx` `filterConfig[columnId].type`)
- R1 A column is filterable when TanStack says `getCanFilter()` **and** the page gives a `filterConfig` entry; the entry's `type ∈ text | select | number | date` decides the dropdown content. Columns without config show no filter button. (`DataTable.tsx` l.39–46, l.422–435)
- R2 **text**: one input `Search...`; value = the string; empty string clears the filter (`setFilterValue(undefined)`). Semantics = TanStack default `includesString` (case-insensitive contains) — no operator choice (no starts-with / equals / empty). (l.519–528)
- R3 **select** (checkbox list): `options` = `string[]` or `{value,label}[]` supplied by the page; value = `string[]` of ticked values; empty array clears. Filter fn `arrIncludesSome`: row passes when its value is in the list; the marker `'__NULL__'` in the list means "blank" and matches `null | undefined | ''`; a blank row never matches a list without `'__NULL__'`. The list row for `'__NULL__'` is rendered italic grey `Blank`. (l.130–143, l.530–537; `checkbox-filter.tsx` l.86–108)
- R4 Checkbox list UX: search box (`Search...`, case-insensitive on the label) narrows the visible options; `Select All` toggles **the visible (searched) options**: if all visible are ticked → clears everything, else ticks all visible (replacing the selection, not adding); indeterminate state shown when some are ticked; `No options found` when the search hits nothing; list height capped at 16 rem with scroll. **No counts** per value. (`checkbox-filter.tsx` l.26–57, l.68–116)
- R5 **number**: two inputs `Min` / `Max` (`type=number step=any`, placeholder `Enter value`); value = `[min|null, max|null]`; both null clears. Filter fn `inNumberRange`: inclusive on both bounds, one-sided when one bound is null. No presets, no "equals", no "blank". (`number-range-filter.tsx`; `DataTable.tsx` l.144–152, l.539–552)
- R6 **date**: tree **year → month → day** built from `config.dateValues: Date[]` (the page passes the dates of the rows it has loaded, or for exchange rates every distinct date in the table). Value = `{ years: Set<number>, months: Set<'YYYY-MM'>, days: Set<'YYYY-MM-DD'> }`; all three empty clears. Filter fn `dateInHierarchy`: row passes when its year ∈ years **or** its month key ∈ months **or** its day key ∈ days. Keys are built in **local** time. (`utils.ts` `buildDateHierarchy`; `DataTable.tsx` l.153–176, l.554–571)
- R7 Date tree semantics (`date-hierarchy-filter.tsx`): years sorted descending, months descending, days descending; expand/collapse chevrons per year and month (collapsed by default); ticking a **year** adds it to `years` and removes every month/day key of that year; ticking a **month** removes its year from `years`, adds the month key, removes its days; ticking a **day** removes its year and month keys and toggles the day. A month shows checked when its key is selected **or** every one of its (existing) days is selected; indeterminate when some days are; a year likewise over its months. Only dates that exist in the data appear (no empty months/days). (l.41–166)
- R8 Quick date filters above the tree (`getQuickDateFilters`): `Today`, `Current Month`, `Last Month`, `Last 2 Months` (first of month-2 → now), `Current Year`; applying one **selects every existing day** in the range as `days` (never `months`/`years`), replacing the selection. (`utils.ts` l.40–89; `date-hierarchy-filter.tsx` l.191–212)
- R9 Day labels use `formatDate(date, locale)`: `dd.MM.yyyy` for locale `ch-fr`/`de-CH`, else ISO `yyyy-MM-dd` (built from `toISOString()`, i.e. UTC — can differ by one day from the local keys at the edges); month labels are English `MONTH_NAMES`. (`lib/utils/date.ts` l.107–120; `utils.ts` l.112–115)
- R10 Filter dropdown chrome: fixed-position panel (18 rem wide, max 70 vh) under the column header, repositioned on scroll, closed on outside click; header row = column name, `▲ Sort ascending` / `▼ Sort descending` buttons (active one blue), `Clear` link when active; body scrolls. Header cell shows a filter icon (blue when active) and a sort icon (`ArrowUpDown` / `ChevronUp` / `ChevronDown`). Clicking the header label also opens the filter. (`DataTable.tsx` l.180–244, l.414–576)
- R11 "Active" per type: text → non-empty string; select → non-empty array; number → any bound non-null; date → any set non-empty. (l.403–412; `column-filter.tsx` l.86–106)

### 2.2 Filter state — where it lived
- R12 Default: internal React state (`useState<ColumnFiltersState>`), lost on navigation. Optional controlled mode via `columnFilters` + `onColumnFiltersChange` props (used by the inbox clients and exchange rates). **Nothing in the URL** anywhere in v1. (`DataTable.tsx` l.89–99)
- R13 Exchange-rates page persists `{ columnFilters, sorting, columnVisibility, density }` as a JSON string in `UserSettings.advancedTablePreferences` (one blob per user, **not per table**), saved 1 000 ms debounced after any change, loaded on mount before the first fetch; `Set`s inside the date filter do not survive `JSON.stringify` (serialise to `{}`), so a persisted date filter reloads empty. (`exchange-rates/page.tsx` l.421–455, l.685–717, l.927–935; `schema.prisma` l.170)
- R14 Sorting: single column (`sorting[0]` only is sent to the server); toggle cycle asc → desc → none from the header icon; the dropdown's two arrows set asc/desc directly. (`exchange-rates/page.tsx` l.794–799; `DataTable.tsx` l.440–453, l.484–505)
- R15 Pagination: none in `DataTable.tsx` (the page loads everything or scrolls); exchange rates uses offset/limit 200 with an IntersectionObserver "load more" and shows `Showing {rows} of {totalRecords} records`; `DataTable.tsx` footer `Showing {filtered} of {data.length} rows`. (`DataTable.tsx` l.622–625; `advanced-table.tsx` l.207–211)

### 2.3 Server-side "available values" (what existed)
- R16 `GET /api/exchange-rates/available-values` → `{ currencies: string[] (union of DISTINCT fromCurrencyCode and toCurrencyCode, sorted), sources: string[] }` via three raw `SELECT DISTINCT … ORDER BY` over the whole `exchange_rates` table. **No counts, no cap, not narrowed by the other active filters, not tenant-scoped** (exchange rates are app-level). (`available-values/route.ts`)
- R17 `GET /api/exchange-rates/available-dates` → `{ data: Date[] (SELECT DISTINCT date ORDER BY date DESC), count }` — every distinct day ever (thousands of rows: 5 pairs × 250 days/year), feeding `buildDateHierarchy` on the client. (`available-dates/route.ts`)
- R18 Inbox-style endpoints return `filterOptions` inline when `includeFilterOptions=true`: documents → `{ documentTypes: distinct documentType, dateRange: {min, max} of uploadedAt }`; banking inbox → `{ bankAccounts: distinct names, currencies: distinct currency, statuses: fixed list, dateRange }`. Tenant-scoped, no counts, not narrowed. (`documents/inbox/route.ts` l.529–561; `banking/inbox-transactions/route.ts` l.323–359)
- R19 Every other list page computes the option lists **in the browser** from the rows it holds (`new Set(rows.map(r => r.country))`, with `'__NULL__'` prepended when a blank exists; dates = the rows' dates). (`partners/page.tsx` l.100–125; `supplier-invoices` l.248–268)
- R20 How exchange-rates sends filters to `/api/exchange-rates`: date selection is **flattened to `[min, max]`** of all selected days (so Jan + Mar selected = Jan 1 … Mar 31 including February); a select with exactly **one** value is sent (`fromCurrency`, `toCurrency`, `source`); with two or more values nothing is sent and the 200-row page is filtered client-side (so "has more" and totals are wrong); the number range is always client-side. (`exchange-rates/page.tsx` l.292–326, l.754–834)

### 2.4 Toolbar, columns, density, export, rows
- R21 Toolbar left: optional `toolbarLeft` slot and a blue pill `{n} filter(s) active` with an ✕ that clears all; right: `Export CSV`, `Columns` (checkbox list `Toggle Columns` of every column with `getCanHide()`), `Density` (`compact | comfortable | spacious` → cell padding `py-1 px-3 | py-2 px-4 | py-4 px-6`; default comfortable). Each feature has an `enable*` prop (all default true). No column reorder, no pinning, no resize, no saved views. (`DataTable.tsx` l.277–387)
- R22 `Export CSV` exports the **currently filtered rows in memory** with the visible columns (minus `actions`), header = column header string or id, cell = raw `row[col.id]` (nested accessors like `partner.name` give `undefined`), values containing a comma are wrapped in quotes, embedded quotes/newlines are not escaped; file name from `exportFilename` (default `export.csv`). Exchange rates has its own export: all loaded rows, headers `Date, From, To, Rate, Source`, locale-formatted date and 4-decimal rate, file `exchange-rates-{yyyy-mm-dd}.csv`. (`utils.ts` l.118–136; `DataTable.tsx` l.257–266; `exchange-rates/page.tsx` l.1049–1082)
- R23 Rows: hover highlight, `onRowClick` (cursor pointer), selected row = `selectedRowId` match → blue background + 4 px left border, `rowClassName(row)` hook; empty body `No data found`; loading state only in the unused `advanced-table.tsx` (`Loading...` spinner) and a `Load more` button variant. Header cells uppercase 12 px, `whitespace-nowrap`. (`DataTable.tsx` l.585–619; `advanced-table.tsx` l.146–200)
- R24 Keyboard: none in the table itself (no row navigation, no Escape to close the dropdown; outside-click only). The inbox pages add `j/k` etc. outside the table (H7).
- R25 Number formatting helper `formatNumber(n, decimals = 4, locale)`: Swiss locales `ch-fr`/`de-CH` → apostrophe thousands `12'433.25`, else `en-US` grouping; used for rate cells. (`utils.ts` l.96–110)

### 2.5 Dead code, bugs, abandoned directions (do not port)
- B1 `/api/currencies/available` is the ECB currency catalogue for the "add currency" admin screen (`{code, name, isAdded}`), not a filter endpoint — false lead in the harvest list.
- B2 `advanced-table.tsx`, `table-toolbar.tsx`, `column-filter.tsx`, `simple-table.tsx` are exported but imported by no page (`DataTable.tsx` is the one in use); `column-filter.tsx` hard-codes `filterType="select"` and never receives options → would render an empty list.
- B3 No consumer declares `filterFn: 'dateInHierarchy'` on its date column (`supplier-invoices`, `banking/transactions`, `expenses` only declare `arrIncludesSome`/`inNumberRange`), so TanStack falls back to its auto filter (`includesString` for the ISO-string dates coming from JSON, fed an object value → `filterValue.toLowerCase` is not a function, or at best **zero rows**) once any date is ticked. The date tree only ever worked on the exchange-rates page, which bypasses `DataTable.tsx` with its own inline tree and server round-trip.
- B4 R20: multi-value selects and number ranges are applied to a 200-row page client-side → wrong totals and "has more"; date selection flattened to a range (R20).
- B5 R13: `Set`s in persisted preferences serialise to `{}`; one preference blob for all tables (`advancedTablePreferences`), so two pages overwrite each other's state.
- B6 R9: day keys local, day labels UTC → off-by-one around midnight for CET users; `getQuickDateFilters()` captures `now` once per render.
- B7 R22: CSV export is not RFC 4180 (quotes/newlines), exports only loaded rows, breaks on nested accessors.
- B8 `Select All` replaces the selection with the visible options (R4) — ticking three values, searching, then "Select All" silently drops the three.
- B9 `rate-range-filter.tsx` is a third copy of the number filter (`step=0.0001`, placeholders `Min rate`/`Max rate`) used only by the exchange-rates page.
- B10 `app/dashboard/table-test` — a playground page (listed as dropped in feature-inventory §3.17).

## 3. Data — the fields that matter

### 3.1 Filter value shapes (v1 client) → v3 `ListQuery` (ui-conventions contract)
| column type | v1 value | v1 filter fn | v3 `Filter` | v3 SQL |
|---|---|---|---|---|
| text | `string` | `includesString` (contains, ci) | `{ op: contains|startsWith|equals|empty, value }` | `ILIKE '%v%'` / `ILIKE 'v%'` / `= v` / `IS NULL OR = ''` |
| select / enum / relation | `string[]`, `'__NULL__'` = blank | `arrIncludesSome` | `{ in: string[] }`, `null` entry = blank | `col IN (…)` [`OR col IS NULL`] |
| number / money | `[min\|null, max\|null]` | `inNumberRange` inclusive | `{ between: [a\|null, b\|null] }` or `{ eq }` or `{ gt }` / `{ lt }` (presets `> 0`, `< 0`) or `{ empty: true }` | `BETWEEN` / `>=` / `<=` / `=` / `>` / `<` / `IS NULL` |
| date | `{ years:Set, months:Set, days:Set }` | `dateInHierarchy` (OR of the three) | `{ dates: { years: number[], months: 'YYYY-MM'[], days: 'YYYY-MM-DD'[] } }` or `{ between: [from, to] }` for presets/custom | `EXTRACT(year)=ANY OR to_char(d,'YYYY-MM')=ANY OR d=ANY` — or cheaper: expand to a list of `[from,to]` ranges and `OR` them |
| boolean / status | `string[]` | `arrIncludesSome` | `{ in }` | `IN` |

### 3.2 Distinct values response
v1: `string[]` (no counts). v3 (`queries.distinct(tx, col, filters)`): `{ value: string | null, label?: string, count: number }[]`, ordered by `count desc, value asc`, capped at **500** with `truncated: true` and the instruction "search to narrow" (ui-conventions). For date columns the same call returns the hierarchy with counts: `{ year, count, months: [{ month, count, days: [{ day, count }] }] }`.

### 3.3 Table state
| state | v1 | v3 |
|---|---|---|
| filters, sort, page, pageSize | React state / one JSON blob per user (exchange rates) | **URL** search params, one key per column: `?f.status=in:open,sent&f.amount=between:0,1000&f.date=dates:2026,2026-03,2026-03-11&f.name=contains:nordea&sort=date:desc&page=2&size=50`; `null` in `in:` encoded as `~` |
| column visibility, order, width, density | visibility + density in the same blob | `table_preferences(user_id, table_key)` JSON (v2): `{ visibility: {col: bool}, order: col[], widths: {col: px}, density }` — debounced 2 s like the document library |
| selected rows | page state | page state (never persisted) |

### 3.4 Column definition (v3 contract, derived)
`{ id, header (i18n key), type: 'text'|'enum'|'number'|'money'|'date'|'boolean'|'relation', filterable: bool, sortable: bool, align?: 'right' for number/money, options?: static enum list (then no distinct call), hidden?: bool default }`. The component derives the filter UI from `type`; modules never write filter UI (ui-conventions §Contract).

## 4. Algorithms / formulas

### 4.1 Date hierarchy from a list of dates (v1 `buildDateHierarchy`, client)
```
for each date: key = local yyyy-mm-dd; skip if seen
  hierarchy[year][month0].push(new Date(year, month0, day))      -- time stripped
sort days desc within month; years/months rendered desc
```
v3 (server, with counts, on the already-filtered set minus the date column's own filter):
```sql
select extract(year from d)::int y, extract(month from d)::int m, d::date day, count(*) n
from <base query with every filter except this column's>
group by 1,2,3 order by 1 desc, 2 desc, 3 desc
```
→ fold into `{year, count, months:[{month, count, days:[{day, count}]}]}`; cap: if distinct days > 500 return years+months only and flag `daysTruncated`.

### 4.2 Tri-state tree selection (v1 `date-hierarchy-filter.tsx`, keep verbatim)
```
toggleYear(y):  if y ∈ years: remove y, remove all months/days of y
                else: add y, remove all months/days of y
toggleMonth(m): remove year(m) from years
                if m ∈ months: remove m and its days
                else: add m, remove its days
toggleDay(d):   remove year(d), remove month(d); toggle d
checked(month)  = m ∈ months OR every existing day of m ∈ days
partial(month)  = m ∉ months AND 0 < |days of m ∈ days| < |days of m|
checked(year)   = y ∈ years OR every month of y checked
partial(year)   = y ∉ years AND some month checked or partial
```
v3 change: when a **year** is un-ticked but it is "checked" only through its months/days (v1 then adds it — the `else` branch — effectively selecting the whole year), v3 removes the children instead (Excel behaviour). Quick presets (R8) write a `between` range, not thousands of day keys.

### 4.3 Row predicate for the date filter (v1 client, v3 server)
`pass(row) = year(row) ∈ years OR 'YYYY-MM'(row) ∈ months OR 'YYYY-MM-DD'(row) ∈ days` (OR across levels; a selected year makes its months irrelevant). Server: convert to ranges — each year → `[y-01-01, y-12-31]`, each month → `[m-01, last day]`, each day → `[d, d]`; merge overlapping ranges; `WHERE d BETWEEN … OR …`. Tested with property tests (any selection ≡ the set of days it denotes).

### 4.4 Checkbox list behaviour (v1 R4 → v3)
```
visible = options filtered by search (label, ci)
selectAll: if every visible ∈ selected: selected −= visible   -- v3: remove only the visible ones
           else selected ∪= visible                             -- v3: add, never replace
indeterminate = 0 < |selected ∩ visible| < |visible|
```

### 4.5 Number range
`pass = (min is null or v ≥ min) and (max is null or v ≤ max)` (inclusive, one-sided allowed — v1 semantics kept). v3 adds `eq` (exact, compared as Decimal, never float) and `empty` (`IS NULL`). Presets are strict-sign predicates, not ranges: `> 0` → `{ gt: 0 }`, `< 0` → `{ lt: 0 }` (so a 0.00 row matches neither); the `Filter` union therefore gets `gt`/`lt` besides `between`.

### 4.6 Text operators (new in v3; v1 only "contains")
`contains` → `ILIKE %v%` (escape `%`, `_`, `\`); `startsWith` → `ILIKE v%`; `equals` → `= v` (ci via `lower()`); `empty` → `IS NULL OR = ''`. Debounce 300 ms (document-library convention).

### 4.7 Distinct values narrowed by the other filters (Excel semantics, D20)
`distinct(col, filters)` applies **every filter except `filters[col]`** (so the open column still lists its own ticked values) and returns value + count over that set. Cap 500; when truncated the list shows the top 500 by count and `Search to narrow…`; the search box then queries the server (`q` param, `ILIKE q%` then `%q%`) instead of filtering locally.

### 4.8 URL (de)serialisation
```
f.<col> = <op>:<payload>      op ∈ in | contains | startsWith | equals | empty | between | eq | dates
in:       comma list, '~' = null, values URL-encoded
between:  a,b with empty side allowed ("between:,1000", "between:0,")
dates:    comma list mixing 2026 | 2026-03 | 2026-03-11
sort    = col:asc|desc[,col2:asc]      (v3 allows multi; UI exposes one, shift-click adds)
page, size
```
Unknown columns/ops are ignored (not an error); a malformed value drops that one filter. `Clear all` = remove every `f.*` and `page`.

## 5. UI behaviour worth keeping
- Header cell = label (click opens filter) · sort glyph · filter glyph (blue when active). Dropdown header: column name · `▲ ▼` sort · `Clear`. Body by type. Keep the fixed-position panel that follows the header on scroll; add **Escape closes**, **Enter applies** (v3 applies on close, not on every tick — one server round-trip per change is wasteful for the checkbox list; show an `Apply` button and a live count `{n} rows` from `distinct`).
- Checkbox list: search box on top (server-backed when truncated), `Select all` (visible), `Blank` row in italics when nulls exist, each row `label … count` right-aligned grey, `No options found`, `Search to narrow (500+ values)`.
- Date tree: presets row (`Today · This month · Last month · This quarter · This year · Custom range…` — v1 had `Last 2 Months`, no quarter, no custom), then years ▸ months ▸ days with counts (`2026 (142)`, `March (31)`, `2026-03-11 (3)`), descending, collapsed by default, month names from the locale (v1: English only).
- Number: `Min` / `Max` inputs + presets `> 0`, `< 0`, `= …`, `Blank`; money columns show the currency code of the column when single-currency, else none.
- Toolbar: active filter **chips** above the table (`Status: open, sent ✕`, `Date: 2026-03 ✕`, `Amount: 0 – 1 000 ✕`) + `Clear all` (v1 had only a counter pill); right: `Columns`, `Density`, `Export CSV` (server-side, current filter, all rows, RFC 4180, UTF-8 BOM so Excel opens it, `;`-less — Excel-fr note in Q3).
- Footer: `{filtered} rows` (`of {total}` when filtered) + server sums of money columns on the filtered set; page size 10/25/50/100 (v2) — v1's infinite scroll dropped for lists (keep paging; virtualise within the page).
- Rows: 36 px, numbers right in tabular figures, dates `yyyy-mm-dd`, currency with code (ui-conventions). Selected row = left border + tint (v1 look). Keyboard on list pages: `j/k` move focus, `Enter` open, `Space` toggle selection, `Esc` closes dropdown/clears selection (v1 had none in the table).
- Strings (en/fr):

| key | en | fr |
|---|---|---|
| table.filter.search | Search… | Rechercher… |
| table.filter.selectAll | Select all | Tout sélectionner |
| table.filter.blank | (Blank) | (Vide) |
| table.filter.noOptions | No options found | Aucune valeur |
| table.filter.truncated | Showing top 500 — search to narrow | 500 premières valeurs — affinez par la recherche |
| table.filter.clear | Clear | Effacer |
| table.filter.apply | Apply | Appliquer |
| table.filter.sortAsc / sortDesc | Sort ascending / Sort descending | Tri croissant / Tri décroissant |
| table.filter.min / max | Min / Max | Min / Max |
| table.filter.text.contains / startsWith / equals / empty | contains / starts with / equals / is empty | contient / commence par / égal à / est vide |
| table.filter.date.today / thisMonth / lastMonth / thisQuarter / thisYear / custom | Today / This month / Last month / This quarter / This year / Custom range… | Aujourd'hui / Ce mois / Mois dernier / Ce trimestre / Cette année / Période… |
| table.filter.number.positive / negative / equals / blank | > 0 / < 0 / equals / blank | > 0 / < 0 / égal à / vide |
| table.toolbar.activeFilters | {n} filters active | {n} filtres actifs |
| table.toolbar.clearAll | Clear all | Tout effacer |
| table.toolbar.columns | Columns | Colonnes |
| table.toolbar.density | Density | Densité |
| table.density.compact / comfortable / spacious | Compact / Comfortable / Spacious | Compact / Confortable / Aéré |
| table.toolbar.export | Export CSV | Exporter CSV |
| table.footer.rows | {n} rows | {n} lignes |
| table.footer.rowsOf | {n} of {total} rows | {n} sur {total} lignes |
| table.empty | No results | Aucun résultat |
| table.empty.filtered | No results for the active filters | Aucun résultat pour les filtres actifs |
| table.loading | Loading… | Chargement… |

## 6. Tests to port
v1 has **no unit tests** for `components/advanced-table/**` and no e2e on filters (the 129 Playwright specs in the repo are auth-protection checks). Everything below is new; fixtures carry the v1 constants.

Kernel `list-query.ts` (Vitest, per filter type):
- `text contains → ILIKE %v% with escaped % _ \` (`text-cases`); `startsWith`, `equals (ci)`, `empty (null or '')`.
- `in with values → IN`; `in with ~ → IN … OR IS NULL`; `in with only ~ → IS NULL`; empty `in` → no filter.
- `between both / left-open / right-open / eq / empty` on Decimal columns (compare as Decimal, never float).
- `dates: year only`; `month only`; `day only`; `mixed year+month+day → merged ranges` (`date-filter-cases.json`); property: for random selections, rows passing the SQL ≡ rows whose day ∈ denoted set.
- `distinct excludes the column's own filter but applies the others` (`distinct-cases.json` — partners example: filter country=CH narrows `type` counts, `country` list still shows SE with its count).
- `distinct cap 500 + truncated flag`; `distinct search q → ILIKE q% first`.
- `distinct for date column returns hierarchy with counts`.
- `URL round-trip: serialise(parse(s)) == s` for every op; malformed value drops that filter only; unknown column ignored.
- `sort multi column; default sort from column defs`.
- `sums on money columns over the filtered set (Decimal)`.

Component (Vitest + Testing Library, extend `data-table.test.tsx`):
- `header filter button only for filterable columns`; `opens on label click`; `Escape closes`; `outside click closes`.
- `checkbox list: search narrows; select all adds visible only; deselect all removes visible only; indeterminate; blank row italic; counts rendered`.
- `date tree: tick year clears its months/days; tick month clears its year and days; tick day clears year and month; month checked when all days ticked; partial states` — 10 cases in `date-tree-cases.json` (tri-state algorithm 4.2).
- `preset writes a between range, not day keys`.
- `number: both empty clears; one-sided allowed; presets`.
- `active filter chips render per column and remove on ✕; Clear all empties f.* and resets page`.
- `column visibility/density persisted to table_preferences (debounced), filters not`.
- `export calls the server action with the current ListQuery`.

Playwright (list page = partners, the reference slice):
- `filter by enum narrows other columns' distinct lists`; `date year → month drill`; `URL survives reload and back button`; `screenshot per filter type` (definition of done §4.5).

## 7. Fixtures copied → `specs/kernel-ui-datatable/fixtures/`
- `v1-filter-model.json` — v1 value shapes per type, filter-fn semantics, `'__NULL__'` marker, active-state rules, density paddings, toolbar strings, `MONTH_NAMES`, locale date/number formats (from `types.ts`, `DataTable.tsx`, `utils.ts`, `lib/utils/date.ts`).
- `quick-date-filters.json` — v1's five presets with their range rules (`utils.ts getQuickDateFilters`) and v3's proposed set.
- `date-tree-cases.json` — sample date list → expected hierarchy (with v3 counts), plus tri-state selection cases (input selection + action → expected sets, from `date-hierarchy-filter.tsx` semantics) and the row-predicate cases.
- `list-query-cases.json` — v3 `ListQuery` examples per type with their URL form and the SQL predicate they must produce; distinct narrowing example; text-escaping cases.
- `v1-available-values-samples.json` — the response shapes of `/api/exchange-rates/available-values`, `available-dates`, documents inbox `filterOptions`, banking inbox `filterOptions`, and the query params the exchange-rates page sent (R20) — the "before" picture for the gap analysis.

## 8. v3 mapping — gap analysis v1 → target (ui-conventions.md) → v2 code
What exists in v2 (`src/kernel/ui/data-table.tsx`, 289 lines): TanStack v8 with `manualSorting` + `manualPagination`, controlled `sorting/page/pageSize`, header sort toggle (asc → desc), skeleton loading, empty-state slot, row click, virtualisation above 50 rows, page-size select (10/25/50/100), `Page x of y`; 10 tests. **No header filters, no distinct values, no URL state, no chips, no column visibility, no density, no export, no sums.** `table_preferences(user_id, table_key, json)` exists (used by the document library for filters + sort + page size, written 2 s debounced) — v3 keeps the table but moves **filters out of it** (URL) and keeps visibility/order/width/density in.

| capability | v1 | target (D20) | v2 today | build |
|---|---|---|---|---|
| typed header filters | yes, client, 4 types | yes, server, 6 types + text ops | no | port `checkbox-filter`, `number-range-filter`, `date-hierarchy-filter` **behaviour** (not code) into `kernel/ui/data-table/filters/*`, driven by `ColumnDef.meta.type` |
| distinct values with counts | no (lists, client) | yes, server, narrowed, cap 500 | no | `queries.distinct()` per module via `kernel/db/list-query.ts` helper `distinctFor(where, col)` |
| date hierarchy with counts | tree without counts, one page | tree with counts | no | `distinctDates()` in the same helper |
| text operators | contains only | contains / starts / equals / empty | ILIKE contains (library search box) | `list-query.ts` |
| number presets | none | `> 0`, `< 0`, equals, blank | no | component + helper |
| filter state | React / one JSON blob | URL | Zustand + table_preferences (library) | `useListQueryUrl()` hook in `kernel/ui`; library migrates to it |
| column prefs | visibility + density, one blob | per user per table | table_preferences per key | reuse; schema `{visibility, order, widths, density}` |
| chips + clear all | counter pill + ✕ | chips | no | component |
| sums footer | no | money sums on the filtered set | no | `queries.list()` returns `sums` |
| export | client CSV of loaded rows | CSV of the current filter, server | no | server action per module `exportCsv(q)` streaming; kernel helper for RFC 4180 |
| pagination | none / infinite | server paging | yes | keep v2 |
| keyboard | none | j/k/enter/space/esc on list pages | no | component |
| density | 3 levels | 3 levels | no | component, persisted |
| column reorder / width | no | yes (persist) | no | TanStack column order + resizing, persisted |
| pinning | no | not in target | no | skip |

Decisions applied: D19 (full-width list archetype), D20 (one kernel `DataTable`, server-side, URL state, prefs per user), constitution (modules expose `queries.list/distinct`; `kernel/ui` never imports server code; Decimal through the helper; `ILIKE` escaping). Dropped from v1: `advanced-table.tsx` family, `rate-range-filter.tsx`, `table-test`, the per-user single JSON blob, client-side CSV, `Set`-based filter values, "Last 2 Months" preset (replaced by quarter + custom), English-only month names, infinite scroll in lists. New: counts, narrowing, text operators, presets, chips, sums, URL state, keyboard, en/fr strings, screenshots per filter type (phase-0 item 8 step 4).

Build order (phase-0 item 8): `kernel/db/list-query.ts` + tests → filter components on v2 `DataTable` → `partners` reference use (`queries.list`, `queries.distinct`) → `documents` library migrated (its Zustand filter store becomes URL-backed) → screenshots in the PR.

## 9. Open questions for the owner
- Q1 Apply-on-close vs apply-on-each-tick for checkbox and date filters: each tick = one server round-trip (list + distinct). Proposal: live row count in the dropdown, data refreshes on `Apply`/close. OK?
- Q2 Date presets: `Today · This month · Last month · This quarter · This year · Custom range`. Keep v1's `Last 2 months`? Add `Last 12 months` for the accountant package views?
- Q3 CSV export for the accountant: comma-separated UTF-8 with BOM (Excel-fr on Swiss/French locales expects `;` and `,` decimals). Pick one: `,` + `.` (machine-friendly, v1) or follow the user's locale (`;` + `,`)? Proposal: `,`/`.` always, and the accountant package (H12) writes `.xlsx` anyway.
- Q4 Distinct cap 500 with server search beyond — fine for partners/categories; for `counterparty` on 3 years of bank rows (~1 500 distinct names) the list will be truncated often. Raise to 1 000 or accept search-first? (Proposal: 500 + search; counterparty lists are typed into anyway.)
- Q5 Week start and "this quarter" follow the Swedish calendar (ISO Monday, Q1 = Jan–Mar). The Swiss VAT quarters are the same. Confirm nothing needs a fiscal year ≠ calendar year.
- Q6 Column widths/order persistence: worth it now (one user) or defer to Growth with pinning? (Proposal: visibility + density now; order/width later.)
