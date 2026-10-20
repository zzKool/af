# AF — AI agent context

## Project in one minute
Business-administration app for AnalyticsFab AB, a solo Swedish aktiebolag that is also Swiss VAT-registered. Documents + OCR, Nordea CSV imports (SEK, CHF, savings), categorised journal (BAS), quotes and invoices (days × contract rate, CHF/EUR/SEK), supplier invoices, expenses with groups and owner reimbursements, traktamente, linking of everything to everything, monthly accountant package. The accountant books; the app organises, links and proves.

v3 = v2 (DefterFab) foundations kept in this repo's history + v1 (`af_core`) feature knowledge harvested as specs + the owner's Excel business rules.

**Read before working:** `docs/constitution.md` (rules, import boundaries, definition of done) · `docs/feature-inventory.md` (scope, decisions D1–D18, module verdicts) · `docs/excel-to-v3-mapping.md` (business rules) · `docs/phase-0.md` (current todo) · `docs/index.md` (pattern wiki from v2).

## Stack
Next.js 16 + React 19 · Prisma 7 + PostgreSQL 17 with RLS · Better Auth 1.5 · pg-boss (replaces Inngest, see phase-0) · Azure Blob (Azurite locally) + Azure Document Intelligence · Chromium for PDF · shadcn/Tailwind · Zustand · pino + Sentry · Vitest + Playwright · Biome · Docker Compose · Node 24.

## Commands
- `docker compose up -d` — Postgres dev + test, Azurite
- `npm run dev` — dev server (Turbopack)
- `npm run lint` / `npm run typecheck` / `npm run test` / `npm run e2e`
- `npx prisma migrate dev` — migrations (forward-only, reviewed)
- CI: GitHub Actions on every PR to `main` (lint, typecheck, test, build, e2e)

## Architecture — short form (full rules in the constitution)
- `src/kernel/*` (auth + `can()`, tenancy, audit, money, clock, storage, ocr, jobs, pdf, ui, i18n) and `src/modules/<name>/` (schema, service, queries, actions, components, tests, `index.ts`). `src/app/` is routes only.
- A module imports `kernel/*` and other modules' `index.ts` only. `index.ts` exposes DTOs, never Prisma types. Guard test enforces.
- Hexagonal: actions → services → db. Services never import `next/*` or components; they take a tenant-scoped `tx` + `CallerIdentity` and return `ServiceResult`; actions never throw, they return `AppError`.
- Multi-tenant via RLS (`SET LOCAL app.tenant_id`). Cross-module references are validated UUIDs, not cross-table FKs.
- `modules/linking` owns the `link` table; modules register as `linkable`. Suggestions, graph, exports are read models.
- Money: Decimal in services, number only at the display boundary. Amount + currency + SEK base + rate + rate source written once, never updated.
- Statuses (paid, refunded, linked, due) are derived, never typed.
- Azure SDKs only inside `kernel/storage` and `kernel/ocr`. Environment differences are env vars only; the same image runs locally, on the homelab and on Azure; nothing assumes continuous uptime.

## Conventions
- Files kebab-case, components PascalCase, DB snake_case, Postgres enums, TIMESTAMPTZ, `@db.Uuid`.
- Tests: `.test.ts` co-located (Vitest), `.spec.ts` in `e2e/` (Playwright). Property tests on money and allocations.
- i18n keys from day one: en + fr; sv is a later dictionary, never a code change.
- Business keys are fixed functions: `Ex{group}-{BAS alias}-{seq}_{date}_`, invoices `{client short}{yy}-{nnn}` via `number_series`. No prefix settings.
- Docs: `docs/<topic>.md` with `[[wiki-links]]`, indexed in `docs/index.md`. Specs in `specs/<module>/`.

## Git
- Trunk `main`; branches `feat/<module>-<topic>`; PR into `main`; conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
- Never commit to `main` directly, never force-push, never commit secrets or `.env.local`.
- NEVER add `Co-Authored-By` headers. NEVER add "Generated with Claude Code" to PRs or commits.
- `defter` remote = the v2 repo, read-only reference. Never push there.

## Do / Don't
- Do read the spec folder of the module before touching it; do update `docs/<module>.md` in the same PR.
- Do attach a screenshot of every new page and every generated PDF to the PR (definition of done §4.5).
- Do keep the architecture guard green; if a rule blocks you, propose a constitution change, don't work around it.
- Don't add a setting, a config engine or a generic framework for a single use.
- Don't touch `schema.prisma`, nav constants or i18n dictionaries in parallel with another branch.
- Don't copy code from `af_core` or v2 history; harvest behaviour and tests into specs.
- Ask before anything irreversible: migrations that drop data, deleting documents, changing numbering series.
