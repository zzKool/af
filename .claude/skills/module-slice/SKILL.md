---
name: module-slice
description: Layout and build order for one AF feature module (schema → service → queries → actions → components → page → tests → docs). Use when creating a new module or moving an existing feature into the module layout. STATUS — draft; finalised from the partners reference slice (phase-0 item 6).
---

# Module slice

Rules in `docs/constitution.md` §2. Pattern reference until the reference slice lands: `docs/partner-crud-pattern.md`, `docs/entity-view-pattern.md`, `docs/contract-pattern.md`.

## Layout

```
src/modules/<name>/
  schema.prisma        models of this module only (merged by prisma.config.ts)
  service.ts           business logic; takes tx + CallerIdentity; returns ServiceResult
  queries.ts           read API for pages and other modules; returns DTOs
  actions.ts           thin Server Actions (see server-action-pattern)
  components/          React components of this module
  linkable.ts          optional: { type, exists, summary, amount } registered with modules/linking
  index.ts             the ONLY public surface: DTO types, queries, actions, linkable
  *.test.ts            Vitest, co-located
docs/<name>.md         what the module does, decisions, how to extend
specs/<name>/          spec.md, plan.md, tasks.md (spec-kit)
e2e/<name>.spec.ts     Playwright happy path
```

## Build order (one PR, or one PR per step for big modules)
1. **Spec** — `specs/<name>/spec.md` from the inventory + Excel mapping; list DTOs and invariants.
2. **Schema** — models, RLS policy, migration. Serialised: check no other open PR touches `schema.prisma`.
3. **Service + tests** — write the tests first from the spec's invariants.
4. **Queries** — list / detail / filters; distinct values for table headers (see `docs/ui-conventions.md`).
5. **Actions** — one file, thin.
6. **Linkable** — if the entity can be linked, register it.
7. **Components + page** — full-width layout, DataTable with header filters, entity view with tabs.
8. **E2E** — one happy path.
9. **Docs** — `docs/<name>.md`, link from `docs/index.md`; nav entry in `src/lib/constants.ts`.
10. **Screenshots** in the PR.

## Guard rules you will hit
- importing another module's `service.ts` → use its `index.ts`
- importing `next/*` in service or queries → move it to the action or page
- `role ===` anywhere → use `can()`
- `.toNumber()` outside components → format at the display boundary
