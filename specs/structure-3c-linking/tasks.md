# Tasks — 3c
- [x] T1 schema `linking.prisma` + Tenant relation; migration with CHECKs, RLS, grants, indexes, delete trigger
- [x] T2 `types.ts`, `kinds.ts` (matrix), `allocation.ts` (pure), `linkable.ts` (registry)
- [x] T3 `linking.ts` service + `queries.ts` + `linking.actions.ts` + `index.ts` / `ui.ts`
- [x] T4 `Linkable` for partners, contracts, documents; `linkables.ts` registration
- [x] T5 `deleteDocument` trigger translation; `cleanupTestData` truncates `links`
- [x] T6 tests: `allocation.pure.test.ts` (fast-check), `linking.test.ts`; vitest `*.pure.test.ts` convention
- [x] T7 guard: one writer; docs `linking.md`, feature-folders, phase-0, spec folder
- [x] T8 PR #4 through CI; merge
