# DefterFab Documentation

Secretary-General for solo Swedish AB business administration.

## Architecture

Technical decisions, stack choices, and system design patterns.

- [[architecture-decisions]] — Key architectural decisions and rationale
- [[tech-stack]] — Languages, frameworks, and library versions
- [[data-model]] — Database schema, relationships, and RLS policies
- [[prisma-rls-setup]] — Multi-tenant RLS with Prisma 7, tenant-aware client, migration workflow
- [[auth-setup]] — Better Auth 1.5 configuration, organization-to-tenant mapping, session management
- [[tenant-management]] — Tenant profile, dual-model pattern, tenant switching, seed data
- [[audit-trail]] — Immutable audit trail, source provenance, opt-in service pattern
- [[observability]] — Pino structured logging, log levels, request-scoped context, Azure Log Analytics

## Patterns

Reusable code patterns and development conventions.

- [[conventions]] — Commit conventions, branching strategy, naming standards
- [[server-actions]] — Middleware chain, RBAC, error handling, and testing guide
- [[error-handling]] — Typed error codes and response patterns
- [[hexagonal-architecture]] — Import boundaries and service isolation
- [[decimal-currency]] — Decimal arithmetic, currency formatting, boundary rule
- [[clock-and-rates]] — Clock abstraction, timezone rules, ECB rate storage

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
