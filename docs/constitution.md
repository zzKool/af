# AF — constitution

Version 1.1 · 2026-10-20 · The rules every spec, agent and PR in this repo obeys. (1.1: layout amended for Prisma's single schema folder and the shadcn `components/ui` location — item 3a.) Changes to this file are PRs of their own.

Context: `feature-inventory.md` (scope, decisions D1–D18), `excel-to-v3-mapping.md` (business rules), `phase-0.md` (current todo).

---

## 1. Principles

1. **The accountant books; the app proves.** AF organises documents, imports bank lines, categorises, links every transaction to its justification and produces a monthly package. No double-entry engine, no statutory statements.
2. **Linking is the product.** The `link` table is the single source of truth for relationships. Everything above it (suggestions, graph, exports, dashboards) is a disposable read model. Nothing below it may be deleted while linked.
3. **Simplify the mechanism, never the capability.** A feature from v1, v2 or the Excel is kept unless the inventory says *drop*; what changes is how it is built.
4. **A setting exists only when two tenants need different values today.** Otherwise it is a constant in code (document prefixes, invoice series format, number formats).
5. **Derived, never typed.** Paid / to refund / refunded / linked / due are computed from links and dates. No status column a human fills in.
6. **Immutable money facts.** Amount, currency, SEK base, rate and rate source are written once per entry and never updated; corrections are new entries.
7. **Build for one, architect for many.** One real tenant and one real user today. RLS, roles and `can()` exist from day one; their UI polish does not.
8. **Local first, cloud agnostic.** The same image runs on a laptop, the homelab and Azure. Environment differences live in env vars only.
9. **Nothing assumes continuous uptime.** The app may be scaled to zero for weeks. Jobs are queued in Postgres and resumable; scheduled work catches up on start.

---

## 2. Architecture

```
src/
  kernel/            auth, can(), tenancy (RLS client, CallerIdentity), audit, money, clock, errors, logging,
                     storage (blob adapter), ocr (adapter), jobs (pg-boss), pdf (Chromium), ui, i18n, nav, stores
  modules/<name>/    service(s)  queries.ts  actions  components/  stores/  jobs/  *.test.ts  index.ts
  app/               Next.js routes only — thin, import from modules/*/index.ts and queries.ts
  components/ui/     shadcn primitives (kernel UI kit, kept where the shadcn CLI expects them); lib/utils.ts = cn()
prisma/schema/<name>.prisma   the module's models — Prisma's multi-file schema needs one folder (see prisma/schema/README.md)
```

File naming inside a module until the reference slice (item 6) fixes the final convention: `<entity>.ts` service, `<entity>.test.ts`, `<entity>.actions.ts`. Current layout and the v2 → 3a path map: `docs/feature-folders.md`.

Modules (from the inventory): partners, contracts, documents, banking, rates, journal, linking, invoices, supplier-invoices, expenses, traktamente, exports, dashboard, settings.

### Import rules — enforced by `architecture.guard.test.ts`
- `kernel/*` imports nothing from `modules/*` or `app/*`. *(enforced since 3a)*
- `modules/<a>` imports `kernel/*` and `modules/<b>/index.ts` only. Never another module's internals. *(index.ts rule enforced from 3b; until then direct file imports between modules are tolerated)*
- `modules/*/service.ts` and `queries.ts` never import `next/*`, `react`, or `components/*`.
- `app/*` and `components/*` never import `service.ts` directly: reads go through `queries.ts`, writes through `actions.ts`.
- Role and permission checks happen only through `kernel/auth/can()`. No `role === 'owner'` anywhere else.
- Azure SDKs appear only inside `kernel/storage` and `kernel/ocr`.
- `.toNumber()` on a Decimal appears only in `components/*` (display boundary). Lint rule.

### Module contract
- `index.ts` is the only public surface: typed DTOs, never Prisma types.
- Services take a tenant-scoped `tx` (RLS session set) and a `CallerIdentity`; return `ServiceResult<T>`; never throw for business errors.
- Actions are thin wrappers on the `authedAction` / `ownerAction` middleware: validate with Zod, call the service, return `{ data | error: AppError }`.
- Every mutation on a financial or linked entity writes an audit row with source provenance.
- A module that can be linked exports `linkable: { type, exists(id), summary(id), amount(id) }` and registers it with `modules/linking`.
- Cross-module references are UUIDs validated through the target module's `index.ts`, not cross-table FKs (RLS blocks them).

### Linking invariants — in the database and in the service
- One writer: only `modules/linking` inserts or deletes rows in `link`.
- `sum(allocated_amount)` per linked entity ≤ its amount (CHECK + service).
- An entity linked inside the retention window cannot be hard-deleted (trigger + service).
- Every link / unlink is audited with the acting identity and reason.
- Link kinds: `justifies`, `transfer`, `settles`, `belongs_to`. New kinds are a migration, not a config.

### Data
- Postgres 17, RLS on every tenant table (`SET LOCAL app.tenant_id`), UUID keys, TIMESTAMPTZ, snake_case, Postgres enums.
- Decimal through services, number only at the display boundary; sv-SE formatting by locale provider.
- Migrations are forward-only and reviewed; schema changes are serialised (one agent, one migration at a time).

---

## 3. Portability rules

1. All environment differences live in env vars (`DATABASE_URL`, storage connection, OCR endpoint, `BASE_URL`, secrets). No `isAzure` / `isLocal` branches.
2. Storage and OCR are adapters behind one interface each in the kernel; Azurite and the real Azure endpoints are configuration.
3. One `docker-compose.yml` for dev, one `docker-compose.prod.yml` for prod-like (same image, no bind mounts, real secrets). If it runs prod-like locally, it runs on Azure.
4. No platform-specific features in code: no Dapr, no KEDA scalers, no managed identity, no cloud cron. Plain credentials, pg-boss schedules.
5. Background work is resumable: queued in Postgres, idempotent handlers, catch-up on startup (ECB rates fetch the gap since the last stored date).
6. Chromium ships in the image; PDFs are generated from the print mode of the same component that renders the editable form.

---

## 3b. UI rules (details in `ui-conventions.md`)

1. Full-width app layout: collapsible sidebar, dense content, no `max-w-*` on page containers.
2. Three page archetypes only: list (DataTable + side panel), entity (header + tabs), work (split panes, keyboard first).
3. Every list is the kernel `DataTable`: server-side paging/sort/filter, Excel-style typed header filters with server-side distinct values, state in the URL, column preferences per user. Modules declare column types; they never write filter UI.
4. Numbers right-aligned in tabular figures with currency code; dates `yyyy-mm-dd`; dark mode via tokens.
5. Every new page ships with a screenshot in the PR.

---

## 4. Definition of done — the verify gate

A PR merges to `main` only when:
1. Spec folder exists and the checklist in it is ticked (`specs/<module>/spec.md`, `plan.md`, `tasks.md`).
2. `npm run lint && npm run typecheck && npm run test` green; the architecture guard passes.
3. E2E for the module's happy path green; flaky tests are quarantined with an issue, never retried into green.
4. Money and allocation logic has property-based tests; harvested v1 behaviour has its fixtures ported.
5. **Something a human looked at**: a screenshot of each new page and each generated PDF attached to the PR.
6. `docs/<module>.md` updated and linked from `docs/index.md`; a decision changed → `feature-inventory.md` decisions log updated.
7. No secrets, no SAS URLs, no `console.*` in server code; audit rows exist for every financial mutation.

---

## 5. Process

- **Spec-driven, per module.** `/speckit.specify → plan → tasks → implement` inside `specs/<module>/`. The constitution is the spec-kit constitution. No epics, no sprints, no retros.
- **Reference slice first.** `partners` is rebuilt by hand into the module layout before any parallel work; the result becomes the `module-slice` skill.
- **Contracts frozen before fan-out.** Prisma schema for the batch, `index.ts` DTOs, shared UI, nav entries. Then one agent per module in its own git worktree; one reviewer agent that has not seen the code.
- **Shared files are serialised.** `schema.prisma`, nav constants, i18n dictionaries, `docs/index.md`: one PR at a time touches them.
- **Trunk is `main`.** Feature branches `feat/<module>-<topic>`, PR into `main`, CI is the gate. Conventional commits. No `Co-Authored-By` headers, no "Generated with" lines in PRs or commits.
- **Harvest, don't copy.** v1 (`af_core`) and v2 history are read for behaviour and test cases; no code is pasted across stacks.

---

## 6. Roles

| Role | Scope | Today |
|---|---|---|
| superadmin | app-level: bank formats, currencies, tenants, users | you |
| owner (tenant admin) | everything in the tenant | you |
| accountant | read-only: journal, bank lines, invoices, supplier invoices, expenses, package; no relationship documents | planned |
| editor | upload, OCR review, linking; no settings, no issue | later |

All checks through `kernel/auth/can(identity, action, subject)`. Sidebar hides by role; server enforces. Both required.

---

## 7. Hosting

One Docker image (Next.js + pg-boss worker + Chromium) · Postgres 17 · blob storage · Azure Document Intelligence. Dev: Docker Compose with Postgres + Azurite, real OCR endpoint. Prod-like: same compose, no bind mounts. Azure: Container Apps (min replicas 0, max 1), Flexible Server B1ms, Blob, DI. Migration between them = `pg_dump`/`pg_restore`, blob copy, env vars.
