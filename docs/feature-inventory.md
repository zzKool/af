# v3 feature inventory — `af_core` (v1) vs `defterfab` (v2)

Version 2 · 2026-10-20 · Status: phase 0 — inventory closed · Owner: Zikrija
Companion: `excel-to-v3-mapping.md` (the current Excel, column by column).

Purpose: one table per module answering *what exists where, what v3 keeps, what it harvests, which mechanism it replaces*. Feeds the constitution, the strip list for the new repo, and the harvest specs.

Rule applied throughout: **simplify the mechanism, never the capability.** Every change is written as "keeps X; mechanism Y → Z".

---

## 0. Facts and figures

| | v1 `af_core` (OpsFab / AF-OPS) | v2 `defterfab` (DefterFab) |
|---|---|---|
| Built | 2025-11-07 → 2026-01-23 (11 weeks, 685 commits) | planning 2026-03-02 → 03-10, dev 03-09 → 03-17 (8 days, 273 commits) |
| Size | ~130 K LOC, 70 Prisma models, 43 API route groups, 60+ dashboard routes | 16 K LOC, 22 models, 19 services, 11 action files, 4 page areas |
| Tests | 61 Jest files + 129 Playwright e2e | 50 Vitest/Playwright files + architecture guard test |
| Stack | Next 15 / React 19 / Prisma 5 / SQL Server / NextAuth 5 / CASL / shadcn / Jest / puppeteer | Next 16.1 / React 19.2 / Prisma 7 / Postgres 17 RLS / Better Auth 1.5 / Inngest / Zustand / pino + Sentry / shadcn / Vitest / Biome / Docker + Container Apps |
| Method | feature-first with Claude in VS Code, audit-driven hardening afterwards | BMAD: brief → PRD → architecture → UX spec → 11 epics, story-per-branch, prep sprints, retros |
| Where it stands | ~95 % of a large scope; two invoice models coexist; tenant isolation patched by audits | foundations + documents done (Epics 0–5); banking started (6.0); invoices, reconciliation, exports never reached |

v1's budget went into features, v2's into foundations. v3 = v2's foundations + v1's feature knowledge (as specs, not code) + the Excel's business rules.

---

## 1. Decisions log

| # | Decision | Source |
|---|---|---|
| D1 | Accountant-software-agnostic: v3 organises, categorises, links and packages. The accountant books. No double-entry engine. | v2 PRD |
| D2 | BAS kontoplan = categorisation, not a ledger. Aliases (`Tr`, `Ut`, `Rep`, `Off`, `Acc`, `Evnt`, `Vat`) are the BAS short codes. | PRD + Excel |
| D3 | Dual-amount storage: object currency + SEK base + rate + rate source on every financial entry. | PRD |
| D4 | Exchange rates: ECB daily reference (today's Excel uses Riksbank via Power Query; equivalent). Bank implicit rate captured on transfer pairs. | Q1 |
| D5 | Document numbering: `number_series(tenant, series, next)` row-locked at issue; invoice series = `{client short}{yy}-INV` (`VA26-INV-001`); prefixes fixed; no settings UI. Quote and credit-note series: D21. | discussion + Excel |
| D6 | Business keys kept as **one fixed function** `Ex{group}-{alias}-{seq}_{date}_` / `InvoiceAF_{number}.pdf`; configurable pattern engine dropped. | Excel |
| D7 | One invoice model. Invoice form = invoice layout (edit / print modes of one component); PDF via Chromium from the print mode; PDF stored as a document at issue, downloadable forever. No sending from the app; "mark as sent". | 3.5, Q7 |
| D8 | Supplier invoices are a **separate module** (payable: document + partner + due date + unpaid state), not expense rows. | your correction |
| D9 | Expenses: group first-class (trip or batch); private payments create an owner liability; reimbursements are settlements, partial and cross-currency allowed; late receipts can join an old group. | Q6, your flow |
| D10 | Traktamente module: Skatteverket normalbelopp table per country/year; app computes days with the half-day rule from trip timestamps; you enter meals paid separately; countries CH, SE, EU. | Q5, Q7 |
| D11 | Time tracking dropped; invoice line = days × rate from the contract rate valid for the period. | Q2 |
| D12 | Swiss VAT kept: CH registration, 8.1 % on Swiss invoices, quarterly declaration period on each invoice, FTA form mapping harvested from v1. | Q3 |
| D13 | Accountant package: monthly; CSV per main account (SEK, CHF) + all PDFs of the period; savings CSV yearly; plus a generated summary (replaces the Excel you used to send). The Excel itself disappears. | Q3, Q4, Q5 |
| D14 | Owner cash planning (social charges, salary, what's left) moves from Excel into an owner-only dashboard widget — Growth phase. | Q4 |
| D15 | Roles: app superadmin, tenant admin (owner), accountant (read-only), editor (later). One real user today; RBAC through one `can()` function so CASL-style rules can be plugged in later. | Q7, 3.1 |
| D16 | Multi-tenancy by RLS kept as built; tenant-switcher polish and the second-tenant journey skipped. | Q6 (first round) |
| D17 | Background jobs: Postgres-backed queue (pg-boss) in the same container replaces Inngest. No external job service, no signing key; runs offline on the homelab. Settled 2026-10-20. | Q8 |
| D18 | Linking module owns the single `link` table; every other module registers as linkable; suggestions, graph and exports are read models. Invariants in DB and service. | your §10 |
| D19 | Layout: full-width app layout (collapsible sidebar, dense content, three page archetypes: list / entity / work). v2's centred `max-w-5xl` pages are replaced. See `ui-conventions.md`. | your UI feedback |
| D20 | Tables: one kernel `DataTable` with Excel-style typed header filters — server-side distinct values with counts, date hierarchy year→month→day, number ranges, text operators — state in the URL, column prefs per user. v1 `advanced-table` is the behaviour reference. See `ui-conventions.md`. | your UI feedback |
| D21 | Document numbers always start with the client code and year, then the type marker: invoices `VA26-INV-001`, quotes `VA26-QUO-001`, credit notes `VA26-CN-001` — one gap-free counter per client × year × type. Supersedes the `QUO26` / `CN-VA26` series of D5; the first cut (`VA26-001` / `-QT`) was revised to `INV` / `QUO` on the owner's word on 2026-10-20. | open-questions B1 |
| D22 | Quotes live in the invoice table (`type = quote`), valid 30 days by default, convert = copy into an invoice draft, PDF stored at issue. PDF money format `CHF 25'944.00` in every language, 2 decimals. | B2, B3 |
| D23 | Swiss VAT on invoices: reverse-charge sentence printed automatically for EU-business clients under the SE registration; CH-registration invoices to non-Swiss clients print the export line; declaration period derived from the issue date and overridable per invoice; every issued invoice counts. Acquisition tax (383) not applied by default (foreign SaaS is Swedish reverse charge, booked by the accountant), per-supplier-invoice flag if ever needed. Minimal `swiss_vat_declaration` record per quarter so "declared" is derived on each invoice. | B4, D-c, D-e |
| D24 | Contract rates: the rate valid on `period_start` applies (a change inside the period splits the line); the previous rate closes on `valid_from − 1`, overlaps rejected; `billing_rate` derived. Unit: enum `rate_unit` with the single value `day` on rate and invoice line — new units are an enum migration, never a code path. One contract per currency. | B5, B6, D-j |
| D25 | Banking: dedup key `sha256(account, date, amount, currency, sender, recipient, name, additional details, message)` + in-file occurrence index; `Balance` (end-of-day only) and `Own notes` excluded; `Date` and `Booking date` headers both accepted; rules match `Name`, `Additional details` and `Message`. Transfer pairs: `CHANGE CHFSEK` in details and message, CHF row negative, SEK row positive, implied rate = SEK ÷ CHF. Short-payment tolerance `delta ≤ max(0.05, 0.5 %)` → bank fees. Receipt allocation currency = invoice currency (DB constraint). | B7, B8, B9, D-a |
| D26 | Expenses: settlements FIFO by expense date with per-row override, residual stays open; exchange difference on cross-currency settlements → BAS 3960/7960 (accountant confirms); ~~card-FX expense = receipt amount in its currency + the bank row's SEK as base (rate source `bank`)~~ — superseded by D60 (F114, 2026-10-27): the expense keeps its own base at its date, the bank row's SEK sits on the link, the gap is the derived FX difference. Swiss VAT payments are expenses of kind `vat_payment`; no mileage; superseded statements kept with a flag. | B10, B11, D-e |
| D27 | "What a document became" is a link: kind `created_from` (expense / supplier_invoice → document), one origin per document (partial unique index), no fields on the document. One `links` table for every relationship stays the architecture (D18). | B12 |
| D28 | Supplier invoices: business key `SI{group}-{alias}-{seq}` (`SI213-Acc-01`), same per-group counter as expenses, stored file `{key}_{date}_{vendor}.pdf`; CH input VAT reclaimed (400) for purchases under the CH registration; no paying-account constraint (card = SEK account, FX like D26); cancel-not-delete in retention; "copy last month". | B13, D-g |
| D29 | Traktamente: rate year and half-day rule per calendar day; day trips nothing tax-free; meals as counts; night allowance dropped from the UI; the per-diem breakdown is its own PDF document. | B14, D-f |
| D30 | `document_type_prefixes` and `document_key_counters` dropped (migration `20261020200000_drop_v2_prefix_tables`). | B15 |
| D31 | Accountant package: `.xlsx` summary only; an invoice issued in June and paid in July appears in both months; no OCR line-item sheet; the savings CSV joins the package of the month it is imported in (December or January); a **year package** = the same generator over 12 months. | D-b, D-i |
| D32 | Documents: identical upload → `Use existing` (primary) / `Upload anyway` (owner); fuzzy duplicate ±1 % / ±7 days / same partner + currency, "Create anyway" on HIGH needs a note; OCR quality two levels; archive only inbox rows; keyboard map `j k x a o i e l d r z u ? Enter 1-3`. | D-d |
| D33 | A `justifies` link does **not** fill in a blank partner on the bank row's journal entry: the journal's partner stays typed (by hand or by a rule); the link is the answer to "who was this paid to". Reversible later as a read-side rule (2026-10-21). | — |
| D34 | A document leaves the inbox when it **became** something (`created_from`), was **filed** (reviewed with nothing created — *Mark as reviewed* and *Just file it* are the same fact) or was **archived**; no new status value (specs/documents, 2026-10-21). | — |
| D35 | A supplier's invoice number is **unique per supplier, no exception**: an *exact* match (same partner + normalised number) is a refusal with a link to the existing invoice, never *Create anyway*. *Create anyway* with a note stays for the *hash* (same file) and *fuzzy* (±1 % / ±7 days) matches. The unique index stays (O1, 2026-10-22; amends D32 and documents US3-2). | O1 |
| D36 | Deleting an expense or supplier invoice whose **only** link is its `created_from` removes that link (through linking) and the document returns to the inbox as *ready*, corrections kept, its key unchanged (keys are never reused). Any other link, a settlement line or a payment still blocks (a supplier invoice is cancelled instead). (O2, 2026-10-22; amends expenses US1-6 and supplier-invoices US1-8.) An `occurrence_of` link (a subscription's attribution, D57) goes with the entity like `created_from` (F94, 2026-10-26). | O2 |
| D37 | **Money facts of an open entity are a draft.** An expense's or supplier invoice's amount, base, rate (and, before F114, `paid_amount`) may change while it is open (edit before payment) until its **first allocating link** (since D60 — before: *first payment link or settlement line*; the attach / detach rewrite of base and rate is gone with D60); from then on a trigger locks them (`lock_money_when_linked`, F114), as the bank row's lock does for bank rows. The bank base stays written once at import. Constitution §1.6 amended (1.3, 1.4). Unblocks F58 (its small fix: the two linkables refuse a generic `justifies`, the linking inbox opens the module's own *Link payment*); F62's lock trigger follows this rule. (O3, 2026-10-22, the recommended option.) | O3 |
| D38 | **`expense_groups` is a shared reference.** `traktamente.trips.group_id` (Cascade) and `supplier_invoices.group_id` keep their real foreign keys; reads still go through `expenses.getGroup` (`index.ts`), not a Prisma relation include across modules. Constitution §2 amended (1.3): shared references are named there; adding one is a constitution PR. No migration. (O4, 2026-10-22, the recommended option.) | O4 |
| D39 | **Each tenant has its own base currency** (`tenants.currency`; SEK for AnalyticsFab AB). The constant `BASE_CURRENCY` goes: every base amount, `rateToBase(date, currency, base)`, Σ and tolerance is in the tenant's base, read once per request through tenancy. Chosen at tenant creation, **locked once the tenant has any money fact** (journal entry, invoice, expense, supplier invoice, settlement) — the company profile then shows it read-only; another base later = another tenant (bases are written once). Columns and comments called "SEK base" mean "base"; no rename, rows do not store it (one per tenant) — invoices' existing `base_currency` stays as the snapshot it is. Country rules keep their own currency and convert at the date's rate when the base differs: traktamente normalbelopp in SEK (Skatteverket), Swiss VAT in CHF. Constitution §1.4 amended (1.3). The work is F70. (O5, 2026-10-22 — the owner chose the *other* option over "a constant".) | O5 |
| D40 | UI visual direction **"Lakehouse"** (F39), picked by the owner on 2026-10-22 from four mockups (Ledger · Workbench · Paper · Lakehouse): inspired by the Databricks workspace UI — top bar with the logo and a centred search, grouped icon sidebar with **+ New**, a content canvas, breadcrumb + title row + underline tabs, a **docked details panel** of collapsible sections instead of the overlay sheet, states as **icon + word** (four families) and tags for metadata only, system font, blue `--primary` for actions, the brand crimson for the logo and + New only, light default with dark from the OS. Excel-style header filters stay (D20); active filters become filter buttons. The sidebar order follows the monthly loop: **Banking before Documents**. One money format in every UI language (`−2 312.43 SEK`). (D37–D39 are reserved for the owner's answers to O3–O5.) See `ui-conventions.md` *Visual direction*. **Built** in the shell and the kernel kit by F39 (2026-10-22): one formatter split in two — `formatMoney` for screens, `formatCurrency` kept for printed sheets; the side panel docks by the Sheet portalling into the canvas; four tokens a shade darker for 4.5:1; landmark names stay English. Modules adopt it in F71. F74 (2026-10-23) closed the kit: no English left in the DataTable popovers, selects never show a raw value, and the docked panel's open / hidden is remembered per table as a separate *Hide* (to a rail) — × / Escape still close the row. | F39 |
| D41 | ~~Rename pass (F46) stops at the app role~~ — **superseded by D42** the same day: the owner confirmed nothing is deployed anywhere. F46 renamed the superuser `defterfab` → `af`, the databases → `af_dev` / `af_test`, the dev compose volumes, the log `service`, the page title, the Azure example names. | F46 |
| D42 | **The app role is `af_app`, renamed in the existing migrations** (2026-10-22). One-off exception to forward-only migrations (constitution): no database exists outside the owner's laptop and CI's throwaway ones, so editing the applied migrations is cheaper than a rename migration (role names are cluster-wide; a `RENAME` migration collides with `prisma migrate dev`'s shadow replay). Cost: any existing local database is rebuilt once. From the first real deployment on, migrations are forward-only without exception. Mentions of **DefterFab / `defterfab` / the `defter` remote that name the v2 repository** stay — they are facts about another repo. | F46 |
| D43 | **A colour scheme in My Preferences: System / Light / Dark** (the owner, 2026-10-22 — amends D40's "no theme setting"). System (the default, stored as null) keeps D40: light, dark from the OS. The choice is the user's (`user_preferences.theme`, enum `theme_preference`), so it follows them to another browser; a cookie `af-theme` mirrors it so the root layout writes `<html data-theme>` in the first HTML (no flash, no session lookup there), and `ThemeSync` in the app layout fixes the cookie when the stored choice differs (a new browser). `globals.css`: the `dark:` variant and the dark tokens answer to the OS unless `data-theme="light"`, and to `data-theme="dark"`; the logo swaps by `dark:` too. | F75 |
| D44 | **A transfer leg is "no document needed" by its link, never by a flag** (F65, 2026-10-23, from audit 20 — amends the banking spec US3 scenarios 2 and 4, FR-010 / FR-011). Accepting a pair writes the `transfer` link and the foreign leg's bank implicit rate, nothing else; `deriveTransactionState` returns `no_document` for a row in a `transfer` link (what the workbench, the inbox and the accountant's sheet showed before). The legs keep `categorised_by` as it was, so rules still categorise them; unpairing returns the rows to their state before the pair. Same PR: an account's number and currency are locked once it has an import. | F65 |
| D45 | **Three process lanes, by risk** (the owner, 2026-10-23): FULL (spec-kit: specify → owner's read → tasks, plan only on a schema change) for a change to a business rule; LIGHT (a ticked task in the module's `tasks.md` + `docs/<module>.md` + tests) for a visible change with no rule change; DIRECT (tests only) for fixes, refactors, infra, docs. CI and the guards on every lane; `/speckit-converge` per module once its batch is built. Clarify / checklist / analyze / taskstoissues not used; MCP servers are a local-session extra, never relied on. Why: 44 rows built, 11 with a spec trail — the one heavy loop was skipped rather than right-sized. [[roadmap]] *How we work*. | owner, chat 2026-10-23 |
| D46 | **F70 parked: the base stays SEK in code until a second company needs another one** (the owner, 2026-10-23). D39 stays the rule (one base per tenant, locked with the first money fact); its build (9 PRs, no visible change for AnalyticsFab AB — spec SC-004) waits like F03. Instead a guard (F85): no new code may type a base `"SEK"` or add a `BASE_CURRENCY` use, so the cost of F70 later stays what it is today. The draft spec stays on `feat/settings-base-currency`. | owner, chat 2026-10-23 |
| D47 | **The reimbursement statement prints *owed*, like the app** (O6, the owner, 2026-10-23): a line's remaining under the owed tolerance (0.50 of the base, `owedBase`) prints 0.00, as the list, the ledger and the status show. One rule on screen and paper (F88). | owner, chat 2026-10-23 |
| D48 | **Drop the two unread columns now** (O7 + O8, the owner, 2026-10-23): `settlements.statement_superseded` (derived since F62) and `journal_entries.bank_implicit_rate` (derived from the `transfer` link since journal T005) with its lock-trigger clause, `setBankImplicitRate` and banking's write. Nothing real is lost — no real data is in the app yet (B1 not started). One forward-only migration (F86). | owner, chat 2026-10-23 |
| D49 | **Expenses stay merchant-level, with an optional partner** (the owner, 2026-10-23, amends the lessons' *Expense dialog: no partner* item): a restaurant, an airline, a hotel chain can be picked as the expense's partner, so spend per partner can be seen (the owner's reason: how much went to each restaurant, airline…), and the partner's default BAS pre-fills the category when the expense has none. Optional: an expense without a partner stays valid. FULL lane — spec first (F87). | owner, chat 2026-10-23 |
| D50 | **F87's spec questions** (the owner, 2026-10-23, `specs/expense-partner/spec.md`): Q1 → the expense dialog shows the supplier dialog's **match card** for the OCR merchant (*Use match* from 60 %, else *New vendor* pre-filled; nothing picked without a click); Q2 → the expense's partner is a **vendor** (a partner created from the dialog is one); Q3 → spend on the partner page = its **expenses only** (supplier invoices stay on their own list). | owner, chat 2026-10-23 |
| D51 | **The owner's real data never leaves his box** (the owner, 2026-10-24): it lives only on the box running the prod compose; no agent session connects to it; nothing real goes into the public repo, PRs, screenshots, artifacts, project docs or memory — fixtures and screenshots use seed / invented data, bug reports are reproduced with invented values; the box's only outbound traffic is image pulls, the ECB fetch, Azure DI in the region the owner chose (he accepted that the documents go there for OCR), Sentry off; the repo stays public (nothing real is ever in it). His infrastructure (hardware, network, VMs, regions, access) is private too — the runbook stays generic. Rules in `CLAUDE.md` *Real data*. | owner, chat 2026-10-24 |
| D52 | **The document type drives the reading** (the owner, 2026-10-24): changing a document's type on the review page re-runs the OCR with that type's model at once (corrections stay); the provisional key follows the type (`exp_20261024_002` ↔ `inv_20261024_002`, same date and number) until the document is reviewed or became something; the upload has no default type — the owner picks it before the upload starts. → F90 | owner, chat 2026-10-24 |
| D53 | **Billed to, checked** (the owner, 2026-10-24): an invoice's customer name and VAT number are read and shown; a warning when neither fits the company profile and its VAT registrations (a private or another company's invoice). A warning, never a block. → F89 | owner, chat 2026-10-24 |
| D54 | **Reverse charge, flagged only** (the owner, 2026-10-24): when the document says so (en "reverse charge", fr "autoliquidation", sv "omvänd skattskyldighet", de "Reverse-Charge"…) the document is flagged, editable by the owner, and the flag shows on what it becomes. No VAT computed — the treatment stays the accountant's (D23). → F89, F91 | owner, chat 2026-10-24 |
| D55 | **Several files, one type** (the owner, 2026-10-26): the upload takes several files at once (at most 50, more is refused as a whole); the type is chosen once and applies to every file; each file is uploaded exactly as one file is — its own provisional key, duplicate check and OCR job — and one file failing never blocks the others. The result is a list, one row per file. No batch entity, no batch status: the rows are the per-file outcomes. → F92 | owner, chat 2026-10-26 |
| D56 | **Global search composed at the app layer** (agent, F93, 2026-10-26, LIGHT lane): each module owns `search<Kind>Hits(tx, caller, q)` in its `search.ts`, exported from `index.ts`; the kernel holds only the shapes and pure rules (`kernel/search`) and the palette (`kernel/ui/shell`), which takes the action as a prop; `app/(app)/search.ts` lists the functions — no registry importing every module (the linking-cycle lesson). Ctrl P opens the same palette (one search). Built on the kit's `Dialog` (no `cmdk`). No trigram index until a measurement asks for one (≤ 30 ms p95 at the volume seed). → F93 | agent, PR F93 |
| D57 | **Subscriptions** (the owner, 2026-10-26, `specs/subscriptions/spec.md`): a recurring cost is described once (vendor, becomes expense or supplier invoice, BAS, group, payer, cadence monthly / yearly, dated expected prices with a tolerance, pauses, end) — expectations only, no money fact. Periods and their state are derived on read, never stored; attribution is a link `occurrence_of` (expense / supplier invoice → subscription). A matching card row or receipt / bill → **one confirm** creates the entity through its module; nothing is created, linked or attached without a click. Q1 A: a foreign-currency card charge waits for its receipt. Q2 B: one expense group per subscription by default. Q3 A: periods count from the start date. Q4 A: monthly bills (accounting firm, shared office) are supplier-invoice subscriptions, paid by transfer through the supplier-invoice flow; salary and Skatteverket stay banking rules. Rules keep writing the journal; a subscription never does. New module `modules/subscriptions`. → F94 | owner, chat 2026-10-26 |

| D58 | **The partner is derived from the proof** (the review 2026-10-26, reversing D33; folded into D59): a row's partner and BAS come from the justifying entity when none is typed; a rule-typed value wins. | [[review-2026-10-26]] §1.3 |
| D59 | **One transaction table** (the owner, 2026-10-27, [[audit-2026-10-27]] §2.3): the SEK base, rate, BAS, partner, note and the no-proof flag live on `bank_transactions`; `journal_entries` and manual journal entries are dropped (periodisation is the accountant's, D1); `/journal` is a read of the same rows or goes. One migration copies the columns. **Applied** (F113 PR A, `20261027120000_one_transaction_table`): the columns, the copy, the links re-pointed, the entries' trail appended onto the rows'; `/journal` and `modules/journal` went; `journal_entries` stays unread until PR B (D65). | audit A4 · B15 · C1 · B2 |
| D60 | **The link is the only payment record** (the owner, 2026-10-27): a `justifies` / `settles` link carries `allocated_amount`, `currency` and `allocated_base`; paid / open and the FX gain **or loss** are derived from Σ links, one rule for receivables, payables and reimbursements; `paid_amount`, `paid_currency`, `base_provisional`, settlement lines and `payment_sources` go — private payers are `bank_accounts` with `role = owner_private`. A deposit + a balance, or two receipts on one card row, are allowed. **Applied** by F114 PR 1 (`specs/linking/payment-record.md`): `allocated_amount` in the target's currency, `allocated_base` = what the row gave (same currency pro rata of the row's base, the exhausting link the exact remainder; another currency the row's remaining base; or stated); the entity's base at its date is never rewritten (`rate_source <> 'bank'`); `settlements` is the numbered statement over its refund row's `settles` links, its difference derived; `links_check_allocation` and `lock_money_when_linked` are the Postgres half; the migration recomputes the ECB base of every entity that carried a bank base, rewrites cross-currency links to the entity's currency with the row's base, and turns the private payment sources into `owner_private` accounts. D26's card-FX sentence and D37's wording are superseded accordingly. | audit A5 · A6 · A7 · A8 · A10 · A12 |
| D61 | **The homelab is the target** (the owner, 2026-10-27): a filesystem storage driver on the box (`STORAGE_DRIVER=fs`, a bind-mounted folder, `rsync` backups), Azure Blob the second driver; the browser gets a file only through an authenticated `GET /api/documents/[id]/file` — no SAS URL, `blob-proxy` deleted; sign-up closed once the owner exists, no organisation creation; admin by a CLI (`scripts/user.ts`); Sentry removed. Azurite stays for dev only. | audit §2.1 · D1 · D2 · D6 · D7 · D13 |
| D62 | **One language at build time** (the owner, 2026-10-27): new UI strings land in `en.ts` only; `fr` and `sv` fall back to `en` until one translation pass at the end; printed invoice strings keep their dictionaries. The `i18n` lock leaves the never-together rule. | audit §2.1 · E11 |
| D63 | **The FK ban is lifted** (the owner, 2026-10-27): cross-module references may be composite `(tenant_id, id)` foreign keys — FK checks bypass RLS (`cross-table-rls-spike.test.ts`), so the constitution's reason was wrong; `RESTRICT` by default, never a cascade across a module boundary; reads still go through the owner's `index.ts`. | audit §2.1 · A11 · D-§3 |
| D64 | **The review page is not a record** (the owner, 2026-10-27): the document page shows the OCR facts and the preview; the entity is the only place facts are edited; line items and the Category select go; once a document became an entity its page is read-only with *edit on the supplier invoice*. | audit §2.2 · C10 · review 1.3-b |
| D65 | ~~**B1 before features**~~ — **lifted by the owner the same evening (2026-10-27)**: features are dispatched again; B1 stays the next milestone, not a gate. Was: after the fix-now list (audit §3) and D59, the next milestone is one real month on the box, the package to the accountant, his reply compared line by line; no new feature row is dispatched before; a refactor PR rides only with an owner-visible change in its module. The Excel history is **not** imported (the owner, confirmed 2026-10-27). | audit E1 · E2 · E8 |
| D66 | **F114's three answers** (the owner, 2026-10-27): (1) an entity's base is the ECB at its own date; **the bank's amount is the truth of what was paid** — it sits on the link (`allocated_base`) — and the difference between the two (what ECB said, what the bank applied) is always shown: the FX difference on the panel, the list and the package; (2) a settlement's exchange difference is derived and signed, no confirmation; (3) private instruments live under Settings → Bank accounts. #318 merged on his word the same day; no manual journal entry exists on the box (the F113 migration's guard will pass). | `specs/linking/payment-record.md` |
| D67 | **F116's four answers** (the owner, 2026-10-27): the counterparty memory weighs 25 points and counts as a reference (memory + exact amount = HIGH); a vendor refund is proven by its credit-note document + a rule, the expense is not reduced; subscriptions get the rule shape now and the matcher runs on the one engine, the module's fate stays F104's (2026-11-30); a cross-currency candidate stays within 6 % of the ECB bases. | `specs/linking/one-engine.md` |
| D69 | **The OCR model follows the file, not only the type** (the agent's call, 2026-10-29, from the owner's first card-paid PDF read as a till receipt): an *expense* that is a PDF is read with the invoice model (vendor, VAT number, invoice number); the receipt model reads images. Refines D52: the type still decides, the file refines; a type change re-reads only when the model differs. | the owner's report 2026-10-29 · F124 |
| D71 | **A counterparty key is a who, never a which** (proposed 2026-10-30, on the owner's word): the per-transaction reference at the end of a card text (`#G169504312`, `* E0100ZW7M8`) is not part of the key; the stored keys and the rules made from such rows are recomputed once. Rules, the counterparty memory and the owner's history recur for the merchant. | the owner's report 2026-10-29 · F124 (6) |

---

## 2. Module map

```mermaid
flowchart TB
  subgraph kernel[Kernel — reuse from v2]
    auth[Auth + roles]
    tenancy[Tenancy / RLS]
    audit[Audit trail]
    money[Money + clock]
    storage[Blob storage]
    jobs[Job queue]
    ui[UI kit + locale]
  end

  subgraph modules[Modules]
    partners[Partners]
    contracts[Contracts + rates]
    documents[Documents + OCR]
    banking[Banking import]
    rates[Exchange rates]
    journal[Journal + BAS]
    linking[Linking]
    invoices[Quotes + invoices]
    supplier[Supplier invoices]
    expenses[Expenses + groups + reimbursement]
    travel[Traktamente]
    exports[Accountant package + declarations]
    dashboard[Dashboard]
  end

  partners --> contracts
  contracts --> invoices
  documents --> linking
  banking --> journal
  journal --> linking
  rates --> journal
  rates --> invoices
  rates --> expenses
  invoices --> linking
  supplier --> linking
  expenses --> linking
  travel --> expenses
  linking --> exports
  journal --> exports
  journal --> dashboard
  linking --> dashboard

  classDef reuse fill:#e1f5ee,stroke:#0f6e56,color:#04342c
  classDef harvest fill:#faece7,stroke:#993c1d,color:#4a1b0c
  classDef new fill:#eeedfe,stroke:#534ab7,color:#26215c
  class auth,tenancy,audit,money,storage,jobs,ui,partners,contracts,documents,banking,rates,dashboard reuse
  class invoices,supplier,expenses,travel,exports harvest
  class journal,linking new
```

Green = v2 code reused (after the four structural moves). Orange = rebuilt on the v2 foundation from v1 behaviour + Excel rules, harvested as specs and fixtures. Purple = new to the PRD, informed by v1's matching code.

---

## 3. Module by module

Verdict legend: **v2** keep v2 code · **harvest** rebuild on v2 foundation from v1 + Excel · **new** build to PRD · **drop**.

### 3.1 Auth, users, roles — v2

| | v1 | v2 |
|---|---|---|
| What | NextAuth v5 + CASL; `Permission` / `Role` / `RolePermission` / `UserTenant`; admin UI for users, roles, tenants | Better Auth 1.5; organisation = tenant; owner / accountant roles enforced in the action middleware; sidebar filtered by role |
| Keeps | superadmin (app-level), tenant admin, accountant read-only, editor later; admin pages for users and tenants (Epic 9) |
| Mechanism | CASL permission matrix → one `can(identity, action, subject)` in the kernel backed by a role map; guard test forbids role checks outside it. CASL can be plugged behind `can()` later without touching call sites |

### 3.2 Tenancy and isolation — v2

| | v1 | v2 |
|---|---|---|
| What | `tenantId` filter by convention; two audit rounds closed gaps | Postgres RLS, tenant-scoped client, `CallerIdentity` on every service call |
| Keeps | full isolation, two-tenant capability |
| Mechanism | filter-by-convention → RLS. Tenant-switcher polish and Journey 4 not built |

### 3.3 Partners — v2 + v1 contacts

| | v1 | v2 |
|---|---|---|
| What | `Partner` + `Contact`; separate clients / suppliers pages | `Partner` with `types[]`, org + VAT number, labelled external identifiers (supplier number etc.), soft-delete, tabbed entity view; pattern-setter module |
| Keeps | everything in v2 + contact persons + per-partner defaults (BAS category, currency, payment terms) + partner short code (`VA`) + 360° view: documents, transactions, invoices, supplier invoices, contracts |
| Mechanism | three pages → one partner hub filtered by type |
| Status | The reference slice (2026-10-20). **2026-10-21**: the entity page's *Transactions* and *Documents* tabs read the journal and the links (counts, the newest entries with a jump to the journal, the linked documents, a *Graph* button); the module's strings in the dictionary. **2026-10-22**: contact persons (name, role, e-mail, phone) on the *Contacts* tab — F08, `specs/partners/spec.md`. |

### 3.4 Contracts and rates — v2 + v1 rate history

| | v1 | v2 |
|---|---|---|
| What | `ClientRate` effective-dated (`lib/rates/lookup.ts`); `Project` budgets; `PriceList` / `PricingRule` / `ServiceCatalog` | `Contract`: client, date range, employee, rate, currency, payment terms, VAT rule, labelled external reference (PO) |
| Keeps | currency per contract (CHF / EUR / SEK), payment terms, PO and other labelled references, **rate history** (`ContractRate` valid_from / valid_to; 1 000 in 2025, 1 200 in 2026), rate stored immutably on each invoice line |
| Mechanism | price lists, pricing rules, service catalog, project budgets → dropped; one contract with dated rates |
| Status | **Built 2026-10-20** (phase 1, first slice): `contract_rates` with the exclusion constraint, `rateFor`, derived current rate, Rates section, en/fr — `docs/contracts.md`, `specs/contracts/`. `billing_rate` carried over and dropped (D24). |

### 3.5 Quotes and invoices — harvest

| | v1 | v2 |
|---|---|---|
| What | `Invoice` + `InvoiceV2` both live; lines, payments, credit notes, templates, period label, PO / contract / vendor-ID labels, en/fr, approval; `Quote` → invoice; puppeteer HTML templates | not built (Epic 10) |
| Keeps | quotes → invoices; lines (days × rate, discount); period label; PO number per invoice; partner and contract labelled identifiers printed; VAT per registration (CH 8.1 %, SE moms, reverse charge); credit notes referencing the original; en/fr/sv (sv dictionary 2026-10-21); logo; lifecycle draft → issued → sent → paid / credited; paid amount and delta derived from bank links; CH declaration period on each invoice; PDF downloadable any time |
| Mechanism | two models → one; 260-line numbering → `number_series` per `{client}{yy}`; separate preview and PDF → one component with edit / print modes, Chromium renders print mode; PDF generated once at issue and stored as a document; templates-of-invoices and approval step dropped; email sending not built (mark as sent) |
| Status | **Built 2026-10-20** (two PRs): model, totals, lifecycle, derived states, list read model; the one-layout sheet (edit / print), print route, PDF job, pages, en/fr — `docs/invoices.md`, `specs/invoices/`. |

### 3.6 Supplier invoices — harvest, own module

| | v1 | v2 |
|---|---|---|
| What | `SupplierInvoice` + lines + payments, posted to ledger | none |
| Keeps | a payable: document (OCR-reviewed) + partner + invoice number + due date + amount + currency + status unpaid / paid; due-date view on the dashboard; link to the paying bank transaction; VAT amount for declarations |
| Mechanism | ledger posting → category + link; lines only when a VAT split needs them; "paid" derived from the link, never typed |
| Status | **Built 2026-10-21**: model, `SI{group}-{alias}-{seq}` keys on the shared counter, partner payment terms, derived status with days overdue, payments as `justifies` links (same currency) or a D-g attach (the bank's base), cancel / uncancel, copy last, the stored-VAT read model, the list with KPIs, the panel, the new dialog, the group section, e2e — `docs/supplier-invoices.md`, `specs/supplier-invoices/`. |

### 3.7 Expenses, groups, reimbursement — harvest + Excel rules

| | v1 | v2 |
|---|---|---|
| What | `ExpenseClaim` + lines + categories + payments; reimbursement page; `CompanyPurchase`; `PayrollEntry` | PRD: manual journal entries for prepaid expenses and claims; reimbursement entry-to-entry linking (Epic 7.4) |
| Keeps | every cost the company bears: company-card purchases (Nordea rows), private purchases to be refunded, Swiss VAT payments, subscriptions; **groups** (`213 — Travel to CH in March 2026`, a month of subscriptions) with late additions; `paid by` ∈ {AF SEK account, AF CHF account, private SE, private CH}; status derived: paid / to refund / refunded; business key per expense; comments and `document_missing` flag |
| Mechanism | claim-per-expense → **owner liability ledger + settlements** (see below); `CompanyPurchase` → an expense paid from a company account; payroll → journal category with recurring templates |

Reimbursement model (your flow: 1 000 CHF paid privately, 900 refunded, maybe in SEK, rest stays in the company):

```mermaid
flowchart LR
  pe1[Hotel 600 CHF private] --> L[Owner liability ledger in SEK base]
  pe2[Transport 150 CHF private] --> L
  pe3[Meals 250 CHF private] --> L
  L --> S[Settlement: refund tx 9 700 SEK ↔ allocations]
  tx[Bank tx -9 700 SEK 'Zikrija'] --> S
  S --> open[Residual stays open on the ledger]
  S --> stmt[Generated reimbursement statement PDF]
```

- Each private expense carries its SEK base (ECB rate of its date). The liability ledger is the running sum of open SEK bases.
- A settlement links one refund bank transaction to a chosen set of private expenses with allocated SEK amounts (FIFO proposed, manual override). Partial amounts allowed; the unallocated remainder stays open — exactly the "leave some in the company" practice.
- Cross-currency refund (CHF expenses, SEK refund) nets in SEK base; the rounding goes to an exchange-difference category.
- The settlement generates a **reimbursement statement PDF** listing the expenses refunded — the justification document the refund transaction never had.

| | |
|---|---|
| Status | **Built 2026-10-20** (two PRs): groups, the four payment sources, expenses with keys per (group, alias), ECB / bank bases, derived status, the ledger, FIFO settlements with rounding / exchange difference, the statement job, linkables, the list read model; the pages (`/expenses`, groups, the group page, settle, settlements, the statement print route), en/fr — `docs/expenses.md`, `specs/expenses/`. · **F87 (2026-10-24, D49 D50)**: an optional partner (a vendor) per expense — the default category proposed never overwriting, the match card from a document, the Partner column + filter, the partner page's Expenses tab (`specs/expense-partner/`). |

### 3.8 Traktamente — harvest calculator, own module

| | v1 | v2 |
|---|---|---|
| What | `TravelAllowance` + rate importer (478 lines) + calculator (385) | none |
| Keeps | per-country, per-year normalbelopp table; trip = group with departure / return timestamps and country; **day count with the half-day rule** (departure after 12:00 / return before 19:00); meals paid separately entered per trip → deduction; night allowance; result = one `per_diem` expense in the group, refunded through the settlement flow |
| Mechanism | rate importer → a one-screen yearly table you maintain from Skatteverket's list |
| Status | **Built 2026-10-20** (with expenses): the normalbelopp table (CSV paste, copy a year), the pure calculator on the harvest's fixtures (half-day rule per calendar day, meals as counts, D29), the trip, the `per_diem` expense, the trip panel, the settings tab, the breakdown PDF job — `docs/traktamente.md`, `specs/traktamente/`. |

### 3.9 Documents and OCR — v2 + v1 extras

| | v1 | v2 |
|---|---|---|
| What | `Document` + polymorphic `DocumentLink` + `OcrResult`; inbox / process / queue; suggestion engine; duplicate detection; keyboard shortcuts and undo | upload + validation → blob → business key → async OCR → review overlay (line items, VAT) → library → retention; `documents.ts` 824 lines |
| Keeps | the whole v2 pipeline; business key as filename; duplicate detection; inbox UX (keyboard, undo); document types incl. `bank_statement`, `reimbursement_statement`, `invoice_pdf` |
| Mechanism | configurable prefixes → fixed key function (D6); `documents.ts` split into upload / review / library / retention (+ `inbox-writes.ts`, `ocr-payload.ts`; `documents.ts` is the barrel) — done in F50-c, 2026-10-22; links move to the linking module |
| Status | v2 pipeline + the library on the DataTable (2026-10-20). **2026-10-21, part 1** (`specs/documents/spec.md` US1–US3): *Make it…* on the review page (expense / supplier invoice / just file it, the dialogs pre-filled, the supplier match, *Became {key}*), the content hash and the upload duplicate card, the entity duplicate check (exact / hash / fuzzy; high blocks with a note) — `docs/document-review.md`, `docs/document-upload.md`. **Part 2** (US4): the inbox work page `/documents/inbox` — derived states (needs OCR / processing / stuck / OCR failed / ready / archived), tabs with counts, *Duplicate of*, archive + restore with a 20-step undo, OCR re-run, *Make it…* and bank-row links from the keyboard, the accountant read-only; the dashboard's *documents to review* = the inbox's count — `docs/document-inbox.md`. |

### 3.10 Banking — v2 + v1 rules

| | v1 | v2 |
|---|---|---|
| What | accounts, imports, transactions; modular CSV parsers; `CategorizationRule` + matcher; inbox / reconcile pages | app-level `BankFormat` library + `BankAccount` per tenant; `csv-parser.ts` with dedup hashing |
| Keeps | three Nordea accounts (SEK main, CHF main, savings) each with its own CSV import; dedup on re-import; counterparty key; learned categorisation rules (OPENAI → OpenAI, MSFT → Microsoft); bank fees auto-categorised with `no_document_needed`; **transfer pairs** (`CHANGE CHFSEK`) detected and linked, bank implicit rate captured |
| Mechanism | three pages → one transactions workbench with filters; reconcile page → linking module |
| Status | **Built 2026-10-20** (phase 1, part 1): import with the D25 dedup key, immutable transactions, categorisation rules (defaults on the first import), transfer pairs, derived state, linkable — `docs/banking.md`, `specs/banking/`. Part 2 (pages) next. The scored suggestions / inbox belong to the linking UI. |

### 3.11 Exchange rates — v2

| | v1 | v2 |
|---|---|---|
| What | ECB sync + converter + admin page with manual rates | `EcbRate` + SDMX fetch + gap detection + `Clock` |
| Keeps | daily ECB rates, weekend / holiday fallback, gap flag > 3 days, rate immutable per entry; manual override on the entry only |
| Mechanism | admin page + table-level manual rates → scheduled job + dashboard flag |
| Status | **Built**: the ECB sync job (weekdays 16:30 Stockholm, catch-up on start), `rateToBase` everywhere, the dashboard's gap item. **2026-10-21**: Settings → Exchange rates (coverage per pair, *Fetch now* queues the job), `scripts/fetch-rates.ts` — `docs/ecb-rates.md`. **2026-10-22**: the script backfills from a date (`fetch-rates.ts 2023-04-01`, F29). |

### 3.12 Journal and BAS — new to PRD

| | v1 | v2 |
|---|---|---|
| What | double-entry: journal lines, chart of accounts, VAT codes, fiscal years, posting service (612) | PRD: chronological ledger of financial events with BAS category, flags, notes, filters; BAS preferences done |
| Keeps | every bank transaction becomes a journal entry (SEK base, rate, source); manual entries for prepaid / forfait; recurring templates (salary, Skatteverket); BAS category per entry with partner defaults; filters by period / currency / partner / category / VAT registration |
| Mechanism | double-entry → categorised single-entry journal; SIE export out of scope (needs debit/credit) |
| Status | **Built 2026-10-20** (with banking part 1): `journal_entries` with the money facts locked by trigger, categorise with the never-overwrite rule, manual entries, the ledger read model — `docs/journal.md`, `specs/journal/spec.md`. Recurring templates = categorisation rules (no template table). Page next. |

### 3.13 Linking — new, informed by v1

| | v1 | v2 |
|---|---|---|
| What | `matching.ts` 1 738 lines + 643 test lines: per-entity candidate finders, amount / cross-currency tolerance, date window, reference in bank text, partner name → HIGH / MEDIUM / LOW with reasons; `@xyflow/react` graph; three payment-allocation tables | Epic 7 backlog |
| Keeps | scored suggestions with reasons; one transaction ↔ many invoices and the reverse; tolerance for short payments and bank fees; link kinds: `justifies` (tx ↔ document / invoice / supplier invoice / expense), `transfer` (tx ↔ tx), `settles` (tx ↔ settlement), `belongs_to` (document ↔ partner / contract); unlinked transactions and unlinked documents views; relationship navigation; graph view |
| Mechanism | three finders → one generic finder over registered linkables; three allocation tables → one `link` table with `allocated_amount`; graph = read model; DB-level invariants (allocation ≤ amount, no delete while linked in retention), audit on every link / unlink; v1 tests → fixtures; property-based tests on allocation math |
| Status | **Built 2026-10-20** (part 1): the one scorer on v1's fixture (one rule set, both directions), candidates through the linkable registry (`facts` / `candidates` / `search`), suggestions for a bank row and for an entity, apply with the proposed allocation, bulk apply HIGH with the skip reasons, *Link to…*, *Unlink*; on the banking panel and the invoice page; the inbox work page (`/banking/inbox`: rows best-candidate first, the keyboard `j k Enter 1–9 l c u ?`, *Apply HIGH* with its report, the unlinked documents tab) — `docs/linking.md`, `specs/linking/`. **Part 2 (2026-10-21)**: the graph read model — `neighbourhood` over the link table (BFS, two hops, capped), the radial picture + the ring list with *Graph* / *Open*, `/links/<type>/<id>` from the *Graph* button next to every *Links* heading, `?open=<id>` on the expenses / supplier-invoices / banking lists. **Complete.** |

### 3.14 Dashboard — v2

| | v1 | v2 |
|---|---|---|
| What | dashboard; `EventLog` + `Notification` + preferences (991 lines) | business-pulse + action-items shell; FR29–31 |
| Keeps | briefing since last visit; action items: documents to review, unlinked transactions, supplier invoices due, open liability to owner, rate gaps; accountant view; **owner cash-planning widget** (D14, Growth) |
| Mechanism | notification system → audit-trail-driven briefing |
| Status | **Built 2026-10-20**: the to-do list (bank lines to justify, documents to review, unlinked documents, supplier invoices overdue / due, client invoices overdue, the liability, receipts missing, ECB gaps, last month's package, last quarter's Swiss VAT) with counts, amounts and the page that resolves each; the pulse (balances, receivables, payables, owed to the owner, invoiced this year); the briefing from the audit trail since the last login — `docs/dashboard.md`. The cash-planning widget (D14) stays Growth. |

### 3.15 Reports, exports, declarations — harvest, reframed

| | v1 | v2 |
|---|---|---|
| What | P&L, balance sheet, VAT report, SIE, Swiss VAT return prep with FTA form mapping | Epic 10 backlog |
| Keeps | monthly accountant package (D13) with a generated summary; Swiss VAT quarterly prep (form-field mapping, H6); Swedish moms prep; SCB filters; management P&L from categories if cheap |
| Mechanism | statutory statements and SIE → dropped; package = zip built from a read model |
| Status | **Package built 2026-10-20**: `/package` with the months' live counts and flags (the month-end checklist), the build job (`package.build`), `Package_2026-06.zip` (`_v2` on rebuild) with the statements per account, every document under its business key, `summary.xlsx` and `notes.md`; the year package (D31) — `docs/accountant-package.md`, `specs/accountant-package/`. **Swiss VAT return built 2026-10-20**: `/exports` with the FTA form from the stored declaration periods and input VAT, the manual refs, Declare / Mark paid (`swiss_vat_declarations`, D23), the derived *declared* chip on invoices, the CSV — `docs/exports.md`, `specs/exports/`. Swedish moms stays with the accountant (the package). |

### 3.16 Settings — v2 minus prefixes

Keeps tenant profile, VAT registrations with rate schedules, bank accounts + formats, BAS preferences (active, favourites, aliases, translations), personal locale, table preferences, app-level admin (currencies, bank formats, rate source). Drops `DocumentTypePrefix`. Adds traktamente table, invoice series, recurring entry templates.

### 3.17 Dropped from v1

Time tracking and `Project` budgets, `PriceList` family, `ServiceCatalog`, `PricingRule`, `PayrollEntry` module, `Tag` / `EntityTag`, `Notification` system, `DimDate`, `table-test`, `expenses/test-upload`, `admin/debug`, second invoice model, two generations of translation files, the 3 112-line `lib/validation` (validation at each module's action boundary instead).

---

## 4. Cross-cutting

| Concern | v1 | v2 | v3 |
|---|---|---|---|
| Money | Decimal + helpers; SEK literals removed by audit | Decimal through services, number at display; `.toNumber()` lint rule (Biome plugin, F48) | v2 + the lint rule |
| Dates | mixed | `Clock`, TIMESTAMPTZ, sv-SE display | v2 |
| Validation | one 3 112-line lib | Zod 4 at the action boundary | v2 |
| Errors | throw `AuthError` | return `AppError`, never throw from actions | v2 |
| Audit | `EventLog` | append-only `AuditLog` with provenance | v2 |
| Jobs | none dedicated | Inngest (OCR) | pg-boss in-container (D17, settled): OCR, ECB sync, PDF, package build |
| PDF | puppeteer, same HTML as preview | none | Chromium from the print mode of the invoice component; reimbursement statement and package summary the same way |
| OCR | Azure DI, sync | Azure DI, async job, review overlay | v2 |
| Storage | Azure Blob | Azure Blob + Azurite, blob proxy | v2 |
| UI kit | shadcn, TanStack Table, `advanced-table` filters | shadcn, `DataTable`, Zustand tenant stores, `LocaleProvider`, centred pages | v2 kit + v1 filter behaviour (H13); full-width layout (D19); per-user column layout on every list (order, width, visibility — `table_preferences`, 2026-10-21); i18n keys from day one — en, fr and sv dictionaries complete for the signed-in UI (2026-10-21) |
| Testing | Jest + 129 e2e | Vitest co-located + Playwright + architecture guard + factories | v2 + flaky-test quarantine + property tests on money and allocations |
| CI / deploy | GH Actions, App Service, SQL Server | GH Actions with Azurite e2e, Docker, Container Apps | v2 (+ Chromium in the image). **Since 2026-10-20**: CI publishes the app image and a one-shot migrate image to `ghcr.io` on every main push; the homelab pulls by tag (`docker-compose.prod.yml`), backups + restore drill, `/api/health`; the Azure job is written, disabled until provisioned — `docs/deployment.md` |
| Docs | large plan documents | `docs/index.md` wiki per pattern | v2 convention + spec-kit specs |
| Observability | logger | pino + Sentry, request context partly deferred | v2 |

---

## 5. What each version got right — and the trap

**v1 right:** invoices that look right (one HTML for preview and PDF), effective-dated rates, scored matcher with reasons and real tests, polymorphic document link, Swiss VAT mapping, a graph people click.
**v1 trap:** scope — 70 models, pricing engines, payroll, time tracking, notifications; two invoice models mid-migration; isolation by convention.

**v2 right:** RLS, a service layer that cannot import the framework (and proves it), audit with provenance, Decimal and clock discipline, documents pipeline with a real review UI, CI with emulators, docs wiki, a PRD whose scope is still correct.
**v2 trap:** ceremony and configurability — four prep sprints and six retros for five epics; settings pages for constants; 100 % of the budget before the first business feature.

**Excel right:** groups, business keys, `paid by`, the transfer pair, the half-day rule, monthly rhythm. **Excel trap:** statuses typed by hand, links held in a text column, supplier invoices mixed with claims.

v3: v2's constraints, v1's appetite, the Excel's rules, and one guard — a setting exists only when two tenants need different values today.

---

## 6. Harvest list → specs

| # | Spec | Source |
|---|---|---|
| H1 | Invoice + credit note model, lifecycle, quote → invoice, series per client-year | v1 `InvoiceV2`, `Quote`, `app/api/invoices`; Excel *Income* |
| H2 | Invoice component (edit / print), en + fr strings, Chromium PDF, stored at issue | v1 `lib/pdf/*` |
| H3 | Match scoring rules + fixtures | v1 `lib/banking/matching.ts` + tests |
| H4 | Learned categorisation / counterparty mappings | v1 `categorization-*.ts`; Excel *Column1* |
| H5 | Contract rate history | v1 `lib/rates/lookup.ts` |
| H6 | Swiss VAT return field mapping + declaration period per invoice | v1 `swiss-vat-types.ts`, `docs/features/swiss-vat-declaration.md`; Excel *VAT Declaration* |
| H7 | Duplicate detection + inbox UX | v1 `duplicate-entity-detection.ts`, last `documents/inbox` commits |
| H8 | Expenses, groups, owner liability ledger, settlements, reimbursement statement | v1 `ExpenseClaim*`, `expenses/reimburse`; Excel *Expenses*; your flow |
| H9 | Traktamente: normalbelopp table, half-day rule, meal deductions | v1 `travel-allowance/calculator.ts`; Excel *Travel Details* |
| H10 | Supplier invoices as payables | v1 `SupplierInvoice*` |
| H11 | Banking: three-account import, transfer pairs, bank fees rule | v2 `csv-parser.ts`; Excel *Bank Statement* |
| H12 | Accountant package: monthly zip + generated summary | Excel (all three sheets) + D13 |
| H13 | DataTable header filters: checkbox distinct values, date hierarchy, number range, text operators, toolbar | v1 `components/advanced-table/*`, `app/api/*/available-values` routes |

---

## 7. Remaining open points

None. The harvest questions (B1–B15, D-a–D-j) were answered on 2026-10-20 and are D21–D32 above; the full question / answer / decision table is `open-questions.md`. Two items still wait for the accountant's confirmation, not for a decision: the BAS pair for exchange differences on settlements (D26) and whether any purchase ever falls under CH acquisition tax (D23).
