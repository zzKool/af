# AF — AI agent context

## Project in one minute
Business-administration app for AnalyticsFab AB, a solo Swedish aktiebolag that is also Swiss VAT-registered. Documents + OCR, Nordea CSV imports (SEK, CHF, savings), categorised journal (BAS), quotes and invoices (days × contract rate, CHF/EUR/SEK), supplier invoices, expenses with groups and owner reimbursements, traktamente, linking of everything to everything, monthly accountant package. The accountant books; the app organises, links and proves.

v3 = v2 (DefterFab) foundations kept in this repo's history + v1 (`af_core`) feature knowledge harvested as specs + the owner's Excel business rules.

**Read before working:** `docs/roadmap.md` (what is done, what is next, how we work — start here) · `docs/constitution.md` (rules, import boundaries, definition of done) · `docs/feature-inventory.md` (scope, decisions D1–D20, module verdicts) · `docs/excel-to-v3-mapping.md` (business rules) · `docs/ui-conventions.md` (layout, DataTable) · `docs/index.md` (the wiki). Skills in `.claude/skills/` apply to every change of their kind.

## Stack
Next.js 16 + React 19 · Prisma 7 + PostgreSQL 17 with RLS · Better Auth 1.5 · pg-boss (replaces Inngest, D17) · Azure Blob (Azurite locally) + Azure Document Intelligence · Chromium for PDF · shadcn/Tailwind · Zustand · pino · Vitest + Playwright · Biome · Docker Compose · Node 24.

## Commands
- `docker compose up -d` — Postgres dev + test, Azurite
- `npm run dev` — dev server (Turbopack)
- `npm run lint` / `npm run typecheck` / `npm run test` / `npm run e2e`
- `npx prisma migrate dev` — migrations (forward-only, reviewed)
- CI: GitHub Actions on every PR to `main` (lint, typecheck, test, build, e2e)

## Architecture — short form (full rules in the constitution)
- `src/kernel/*` (auth + `can()`, tenancy, audit, money, clock, errors, logging, storage, ocr, jobs, pdf, ui, i18n, nav, stores) and `src/modules/<name>/` (`<entity>.ts` service, `<entity>.actions.ts`, `queries.ts`, `components/`, `stores/`, `jobs/`, tests, `index.ts`). Models in `prisma/schema/<name>.prisma`. `src/app/` is routes only; `src/components/ui` + `src/lib/utils.ts` are the shadcn kernel kit. Map: `docs/feature-folders.md`.
- A module imports `kernel/*` and other modules' `index.ts` only. `index.ts` exposes DTOs, never Prisma types. Guard test enforces.
- Hexagonal: actions → services → db. Services never import `next/*` or components; they take a tenant-scoped `tx` + `CallerIdentity` and return `ServiceResult`; actions never throw, they return `AppError`.
- Multi-tenant via RLS (`SET LOCAL app.tenant_id`). Cross-module references are composite `(tenant_id, id)` FKs, `RESTRICT`, never a cascade across modules (D63); reads still through the owner's `index.ts`.
- `modules/linking` owns the `link` table; modules register as `linkable`. Suggestions, graph, exports are read models.
- Money: Decimal in services, number only at the display boundary. Amount + currency + base (the tenant's base currency, D39) + rate + rate source written once, never updated — an open expense / supplier invoice is a draft until its first payment (D37).
- Statuses (paid, refunded, linked, due) are derived, never typed.
- Azure SDKs only inside `kernel/storage` and `kernel/ocr`. Environment differences are env vars only; the same image runs locally, on the homelab and on Azure; nothing assumes continuous uptime.

## Conventions
- Files kebab-case, components PascalCase, DB snake_case, Postgres enums, TIMESTAMPTZ, `@db.Uuid`.
- Tests: `.test.ts` co-located (Vitest), `.spec.ts` in `e2e/` (Playwright). Property tests on money and allocations.
- i18n keys from day one, **in `en.ts` only** (D62, 2026-10-27): `fr` / `sv` fall back on `en` until one translation pass at the end; printed invoice strings keep theirs. A new language is one dictionary file, never a code change.
- Business keys are fixed functions: `Ex{group}-{BAS alias}-{seq}_{date}_`, invoices `{client short}{yy}-{nnn}` via `number_series`. No prefix settings.
- Docs: `docs/<topic>.md` with `[[wiki-links]]`, indexed in `docs/index.md`. Specs in `specs/<module>/`.

## Real data — never leaves the box (D51)
The owner's real company data (partners, amounts, bank rows, documents, invoices) lives **only** on his own box (the prod compose). **The repo is public.**
- **No access**: no agent session connects to the box — no database URL, credentials, tunnel or MCP server pointed at it. `.mcp.json`'s Postgres is the laptop's `af_dev` (seed data) only.
- **Nothing real in the repo, PRs, artifacts, project docs or memory**: no real names of clients / suppliers, amounts, IBANs, invoice numbers, CSVs, PDFs, dumps, logs. Fixtures, tests and examples use invented data.
- **Screenshots** (definition of done) come from a cloud session or the dev / test database on seed data — never from the box, never from a screen the owner shares.
- **Bug reports**: when the owner describes a bug with real values, reproduce it with invented ones before writing a test, a lesson or a PR; never copy his values.
- **The box sends out only**: image pulls (ghcr), the ECB rates fetch (nothing sent), Azure Document Intelligence in the region the owner chose (the documents themselves go there for reading, nothing else). No error-tracking service: unexpected errors are one log line with a reference (F111).
- **The owner's infrastructure stays private too**: no hardware, hostnames, network layout, VM setup, regions or access paths of his box in the repo — the runbook stays generic ([[deployment]]). His own notes live in `private/` (gitignored): never commit it, never read it unless he asks.
- Unsure whether something is real data → treat it as real.

## Git
- Trunk `main`; branches `feat/<module>-<topic>`; PR into `main`; conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
- Never commit to `main` directly, never force-push, never commit secrets or `.env.local`.
- NEVER add `Co-Authored-By` headers. NEVER add "Generated with Claude Code" to PRs or commits.
- `defter` remote = the v2 repo, read-only reference. Never push there.

## Do / Don't
- Do read the spec folder of the module before touching it; do update `docs/<module>.md` in the same PR.
- Do attach a screenshot of every new page and every generated PDF to the PR (definition of done §4.5) — on seed data only (D51).
- Do keep the architecture guard green; if a rule blocks you, propose a constitution change, don't work around it.
- Don't add a setting, a config engine or a generic framework for a single use.
- Don't touch `schema.prisma`, nav constants or `package.json` in parallel with another branch.
- Don't copy code from `af_core` or v2 history; harvest behaviour and tests into specs.
- Ask before anything irreversible: migrations that drop data, deleting documents, changing numbering series.
