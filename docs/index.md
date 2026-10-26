# AF Documentation

Business administration for AnalyticsFab AB — documents, bank imports, journal, invoices, expenses, linking, monthly accountant package.

## Phase 0 — read first

- [[features]] — The flat table: one row per feature with its module, status (built / partial / planned / later / dropped / owner), what is left, the shared files it touches and its size — for dispatching work to agents
- [[lessons]] — Findings of the 2026-10-20 → 21 build with their actions: process (e2e ownership, CI logs, the cloud session's environment), code (load cycles through the linking registry, link reads), product gaps, how to work with the agent
- [[roadmap]] — What is done, what is left to a first real version, what is next, how we work (the spec-kit loop as applied, self-merge when green, the local test loop)
- [[constitution]] — Rules, import boundaries, linking invariants, portability, definition of done, process
- [[feature-inventory]] — v1 vs v2 vs Excel: scope, decisions D1–D40, module verdicts, harvest list
- [[ui-conventions]] — Layout (three archetypes, full width), the visual direction "Lakehouse" (D40: tokens light + dark, type, one money format, states vs tags, shell, page anatomy, the docked details panel), the Excel-style DataTable and `ListQuery`, i18n; its checklist form is the `af-design` skill
- [[excel-to-v3-mapping]] — The owner's tracking Excel mapped column by column to the v3 model
- [[phase-0]] — Status board of the organisation work before the first business feature
- [[feature-folders]] — The kernel / modules layout (3a): what lives where, rules enforced now, v2 → 3a path map
- [[linking]] — The single link table (3c): kinds matrix, invariants in service and database, how a module becomes linkable; the one scorer and the suggestions both ways (candidates through the registry, apply / bulk apply, *Link to…*), on the banking panel and the invoice page; the inbox work page with the keyboard and *Apply HIGH*
- [[authorization]] — `can()` and the role table (4.2): roles, actions, subjects, where checks live

## Architecture

Technical decisions, stack choices, and system design patterns.

- [[architecture-decisions]] — Post-commit side-effect pattern, future ADRs
- [[tech-stack]] — Languages, frameworks, and library versions
- [[data-model]] — Database schema, relationships, and RLS policies
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
- [[error-handling]] — Typed error codes and response patterns
- [[hexagonal-architecture]] — Import boundaries and service isolation (paths updated for the 3a layout; see [[feature-folders]])
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
- [[banking]] — Nordea import (D25 dedup, `Date` header, counterparty key), immutable transactions, categorisation rules (first hit wins, never over a hand-set fact), transfer pairs (`CHANGE CHFSEK` → one `transfer` link + the bank implicit rate), derived open/partial/linked/no-document state, ListQuery read model
- [[journal]] — the categorised ledger (D3): one entry per bank transaction or by hand, SEK base written once (ECB / same currency / manual), category · partner · note · no-document-needed, the never-overwrite rule, the ledger list
- [[expenses]] — groups (`213 — …`), the four payment sources, expenses with keys `Ex213-Tr-01` and SEK bases (ECB; the bank row's once attached, D26), derived status, the owner's liability ledger, FIFO settlements `ST26-001` with rounding / exchange difference, the reimbursement statement job, linkables
- [[supplier-invoices]] — payables keyed like expenses (`SI213-Acc-01`, the shared per-group counter, D28), vendor partners with payment terms, derived unpaid / partially paid / paid / overdue, payments as `justifies` links (instalments, rounding note) or a cross-currency attach with the bank's base (D-g), cancel-not-delete, the stored-VAT read model for the declarations, the list with KPIs and the panel
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

- [[shadcn-ui]] — Component library usage and customization
- [[domain-components]] — Business-specific UI components
- [[shared-components]] — Loading states, empty states, dialogs

## Services

Backend service documentation and API contracts.

- [[business-logic]] — Service layer patterns and responsibilities
- [[external-integrations]] — Azure DI, Blob Storage, ECB
- [[testing]] — Test architecture, fixtures, and coverage strategy
- [[test-performance-baseline]] — Test suite performance baseline and monitoring thresholds
- [[config-page-test-template]] — Reusable test structure for config CRUD pages (Stories 3.1–3.4)
- [[story-creation-checklist]] — Mutation story checklist, pattern-setter flag, retro gate check
- [[auto-save-pattern]] — Comprehensive auto-save form pattern reference (8 edge cases)
- [[blob-storage]] — Azure Blob Storage service, Azurite setup, test patterns
- [[async-jobs]] — pg-boss in-process queue (D17): JobDefinition, withJobContext, retries + dead letter, schedules with catch-up, pgboss schema migration
- [[pdf]] — kernel/pdf: Chromium in the image, print routes + print tokens, renderPathToPdf / renderHtmlToPdf
- [[open-questions]] — the owner's decisions pending from the harvest (blocking vs during-the-build), with proposals
- [[verify-gate]] — what runs on a PR and on main (lint, typecheck, drift check, tests, build, e2e + page screenshots), flaky quarantine, DoD mapping
- [[ocr-processing]] — OCR service interface, Azure DI integration, resumable process-document job, quality classification
