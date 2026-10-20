---
name: module-slice
description: Layout and build order for one AF feature module (schema → service → queries → actions → components → page → tests → docs). Use when creating a new module or moving an existing feature into the module layout. STATUS — draft; finalised from the partners reference slice (phase-0 item 6).
---

# Module slice

Rules in `docs/constitution.md` §2. Pattern reference until the reference slice lands: `docs/partner-crud-pattern.md`, `docs/entity-view-pattern.md`, `docs/contract-pattern.md`.

## Layout

```
prisma/schema/<name>.prisma   models of this module only (Prisma multi-file schema: one folder, one file per module)
src/modules/<name>/
  <entity>.ts          service: business logic; takes tx + CallerIdentity; returns ServiceResult
  <entity>.test.ts     Vitest, co-located, DB-backed (RLS on)
  <entity>.actions.ts  thin Server Actions (see server-action-pattern)
  queries.ts           read API for pages and other modules; returns DTOs
  components/          React components of this module
  stores/              client state (Zustand) of this module
  jobs/                background handlers of this module
  __fixtures__/        test fixtures
  linkable.ts          optional: { type, exists, summary, amount } registered with modules/linking   (from 3c)
  types.ts             DTOs — plain types, never Prisma; mappers (toXDto) next to the service
  index.ts             SERVER surface: types, queries, services, actions, jobs, linkable
  ui.ts                CLIENT surface: components, stores, actions, types
docs/<name>.md         what the module does, decisions, how to extend
specs/<name>/          spec.md, plan.md, tasks.md (spec-kit)
e2e/<name>.spec.ts     Playwright happy path
```

Single-entity modules may switch to `service.ts` / `actions.ts` once the reference slice (phase-0 item 6) settles it.

## Build order (one PR, or one PR per step for big modules)
1. **Spec** — `specs/<name>/spec.md` from the inventory + Excel mapping; list DTOs and invariants.
2. **Schema** — models, RLS policy, migration. Serialised: check no other open PR touches `schema.prisma`.
3. **Service + tests** — write the tests first from the spec's invariants.
4. **Queries** — list / detail / filters; distinct values for table headers (see `docs/ui-conventions.md`).
5. **Actions** — one file, thin.
6. **Linkable** — if the entity can be linked, register it.
7. **Components + page** — full-width layout, DataTable with header filters, entity view with tabs.
8. **E2E** — one happy path.
9. **Docs** — `docs/<name>.md`, link from `docs/index.md`; nav entry in `src/kernel/nav/constants.ts`.
10. **Screenshots** in the PR.

## Guard rules you will hit
- importing another module's files → use `@/modules/<m>` (server) or `@/modules/<m>/ui` (client)
- a `"use client"` file importing `@/modules/<m>` → use `/ui`
- a service returning a Prisma row type → add a DTO in `types.ts` + mapper
- importing `next/*` in service or queries → move it to the action or page
- `role ===` anywhere → use `can()`
- `.toNumber()` outside components → format at the display boundary
