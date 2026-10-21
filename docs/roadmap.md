# Roadmap — where the app stands and what is left

> The one page an agent or the owner reads to know what is done, what is next, and how we work. Facts live elsewhere ([[feature-inventory]] §3 for the per-module status, `specs/<module>/` for the detail); this page is the **order**. Update it in the same PR as the work it describes.

## Starting a session

Read `CLAUDE.md`, then this page, then the spec folder of the module in *Next up*. Work as *How we work* says. The owner is asked only for the decisions listed under *Open decisions*; everything else is the agent's call, written down in the PR.

## Done — the vertical slices (2026-10-20 → 21)

Every module of [[feature-inventory]] §3 has a build behind it; the status line of each section says what exactly. In one line each:

| Module | What works | Doc |
|---|---|---|
| Partners, contracts | hub with types, identifiers, defaults; contracts with dated rates; the 360° entity page (documents, journal, graph) | [[partners]], [[contracts]] |
| Invoices | quotes → invoices → credit notes, `VA26-INV-001` series, one sheet edit/print, Chromium PDF stored as a document, paid derived from links, CH declaration period | [[invoices]] |
| Supplier invoices | payables with `SI` keys, terms, derived status, payment links, cancel, copy last | [[supplier-invoices]] |
| Expenses, traktamente | groups, four payment sources, `Ex` keys, owner liability ledger, FIFO settlements + statement PDF, trips with the half-day rule + per-diem PDF | [[expenses]], [[traktamente]] |
| Documents | upload → blob → key → OCR job → review page (auto-save, corrections, classify, mark reviewed) → library with Excel filters, retention guard on delete | [[document-upload]], [[document-review]], [[document-library]] |
| Banking, journal | three Nordea CSV imports with dedup, rules, transfer pairs; every row a journal entry with locked money facts; the journal page | [[banking]], [[journal]] |
| Linking | one `links` table, the scorer, suggestions both ways, the inbox work page with the keyboard, the graph page | [[linking]] |
| Rates | ECB sync job, `rateToBase`, Settings → Exchange rates with *Fetch now*, `scripts/fetch-rates.ts` | [[ecb-rates]] |
| Package, exports | the month-end checklist and zip, the Swiss VAT return with the declaration record | [[accountant-package]], [[exports]] |
| Dashboard, settings | to-do list, pulse, briefing; company, VAT registrations, bank accounts, BAS, traktamente, rates, my preferences | [[dashboard]] |
| Cross-cutting | RLS, `can()`, audit, pg-boss, per-user table layouts, en / fr / sv, CI with e2e on `main`, images on `ghcr.io`, homelab runbook + backups | [[constitution]], [[deployment]] |

## Left — to a first real version

Decided with the owner on 2026-10-21: **cut-off 2023-04** (the start of the activity); **no Excel history import** — the owner enters his data himself; **UI/UX after the features**, as a direction decision first.

### A. Gaps in the loop (code)

```
upload ──► review ──► make it an expense / SI ──► link bank row ──► package
  ✓          ✓            ✗ A1                        ✓               ✓
accountant: invite ✗ A2 ──► read-only ✓ ──► package ✓
```

- [ ] **A1 Document inbox** — `specs/documents/` (H7, D27, D32): from the review page, *make this an expense* / *a supplier invoice* (`created_from` link, the key), duplicate detection on upload (same hash → *Use existing*; fuzzy supplier-invoice duplicate), *archive* for irrelevant uploads, the keyboard map and undo. The link kind and the services already exist; this is the UI and the finder.
- [ ] **A2 Members** — Settings → Members: invite the accountant by email (role accountant), show the invitation link for the owner to send himself (no email sending in v1), revoke; a password-reset path. Today only `prisma/seed.ts` does this through the API.
- [ ] **A3 Rates backfill by date** — `scripts/fetch-rates.ts 2023-04-01` (`fetchDailyRates` already takes `startDate`; only the script argument is missing). A `fix:` PR, no spec.
- [ ] **A4 Partners: contact persons** — small.

### B. Real-data readiness (the owner, with the agent's help)

- [ ] **B1** The owner enters 2023-04 onwards: partners, contracts with their rate history, bank CSVs, invoices (the series counters continue from the last numbers he used). Every oddity he hits is a bug report worth more than a test.
- [ ] **B2** Azure Document Intelligence (F0) keys in the homelab `.env.prod` — without them the mock OCR runs.
- [ ] **B3** The homelab actually running it: `docker-compose.prod.yml`, the nightly backup cron, one restore drill with real data ([[deployment]]). The Azure job stays `if: false`.
- [ ] **B4** The accountant's two confirmations (non-blocking): the 3960/7960 pair for exchange differences (D26), CH acquisition tax never applies (D23).

### C. Finish and polish

- [ ] **C1 UI/UX pass** — direction first (density — the Excel-like tables stay —, typography, colour, panel vs page, chips, light/dark), decided with the owner on concrete options; written down in [[ui-conventions]] and as a repo skill `.claude/skills/af-design` so every later PR follows it; then one restyle of the shell + kernel kit, which the modules inherit. Not the shadcn default look.
- [ ] **C2** Remaining English: login / register pages, error fallbacks. The owner's Swedish read of `sv.ts`.
- [ ] **C3** Phase-0 leftovers: the rename pass (`defterfab_*` → `af_*`), branch protection on GitHub.
- [ ] **C4** Deferred mechanics: Sentry request context, the `.toNumber()` lint rule, the two quarantined e2e.
- Out of scope by decision: email sending, the cash-planning widget (D14, Growth), SIE, Swedish moms (the accountant's), mobile.

## Next up

**A1 Document inbox** — `/speckit-specify` → `specs/documents/spec.md` → the owner reads it → plan → tasks → 2–3 PRs → `/speckit-converge`. Then A2, A3, A4, then B with the owner.

## Open decisions (the owner's)

- Should a `justifies` link fill in a blank partner on the bank row's journal entry? It crosses "typed, not derived" for the partner field — not done unasked.

## How we work

The loop per feature, spec-kit as applied to AF (the skills are in `.claude/skills/`, the constitution check reads `docs/constitution.md`):

```
harvest.md (once per module) ──► /speckit-specify ──► owner reads spec.md ──► /speckit-plan ──► /speckit-tasks ──► PRs ──► /speckit-converge
skipped: /speckit-clarify (questions go to the owner in chat → docs/open-questions.md), checklist, analyze, taskstoissues
```

- `specs/<module>/`, not numbered feature folders; branches `feat/<module>-<topic>`; one spec can span several PRs.
- The agent works autonomously: spec → implement → PR → **self-merge when CI is green** (`scripts/merge-when-green.sh <pr> "<title>"`). The owner is asked only for *Open decisions* and before anything irreversible (CLAUDE.md).
- Every PR: `docs/<module>.md` updated, screenshots of new pages and PDFs under `specs/<module>/screenshots/` linked from the PR body, the definition of done ([[constitution]] §4).
- PRs that touch `prisma/schema`, the nav constants or the i18n dictionaries are serialised, never parallel. Never force-push; a pushed branch takes `origin/main` by merge.
- CI runs lint / typecheck / unit / build on PRs and the e2e only on `main` pushes ([[verify-gate]]). After a merge, watch `main`'s `build-and-e2e` and fix it first if it goes red.
- Local test loop: `docker compose up -d`, `npx prisma migrate deploy` against the test database, `npm run seed`, `npm run test`, then `scripts/reset-e2e-data.sh` + `npm run seed` before `npm run e2e` (a full server-test run empties the seed; the e2e journeys leave data behind that the next run sees as duplicates). The e2e run with `--workers=2` like CI.
- In a cloud agent session the CI logs on GitHub's blob host are not reachable through the proxy: read failures with `gh api repos/zzKool/af/check-runs/<id>/annotations`.

Related: [[feature-inventory]] · [[phase-0]] · [[open-questions]] · [[constitution]] · [[verify-gate]]
