# Features — the flat table

> One row per feature, for dispatching work to agents in separate sessions. **Status**: built · partial · planned · later (out of the first real version by decision) · dropped · owner (only the owner can do it). **Touches** names the shared files a change needs (`schema`, `nav`, `i18n`) — two builders may not hold PRs on the same shared file at once, and never two migrations at once. **Size**: S < half a day · M a day · L several. Source of truth for status: `specs/<module>/tasks.md` ticks and [[feature-inventory]] §3 status lines; **every feature PR updates its row**.

Dispatch rule: pick a row with status planned, give the builder its ID, the module, and "never touch any other module's folder"; two builders at a time only on rows with different modules and no shared file in common.

| ID | Feature | Module (folder) | Status | What exists · what is left | Spec / docs | Touches | Size |
|---|---|---|---|---|---|---|---|
| F01 | Auth, sessions, organisation = tenant, roles owner / accountant | `kernel/auth`, `modules/settings` | built | Better Auth 1.5, `can()` role table, `requireCaller`; editor and superadmin roles exist in the table, no UI | [[authorization]], [[auth-setup]] | — | — |
| F02 | Row-level tenant isolation | `kernel/db` | built | RLS on every tenant table, tenant-scoped client | [[prisma-rls-setup]] | — | — |
| F03 | Members: invite the accountant, revoke, password reset | `modules/settings` (+ auth) | planned | nothing in the UI; `prisma/seed.ts` invites through the API. Spec first (`/speckit-specify`), one migration if invitations need a table of their own | roadmap A2 | schema, nav, i18n | M |
| F04 | Login / register / error pages in fr + sv | `app/(auth)` | planned | English only; signed-in UI is en / fr / sv | roadmap C2 | i18n | S |
| F05 | Superadmin pages (tenants, users, bank formats, currencies) | `modules/settings` | later | constitution §6; one tenant today | — | nav | M |
| F06 | Partner hub: types, identifiers, defaults (currency, BAS, terms), short code, soft delete | `modules/partners` | built | reference slice | [[partners]], `specs/partners` | — | — |
| F07 | Partner 360°: documents, journal entries, graph on the entity page | `modules/partners` | built | 2026-10-21 | [[partners]] | — | — |
| F08 | Contact persons on a partner | `modules/partners` | planned | not built | roadmap A4 | schema, i18n | S |
| F09 | Supplier match (OCR vendor → partner) | `modules/partners` | built | `match.ts`, `matchPartnersAction`, the card in the supplier-invoice dialog | [[partners]] | — | — |
| F10 | Contracts with dated rate history, rate used by invoice lines cannot be deleted | `modules/contracts` | built | `contract_rates`, `rateFor` | [[contracts]], `specs/contracts` | — | — |
| F11 | Quotes → invoices → credit notes, `{client}{yy}-{nnn}` series, lifecycle, derived paid / overdue / credited | `modules/invoices` | built | two PRs 2026-10-20 | [[invoices]], `specs/invoices` | — | — |
| F12 | Invoice sheet: one component edit / print, Chromium PDF stored as a document, en / fr / sv printed strings, logo, VAT per registration, reverse charge, CH declaration period | `modules/invoices`, `kernel/pdf` | built | | [[invoices]], [[pdf]] | — | — |
| F13 | Mark as sent (no email sending) | `modules/invoices` | built | email sending dropped by decision | [[invoices]] | — | — |
| F14 | Supplier invoices: `SI` keys, terms, derived status + days overdue, payments as `justifies` links (cross-currency via the bank base), cancel / uncancel, copy last, VAT read model | `modules/supplier-invoices` | built | | [[supplier-invoices]], `specs/supplier-invoices` | — | — |
| F15 | Supplier-invoice duplicate check (exact / hash / fuzzy, Create anyway with a note) | `modules/supplier-invoices` | built | `duplicates.ts` | [[supplier-invoices]] | — | — |
| F16 | Expenses: groups, four payment sources, `Ex` keys, ECB / bank bases, derived status, company-card attach | `modules/expenses` | built | | [[expenses]], `specs/expenses` | — | — |
| F17 | Owner liability ledger, FIFO settlements, exchange difference, reimbursement statement PDF | `modules/expenses` | built | the 3960/7960 pair awaits the accountant (D26) | [[expenses]] | — | — |
| F18 | Expense duplicate check (hash / same merchant fuzzy) | `modules/expenses` | built | `duplicates.ts`, the shared `DuplicatePanel` | [[expenses]] | — | — |
| F19 | Traktamente: normalbelopp table, half-day rule, meals, trip → per-diem expense, breakdown PDF | `modules/traktamente` | built | | [[traktamente]], `specs/traktamente` | — | — |
| F20 | Document upload → blob → key → OCR job → statuses | `modules/documents`, `kernel/ocr`, `kernel/storage` | built | mock OCR without Azure DI keys | [[document-upload]] | — | — |
| F21 | Review page: auto-save corrections, classify, line items, mark reviewed (= filed, D34) | `modules/documents` | built | | [[document-review]] | — | — |
| F22 | Library: DataTable with Excel filters, download, delete with retention guard | `modules/documents` | built | | [[document-library]] | — | — |
| F23 | Make it…: expense / supplier invoice / just file it from the review page, Became {key} | `modules/documents` | built | #50 | [[document-review]], `specs/documents` | — | — |
| F24 | The same file twice: content hash, Use existing / Upload anyway | `modules/documents` | built | `scripts/backfill-document-hashes.ts` for rows stored before — **owner runs it once** | [[document-upload]] | — | — |
| F25 | Inbox work page: states, counts, archive + undo, OCR re-run, keyboard, accountant read-only | `modules/documents` | built | #55 | [[document-inbox]] | — | — |
| F26 | Banking: three Nordea CSV imports with dedup, immutable rows, categorisation rules, transfer pairs, derived state, workbench / imports / rules pages | `modules/banking` | built | | [[banking]], `specs/banking` | — | — |
| F27 | Journal: every bank row an entry with locked money facts, categorise (never overwrite), manual entries, the ledger page with filters; recurring = rules | `modules/journal` | built | D33: the partner stays typed | [[journal]], `specs/journal` | — | — |
| F28 | ECB rates: sync job, catch-up on start, `rateToBase` with nearest-day fallback, Settings → Exchange rates with Fetch now | `modules/rates` | built | | [[ecb-rates]] | — | — |
| F29 | Rates backfill by date (`scripts/fetch-rates.ts 2023-04-01`) | `modules/rates` (script) | built | `fetchDailyRates({ startDate })` fetches every observation from that day (only the URL builder took it before); the script takes a past day or a count (`fetchRatesArgToOptions`) | [[ecb-rates]] | — | — |
| F30 | Linking: one `links` table, kinds, invariants, audit; scorer with reasons; suggestions both ways; apply / bulk apply HIGH; Link to…; the `/banking/inbox` work page; the graph page | `modules/linking` | built | complete | [[linking]], `specs/linking` | — | — |
| F31 | Dashboard: to-do list with counts and amounts, pulse, briefing since last login | `modules/dashboard` | built | | [[dashboard]] | — | — |
| F32 | Cash-planning widget | `modules/dashboard` | later | D14, Growth | — | — | M |
| F33 | Monthly accountant package: checklist, zip with statements, documents under keys, `summary.xlsx`, `notes.md`; year package | `modules/package` | built | | [[accountant-package]] | — | — |
| F34 | Swiss VAT return: FTA form from stored periods, Declare / Mark paid, CSV, derived *declared* chip on invoices | `modules/exports` | built | CH acquisition tax awaits the accountant (D23) | [[exports]] | — | — |
| F35 | Swedish moms, SIE export, statutory statements | — | dropped | the accountant's, by decision | [[feature-inventory]] | — | — |
| F36 | Settings: company profile, VAT registrations, bank accounts, BAS preferences, traktamente table, my preferences (locale), settings hub | `modules/settings` | built | | [[settings]] | — | — |
| F37 | Per-user table layouts (order, width, visibility) on every list | `kernel/ui/data-table` | built | | [[ui-conventions]] | — | — |
| F38 | i18n en / fr / sv for the signed-in UI | `kernel/i18n` | built | owner's Swedish read pending | — | i18n | — |
| F39 | UI / UX direction pass: decide direction with the owner, write `ui-conventions` + `.claude/skills/af-design`, restyle the shell and the kernel kit once | `kernel/ui`, `components/ui` | planned | after the features; Designer session first, then one builder | roadmap C1 | nav | L |
| F40 | CI: lint / typecheck / unit / build on PRs, e2e on main, images to ghcr.io, migrate image | `.github`, `Dockerfile` | built | | [[verify-gate]], [[ci-cd]] | — | — |
| F41 | Homelab deployment: compose prod, backups, restore drill, `/api/health` | `deploy/`, `docker-compose.prod.yml` | built (runbook) · owner (run it) | B3 | [[deployment]] | — | — |
| F42 | Azure Container Apps deployment | `.github/workflows/ci.yml` deploy job | planned | written, `if: false` until provisioned | [[deployment]] | — | S + owner |
| F43 | Azure Document Intelligence keys in production | — | owner | B2; mock OCR until then | [[deployment]] | — | — |
| F44 | Real data from 2023-04 (partners, contracts, bank CSVs, invoices; series continue from the last numbers) | — | owner | B1 — the acceptance test | roadmap B1 | — | — |
| F45 | Accountant confirmations: 3960/7960 pair, CH acquisition tax | — | owner | B4, non-blocking | [[open-questions]] | — | — |
| F46 | Rename pass `defterfab_*` → `af_*` (compose, env example, CI, seed tenant) | repo-wide | planned | optional, before a quiet moment | roadmap C3 | — | S |
| F47 | Branch protection on `main` | GitHub settings | owner | needs GitHub Pro | [[phase-0]] | — | — |
| F48 | Deferred mechanics: `.toNumber()` lint rule, Sentry request context, the two quarantined e2e | `kernel` | built | Biome plugin `biome-plugins/decimal-to-number.grit`; `reportError` attaches user / tenant / request id / action to the Sentry event (jobs: job / id / attempt / tenant); no e2e was quarantined — `quarantine(` has no caller on `main` | [[observability]], [[constitution]] §2 | — | — |
| F49 | Cloud-session dev environment script / doc (Postgres, Azurite, env, font stub, prod build) | `scripts/` | built | `scripts/dev-env.sh` (one command, idempotent, ≈2 min) + `scripts/dev-env.md`: Postgres :5433 without Docker, psql migrations when the Prisma engine is blocked, seed as the migration role, Azurite from npm, Playwright Chromium from `/opt/pw-browsers`, generated `next/font` mock, `next start` :3000 | `scripts/dev-env.md`, [[local-environment-setup]] | — | S |
| F50 | Code-hygiene items from the audit pass (split `documents.ts`, `parseOcrPayload`, zod scalars, `GroupPicker`, panel splits, typed JSON columns) | per item's module | planned | each a small PR; take them one module at a time | [[lessons]] | — | S each |
| F51 | Make it… hidden for relationship documents; dashboard "to review" aligned on the inbox total | `modules/documents`, `modules/dashboard` | built | shipped with inbox part 2 (T014): `MakeItSection` shows *Expense* / *Supplier invoice* only when `documentType === "financial"` (review page and inbox `canMake`, tests in `make-it-section.test.tsx` + `inbox-workbench.test.tsx`); the dashboard item counts `documents.inboxTotals().total` and opens `/documents/inbox` (`overview.test.ts`, SC-005). Nothing left | [[document-inbox]], [[dashboard]], [[lessons]] | — | — |

Related: [[roadmap]] (the order) · [[feature-inventory]] (the decisions) · [[lessons]] (the findings)
