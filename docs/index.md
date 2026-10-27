# AF Documentation

Business administration for AnalyticsFab AB — documents, bank imports with the categorised rows, invoices, expenses, linking, monthly accountant package.

## Phase 0 — read first

- [[audit-2026-10-27]] — The in-depth independent audit: five auditors (domain & money, ingestion, UI/UX, tech / security / tests, scope & process), ~70 findings with `file:line`, what would have been built differently in four dimensions, fix-now, cut / freeze, the order, the decisions D59–D65 for the owner
- [[review-2026-10-26]] — The owner's first-real-use review: document-first vs transaction-first, the Justify panel from the bank row, the picker, two vendors / D33 reversed, subscriptions on probation, the proofs mailbox, AI on the homelab, stop / start / keep
- [[features]] — The flat table: one row per feature with its module, status (built / partial / planned / later / dropped / owner), what is left, the shared files it touches and its size — for dispatching work to agents
- [[lessons]] — Findings of the 2026-10-20 → 21 build with their actions: process (e2e ownership, CI logs, the cloud session's environment), code (load cycles through the linking registry, link reads), product gaps, how to work with the agent
- [[roadmap]] — What is done, what is left to a first real version, what is next, how we work (the spec-kit loop as applied, self-merge when green, the local test loop)
- [[constitution]] — Rules, import boundaries, linking invariants, portability, definition of done, process
- [[feature-inventory]] — v1 vs v2 vs Excel: scope, decisions D1–D40, module verdicts, harvest list
- [[ui-conventions]] — Layout (three archetypes, full width), the visual direction "Lakehouse" (D40: tokens light + dark, type, one money format, states vs tags, shell, page anatomy, the docked details panel), the Excel-style DataTable and `ListQuery`, i18n; its checklist form is the `af-design` skill
- [[excel-to-v3-mapping]] — The owner's tracking Excel mapped column by column to the v3 model
- [[feature-folders]] — The kernel / modules layout (3a): what lives where, rules enforced now, v2 → 3a path map
- [[linking]] — The single link table (3c): kinds matrix, invariants in service and database, how a module becomes linkable; the one scorer and the suggestions both ways (candidates through the registry, apply / bulk apply, *Link to…*), on the banking panel and the invoice page; the inbox work page with the keyboard and *Apply HIGH*
- [[authorization]] — `can()` and the role table (4.2): roles, actions, subjects, where checks live

## Architecture

Technical decisions, stack choices, and system design patterns.

- [[architecture-decisions]] — Post-commit side-effect pattern, future ADRs
- [[prisma-rls-setup]] — Multi-tenant RLS with Prisma 7, tenant-aware client, migration workflow
- [[cross-table-rls]] — Cross-table FK behavior under RLS, service-level FK validation pattern (Epic 4 spike)
- [[auth-setup]] — Better Auth 1.5 configuration, organization-to-tenant mapping, session management
- [[tenant-management]] — Tenant profile, dual-model pattern, tenant switching, seed data
- [[audit-trail]] — Immutable audit trail, source provenance, opt-in service pattern
- [[observability]] — Pino structured logging, Sentry error tracking, log levels, request-scoped context

## Patterns

Reusable code patterns and development conventions.

- [[conventions]] — Commit conventions, branching strategy, naming standards
- [[server-actions]] — Middleware chain, RBAC, error handling, and testing guide
- [[decimal-currency]] — Decimal arithmetic, currency formatting, boundary rule
- [[clock-and-rates]] — Clock abstraction, timezone rules, ECB rate storage
- [[ecb-rates]] — ECB SDMX API fetching service, XML parsing, gap detection
- [[csv-parsing]] — Bank CSV parsing service, Nordea format, dedup hashing
- [[zustand-stores]] — Tenant-scoped Zustand store pattern with auto-reset
- [[middleware]] — Auth gating strategy (proxy.ts session cookie checks)

## Configuration

Environment setup, settings, and deployment configuration.

- [[project-scaffold]] — Tech stack, development commands, project structure
- [[local-environment-setup]] — Prerequisites, quick start, and service verification · cloud sessions: `scripts/dev-env.sh` / `scripts/dev-env.md`
- [[environment-variables]] — Required env vars and their purpose
- [[deployment]] — the runbook: the images CI publishes (app + one-shot migrate), the homelab stack (`docker-compose.prod.yml`, update by tag, Caddy for TLS), backups and the restore drill, `/api/health`, the Azure path (scale to zero, ≈ €17–20)
- [[ci-cd]] — CI/CD pipeline, Docker, E2E testing, and recovery runbook

## Pages

Page-specific documentation and patterns.

- [[dashboard]] — Route config, locale resolution, page archetypes, toast infrastructure
- [[search]] — the Ctrl K palette (F93): each module's `search<Kind>Hits`, composed in the app layer (no registry), amount formats, ranking, the volume measurement; af-design: kit `Dialog`, combobox a11y, landmark names stay English
- [[bas-categories]] — BAS kontoplan reference data, no-RLS shared data pattern, natural key, sparse preferences
- [[vat-registrations]] — Multi-country VAT registration management, rate schedule JSONB, auto-save pattern
- [[bank-accounts]] — Bank account configuration with CSV format library, two-table pattern, multi-currency accounts
- [[numbering]] — number_series (gap-free, row-locked) and the fixed key functions: invoice numbers, expense refs, upload keys (D5, D6)
- [[user-preferences]] — Personal locale preferences, format utilities, LocaleProvider context
- [[partners]] — the reference slice (phase-0 item 6): module layout, ListQuery read API, DataTable list page, entity page, the tests that define it
- [[partner-crud-pattern]] — (v2 history) Domain entity CRUD pattern-setter: schema, service, actions, pages, soft-delete, FK validation
- [[banking]] — Nordea import (D25 dedup, `Date` header, counterparty key), the row with its facts (F113, D59: the SEK base written once, category · partner · note · no-document-needed changed freely, the never-overwrite rule), categorisation rules (first hit wins, never over a hand-set fact), transfer pairs (`CHANGE CHFSEK` → one `transfer` link + the bank implicit rate), derived open/partial/linked/no-document state, ListQuery read model
- [[journal]] — (superseded by F113) the categorised ledger as it was: one entry per bank transaction, the rules the row inherited
- [[expenses]] — groups (`213 — …`), the payers (main accounts and the owner's private instruments, F114), expenses with keys `Ex213-Tr-01` and SEK bases written once at their date, status derived from the `justifies` / `settles` links (D60), the owner's liability ledger, FIFO settlements `ST26-001` — the statement over the refund row's links, rounding / FX difference derived —, the reimbursement statement job, linkables
- [[supplier-invoices]] — payables keyed like expenses (`SI213-Acc-01`, the shared per-group counter, D28), vendor partners with payment terms, derived unpaid / partially paid / paid / overdue, payments as `justifies` links in any row currency (instalments, rounding note; the row's base on the link, the FX difference derived — F114 / D60), cancel-not-delete, the stored-VAT read model for the declarations, the list with KPIs and the panel
- [[subscriptions]] — recurring costs described once (F94, D57): expectations only, periods and their state derived, a matching card row / receipt / bill → one confirm through the owning module, `occurrence_of` links; rules keep the journal
- [[accountant-package]] — the month (or year) as one zip generated from the links (D13, D31): statements per account, every document under its business key, `summary.xlsx` (seven sheets, derived statuses), `notes.md` with the flags; the build job, versions, the `/package` month-end checklist
- [[exports]] — the Swiss VAT return (FTA form ref by ref from the stored declaration periods and the stored input VAT, the v3 corrections of H6, the CSV) and the declaration record (manual refs, declared / paid, derived *declared* on every invoice, D23)
- [[traktamente]] — Skatteverket's normalbelopp table (paste the CSV, copy a year), the pure day-count / per-diem calculator (half-day rule per calendar day, meals as counts, D29), the trip of a trip group, the `per_diem` expense
- [[invoices]] — quotes, invoices, credit notes on one table: Decimal totals (VAT once per rate), issue (number, ECB base, declaration period, snapshot, DB lock), derived paid/overdue/credited, ListQuery read model; the one-layout sheet (edit / print), the print route, the PDF job, the pages
- [[contracts]] — contract rate history (D24): non-overlapping dated rates, `rateFor(contract, date)`, derived current rate, auto-close, the Rates section; first module on the kernel string dictionary
- [[contract-pattern]] — (v2 history) Child entity pattern, dual self-referential FK; its Decimal `billing_rate` pipeline is superseded by [[contracts]]
- [[entity-view-pattern]] — Tabbed entity detail page pattern, persistent header, empty state stubs
- [[document-upload]] — Document upload pipeline, file validation, business key generation, status lifecycle
- [[document-review]] — Document review & correction, corrections overlay, dual-pane UI, role-based access
- [[document-library]] — the library on the kernel DataTable: the ListQuery read model (OCR facts as corrected, linked), the role base, Download / Delete, the upload zone
- [[document-inbox]] — the documents work page `/documents/inbox`: derived inbox states, tabs + counts, duplicates, archive / restore with undo, OCR re-run, Make it… from the keyboard, the accountant read-only

## Components

UI component documentation and design system.


## Services

Backend service documentation and API contracts.

- [[test-performance-baseline]] — Test suite performance baseline and monitoring thresholds
- [[config-page-test-template]] — Reusable test structure for config CRUD pages (Stories 3.1–3.4)
- [[auto-save-pattern]] — Comprehensive auto-save form pattern reference (8 edge cases)
- [[blob-storage]] — Azure Blob Storage service, Azurite setup, test patterns
- [[async-jobs]] — pg-boss in-process queue (D17): JobDefinition, withJobContext, retries + dead letter, schedules with catch-up, pgboss schema migration
- [[pdf]] — kernel/pdf: Chromium in the image, print routes + print tokens, renderPathToPdf / renderHtmlToPdf
- [[verify-gate]] — what runs on a PR and on main (lint, typecheck, drift check, tests, build, e2e + page screenshots), flaky quarantine, DoD mapping
- [[ocr-processing]] — OCR service interface, Azure DI integration, resumable process-document job, quality classification
