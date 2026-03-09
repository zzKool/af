# DefterFab — AI Agent Context

## Project Overview
Solo Swedish AB consultant business management app.
Next.js 16.1 + Prisma 7 + PostgreSQL 17 + Better Auth 1.5.

## Architecture
- Hexagonal: actions → services → db (services never import next/*)
- Multi-tenant via RLS (SET LOCAL app.tenant_id)
- CallerIdentity passed to every service method

## Key Commands
- `npm run dev` — Start dev server (Turbopack)
- `npm run test` — Vitest unit/integration
- `npm run e2e` — Playwright E2E
- `npm run lint` — Biome check
- `docker compose up -d` — Start dev + test databases

## Conventions
- See architecture.md in _bmad-output/planning-artifacts/ for full details
- Server Actions: one file per entity in src/server/actions/
- Services: framework-agnostic in src/server/services/
- Tests: .test.ts (Vitest) co-located, .spec.ts (Playwright) in e2e/
- Naming: files=kebab-case, components=PascalCase, DB=snake_case
- Money: Decimal through services, number only at display boundary
- Dates: TIMESTAMPTZ in DB, ISO 8601 in code, sv-SE for display

## Boundaries — Do Not Cross
- src/server/services/* MUST NOT import from next/* or src/components/*
- src/server/actions/* are thin wrappers — logic goes in services
- src/components/* MUST NOT import from src/server/* (except type imports from actions)
- All DB timestamps use TIMESTAMPTZ, all UUIDs use @db.Uuid
- Money stays as Decimal until component display boundary
- Server Actions never throw — return AppError objects
- Enums are PostgreSQL-level, not Prisma-level
- Sidebar hides UI by role, Server Actions enforce RBAC server-side. Both required.

## Server Action Pattern
- Import from src/server/middleware/action-client.ts
- publicAction: no auth (login, register)
- authedAction: full middleware chain (most actions)
- ownerAction: owner role required (settings, user mgmt)
- Business errors: return { error: AppError } inside data, never throw
- See src/server/actions/journal.ts for reference pattern

## Planning Artifacts (read for context)
- _bmad-output/planning-artifacts/prd.md
- _bmad-output/planning-artifacts/architecture.md
- _bmad-output/planning-artifacts/ux-design-specification.md
