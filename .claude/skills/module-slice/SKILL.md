---
name: module-slice
description: Layout and build order for one AF feature module (schema → service → queries → actions → components → page → tests → docs). Use when creating a new module or moving an existing feature into the module layout. Finalised from the partners reference slice (phase-0 item 6).
---

# Module slice

Rules in `docs/constitution.md` §2. **Reference: `src/modules/partners` + `docs/partners.md`** — copy its shape, not its code.

## Layout

```
prisma/schema/<name>.prisma   models of this module only; RLS policy + partial unique indexes in the migration
src/modules/<name>/
  types.ts             DTOs — plain types, never Prisma; Dates stay Date on the server surface
  <entity>.ts          service: Zod schemas, toXDto mapper, writes (tx + CallerIdentity + AuditLogger → ServiceResult), single reads
  <entity>.test.ts     Vitest, co-located, DB-backed (RLS on): invariants, FK checks, soft delete, tenant isolation
  queries.ts           READ API: `COLUMNS: ColumnMap`, `list<X>(tx, q: ListQuery)`, `distinct<X>Values(tx, col, q)`, `<x>DateHierarchy(tx, col, q)` + re-exported single reads
  queries.test.ts      the ListQuery contract on the real DB (paging, every filter kind, search, distinct with Excel semantics)
  <entity>.actions.ts  thin Server Actions `<verb><Entity>Action` (server-action-pattern) + `distinct<X>Action` / `<x>DateHierarchyAction` on `listQuerySchema`
  linkable.ts          optional: { type, exists, summary } registered in modules/linking/linkables.ts
  components/
    <entity>-table.tsx   "use client": columns + filterSource (the two actions) + create/row actions on kernel DataTable
    <entity>-form.tsx    autosave-on-blur edit form
    <entity>-detail-tabs.tsx  entity page content (header + tabs)
  stores/              client state (Zustand) — module-internal, never exported from ui.ts
  jobs/                JobDefinitions, exported as `<name>Jobs` / `<name>Schedules`, listed in src/instrumentation.ts
  __fixtures__/        test data
  index.ts             SERVER surface: types, queries, services, actions, jobs, linkable
  ui.ts                CLIENT surface: components, actions, types only
src/app/(app)/<name>/page.tsx         list page: parseListQuery(searchParams) → list → <ListPage><XTable result/></ListPage>
src/app/(app)/<name>/[id]/page.tsx    entity page: <EntityPage> around the tabs component
docs/<name>.md         what the module does, decisions, how to extend — linked from docs/index.md
specs/<name>/          harvest.md (if v1 had it) · spec.md · plan.md · tasks.md
e2e/<name>.spec.ts     Playwright happy path
```

## Build order (one PR, or one PR per step for big modules)
1. **Spec** — read `specs/<name>/harvest.md` §9 and get the owner's answers; `/speckit-specify` → `spec.md` with DTOs and invariants.
2. **Schema** — models, RLS, migration (hand-written; CI's drift check compares them). Serialised: no other open PR on `prisma/schema`.
3. **Service + tests** — tests first, from the spec's invariants. Numbers via `modules/numbering` (`nextInSeries` in the same transaction).
4. **Queries** — `COLUMNS` then `list / distinct / dateHierarchy` with `kernel/list-query/prisma` helpers; `queries.test.ts` like partners'.
5. **Actions** — one file, thin; the two filter-source actions validated by `listQuerySchema`.
6. **Linkable** — if the entity can be linked, register it; amounts via `summary`.
7. **Components + pages** — `ListPage` + `DataTable` (columns declare `type`; never write filter UI), `EntityPage` + tabs, `WorkPage` for split-pane flows. Full width, no `max-w` on containers.
8. **Jobs / PDF** — `JobDefinition` in `jobs/`, print route + `renderPathToPdf` if it prints.
9. **E2E** — one happy path.
10. **Docs** — `docs/<name>.md`, index link, nav entry in `src/kernel/nav/constants.ts`, `can()` subject if new.
11. **Screenshots** of every page (and PDF) in the PR; `specs/<name>/screenshots/` is a fine home.

## Guard rules you will hit
- importing another module's files → use `@/modules/<m>` (server) or `@/modules/<m>/ui` (client)
- a `"use client"` file importing `@/modules/<m>` → use `/ui`
- `ui.ts` exporting a store or a service → components, actions and types only
- a service returning a Prisma row type → add a DTO in `types.ts` + mapper
- importing `next/*` in service or queries → move it to the action or page
- `role ===` anywhere → use `can()`; `pg-boss`/`playwright-core`/Azure SDKs outside their kernel folder → use the adapter
- writing the `links` table → only `modules/linking` does
- `.toNumber()` outside components → format at the display boundary
