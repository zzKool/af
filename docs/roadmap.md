# Roadmap — where the app stands and what is left

> The one page an agent or the owner reads to know what is done, what is next, and how we work. Facts live elsewhere ([[feature-inventory]] §3 for the per-module status, `specs/<module>/` for the detail); this page is the **order**. Update it in the same PR as the work it describes.

## Starting a session

Read `CLAUDE.md`, then this page, then [[lessons]] (the findings of the last build, with their actions), then the spec folder of the module in *Next up*. Work as *How we work* says. The owner is asked only for the decisions listed under *Open decisions*; everything else is the agent's call, written down in the PR.

## Done — the vertical slices (2026-10-20 → 21)

The feature-by-feature view with statuses is [[features]]; this table is the module view.

Every module of [[feature-inventory]] §3 has a build behind it; the status line of each section says what exactly. In one line each:

| Module | What works | Doc |
|---|---|---|
| Partners, contracts | hub with types, identifiers, defaults; contracts with dated rates; the 360° entity page (documents, journal, graph) | [[partners]], [[contracts]] |
| Invoices | quotes → invoices → credit notes, `VA26-INV-001` series, one sheet edit/print, Chromium PDF stored as a document, paid derived from links, CH declaration period | [[invoices]] |
| Supplier invoices | payables with `SI` keys, terms, derived status, payment links, cancel, copy last | [[supplier-invoices]] |
| Expenses, traktamente | groups, four payment sources, `Ex` keys, owner liability ledger, FIFO settlements + statement PDF, trips with the half-day rule + per-diem PDF | [[expenses]], [[traktamente]] |
| Documents | upload → blob → key → OCR job → review page (auto-save, corrections, classify, mark reviewed, *Make it…*) → library with Excel filters, retention guard on delete; content-hash duplicates; the inbox work page with archive + undo and the keyboard | [[document-upload]], [[document-review]], [[document-library]], [[document-inbox]] |
| Banking, journal | three Nordea CSV imports with dedup, rules, transfer pairs; every row a journal entry with locked money facts; the journal page | [[banking]], [[journal]] |
| Linking | one `links` table, the scorer, suggestions both ways, the inbox work page with the keyboard, the graph page | [[linking]] |
| Rates | ECB sync job, `rateToBase`, Settings → Exchange rates with *Fetch now*, `scripts/fetch-rates.ts` | [[ecb-rates]] |
| Package, exports | the month-end checklist and zip, the Swiss VAT return with the declaration record | [[accountant-package]], [[exports]] |
| Dashboard, settings | to-do list, pulse, briefing; company, VAT registrations, bank accounts, BAS, traktamente, rates, my preferences | [[dashboard]] |
| Cross-cutting | RLS, `can()`, audit, pg-boss, per-user table layouts, en / fr / sv, CI with e2e on `main`, images on `ghcr.io`, homelab runbook + backups | [[constitution]], [[deployment]] |

### Since the slices — 2026-10-24

The OCR reading, finished before the owner's real documents go through it (B1):

| ID | What works | Decision · doc |
|---|---|---|
| F89 | OCR reads the **currency** (receipts too), **line Tax %**, the vendor VAT number, **Billed to** (name + VAT number, a warning when neither fits the company), the **reverse-charge** flag; the corrections counter counts real corrections | D53, D54 · [[ocr-processing]], [[document-review]] |
| F90 | **The type drives the reading**: a type change re-runs the OCR with that type's model (corrections stay); the provisional key follows the type until reviewed / became; the upload asks for the type, no default | D52 · [[document-review]] |
| F91 | **Reverse-charge tag** on the expense / supplier invoice made from a flagged document — a tag only, the VAT treatment stays the accountant's | D54 · [[expenses]], [[supplier-invoices]] |
| F92 | **Several files at once, one type** (2026-10-26): up to 50 files per drop / pick, each through the one-file upload (own key, duplicate check, OCR job); a per-file result list — uploaded · duplicate · failed | D55 · [[document-upload]] |

## Left — to a first real version

Decided with the owner on 2026-10-21: **cut-off 2023-04** (the start of the activity); **no Excel history import** — the owner enters his data himself; **UI/UX after the features**, as a direction decision first.

### A. Gaps in the loop (code)

```
upload ──► review ──► make it an expense / SI ──► link bank row ──► package
  ✓          ✓            ✓ A1                        ✓               ✓
accountant: invite ✗ A2 ──► read-only ✓ ──► package ✓
```

- [x] **A1 Document inbox** — converged 2026-10-22: nine small gaps left as `specs/documents/tasks.md` Phase 3 (T019–T027; O1 / O2 decided as D35 / D36). `specs/documents/`: part 1 (*Make it…* on the review page, the upload duplicate card, the entity duplicate check, the supplier match — #50) and part 2 (the work page `/documents/inbox`: states, counts, duplicates, archive + undo, OCR re-run, the keyboard; the dashboard item opens it — [[document-inbox]]).
- [ ] **A2 Members** — *later, parked by the owner 2026-10-22 (F03).* Settings → Members: invite the accountant by email (role accountant), show the invitation link for the owner to send himself (no email sending in v1), revoke; a password-reset path. Today only `prisma/seed.ts` does this through the API.
- [x] **A3 Rates backfill by date** — `scripts/fetch-rates.ts 2023-04-01` backfills every ECB day from that date ([[ecb-rates]]).
- [x] **A4 Partners: contact persons** — the Contacts tab on the partner page (F08, [[partners]]).

### B. Real-data readiness (the owner, with the agent's help)

- [ ] **B1** The owner enters 2023-04 onwards — **next up**, plan under *Next up*: partners, contracts with their rate history, bank CSVs, invoices, supplier invoices / receipts through OCR, links, the package. Every oddity he hits is a bug report worth more than a test (reproduced with invented values — D51).
- [x] **B2** Azure Document Intelligence keys set on the owner's box — real OCR active, the mock no longer runs there (2026-10-24, [[deployment]]).
- [x] **B3** The owner's box runs the prod compose, the nightly backups, and a restore drill passed (2026-10-24, [[deployment]]). The Azure job stays `if: false`.
- [ ] **B4** The accountant's two confirmations (non-blocking): the 3960/7960 pair for exchange differences (D26), CH acquisition tax never applies (D23).

### C. Finish and polish

- [x] **C1 UI/UX pass** — direction **D40 "Lakehouse"** (2026-10-22, Databricks-inspired; logos in `public/brand/`), and the **restyle of the shell + kernel kit** (F39, the same day): the modules inherit the tokens, the shell, the tabs, the buttons, the DataTable and the docked details panel. Left, one row each in [[features]]: **F71** each module adopts the kit (states, on-screen money, keys, row actions — one PR per module), ~~F72~~ sidebar counts (2026-10-24), ~~F73~~ **+ New** opening the dialog (2026-10-24), ~~F74~~ the kit's English leftovers (2026-10-23); then ~~F69~~ (the banking *Months* panel, built 2026-10-23).
- [ ] **C2** ~~Remaining English: login / register pages, error fallbacks~~ (F04, 2026-10-22). Left: the owner's Swedish read of `sv.ts`.
- [ ] **C3** Phase-0 leftovers: ~~the rename pass (`defterfab_*` → `af_*`)~~ (F46, 2026-10-22, D42 — owner, once: `docker compose down`, `docker volume rm af_db-dev-data af_db-test-data af_pgdata-dev af_pgdata-test` (whichever exist), DB URLs from `.env.example` into `.env.local`, `docker compose up -d`, `npx prisma migrate deploy`, `npm run db:seed`). Left: branch protection on GitHub (owner, F47).
- [x] **C4** Deferred mechanics: Sentry request context, the `.toNumber()` lint rule (F48); no e2e turned out to be quarantined.
- Out of scope by decision: email sending, the cash-planning widget (D14, Growth), SIE, Swedish moms (the accountant's), mobile.

## Next up

### 0. Before B1 — the audit's fix-now and the one table (2026-10-27, D59–D65)

[[audit-2026-10-27]] §3 and §7. **Done 2026-10-27** (one night, twelve PRs): ~~F105~~ close the box · ~~F106~~ one file route · ~~F107~~ fs storage · ~~F108~~ mock OCR gated · ~~F109~~ imports all-or-nothing · ~~F110~~ failed jobs visible · ~~F111~~ rollback + deps · ~~F112~~ admin CLI · ~~F118~~ en only · F120 the docs cuts (the code cuts left) · the lessons · ~~F113 PR A~~ the one transaction table (the spec approved by the owner, the migration, the journal folded into banking, `/journal` gone). Main is on the fs driver with the file route, Sentry and react-query gone, `xlsx` dev-only, one table for a bank movement.

```
~~F113 PR A~~ ─► ~~the Justify panel (F97)~~ ─► F114 (spec + PR 1 #318 + PR 2 built; PR 1 waits for the owner's word — it drops columns; PR 2 follows it) ─► F115 ─► F116
                                                     │
                                                     ▼
                                         B1 — one real month on the box (D65)
                                                     │
                                                     ▼
                              F113 PR B (drop journal_entries) · PR C (linked = categorised)
```

**The owner's side, before the next `up -d` on the box** ([[deployment]]): snapshot the VM; `AUTH_SIGNUP=closed` and `AF_APP_PASSWORD` (+ `DATABASE_URL`) in `.env.prod`; keep `AZURE_STORAGE_CONNECTION_STRING` for that one deploy (the migrate container moves the documents into the folder — *documents: N moved* in its log), check a preview, run `backup.sh`, then drop the variable and the old `blobdata` volume. **F113's migration refuses to run while a manual journal entry exists** — it names them; delete them first (none expected). No new feature row is dispatched before B1 (D65); a refactor rides only with an owner-visible change in its module.

### 1. B1 — 2023-Q2 end to end, on the owner's box

The acceptance test: one real quarter, from the start of the activity, through every module, ending in a package compared with what the accountant filed. The owner does the entering; the agent fixes what he reports (D51: never on the box, never with his values).

```
settings ─► partners ─► contracts ─► rates backfill ─► bank CSVs ─► invoices
                                                          │             │
                     receipts / supplier invoices ─► OCR ─► review ─► Make it…
                                                          │             │
                                                          └──► links ◄──┘
                                                                 │
                                    package 2023-04 · 05 · 06 ─► compare 2023-06 with what was filed
```

1. **Settings** — company profile, VAT registrations, the three Nordea accounts, BAS categories as the accountant uses them.
2. **Partners** — the clients and suppliers of 2023-Q2 (short codes, identifiers, default currency / BAS / terms).
3. **Contracts** — with their 2023 daily rates (the dated rate history).
4. **Rates** — `scripts/fetch-rates.ts 2023-04-01` before any money fact (A3; the SEK bases are locked once written).
5. **Bank CSVs** — SEK, CHF and savings, 2023-04 → 06; rules, transfer pairs.
6. **Invoices** — the quarter's invoices, numbered as they were issued.
7. **Supplier invoices / receipts** — uploaded with their type (F90), read by the real OCR (B2), reviewed, *Make it…* expense / supplier invoice; owner-paid expenses and their reimbursements; traktamente trips if any.
8. **Links** — the bank rows justified (the inbox's suggestions, *Link to…* for the rest); nothing left to justify for the quarter.
9. **Package** — 2023-04, 05, 06; **the 2023-06 package compared with what was filed** — every difference is either explained or a bug report.

Done when the 2023-06 package matches what was filed, or every difference has a reason written down. Each oddity → a row in [[features]] or a line in [[lessons]], reproduced on seed / invented data before a test or a fix.

### 2. Alongside, as they fit

- **Left from earlier rounds**: ~~F56 · F57 · F58 · F59 · F60~~ (the audit's wrong figures, 2026-10-23); ~~F85 · F86 · F87 · F88~~ (the owner's 2026-10-23 decisions, built 2026-10-23 → 24); ~~F72 · F73~~ (2026-10-24), ~~F74~~ (2026-10-23); F70 parked (D46).
- **F71** — the kit in the last modules: dashboard, settings, rates (one PR each).
- ~~**F93**~~ — the Ctrl K global search (2026-10-26, [[search]]).
- ~~**F94 Subscriptions**~~ (FULL, D57) — built 2026-10-26 (P1–P2, [[subscriptions]]); US7 (P3) waits for the owner's use on B1.
- **F67** — the audit's hygiene, line by line; **F66**'s last item (dashboard's kernel reads).
- The documents convergence is done (`specs/documents/tasks.md` Phase 3, T019–T028); the convergence passes ~~F77–F81~~ are built (2026-10-23).

F03 Members is *later*: the owner will not invite the accountant into the app for now (2026-10-22). The dispatch table is [[features]].

## Open decisions (the owner's)

None open.

Decided 2026-10-27 (the audit's §8, one batch): **D59** one transaction table · **D60** the link as the only payment record · **D61** the homelab is the target (fs storage, one file route, closed sign-up, CLI admin, no Sentry) · **D62** one language at build time (`en.ts` only; `fr` / `sv` fall back) · **D63** the FK ban lifted (composite FKs, `RESTRICT`) · **D64** the review page is not a record · **D65** B1 before features. The Excel history stays **not imported** (the owner re-keys; confirmed). Open from the audit: subscriptions — probation to 2026-11-30 (D57 / F104) stands. The preview question is moot (F106 serves the bytes through the app); F105 is built — closing the box is one line in `.env.prod`. `specs/banking/one-table.md` (F113) was read and approved 2026-10-27; PR A is built. F97 is built (five stories, 2026-10-27). `specs/linking/payment-record.md` (F114) is written for the owner's read — three questions in it; PR 1 (#318) is built and green and merges after his word; PR 2 (`feat/package-payment-columns`, the package columns) is stacked on it. Still wanted from the owner: his word that no manual journal entry exists on the box before the next deploy (the migration refuses otherwise, naming them).

Decided 2026-10-23 (O6–O8 and two more, chat): **F70 parked** — the base stays SEK in code until a second company needs another, a guard stops new hard-coded SEK (D46 → F85); the reimbursement statement prints *owed* like the app (D47 → F88); both unread columns dropped now, before real data (D48 → F86); expenses get an **optional partner** for spend per merchant (D49 → F87, FULL).

Decided 2026-10-22 (the audit's O3–O5, constitution 1.3): an open expense / supplier invoice's money facts are a draft until its first payment, then locked (D37 → F58, F62); `expense_groups` is a shared reference other modules may FK to (D38); **each tenant has its own base currency**, locked once it has money (D39 → F70). Decided 2026-10-22: a supplier's invoice number is unique, an exact match is refused (D35); deleting what a document became returns it to the inbox when `created_from` is its only link (D36). Decided 2026-10-21: a `justifies` link does not fill in the journal entry's partner (D33); reviewed = filed (D34).

## How we work

**Three lanes (D45)** — the builder picks one from the row and names it in the PR body. Ceremony follows the risk of the change, not its size:

```
Does it change a business rule? (money facts, VAT, rates, linking, a derived status, numbering, a new entity / table)
 ├─ yes → FULL    /speckit-specify ─► owner reads spec.md ─► /speckit-tasks (/speckit-plan only when the schema changes) ─► PRs
 └─ no  → a new or changed screen / behaviour the owner will see?
           ├─ yes → LIGHT   a task line ticked in specs/<module>/tasks.md + a few lines in docs/<module>.md + tests ─► PR
           └─ no  → DIRECT  fix / refactor / infra / docs ─► tests (a fix starts with the test that reproduces it) ─► PR
Every lane: the features.md row updated · CI + architecture guard + lint rules (automatic)
Per module, once its batch of rows is built: /speckit-converge ─► docs PR (gaps become tasks or rows)
```

- **Removed** (F120): `speckit-clarify` (questions go to the owner in one batch → *Open decisions*), `checklist`, `analyze`, `taskstoissues` — they loaded in every session and were never used. No retro-specs for what is built: converge documents what exists.
- **House skills, by trigger** (`.claude/skills/`): `server-action-pattern` — any action; `bas-accounting` — any money, VAT, BAS or rate; `invoice-pdf` — any rendered PDF; `af-design` — any UI; `test-conventions` — every lane; `module-slice` — a new module only.
- **Stack docs**: `.mcp.json` (Context7, Microsoft Learn, Playwright, Postgres) loads only in a local Claude Code session. In a cloud session, check an API against the version in `package.json` and the types in `node_modules`, not against memory.
- **Too much process** shows as: a one-line fix needing more than one PR, a builder reading process docs longer than code, `features.md` and a `tasks.md` disagreeing. Seen → a lesson + a simpler rule here, never a new tool.

- `specs/<module>/`, not numbered feature folders; branches `feat/<module>-<topic>`; one spec can span several PRs.
- The agent works autonomously: spec → implement → PR → **self-merge when CI is green** (`scripts/merge-when-green.sh <pr> "<title>" "$(git rev-parse HEAD)"`). The owner is asked only for *Open decisions* and before anything irreversible (CLAUDE.md).
- Every PR: `docs/<module>.md` updated, screenshots of new pages and PDFs under `specs/<module>/screenshots/` linked from the PR body, the definition of done ([[constitution]] §4).
- PRs that touch `prisma/schema`, the nav constants, the i18n dictionaries or `package.json` / `package-lock.json` are serialised, never parallel — dependabot's PRs (`.github/dependabot.yml`, weekly, minor + patch grouped) included: merge one, rebase the next. Never force-push; a pushed branch takes `origin/main` by merge. **No branch left behind**: GitHub deletes a merged PR's branch; a branch a session stops using (renamed, restarted, superseded) is deleted by that session or gets a PR — before the session reports done.
- CI runs lint / typecheck / unit / build-and-e2e on every code PR and every `main` push, side by side; a docs-only PR (`*.md`, `docs/`, `specs/` — `scripts/ci-docs-only.sh`) skips them and merges in under a minute ([[ci-cd]], [[verify-gate]]). After a merge, watch `main`'s `build-and-e2e` and fix it first if it goes red.
- Local test loop: `docker compose up -d`, `npx prisma migrate deploy` against the test database, `npm run db:seed`, `npm run test`, then `scripts/reset-e2e-data.sh` + `npm run db:seed` before `npm run e2e` (a full server-test run empties the seed; the e2e journeys leave data behind that the next run sees as duplicates). The e2e run with `--workers=2` like CI.
- In a cloud agent session: `scripts/dev-env.sh` builds all of it from nothing (Postgres, Azurite, `.env.local`, migrations, seed, Chromium, the build, `next start` on :3000) — `scripts/dev-env.md` says why each step and the test loop there.
- In a cloud agent session the CI logs on GitHub's blob host are not reachable through the proxy: read failures with `gh api repos/zzKool/af/check-runs/<id>/annotations`.

Related: [[feature-inventory]] · [[constitution]] · [[verify-gate]]
