# Feature folders — kernel and modules

Introduced by phase-0 item 3a (2026-10-20). Rules in [[constitution]] §2; enforced by `src/kernel/guards/architecture.guard.test.ts`.

## Layout

```
src/
  kernel/            cross-cutting infrastructure — never imports modules/ or app/
    actions/         server-action middleware chain (action-client, auth, tenant, logging, rate-limit, errors)
    audit/           append-only audit trail + types
    auth/            Better Auth server + client, CallerIdentity (can() lands in item 4)
    clock/           Clock abstraction, calendar-day arithmetic (addDays)
    db/              Prisma client, tenant-scoped client (RLS), test setup + fixtures
    errors/          AppError, extract-error
    guards/          architecture guard test
    i18n/            locale, date formatting, LocaleProvider, FormattedDate; dictionaries/{en,fr}.ts + translate() / useT() (UI strings)
    jobs/            pg-boss queue behind JobDefinition/ScheduleDefinition + withJobContext (see async-jobs)
    list-query/      ListQuery contract: types, URL codec, Prisma where/orderBy/distinct helpers, Zod schema (D20)
    logging/         pino logger
    money/           currency + number formatting (Decimal at the boundary), settlement tolerance (D25)
    nav/             nav constants + role filter
    ocr/             Azure Document Intelligence adapter (+ fixtures)
    pdf/             Chromium renderer (playwright-core) + print tokens — see pdf
    storage/         blob storage adapter + file validation
    stores/          tenant-scoped Zustand store factory
    test-utils/      shared test helpers
    ui/              ui/data-table (DataTable + typed header filters + useListQuery), ui/shell (sidebar, topbar, page archetypes), providers, confirm dialog, company avatar; legacy-data-table until documents migrate
  modules/<m>/       one feature module each
    index.ts                 SERVER surface: types, queries, services, actions, jobs — the only server import path from outside
    ui.ts                    CLIENT surface: components, actions, types — importable from pages and client components; stores stay internal
    types.ts                 DTOs (plain types, never Prisma); mappers live next to the service
    queries.ts               the module's read API (named re-exports today; real query implementations with the reference slice)
    <entity>.ts              service (framework-free; tx + CallerIdentity → ServiceResult)
    <entity>.test.ts         co-located Vitest (DB-backed, RLS on)
    <entity>.actions.ts      thin Server Actions, named <verb><Entity>Action
    components/              React components of the module
    stores/                  client state (Zustand) of the module
    jobs/                    JobDefinitions of the module (exported as `<m>Jobs` / `<m>Schedules`, listed in src/instrumentation.ts)
    __fixtures__/            test fixtures
  app/               Next.js routes only
  components/ui/     shadcn primitives (kernel UI kit; kept here for the shadcn CLI)
  lib/utils.ts       cn() for shadcn (kernel)
prisma/schema/<m>.prisma   the module's models (one folder, Prisma multi-file schema) — see prisma/schema/README.md
```

Modules today: `partners` (the reference slice — see [[partners]]), `contracts` (rate history — see [[contracts]]), `invoices` (see [[invoices]]), `documents`, `banking`, `rates`, `settings`, `dashboard`, `linking` (3c — see [[linking]]), `numbering` (4.4 — see [[numbering]]).

## Rules enforced now (3a)
- `kernel/*` never imports `modules/*` or `app/*`.
- `modules/*` never import `app/*` (and the legacy `src/server`, `src/hooks`, `src/types` are gone).
- `app/*` imports only `kernel`, `modules`, `components/ui`, `lib/utils`, `generated`.
- Services (everything in a module that is not `components/`, `stores/`, `.tsx` or `.actions.ts`; kernel adapters likewise) never import `next/*`, `react`, or components.
- No `console.*` in server code; no `GRANT ALL` in migrations.

## Rules enforced since 3b / 3d
- Outside a module, only `@/modules/<m>` (server) or `@/modules/<m>/ui` (client) is imported — pages included.
- A file with `"use client"` never imports a server surface.
- `ui.ts` exports only `components/`, `*.actions` and `types` (never stores — hooks would enter the server graph of a page importing it); `index.ts` never exports components; `index.ts`, `ui.ts`, `types.ts` never mention `@/generated/prisma`.
- Service functions that return rows return DTOs (`PartnerDto`, `ContractDto`, …), mapped inside the module.
- Actions are `<verb><Entity>Action`; v2's unsuffixed actions were renamed in 3b.

## Rules enforced since 3c
- Only `src/modules/linking` writes the `links` table (guard); modules expose a `Linkable` and register it in `linking/linkables.ts`.

## Rules arriving with the next moves
- Settled by the reference slice (item 6): `queries.ts` holds the module's `COLUMNS` + `list/distinct/dateHierarchy`; file naming stays `<entity>.ts` / `<entity>.actions.ts` (one entity per module is the common case and the name says what it is).

## Where did it go? (v2 → 3a)

| v2 | 3a |
|---|---|
| `src/server/db/*` | `src/kernel/db/*` |
| `src/server/middleware/*` | `src/kernel/actions/*` |
| `src/server/auth.ts`, `src/lib/auth-client.ts`, `src/types/caller-identity.ts` | `src/kernel/auth/` |
| `src/server/services/audit.ts`, `src/types/audit.ts` | `src/kernel/audit/audit.ts`, `types.ts` |
| `src/server/services/{clock,storage,file-validation,ocr}.ts` | `src/kernel/{clock,storage,storage,ocr}/` |
| `src/server/inngest/{client,context}.ts` | `src/kernel/jobs/` |
| `src/server/inngest/functions/process-document.ts` | `src/modules/documents/jobs/` |
| `src/server/logger.ts` | `src/kernel/logging/logger.ts` |
| `src/types/app-error.ts`, `src/lib/extract-error.ts` | `src/kernel/errors/` |
| `src/lib/{format-currency,format-number}.ts` | `src/kernel/money/` |
| `src/lib/{locale,format-date}.ts`, `components/providers/locale-provider.tsx`, `components/domain/formatted-date.tsx` | `src/kernel/i18n/` |
| `src/lib/{constants,nav-filter}.ts` | `src/kernel/nav/` |
| `src/lib/stores/*` | `src/kernel/stores/` |
| `src/components/shared/*`, `src/hooks/use-confirm-dialog*` | `src/kernel/ui/` |
| `src/components/domain/{sidebar,tenant-switcher}.tsx` | `src/kernel/ui/shell/` |
| `src/server/services/<x>.ts` + `src/server/actions/<x>.ts` | `src/modules/<m>/<x>.ts` + `<x>.actions.ts` |
| `src/components/{domain,partners,settings}/*` | `src/modules/<m>/components/` |
| `src/hooks/use-document-*-store.ts` | `src/modules/documents/stores/` |
| `src/server/services/__fixtures__/*` | `src/modules/banking/__fixtures__/` (CSV), `src/kernel/ocr/__fixtures__/` (PDF, JPG) |
| `prisma/schema/app.prisma` | `prisma/schema/{tenancy,audit,rates,settings,banking,documents,partners,contracts,linking,numbering,invoices}.prisma` |

Vitest projects: `server` (DB-backed: `kernel/**` + `modules/**` tests), `pure` (`kernel/{money,i18n,nav,stores,errors,guards}`), `client` (all `*.test.tsx`, jsdom).

## Adding a module
Follow the `module-slice` skill: `prisma/schema/<m>.prisma` → service + tests → actions → components → page under `src/app/(app)/<m>/` → nav entry in `src/kernel/nav/constants.ts` → `docs/<m>.md` linked from [[index]].
