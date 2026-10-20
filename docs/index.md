# AF Documentation

Business administration for AnalyticsFab AB — documents, bank imports, journal, invoices, expenses, linking, monthly accountant package.

## Phase 0 — read first

- [[constitution]] — Rules, import boundaries, linking invariants, portability, definition of done, process
- [[feature-inventory]] — v1 vs v2 vs Excel: scope, decisions D1–D18, module verdicts, harvest list
- [[excel-to-v3-mapping]] — The owner's tracking Excel mapped column by column to the v3 model
- [[phase-0]] — Status board of the organisation work before the first business feature
- [[feature-folders]] — The kernel / modules layout (3a): what lives where, rules enforced now, v2 → 3a path map
- [[linking]] — The single link table (3c): kinds matrix, invariants in service and database, how a module becomes linkable
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
- [[local-environment-setup]] — Prerequisites, quick start, and service verification
- [[environment-variables]] — Required env vars and their purpose
- [[docker-compose]] — Local development services (PostgreSQL, Azurite); `docker-compose.prod.yml` + `scripts/backup.sh` for the prod-like stack (4.5)
- [[deployment]] — Azure Container Apps deployment patterns
- [[ci-cd]] — CI/CD pipeline, Docker, E2E testing, and recovery runbook

## Pages

Page-specific documentation and patterns.

- [[dashboard]] — Route config, locale resolution, page archetypes, toast infrastructure
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
- [[traktamente]] — Skatteverket's normalbelopp table (paste the CSV, copy a year), the pure day-count / per-diem calculator (half-day rule per calendar day, meals as counts, D29), the trip of a trip group, the `per_diem` expense
- [[invoices]] — quotes, invoices, credit notes on one table: Decimal totals (VAT once per rate), issue (number, ECB base, declaration period, snapshot, DB lock), derived paid/overdue/credited, ListQuery read model; the one-layout sheet (edit / print), the print route, the PDF job, the pages
- [[contracts]] — contract rate history (D24): non-overlapping dated rates, `rateFor(contract, date)`, derived current rate, auto-close, the Rates section; first module on the kernel string dictionary
- [[contract-pattern]] — (v2 history) Child entity pattern, dual self-referential FK; its Decimal `billing_rate` pipeline is superseded by [[contracts]]
- [[entity-view-pattern]] — Tabbed entity detail page pattern, persistent header, empty state stubs
- [[document-upload]] — Document upload pipeline, file validation, business key generation, status lifecycle
- [[document-review]] — Document review & correction, corrections overlay, dual-pane UI, role-based access
- [[document-library]] — Document library page, paginated table, filters, download, stats bar, DataTable component

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
