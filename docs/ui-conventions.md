# UI conventions

Version 3 · 2026-10-22 · Decisions D19, D20 and **D40 (the visual direction, F39)** in [[feature-inventory]]. Applies to every page; the repo skill `.claude/skills/af-design` is the checklist form of this page — every UI PR follows it. *Visual direction* below is **built in the shell and the kernel kit** since F39 (2026-10-22, see *Where it lives* at the end of that section); the modules inherit it — what each module still adopts on its own (its states, its on-screen money, its keys and row actions) is F71 in [[features]]. Before v3, Version 2 (2026-10-20) — the layout and the DataTable, unchanged below. **Built** (phase-0 item 8): the shell (`kernel/ui/shell`: sidebar, topbar, `ListPage` / `EntityPage` / `WorkPage` / `PageHeader`), the `DataTable` (`kernel/ui/data-table`) and the `ListQuery` contract (`kernel/list-query`), first used by [[partners]]. Column order / width / visibility persist per user since 2026-10-21 (`kernel/ui/data-table/preferences.tsx` + `table_preferences`). Still to come: virtualised body. The documents library migrated onto it on 2026-10-20 (the legacy table is gone). The list page's **side panel** is `components/ui/sheet.tsx` (first used by the banking workbench and the journal, then the expenses list) — since F39 it docks into the canvas (*Details panel* below); forms that interrupt (import, rule, manual entry, new expense, new group) use `components/ui/dialog.tsx`. The first **work page** is `/expenses/settle` (`WorkPage`: the open expenses left, the refund row and the confirmation right).

## Layout — full width, dense, app not website

v2 centred pages in `max-w-5xl`. v3 is a working tool for managing a company: screens are wide, dense and consistent.

```
┌─ top bar (44 px, app background): ☰ · logo ───────── search (Ctrl P) ───────── tenant ▾ · avatar ─┐
├─ sidebar (190 → 56 px) ──┬─ content canvas (surface, 1 px border top + left, 10 px top-left radius) ─┤
│ + New                    │ breadcrumb ›                                         │ details panel     │
│ Dashboard                │ ▣ Title  [tag] [tag]           ⋮  [Secondary] [Primary ▾] │ (list pages,  │
│ Records                  │ Tab 11 │ Tab 4 │ Tab                                 │  selected row):   │
│   Banking · Documents ·  │ ⓘ banner (optional)                                  │  ⌃ About          │
│   Journal                │ summary panel (optional, e.g. Months)                │  ⌃ Proof          │
│ Sales: Partners · Invoic │ [Filter rows] [Col: value ▾] [Col ▾] Clear filters   │  ⌃ <module form>  │
│ Costs: Supplier inv. ·   │ DataTable (header filters, 32 px rows, ⋮ per row)    │  ⌄ History        │
│   Expenses               │ footer: count · Σ · pager                            │                   │
│ Close: Package · Decl.   │                                                      │                   │
│ Settings (bottom)        │  entity pages → title row + underline tabs           │                   │
│                          │  work pages   → split panes (list | detail)          │                   │
└──────────────────────────┴──────────────────────────────────────────────────────┴───────────────────┘
```

Rules
- No `max-w-*` on page containers; the canvas padding is 20 px sideways, 14 px on top; content stretches. Reading-length limits apply only to prose (settings help text, notes).
- Three page archetypes and nothing else: **list** (DataTable + the docked details panel for the selected row), **entity** (title row + underline tabs: overview, documents, links, audit), **work** (split panes for linking, review, settlement — list left, detail right, keyboard navigable).
- Density: 13 px table text, **32 px rows**, numbers right-aligned in tabular figures, dates `yyyy-mm-dd`, money as `−2 312.43 SEK` (see *Numbers*).
- Keyboard first on work pages: `j/k` move, `enter` open, `l` link, `u` undo (v1 inbox UX, H7).
- Dark mode via tokens from day one; no hardcoded colours.
- Sidebar hides by role; the server enforces (both required, constitution §6).

## Visual direction — "Lakehouse" (D40, F39)

Chosen by the owner on 2026-10-22 from four mockups (A Ledger · B Workbench · C Paper · **D Lakehouse**), on the Design canvas *AF — F39 UI directions*. D is **inspired by** the 2026 Databricks workspace UI the owner works in daily — the pattern language (top-bar search, grouped icon sidebar, content canvas, underline tabs, a details panel of collapsible sections, icon-plus-word statuses) — never its logo, red, names or assets. Not the shadcn default look.

### Brand
- Logo: `public/brand/af-logo.svg` (full, 1143 × 252) and `public/brand/af-sign.svg` (the sign, 167 × 252); `-dark` variants recolour the navy for dark mode. Full logo in the top bar at 24 px high; the sign is the favicon / app icon and the collapsed-sidebar mark. Never re-type the paths; never recolour beyond the two variants.
- Brand colours: navy `#2C3241`, crimson `#CD1F3D`. Crimson appears in the logo and the **+ New** button only — it is not the action colour and not an error colour.

### Tokens (CSS variables on `:root`, redefined for dark — from the OS unless the user forced light, or forced dark (D43) — mapped onto the shadcn names in `globals.css`)

Light / dark: System (the default) follows the OS; My Preferences can force Light or Dark (D43) — `<html data-theme="light|dark">`, set in the first HTML from the `af-theme` cookie. Colour through tokens and the `dark:` variant only; never `@media (prefers-color-scheme)` or a `<picture>` media query in a component (they ignore the user's choice). The two dark token blocks in `globals.css` stay equal (`kernel/ui/theme.pure.test.ts`).

| token | light | dark | use |
|---|---|---|---|
| `--app` | `#F6F7F9` | `#1F2428` | top bar, sidebar, page behind the canvas |
| `--surface` | `#FFFFFF` | `#16191C` | the content canvas, panels, popovers, inputs |
| `--border` | `#D8DEE4` | `#2F3940` | canvas edge, inputs, buttons, table header rule |
| `--border-subtle` | `#EBEEF1` | `#232B31` | table row separators, count badges |
| `--text` | `#11171C` | `#E8ECF0` | everything readable |
| `--text-muted` | `#5A6C7A` | `#9AABB9` | labels, secondary text, section labels (≥ 4.5:1 on every ground, `--tag` and `--hover` included) |
| `--primary` | `#2272B4` | `#4299E0` | primary buttons, links, dates-as-links, active tab rule, focus ring |
| `--primary-hover` | `#0E538B` | `#8ACAFF` | hover of the above; active nav text |
| `--primary-fg` | `#FFFFFF` | `#0B0F12` | text on primary |
| `--hover` | `#EEF2F5` | `#232A30` | row and item hover |
| `--selection` | `#EDF5FC` | `#132C44` | selected row, active filter button (a `--primary` link on it ≥ 4.5:1) |
| `--nav-active` | `#E2EBF3` | `#2A3540` | the current sidebar item |
| `--brand` / `--brand-tint` | `#CD1F3D` / `#FBE9EC` | `#EC4A64` / `#2B151B` | **+ New** only |
| `--state-done` | `#277C43` | `#6CC08A` | done icons; positive amounts |
| `--state-progress` | `#2272B4` | `#6FB4F0` | in-progress icons |
| `--state-attention` | `#B26B00` | `#F0B65A` | attention icons, *to justify* bars |
| `--state-neutral` | `#8396A5` | `#8396A5` | neutral icons |
| `--destructive` | `#C82D4C` | `#F28B9E` | delete / irreversible only |
| `--tag` | `#EBEEF1` | `#26303A` | metadata tags, code chips, info banner |

Four values were darkened a shade from the mockup by F39 so every text pair reaches 4.5:1 (the e2e's axe scan caught `--text-muted` on `--hover` at 4.43): `--text-muted` light, `--selection` both, `--brand-tint` dark.

Radius: 4 px controls, tags and buttons; 6–8 px panels and cards; 10 px the canvas's top-left corner. No shadows except popovers and dialogs. No gradients.

### Type
- **System font stack**, nothing to load: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Mono for keys and file names: `ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace`. This drops `next/font` (Geist) — no font download in any environment.
- Scale: page title 20 / 600 · panel title 15 / 600 · body, table, labels 13 / 400 · table headers and section heads 13 / 600 · secondary 12 / 400 · the selected amount in the details panel 22 / 600.
- `font-variant-numeric: tabular-nums` on every figure (amounts, dates, counts, rates). Business keys (`VA26-INV-007`, `SI-2026-031`, `Ex12-6540-003_2026-07-28_`) render as a mono **code chip** (`--tag` background, 4 px radius).

### Numbers
One format in every UI language: thousands with a narrow no-break space (U+202F), `.` decimals, a true minus (U+2212), `+` only where the sign is the point (bank rows), the currency code after: `−2 312.43 SEK`, `+237 740.00 SEK`, `24 000.00 CHF`. One kernel formatter (`kernel/money`), never `toLocaleString` in a component. Printed documents (invoices, statements) keep their language's format — that is [[pdf]]'s rule, not this one.

### States and tags — two different things
- A **state** (derived, constitution: never typed) is an **icon + word**: a 15 px circle icon in the family colour, the word in `--text` (neutral words in `--text-muted`). No pill, no background.

  | family | icon | states |
  |---|---|---|
  | attention | ⓘ-style `!` circle, `--state-attention` | Open (bank row to justify), Overdue, Due, Awaiting link, OCR failed |
  | in progress | half-filled circle, `--state-progress` | Match found, Issued, Sent, Partially paid, OCR pending, Ready |
  | done | ✓ circle, `--state-done` | Linked, Paid, Reviewed / Filed, Settled, Credited |
  | neutral | `–` circle, `--state-neutral` | Draft, Transfer, No document needed, Cancelled, Archived |

  One component, `<StateLabel family state />`, in the kernel kit; a module maps its derived status to a family in one place.
- A **tag** is metadata (bank, currency, document type, VAT registration): grey `--tag` rectangle, 4 px radius, 12 px text, never a colour.
- A **count** is a round grey badge (`--border-subtle`, 11 px / 600): tab counts, sidebar counts of open items.

### Shell
- **Top bar** (44 px, `--app`): sidebar toggle · full logo · centred search (520 px, `Ctrl P`) · tenant switcher · avatar. Replaces today's topbar (the breadcrumb moves into the canvas).
- **Sidebar** (190 px, collapses to 56 px icons only; `--app`): **+ New** (brand tint: upload document, import CSV, new invoice / supplier invoice / expense) · groups with 12 px muted labels, lucide icons at 16 px, a count badge for open work · **Settings** pinned to the bottom. The **order follows the owner's monthly loop** — import the bank statement, then attach a document to each line:

  ```
  Dashboard
  Records   Banking · Documents · Journal
  Sales     Partners · Invoices
  Costs     Supplier invoices · Expenses
  Close     Package · Declarations
  ─────
  Settings
  ```
  The group labels are i18n keys (`nav.group.*`). This is the nav-constants change in F39's builder PR.
- **Content canvas**: `--surface`, 1 px `--border` on top and left, 10 px top-left radius, flush right and bottom.

### Page anatomy (list and entity pages)
1. **Breadcrumb** — links in `--primary`, `›` separators, the current page not repeated. Names, never ids (`Partners › Valtech Switzerland SA`, not `353ec92f`).
2. **Title row** — 28 px icon tile (`--tag`) · title 20 / 600 · copy button when the title is a key · tags · spacer · ⋮ more · secondary buttons · **one primary** (a split button `Import CSV ▾` when the primary has variants). The title appears once (today's partner page shows it twice).
3. **Underline tabs** — 13 px, the active one `--text` / 600 with a 2 px `--primary` rule, counts as badges.
4. **Info banner** (optional) — `--tag` background, ⓘ icon, one sentence, one link, at most one small button on the right. For what the owner should do next on this page (*July 2026: 4 transactions have no proof yet — package 2026-07 not built. Open package*), not for errors (those are toasts or inline).
5. **Summary panel** (optional) — a bordered 6 px card above the table; on banking the **Months** panel (F69): bars per month (*justified* `--state-done` stacked under *to justify* `--state-attention`) and an account × month square grid (done / attention / not imported `--tag`). Clicking a month sets the Month filter.
6. **Filter bar** — `Filter rows…` (the table's free-text search) · one **filter button per active or common column** (`Month: July 2026 ▾`; an active one has `--primary` border on `--selection`) · `Clear filters` link · right-aligned context (balance, as-of date). The buttons open the **same typed filter popovers as the column headers** (D20 unchanged); they replace today's removable chips.
7. **DataTable** — see below; headers 13 / 600 on `--surface` with a 1 px `--border` rule, rows separated by `--border-subtle`, hover `--hover`, selected `--selection`; the date (or key) cell is the row's link in `--primary`; a ⋮ row-actions button last; the column chooser icon in the header's last cell.
8. **Footer** — row count · Σ of money columns · `‹ Previous` / `Next ›`.

### Details panel (the list page's side panel)
Docked on the right of the canvas (340–400 px, a 1 px `--border` left edge), **not** an overlay sheet: the table narrows. Opens on row selection; × and Escape close the row. Since F74 a **Hide** button beside × collapses the panel to a 40 px rail with **Show**, and the choice is remembered per table (the page's DataTable keeps it in its layout, `panelHidden` in `table_preferences`): a hidden panel stays a rail when another row is picked and after a reload, until *Show*. Section titles from the kernel's keys: `details.about`, `details.proof`, `details.history`. Content, top to bottom: the row's title (description / key) and its amount 22 / 600 with its state · collapsible sections with a chevron header — **About this <thing>** (a key–value grid: label column 110 px `--text-muted`), **Proof** (links and suggestions: the suggested target as a link, its reasons, `Link` primary + `Dismiss`; with nothing linked: `Upload document · Link to… · No document needed`), the module's **form** (category, partner…), **History** (collapsed by default). Small buttons (26 px) inside the panel. Dialogs stay for interrupting forms (import, rule, new expense) — unchanged.

### Buttons
32 px, 4 px radius: **primary** (`--primary`, 600) — at most one per title row or dialog; **secondary** (surface, `--border`); **link** (no border, `--primary`); **icon** (28 px, no border, `--text-muted`, hover `--hover`, always an `aria-label`); **destructive** (`--destructive`, behind a confirm). 26 px small variant inside panels and banners.

### Light / dark
Light is the default; dark follows the OS (`prefers-color-scheme`) — no theme setting until someone asks (constitution: no setting for a single use). Every colour comes from a token; the logo swaps to its `-dark` file.

### Where it lives (built by F39)

| Piece | File | Notes |
|---|---|---|
| Tokens, type, dark | `app/globals.css` | the table above as CSS variables; shadcn names map onto them (`--background` = `--surface`, `--muted-foreground` = `--text-muted`, `--accent` = `--hover`…); utilities `bg-app`, `bg-surface`, `border-subtle`, `bg-hover`, `bg-selection`, `bg-nav-active`, `text-brand` / `bg-brand-tint`, `text-state-*`, `bg-tag`; `dark:` = the OS setting (`@custom-variant dark` on the media query, no class); radius scale 4 px controls, 8 px cards / dialogs |
| Shell | `kernel/ui/shell/app-shell.tsx` (+ `topbar`, `sidebar`, `breadcrumb`, `details-dock`, `shell-context`, `routes`, `icons`) | the top bar's search finds pages by name in the UI language (`routes.ts` `destinationsFor`, `Ctrl P` / `⌘ P`); the avatar menu holds My preferences and Log out; the sidebar's groups come from `NAV_ITEMS[].group` (`NAV_GROUPS`), **+ New** from `NEW_ITEMS` (each opens the page whose primary makes the thing); the collapsed state is per browser |
| Breadcrumb | `kernel/ui/shell/routes.ts` `crumbsFor` | named ancestors only (`NAV_ITEMS` + `SUB_PAGES`); ids, `new` and route groups are skipped. A page's own `back` link shows only where the trail is empty (the link graph) |
| Page anatomy | `kernel/ui/shell/page.tsx` | `PageHeader` = section icon tile · title 20 / 600 · `tags` · `meta` · `actions` · `tabs` · `banner`; `ListPage` / `EntityPage` / `WorkPage` with the 20 / 14 px canvas padding |
| Details panel | `components/ui/sheet.tsx` + `details-dock.tsx` | a right-side `SheetContent` inside the shell portals into the dock (380–400 px, `--border` left edge, no backdrop, non-modal, a row click does not close it; Escape and × do); outside the shell (tests) the old overlay. Open / hidden per table (F74): the DataTable registers its layout's `panelHidden` with the dock (`useDockedPanel`, the first table on the page); hidden = a rail with *Show* instead of the panel; *Hide* sits beside ×. Sections: `kernel/ui/details-section.tsx` (`DetailsSection`, `DetailsGrid`) |
| States, tags, keys, counts | `kernel/ui/state-label.tsx`, `kernel/ui/tags.tsx` | `<StateLabel family state>` (`attention` · `progress` · `done` · `neutral`); `<Tag>`, `<CodeChip>`, `<CountBadge>`; `Badge` is a grey tag too |
| Banner, split primary | `kernel/ui/info-banner.tsx`, `kernel/ui/split-button.tsx` | |
| Row actions outside a DataTable | `kernel/ui/data-table/row-actions-menu.tsx` `RowActionsMenu` | the DataTable's ⋮ menu, exported (F71, contracts) for the few kit `Table`s that are not DataTables — an inline-edit grid, a handful of rows expanded in place; same `RowAction` shape; also an entity page's own ⋮ in its title row, labelled `shell.more` (*More actions* — partners F71) |
| Money on screen | `kernel/money/format-money.ts` `formatMoney(amount, currency, { signed, bare })` | the one format; `formatCurrency` stays the **printed** format (invoices FR-010, statements, per-diem sheets) |
| Kit primitives | `components/ui/*` | buttons 32 / 26 px, 4 px; underline tabs for `default` and `line`; inputs and selects on `--surface`, 13 px; tables 32 px rows with `--border-subtle` separators. `SelectValue` shows the item's label (collected from the `<SelectItem>` children, or `items`), else the placeholder, else nothing — never the raw value; items rendered by a child component need `items` |

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
- Active filters shown above the table — since D40 as **filter buttons** (`Column: value ▾`, opening that column's filter popover) in the filter bar, plus *Clear filters*; before D40 as removable chips.
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
`<DataTable tableKey columns result state filterSource valueLabel rowHref|onRowClick selectable bulkActions toolbar emptyState />` with `state = useListQuery({ columns, defaultSort })`. Columns: `{ key, header, type, filterable?, sortable?, align?, width?, cell?, truncate?, defaultHidden?, alwaysVisible? }`. Header = sort button (shift-click adds a secondary key) + filter trigger (filled when active) → `TextFilter` / `RangeFilter` / `CheckboxFilter` / `DateFilter` popovers; the filter bar above (since F39: `Filter rows…`, a filter button per active filter or `quickFilter: true` column opening the same popover, *Clear filters*, `context` on the right); the last column holds the Columns menu in its header and each row's ⋮ menu (`rowActions: (row) => RowAction[]`); footer with count, sums (`formatMoney`), page size, pager; Columns menu (visibility, order and *Reset layout*, remembered per `tableKey` per user). Every string is a key: the frame's `table.*`, the popovers' `table.filter.*` (operators, presets, Min / Max, search, select all…), blanks `common.blanks`; month names come from `Intl` in the UI language (`monthName`). `describeFilter(filter, label, t)` takes the translator. Since F74 no English is left in the kit.

## i18n — UI strings

English is the key set: `src/kernel/i18n/dictionaries/en.ts` (`as const`); every other dictionary is `Record<MessageKey, string>` typed against it (`fr.ts`, `sv.ts` — the Swedish one follows BAS / Skatteverket terminology and the v1 printed-invoice strings in `specs/invoices/fixtures/invoice-strings.sv.json`; a new language is one file + one line in `translate.ts`, no code change). Keys are `<module>.<area>.<name>`; `{name}` placeholders are filled by the caller. Client components call `useT()`; server components either build a `translator(locale)` from the user's preferences or render `<Msg k="…" />` (`kernel/i18n/msg.tsx`, a client leaf that reads the LocaleProvider) for a heading. Since 2026-10-21 every module string is in the dictionary — the partners and contracts components, the settings hub and the section headings included; the settings forms (company, BAS categories, VAT registrations, bank accounts, my preferences) followed the same day. The document review page (header, footer, the sections, line items), the preview and the upload zone followed. The login / register pages and the error fallbacks followed on 2026-10-22 (F04): `app/(auth)/layout.tsx` has no user yet, so it resolves the language on the server from the browser's `Accept-Language` — the first tag by quality that has a dictionary (`uiLanguageFromAcceptLanguage` in `kernel/i18n/locale.ts`: `de-CH,fr;q=0.9` → fr) — and hands it to a `LocaleProvider`, so the server and client renders agree. Register errors are keys (`registerErrorKey`), never Better Auth's raw English message; the tenant made at registration is named in that language (`auth.register.orgName`). The breadcrumb names the nav items and the known sub-pages (`CRUMB_KEYS` in `topbar.tsx`); anything else shows its URL segment.

- Client components: `const t = useT(); t("contracts.rates.title")` — the language comes from `LocaleProvider` (user preference, else the browser), `fr-CH` → fr, anything without a dictionary → en.
- No preference = the browser's language, decided **on the server** from Accept-Language (F68): server pages build `translator(await requestLocale(prefs.locale))`, the shell passes `browserLocale()` to `LocaleProvider`, and a client component that formats or translates with the locale reads `useLocale().effectiveLocale` — `locale` is the raw preference (null = *Browser default*, what My Preferences shows). Never `prefs.locale ?? null` straight into `translator`: that is English on the server under a French client.
- Server components, PDFs, jobs: `translate(locale, key, params)` or `translator(locale)`.
- Services return English messages (logs, tests, API) and, when a client may want to re-render them, `AppError.details` with the facts (`{from, to}`, `{n}`); the component picks the key.
- A module adds its keys to **both** dictionaries in the same PR (`translate.pure.test.ts` fails on a missing key). Dictionaries are a shared file (constitution §5): one PR at a time.
- Partners / documents / settings still carry English literals from v2 — migrate them when a page is next touched, not in bulk.
