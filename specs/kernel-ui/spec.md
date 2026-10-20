# Spec — phase-0 items 6 + 8: kernel UI and the partners reference slice

**Problem.** v2's pages were centred in `max-w-5xl` and its DataTable had no header filters; v1 had Excel-style filters the owner liked (checkbox values, date tree, number ranges) but no counts, no narrowing, no URL state and a broken date hierarchy (H13 harvest). Every list in v3 needs the same table, built once (D19, D20).

**Scope**
- R1 `kernel/list-query`: the `ListQuery` contract (types), URL codec, Prisma `where`/`orderBy`/pagination helpers, distinct values and date hierarchy over the set filtered by the other columns (Excel semantics), Zod schema for actions. Pure tests per filter kind + fast-check round trip.
- R2 `kernel/ui/data-table`: `DataTable` on one page of server rows; header = sort (shift for secondary) + typed filter popover (`text` operators, `range` with presets, `checkbox` list with counts/search/blanks, `date` tree year→month→day with tri-state + presets + from/to); chips; footer (count, sums, page size, pager); Columns menu persisted per `tableKey`; `useListQuery` keeps everything in the URL with `useTransition`.
- R3 Shell: full-width layout with topbar (breadcrumb, tenant, user); `ListPage` / `EntityPage` / `WorkPage` / `PageHeader`; every page container widened (`p-4 md:p-6`, no `max-w`).
- R4 Partners as the reference slice: `queries.ts` with `PARTNER_COLUMNS` + `listPartners` / `distinctPartnerValues` / `partnerDateHierarchy`; the two filter-source actions; `PartnerTable` on the kernel table (create, deactivate/reactivate, row links); `partner.short_code` (migration, DTO, form, column) for D5 numbering; entity page on `EntityPage`.
- R5 `module-slice` skill finalised from it; `docs/partners.md`, `docs/ui-conventions.md` v2.

**Acceptance**
- [x] 16 pure tests (codec + prisma), 10 jsdom tests (table), 7 DB tests (partners queries) green; existing suites unchanged
- [x] screenshots: list, each filter type, filtered + sorted URL, entity page, documents page full width (`specs/kernel-ui/screenshots/`)
- [x] URL round trip proven in the browser (`?f.types=in%3Aclient&f.name=text%3Acontains%3Aa&sort=…`)

**Out of scope (next).** Per-user column order/width (`table_preferences`), documents library onto the new table (then `legacy-data-table` goes), footer sums wired on a money column, virtualised body, i18n of the table strings (keys exist in no dictionary yet — all English today).
