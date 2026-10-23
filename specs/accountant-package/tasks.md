# Tasks — accountant package (`feat/accountant-package`)

- [x] T001 Schema `package_builds` + migration (RLS, grant) — `prisma/schema/package.prisma`
- [x] T002 Module skeleton `src/modules/package/`: types, `period.ts` (pure), `index.ts`, `ui.ts`
- [x] T003 Period reads the package needs, in the owning modules: `banking.rawRowsForPeriod`, `linking.linksTouching`, `documents.documentsByIds` + `documents.documentBytes`, `storeGeneratedDocument` takes `application/zip`
- [x] T004 `collect.ts` — the period's data through the modules' queries (FR-002), flags (FR-004)
- [x] T005 Pure generators: `csv.ts`, `summary.ts` (xlsx), `notes.ts`, `zip.ts` (fflate) + pure tests on a fixture `PeriodData` (determinism)
- [x] T006 Service `package.ts` (request build, mark built / failed) + job `jobs/build-package.ts` + registration in `src/instrumentation.ts`
- [x] T007 Queries `monthOverview` (live counts + flags per month) + `listBuilds`; actions (`buildPackageAction` owner, `listPackagesAction`, `getPackageNotesAction`)
- [x] T008 DB test: fixture month → entries + notes (SC-001), twice → identical (SC-002), roles (SC-003), savings placement
- [x] T009 Page `/package` + `PackagePage` component (list, Build, Download, notes pane, polling), nav item, strings en + fr, nav tests, `e2e/auth.spec.ts`
- [x] T010 E2E `e2e/package.spec.ts` + screenshot; docs `docs/accountant-package.md`, `docs/index.md`, `docs/feature-inventory.md`

## F71 — the page adopts the D40 kit (2026-10-23, `feat/package-kit`)

- [x] T011 Golden first: the sha-256 of the zip, `summary.xlsx`, `notes.md` and the year zip on `main` (aec3173), over the fixture plus a delta and an unpaid-invoice flag, in UTC (`package-golden.json`, `generators.pure.test.ts`) — unchanged after the restyle
- [x] T012 `state-family.ts`: `periodState` (building · failed · flagged · built · ready · empty) and the one map of states and build statuses → families; `state-family.pure.test.ts`
- [x] T013 The months as a DataTable: `month-columns.ts`, `periodRow` / `listMonths` / `distinctMonthValues` / `monthDateHierarchy` in memory over `periodOverview`, the two filter actions; *Month* quick filter; keys → `<CodeChip>`; row buttons → ⋮ `rowActions`; the years a kit `Table` with `RowActionsMenu`; DB test on the state, the Month and the state filters
- [x] T014 The docked panel (`package-panel.tsx`): one primary (*Build* / *Rebuild*) beside *Download v{n}*, `DetailsSection`s (Flags · Documents · `notes.md` · Built versions), build statuses as `<StateLabel>`; flags on screen through `formatMoney` / `<CodeChip>` (`flag-list.tsx` + its test) — the flag carries `amount` / `currency` / `account` / `date` for the screen only
- [x] T015 Strings en / fr / sv (`package.col.month` / `state`, `package.state.*`, `package.flag.open`, `package.downloadVersion`, `package.version.flags`, `package.empty`; `package.status.*` capitalised; ten unused keys dropped); e2e `package.spec.ts` on the table and the panel; screenshots light + dark; [[accountant-package]]

## Cleanup lane 7 (2026-10-23, lessons audit 23 / 25 / 26 / 29 / 30 — DIRECT, behaviour-neutral)

- [x] T016 `PackageBuildStatus` pinned to the Postgres enum: `toBuildDto` reads `row.status` without a cast (a member the DTO list lacks no longer compiles), `state-family.pure.test.ts` holds `PACKAGE_BUILD_STATUSES` equal to the enum (lessons audit 30) — *`feat/package-build-status-enum`*
- [x] T017 A build's `counts` parsed on read: `parsePackageCounts` (`counts.ts`, pure — a known key holding a whole non-negative number, else 0; other keys dropped; not an object → no counts) in `toBuildDto` instead of `as Partial<PackageCounts>`; `counts.pure.test.ts` (round trip, older rows, bad values) (lessons audit 29) — *`feat/package-counts-parse`*
- [x] T018 The package reads through the owners: `firstMonth` → `banking.firstBookingDate`; a bank row's state, allocation and transfer → `banking.transactionStates` (no second derivation in `collect.ts`); the *missing document* flag → the supplier invoices' / expenses' own `hasDocument` (lessons audit 23 follow-up, 25, 26). Same flags on the fixture (`package.test.ts` unchanged) — *`feat/package-owner-reads`*
