# DefterFab Documentation

Secretary-General for solo Swedish AB business administration.

## Architecture

Technical decisions, stack choices, and system design patterns.

- [[architecture-decisions]] — Key architectural decisions and rationale
- [[tech-stack]] — Languages, frameworks, and library versions
- [[data-model]] — Database schema, relationships, and RLS policies
- [[prisma-rls-setup]] — Multi-tenant RLS with Prisma 7, tenant-aware client, migration workflow
- [[auth-setup]] — Better Auth 1.5 configuration, organization-to-tenant mapping, session management

## Patterns

Reusable code patterns and development conventions.

- [[conventions]] — Commit conventions, branching strategy, naming standards
- [[server-action-pipeline]] — Middleware chain for all mutations
- [[error-handling]] — Typed error codes and response patterns
- [[hexagonal-architecture]] — Import boundaries and service isolation

## Configuration

Environment setup, settings, and deployment configuration.

- [[project-scaffold]] — Tech stack, development commands, project structure
- [[local-environment-setup]] — Prerequisites, quick start, and service verification
- [[environment-variables]] — Required env vars and their purpose
- [[docker-compose]] — Local development services (PostgreSQL, Azurite)
- [[deployment]] — Azure Container Apps deployment patterns

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
