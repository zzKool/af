# 3b — Module surfaces: `index.ts` (server) and `ui.ts` (client), DTOs instead of Prisma types

Status: implemented (PR #3) · Constitution §2 (1.2) · Phase-0 items 3b + 3d · depends on 3a (PR #2)

## Goal
Each module gets an explicit public surface. Anything outside the module — pages, other modules, jobs — imports only that surface. Prisma types stop crossing module boundaries.

## Design

Two entry files per module, because Next.js bundles server and client code differently and one barrel that re-exports both pulls Prisma into client bundles:

```
src/modules/<m>/
  index.ts   server surface: DTO types, service functions, queries (3d), actions, linkable (3c)
  ui.ts      client surface: components, stores, actions (actions are safe on both sides), DTO types
```

- DTOs are plain TypeScript types declared in `<m>/types.ts` and re-exported from both surfaces. Money fields are `Prisma.Decimal` inside services and `string` in DTOs that cross to the client (v2's serialisation rule, `docs/decimal-currency.md`).
- Service signatures change from `ServiceResult<Awaited<ReturnType<typeof tx.partner.findMany>>>` to `ServiceResult<PartnerDto[]>`; a `toPartnerDto(row)` mapper lives next to the service. Internal CRUD may keep Prisma rows; the surface may not.
- Guard rule (new): a file outside `src/modules/<m>/` may import `@/modules/<m>` or `@/modules/<m>/ui` only. Enforced for `src/app`, `src/modules/*`, `src/kernel` (kernel still imports nothing from modules).
- `queries.ts` (3d) names the read API of each module as explicit re-exports of the read functions; pages import the surfaces only. Standalone query implementations (`ListQuery`, DataTable distinct values) are built with the partners reference slice.
- v2 actions without the `…Action` suffix (banking, settings, dashboard, document-type-prefixes) are renamed to the convention so services and actions can share one surface.
- CI: E2E gated to `main` pushes + manual dispatch (user request: fewer, shorter runs).

## Scope
Seven modules: partners, contracts, documents, banking, rates, settings, dashboard. No behaviour change; e2e unchanged.

## Acceptance
- [x] Every module has `index.ts` + `ui.ts`; `src/app` and cross-module imports use only those (guard test, 3 new rules)
- [x] No `Awaited<ReturnType<typeof tx.` in services; no `@/generated/prisma` in any `index.ts`/`ui.ts`/`types.ts`
- [x] tsc, Biome, guard, pure/client tests green locally; server tests green in CI; e2e on `main` after merge
- [x] `docs/feature-folders.md`, `module-slice` + `server-action-pattern` skills updated; constitution 1.2
