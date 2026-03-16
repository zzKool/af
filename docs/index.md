# DefterFab Documentation

Secretary-General for solo Swedish AB business administration.

## Architecture

Technical decisions, stack choices, and system design patterns.

- [[architecture-decisions]] — Key architectural decisions and rationale
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
- [[hexagonal-architecture]] — Import boundaries and service isolation
- [[decimal-currency]] — Decimal arithmetic, currency formatting, boundary rule
- [[clock-and-rates]] — Clock abstraction, timezone rules, ECB rate storage
- [[zustand-stores]] — Tenant-scoped Zustand store pattern with auto-reset
- [[middleware]] — Auth gating strategy (proxy.ts session cookie checks)

## Configuration

Environment setup, settings, and deployment configuration.

- [[project-scaffold]] — Tech stack, development commands, project structure
- [[local-environment-setup]] — Prerequisites, quick start, and service verification
- [[environment-variables]] — Required env vars and their purpose
- [[docker-compose]] — Local development services (PostgreSQL, Azurite)
- [[deployment]] — Azure Container Apps deployment patterns
- [[ci-cd]] — CI/CD pipeline, Docker, E2E testing, and recovery runbook

## Pages

Page-specific documentation and patterns.

- [[dashboard]] — Route config, locale resolution, page archetypes, toast infrastructure
- [[bas-categories]] — BAS kontoplan reference data, no-RLS shared data pattern, natural key, sparse preferences
- [[vat-registrations]] — Multi-country VAT registration management, rate schedule JSONB, auto-save pattern
- [[bank-accounts]] — Bank account configuration with CSV format library, two-table pattern, multi-currency accounts
- [[document-type-prefixes]] — Configurable business key prefixes, seed-on-first-access, free-form document types
- [[user-preferences]] — Personal locale preferences, format utilities, LocaleProvider context
- [[partner-crud-pattern]] — Domain entity CRUD pattern-setter: schema, service, actions, pages, soft-delete, FK validation
- [[contract-pattern]] — Child entity pattern, Decimal money field pipeline, dual self-referential FK
- [[entity-view-pattern]] — Tabbed entity detail page pattern, persistent header, empty state stubs
- [[document-upload-flow]] — Document upload pipeline, file validation, business key generation, status lifecycle
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
- [[external-integrations]] — Azure DI, Blob Storage, ECB, Inngest
- [[testing]] — Test architecture, fixtures, and coverage strategy
- [[test-performance-baseline]] — Test suite performance baseline and monitoring thresholds
- [[config-page-test-template]] — Reusable test structure for config CRUD pages (Stories 3.1–3.4)
- [[story-creation-checklist]] — Mutation story checklist, pattern-setter flag, retro gate check
- [[auto-save-pattern]] — Comprehensive auto-save form pattern reference (8 edge cases)
- [[blob-storage]] — Azure Blob Storage service, Azurite setup, test patterns
- [[async-jobs]] — Inngest async job infrastructure, withInngestContext, retry patterns
- [[ocr-processing]] — OCR service interface, Azure DI integration, 3-step Inngest architecture, quality classification
