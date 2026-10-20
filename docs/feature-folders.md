# Feature folders — kernel and modules

Introduced by phase-0 item 3a (2026-10-20). Rules in [[constitution]] §2; enforced by `src/kernel/guards/architecture.guard.test.ts`.

## Layout

```
src/
  kernel/            cross-cutting infrastructure — never imports modules/ or app/
    actions/         server-action middleware chain (action-client, auth, tenant, logging, rate-limit, errors)
    audit/           append-only audit trail + types
    auth/            Better Auth server + client, CallerIdentity (can() lands in item 4)
    clock/           Clock abstraction
    db/              Prisma client, tenant-scoped client (RLS), test setup + fixtures
    errors/          AppError, extract-error
    guards/          architecture guard test
    i18n/            locale, date formatting, LocaleProvider, FormattedDate
    jobs/            background job client + context (Inngest today, pg-boss in item 4)
    logging/         pino logger
    money/           currency + number formatting (Decimal at the boundary)
    nav/             nav constants + role filter
    ocr/             Azure Document Intelligence adapter (+ fixtures)
    storage/         blob storage adapter + file validation
    stores/          tenant-scoped Zustand store factory
    test-utils/      shared test helpers
    ui/              DataTable, providers, confirm dialog, company avatar; ui/shell = sidebar + tenant switcher
  modules/<m>/       one feature module each
    <entity>.ts              service (framework-free; tx + CallerIdentity → ServiceResult)
    <entity>.test.ts         co-located Vitest (DB-backed, RLS on)
    <entity>.actions.ts      thin Server Actions
    components/              React components of the module
    stores/                  client state (Zustand) of the module
    jobs/                    background handlers of the module
    __fixtures__/            test fixtures
  app/               Next.js routes only
  components/ui/     shadcn primitives (kernel UI kit; kept here for the shadcn CLI)
  lib/utils.ts       cn() for shadcn (kernel)
prisma/schema/<m>.prisma   the module's models (one folder, Prisma multi-file schema) — see prisma/schema/README.md
```

Modules today: `partners`, `contracts`, `documents`, `banking`, `rates`, `settings`, `dashboard`.

## Rules enforced now (3a)
- `kernel/*` never imports `modules/*` or `app/*`.
- `modules/*` never import `app/*` (and the legacy `src/server`, `src/hooks`, `src/types` are gone).
- `app/*` imports only `kernel`, `modules`, `components/ui`, `lib/utils`, `generated`.
- Services (everything in a module that is not `components/`, `stores/`, `.tsx` or `.actions.ts`; kernel adapters likewise) never import `next/*`, `react`, or components.
- No `console.*` in server code; no `GRANT ALL` in migrations.

## Rules arriving with the next moves
- **3b** — each module exposes `index.ts` (DTOs, never Prisma types); cross-module imports go through it only. Until then modules may import each other's files directly.
- **3c** — `modules/linking` owns the `link` table; modules register `linkable`.
- **3d** — `queries.ts` per module; pages stop importing services directly.
- **Reference slice (item 6)** — final file naming for single-entity modules (`service.ts` / `queries.ts` / `actions.ts`); until then the 3a naming `<entity>.ts` / `<entity>.actions.ts` stands.

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
| `prisma/schema/app.prisma` | `prisma/schema/{tenancy,audit,rates,settings,banking,documents,partners,contracts}.prisma` |

Vitest projects: `server` (DB-backed: `kernel/**` + `modules/**` tests), `pure` (`kernel/{money,i18n,nav,stores,errors,guards}`), `client` (all `*.test.tsx`, jsdom).

## Adding a module
Follow the `module-slice` skill: `prisma/schema/<m>.prisma` → service + tests → actions → components → page under `src/app/(app)/<m>/` → nav entry in `src/kernel/nav/constants.ts` → `docs/<m>.md` linked from [[index]].
