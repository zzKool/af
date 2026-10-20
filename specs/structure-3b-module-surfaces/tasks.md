# Tasks — 3b + 3d

- [x] T1 `types.ts` + `toPartnerDto` / `toContractDto`; `getPartners`, `getPartner`, `searchPartners`, `getContracts`, `getContract` return DTOs
- [x] T2 `queries.ts` per module (named read API)
- [x] T3 `index.ts` (server surface, explicit re-exports) and `ui.ts` (client surface) per module
- [x] T4 Rename unsuffixed actions to `…Action` (24 names, 20 files); namespace property accesses preserved
- [x] T5 `src/app` and cross-module imports routed through the surfaces; duplicate imports merged
- [x] T6 Guard: surface-only imports, client components never import server surfaces, ui/index export rules, no Prisma in surfaces
- [x] T7 CI: E2E on `main` + manual only; policy documented in `docs/ci-cd.md`
- [x] T8 Docs: constitution 1.2, feature-folders, skills, phase-0 ticks
- [x] T9 PR #3 through CI; merge
