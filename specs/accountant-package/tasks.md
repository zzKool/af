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
