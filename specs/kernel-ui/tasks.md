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
