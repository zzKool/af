# UI conventions

Version 1 · 2026-10-20 · Decisions D19 and D20 in [[feature-inventory]]. Applies to every page; the `DataTable` spec below is a kernel component (`kernel/ui`), built once in phase-0 item 8 and reused by every module.

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
- Filter + sort + page state lives in the **URL** (shareable, back-button safe); column visibility, order and width persist per user per table (`table-preferences`, v2).
- Row selection with bulk actions (link, categorise, export CSV of the current filter).
- Sticky header, virtualised body, loading skeleton, empty state with the active filters named.
- Footer: row count of the filtered set, sum of money columns on the filtered set (server-side).

### Contract
```ts
type ListQuery = { page; pageSize; sort: {col; dir}[]; filters: Record<col, Filter> }
type Filter = { in: string[] } | { ilike; op } | { between: [a, b] } | { dates: { years; months; days } }
queries.list(tx, q): { rows: Dto[]; total; sums? }
queries.distinct(tx, col, q.filters): { value; count }[]
```
Column definitions declare `type` and `filterable`; the component derives the filter UI from the type. Modules never write filter UI.

### Build plan (phase-0 item 8)
1. Port v1 filter components into `kernel/ui/data-table/` on top of v2's `DataTable` (TanStack Table v8).
2. `ListQuery` → Prisma `where` helper in `kernel/db/list-query.ts` with tests per filter type.
3. Reference use on `partners` (the reference slice), then `documents`.
4. Screenshot of each filter type in the PR.
