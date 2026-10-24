# Tasks — items 6 + 8
- [x] T1 `kernel/list-query/{types,codec,prisma,schema}.ts` + pure tests
- [x] T2 `components/ui/{popover,checkbox}.tsx` (base-nova shape, hand-written — registry unreachable here)
- [x] T3 `kernel/ui/data-table/*`: DataTable, 4 filters, chips, useListQuery, Columns menu; jsdom tests
- [x] T4 `kernel/ui/shell/{page,topbar}.tsx`, app layout, all pages widened; v2 table → `legacy-data-table.tsx`
- [x] T5 partners: `short_code` migration + schema + DTO + form; `queries.ts` reference + `queries.test.ts`; actions; `PartnerTable`; pages
- [x] T6 docs (partners, ui-conventions v2, feature-folders, index, phase-0), `module-slice` skill finalised, screenshots
- [x] T7 (follow-up) documents library → DataTable; table_preferences for column order/width; delete `legacy-data-table` — done in #30 (library on the DataTable, legacy table removed) and #39 (per-user layouts)

# Tasks — F39, the D40 restyle of the shell and the kernel kit (2026-10-22)
Direction and rules: `docs/ui-conventions.md` *Visual direction* + `.claude/skills/af-design`; no spec of its own (a restyle of the kit, decided as D40). Kit only — no module folder touched.
- [x] T1 tokens light + dark (OS) in `app/globals.css`, mapped onto the shadcn names; system font, `next/font` + the cloud font stub removed; favicon `app/icon.svg` = the AF sign
- [x] T2 nav: `NAV_ITEMS[].group` (`NAV_GROUPS`), the loop order (Banking → Documents → Journal), Settings `bottom`, `NEW_ITEMS`; `nav.group.*`, `nav.new.*`, `shell.*`, `table.*` keys in en / fr / sv
- [x] T3 shell: `AppShell` — top bar (toggle, logo, page search `Ctrl P`, tenant, avatar menu), sidebar (+ New, groups), canvas, breadcrumb (`routes.ts` `crumbsFor`: names, never ids), the details dock
- [x] T4 `PageHeader` anatomy (icon tile, title, tags, meta, actions, tabs, banner; `back` only where the trail is empty); canvas padding 20 / 14 px
- [x] T5 kit primitives: buttons, tabs (underline), badge = tag, inputs, selects, cards, dialogs, popovers, menus, checkbox, table rows
- [x] T6 DataTable: filter bar with filter buttons (`quickFilter`), 32 px rows, last column = column chooser + ⋮ `rowActions`, footer + cells in `formatMoney`, `table.*` strings
- [x] T7 Sheet docks into the canvas inside the shell (non-modal, no backdrop); overlay outside
- [x] T8 new kit pieces: `StateLabel`, `Tag` / `CodeChip` / `CountBadge`, `InfoBanner`, `SplitButton`, `DetailsSection` / `DetailsGrid`; `formatMoney` (+ property test)
- [x] T9 tests: `routes.pure.test.ts`, `format-money.test.ts`, `kit.test.tsx`, DataTable tests on the filter bar and row actions; e2e adapted (sv breadcrumb on a sub-page, Clear filters); `e2e/screenshots.spec.ts` shoots light + dark of every page
- [x] T10 docs: ui-conventions *Where it lives*, af-design, features F39 + F71–F74, roadmap C1, lessons

# Tasks — F74, the kit's leftovers (2026-10-23, lane DIRECT)
Kit only (`kernel/ui`, `components/ui`, `kernel/i18n`); no module folder, no schema, no nav. Branch `feat/kernel-ui-kit-leftovers`.
- [x] T1 filter popovers in the UI language: `table.filter.*` keys (en / fr / sv) in `TextFilter` (operators `TEXT_OP_KEYS`), `RangeFilter`, `CheckboxFilter`, `DateFilter` (presets, From / To, Expand / Collapse, month names via `monthName` + `Intl`); `(Blanks)` = `common.blanks`; `describeFilter(f, label, t)`; the DataTable's aria labels (`table.filterColumn`, `moveUp` / `moveDown`, `resize`, `selectPage` / `selectRow`) and boolean cells (`common.yes` / `no`); `useUiLanguage()` in `kernel/i18n/use-t.ts`
- [x] T2 `SelectValue` renders the item's label from the collected items (or `items`, record or `{ value, label }[]`), else the placeholder, else nothing — never the raw value (`selectedLabel`)
- [x] T3 docked panel open / hidden per table: `TableLayout.panelHidden` (normalised, kept by *Reset layout*, not a column change), `useTableLayout().setPanelHidden`; `useDockedPanel` registers it with `DockedCanvas`; `SheetContent` docked: *Hide* beside × (`details.hide`), hidden = rail with *Show* (`details.show`); × label `details.close`; `SheetHeader` `pr-16` for the two buttons
- [x] T4 `details.about` / `details.proof` / `details.history` keys for the modules' panels
- [x] T5 tests: `data-table.test.tsx` — a Swedish user's four popovers and filter button, `describeFilter` with the sv translator, Hide → rail → saved → reload keeps it → Show; `kit.test.tsx` — an id value shows its label, the none sentinel its label, a child-component item via `items`, unknown → placeholder / blank, never the id
- [x] T6 docs: features F74 (+ F71's History note), ui-conventions (panel, DataTable i18n, select), feature-inventory D40, lessons, banking, roadmap

## F72 — sidebar counts of open work (2026-10-24, `feat/shell-sidebar-counts`, LIGHT)

- [x] `Sidebar` / `AppShell` take `counts` (nav path → n): a `<CountBadge>` right of the label when n > 0, a dot when collapsed (the count in the tooltip); the link's accessible name stays the label (`aria-label`), so e2e and screen readers still find *Banking*. `sidebar.test.tsx`.
- [x] The app layout loads them for the owner (`can create bank_transaction`, like the dashboard's to-do) in one tenant transaction, in parallel with its other reads: banking `rowsToJustifyCount` (`open-work.test.ts` against the list), documents `inboxOpenCount` (`inbox.test.ts`: = `inboxTotals.total`, owner and accountant), invoices `overdueInvoiceCount` (`invoices.test.ts`: draft no, overdue yes, partly paid no). No i18n, no nav constant changed.
- [ ] Supplier invoices: overdue count — after the supplier-invoices PR of the other session merges.
