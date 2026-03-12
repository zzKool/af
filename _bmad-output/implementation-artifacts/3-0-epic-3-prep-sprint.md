# Story 3.0: Epic 3 Prep Sprint

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a development team,
I want to complete all prep sprint tasks identified in the Epic 2 retrospective,
so that Epic 3 stories (3.1–3.4) have a solid, safe foundation with proper enforcement, patterns, and resolved technical debt.

## Acceptance Criteria

1. **Given** the init migration uses `GRANT ALL` on tables/sequences
   **When** the prep sprint is complete
   **Then** a new migration replaces `GRANT ALL` with specific grants (`SELECT, INSERT, UPDATE, DELETE` on tables; `USAGE, SELECT` on sequences) for the `defterfab_app` role, and `ALTER DEFAULT PRIVILEGES` uses specific grants too

2. **Given** Zustand is not yet used but will be introduced in Story 3.1 (BAS category list)
   **When** the prep sprint is complete
   **Then** a Zustand store pattern is established with an automatic tenant-switch reset mechanism that clears client-side state when the active organization changes, preventing cross-tenant state leakage

3. **Given** the proxy.ts migration (from deprecated `middleware.ts`) was already completed
   **When** the prep sprint is complete
   **Then** the auth gating strategy is documented in `docs/middleware.md` and the deferred items register is updated to mark item #3 as resolved

4. **Given** the retro identified the need for architectural guard tests
   **When** the prep sprint is complete
   **Then** CI-integrated tests exist that fail on: (a) `GRANT ALL` in migration files, (b) `console.*` usage in `src/server/**/*.ts` (excluding tests), (c) `next/*` imports in `src/server/services/**/*.ts`

5. **Given** Stories 3.1–3.4 are all configuration CRUD pages with similar patterns
   **When** the prep sprint is complete
   **Then** a config page test template document AND reusable test helper functions exist that define the test structure: CRUD operations, RLS isolation, audit log assertions, auto-save behavior

6. **Given** the deferred items register exists
   **When** the prep sprint is complete
   **Then** all items with "Before Epic 3" or "Before Story 3.1" deadlines have been resolved or explicitly re-deferred with justification

7. **Given** story creation should verify outstanding retro action items
   **When** the prep sprint is complete
   **Then** the deferred items register is up-to-date and the process for checking it before story creation is documented

8. **Given** the retro identified story template improvements (mutation checklist, pattern-setter flag, Task 0 retro gate check)
   **When** the prep sprint is complete
   **Then** the story creation workflow or its documentation includes a mutation story checklist (RLS policy, specific GRANTs, audit test), a pattern-setter flag for first-of-kind stories, and a Task 0 gate check for outstanding retro items

## Tasks / Subtasks

- [x] Task 1: Fix GRANT ALL → specific grants (AC: #1, #6) — **must complete before Task 2** (guard test validates this fix)
  - [x] 1.1 Create new Prisma migration that: (a) grants `USAGE ON SCHEMA public` to `defterfab_app` (missing from init migration — PG 17 no longer grants this by default, causing "permission denied for schema public" errors), and (b) revokes `GRANT ALL` from `defterfab_app` role on all existing tables
  - [x] 1.2 Re-grant with specific permissions: `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE` for each app table (`tenants`, `tenant_configs`, `users`, `sessions`, `accounts`, `organizations`, `members`, `invitations`, `verifications`); `GRANT SELECT, INSERT ON TABLE` for immutable tables (`audit_logs`, `ecb_rates`)
  - [x] 1.3 Replace `GRANT ALL ON ALL SEQUENCES` with `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public`
  - [x] 1.4 Replace `ALTER DEFAULT PRIVILEGES ... GRANT ALL` with specific grants in the new migration
  - [x] 1.5 Run `prisma migrate dev` and verify all existing tests pass (167 Vitest + E2E)
  - [x] 1.6 Verify seed script works correctly with restricted grants

- [x] Task 2: Architectural guard tests (AC: #4)
  - [x] 2.1 Create `src/server/guards/architecture.guard.test.ts` — Vitest test that scans migration SQL files for `GRANT ALL` patterns and fails if found. Exception: allow `GRANT ALL` only in the init migration file (`20260309205743_init_schema_with_rls/migration.sql`) since those grants are revoked by the fix migration. All subsequent migrations must use specific grants.
  - [x] 2.2 Add guard test: scan `src/server/services/**/*.ts` (exclude `*.test.ts`) for `import.*from ['"]next/` — must find zero matches
  - [x] 2.3 Add guard test: scan `src/server/**/*.ts` (exclude `*.test.ts`, `seed.ts`) for `console\.(log|warn|error|info|debug)` — must find zero matches (Pino logger required instead)
  - [x] 2.4 Ensure guard tests run as part of `npm run test` (Vitest) so CI catches violations

- [x] Task 3: Zustand tenant-switch reset pattern (AC: #2)
  - [x] 3.1 Install Zustand: `npm install zustand@5.0.11` (exact version per architecture doc)
  - [x] 3.2 Create `src/lib/stores/create-tenant-store.ts` — factory function that creates Zustand stores scoped to the active tenant. Use a reactive pattern: stores subscribe to `activeOrganizationId` and reset to initial state when it changes. No central registry — each store handles its own reset via a `useTenantId()` subscription. Keep it simple for our 2-5 tenant scale.
  - [x] 3.3 Create `src/lib/stores/use-tenant-id.ts` — hook that exposes the current `activeOrganizationId` from Better Auth's session context. Zustand stores subscribe to this for tenant-change detection. Must handle loading/undefined session state gracefully (return `null` until session resolves) to prevent premature store resets on initial page load.
  - [x] 3.4 Write unit tests: store resets to initial state on tenant switch, multiple stores all reset independently, reset doesn't fire on same tenant re-selection
  - [x] 3.5 Document the pattern in `docs/zustand-stores.md` with usage example for Epic 3 config pages

- [x] Task 4: Document proxy.ts + close deferred item (AC: #3)
  - [x] 4.1 The migration from `middleware.ts` → `proxy.ts` is already done (`src/proxy.ts` exists with Better Auth session cookie gating). No codemod needed.
  - [x] 4.2 Create `docs/middleware.md` documenting the auth gating strategy: `src/proxy.ts` intercepts all app routes, checks Better Auth session cookie, redirects to `/login` if missing. Route matcher excludes `api`, `_next/static`, `_next/image`, `login`, `register`, `favicon.ico`.
  - [x] 4.3 Update deferred items register: mark item #3 (proxy.ts codemod) as Resolved with note "Already migrated — `src/proxy.ts` exists"

- [x] Task 5: Config page test template + helpers (AC: #5)
  - [x] 5.1 Create `src/server/test-utils/config-crud-helpers.ts` — reusable test assertion functions: `assertRlsIsolation(model, tenantA, tenantB)`, `assertAuditLogged(action, entityType, entityId)`, `assertCrudOperations(service, fixtures)`. These are code helpers that Stories 3.1–3.4 import directly.
  - [x] 5.2 Create `docs/config-page-test-template.md` documenting the reusable test structure for settings CRUD pages (Stories 3.1–3.4): service-level CRUD tests, RLS isolation tests, audit log assertions, auto-save behavior pattern (onChange for toggles, onBlur for text — reference `src/components/domain/company-profile-form.tsx` as the canonical auto-save implementation using `useAction()` + field-level `onBlur` saves), validation tests (duplicate prevention, required fields), empty state handling
  - [x] 5.3 Include concrete test code examples using existing patterns from `settings.test.ts`, `tenant-client.test.ts`, plus references to the new helper functions from 5.1

- [x] Task 6: Update deferred items register + story template (AC: #6, #7, #8)
  - [x] 6.1 After completing Tasks 1–5, update `_bmad-output/implementation-artifacts/deferred-items.md`: move items #1 (GRANT ALL) and #2 (Zustand reset) to Resolved; update item #3 (proxy.ts) based on Task 4 findings
  - [x] 6.2 Review remaining active items — verify deadlines are still appropriate
  - [x] 6.3 Update `docs/index.md` with links to any new docs created
  - [x] 6.4 Create `docs/story-creation-checklist.md` — mutation story checklist (RLS policy task, specific GRANTs task, audit.log integration test task), pattern-setter flag guidance (first-of-kind stories get minimal scope), and Task 0 gate check (verify deferred items register before creating next story)

- [x] Task 7: Verify everything (AC: all)
  - [x] 7.1 Run full test suite: `npm run test` — all existing 167 tests + new guard tests pass
  - [x] 7.2 Run `npm run lint` (Biome check) — clean
  - [x] 7.3 Run `npm run e2e` — no regressions
  - [x] 7.4 Run `npx biome check --write` before each commit
  - [x] 7.5 Verify `npm run dev` starts without warnings related to changes

## Dev Notes

### Architecture Patterns & Constraints

- **This is a housekeeping story** — no new domain models, no new pages, no UI changes. Pure infrastructure, testing, and technical debt cleanup.
- **Migration safety:** The GRANT fix migration must be additive (new migration file), not editing the init migration. Editing applied migrations causes checksum mismatches requiring `prisma migrate reset`. Lesson learned from Stories 2.1 and 2.3.
- **Guard tests are Vitest tests**, not a separate test framework. They use `fs.readFileSync` and regex to scan source files. They run in the existing `server` Vitest project.
- **Zustand is a new dependency** — first client-side state management library. Architecture specifies Zustand 5.0.11. Stores are session-only (lost on refresh), per the architecture doc.

### GRANT ALL Fix — Technical Details

**BUG FOUND:** The init migration is also missing `GRANT USAGE ON SCHEMA public TO defterfab_app`. PostgreSQL 17 does not grant schema USAGE to new roles by default (changed in PG 15). This causes "permission denied for schema public" errors at runtime. The fix migration MUST include this grant. Applied manually to dev and test databases as a hotfix.

The init migration ([migration.sql:151-154](prisma/migrations/20260309205743_init_schema_with_rls/migration.sql#L151-L154)) has:
```sql
GRANT ALL ON ALL TABLES IN SCHEMA public TO defterfab_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO defterfab_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO defterfab_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO defterfab_app;
```

Later migrations (audit_logs, ecb_rates) correctly use specific grants. The fix migration must:
1. `REVOKE ALL` on existing tables/sequences from `defterfab_app`
2. Re-grant with table-specific permissions
3. Fix `ALTER DEFAULT PRIVILEGES` for future tables

Tables and their required permissions:
- **Full CRUD** (`SELECT, INSERT, UPDATE, DELETE`): `tenants`, `tenant_configs`, `users`, `sessions`, `accounts`, `organizations`, `members`, `invitations`, `verifications`
- **Immutable / append-only** (`SELECT, INSERT`): `audit_logs`, `ecb_rates`
- **Prisma migrations** (`_prisma_migrations`): `SELECT, INSERT, UPDATE, DELETE` (Prisma needs this for migration tracking). Note: verify whether `defterfab_app` currently has grants on this table — it may be owned by the migration role instead. If `defterfab_app` doesn't access it at runtime, skip it in the fix migration.

### Zustand Pattern — Design Decision

Architecture says: "Zustand: Filter state per table, workbench divider position, sidebar state, selected entry. Session-only (lost on refresh)."

**Reactive pattern (not registry):** Each store subscribes to `activeOrganizationId` and resets itself on change. No central registry, no global `resetAllStores()`. This is simpler and more idiomatic Zustand:
- `useTenantId()` hook exposes current org ID from Better Auth session
- `createTenantStore(initialState)` factory creates a store that auto-resets when tenant changes
- Each store is independent — no coupling between stores

Since Zustand isn't used yet, this task establishes the pattern. First real consumer: Story 3.1 BAS category filter/search state.

### proxy.ts Codemod — Context

Next.js has been evolving the middleware pattern. The codemod `@next/codemod@canary middleware-to-proxy` was mentioned in Epic 1 retro. As of Next.js 16.1, check whether:
- `middleware.ts` is still the supported pattern
- `proxy.ts` is the new recommended pattern
- The codemod is stable or still canary

**Already done:** `src/proxy.ts` exists with Better Auth session cookie gating. The migration from `middleware.ts` was completed previously. Task is now just documentation + closing the deferred item.

### Guard Tests — Implementation Notes

These are **static analysis tests**, not runtime tests. They scan the file system:

Use Node's built-in `node:fs` + `node:path` with `readdirSync({ recursive: true })` — zero new dependencies. Do NOT install the `glob` package. Vitest already has full Node access.

```typescript
// Example pattern for import boundary guard
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function findFiles(dir: string, ext: string, ignore?: RegExp): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith(ext) && (!ignore || !ignore.test(e.name)))
    .map(e => join(e.parentPath, e.name));
}

test('services must not import from next/*', () => {
  const files = findFiles('src/server/services', '.ts', /\.test\.ts$/);
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    expect(content).not.toMatch(/import.*from\s+['"]next\//);
  }
});
```

### Config Page Test Template — What to Cover

Stories 3.1–3.4 all follow the same pattern:
1. **Service tests:** CRUD operations with Prisma, validation, business rules
2. **RLS tests:** Two tenants, verify isolation (tenant A's config invisible to tenant B)
3. **Audit tests:** Every create/update/delete writes an audit_log entry
4. **Action tests:** Server actions return AppError (never throw), proper middleware chain
5. **Auto-save:** No explicit save button; mutations fire on onChange (toggles) or onBlur (text)

Existing patterns to reference:
- [settings.ts](src/server/actions/settings.ts) — Server Action pattern
- [tenant-client.test.ts](src/server/db/tenant-client.test.ts) — RLS isolation testing

### Previous Story Intelligence (Story 2.5)

- **167 tests passing** across the suite — must not regress
- **Biome check before commit** — `npx biome check --write`
- **Conventional commits:** `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`
- **Dashboard service dual-client pattern** — not relevant to this story but documents the exception
- **NAV_ITEMS** in `src/lib/constants.ts` — no changes needed for this story (no new pages)

### What NOT to Build

- No new UI pages or components — this is infrastructure only
- No BAS category schema or seed data — that's Story 3.1
- No settings page UI changes
- No new server actions or services (except Zustand store utilities)
- No changes to the sidebar or dashboard

### Project Structure Notes

New files:
- `prisma/migrations/<timestamp>_fix_grant_all_specific_grants/migration.sql`
- `src/server/guards/architecture.guard.test.ts`
- `src/lib/stores/create-tenant-store.ts`
- `src/lib/stores/use-tenant-id.ts`
- `src/lib/stores/*.test.ts`
- `src/server/test-utils/config-crud-helpers.ts`
- `docs/zustand-stores.md`
- `docs/config-page-test-template.md`
- `docs/story-creation-checklist.md`
- `docs/middleware.md` (if proxy.ts codemod is N/A)

Modified files:
- `_bmad-output/implementation-artifacts/deferred-items.md`
- `docs/index.md`
- `package.json` (zustand dependency)
- `package-lock.json` (zustand dependency)

### References

- [Source: _bmad-output/implementation-artifacts/epic-2-retro-2026-03-12.md — Prep Sprint section (7 tasks), enforcement strategy, deferred items]
- [Source: _bmad-output/implementation-artifacts/deferred-items.md — Items #1, #2, #3 with Before Epic 3 deadlines]
- [Source: _bmad-output/planning-artifacts/architecture.md — Zustand 5.0.11, session-only state, CallerIdentity, hexagonal architecture, testing tiers, Prisma model template, GRANT patterns]
- [Source: prisma/migrations/20260309205743_init_schema_with_rls/migration.sql — GRANT ALL lines 151-154]
- [Source: prisma/migrations/2026031*_add_audit_logs + _add_ecb_rates_table — Correct specific grants pattern to follow]
- [Source: _bmad-output/implementation-artifacts/2-5-minimal-dashboard-shell.md — Previous story patterns, 167 test count]
- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3 stories 3.1-3.4 requirements context]
- [Source: src/components/domain/company-profile-form.tsx — Canonical auto-save pattern for config page test template]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- E2E initially failed after migration because test DB (port 5433) needed re-seeding. Resolved by seeding test DB with correct env vars.

### Completion Notes List

- Task 1: Created migration `20260312005732_fix_grant_all_specific_grants` that revokes GRANT ALL and re-grants with table-specific permissions. Added missing `GRANT USAGE ON SCHEMA public` for PG 17. All 168 existing tests pass. Seed works.
- Task 2: Created `architecture.guard.test.ts` with 3 guard tests: GRANT ALL scanner (excludes init migration), next/* import boundary, console.* usage scanner. All run in Vitest server project.
- Task 3: Zustand 5.0.11 was already installed. Created `createTenantStore` factory with reactive tenant-switch reset, `useTenantId` hook, 6 unit tests, and `docs/zustand-stores.md`.
- Task 4: Created `docs/middleware.md` documenting proxy.ts auth gating strategy. Deferred item #3 marked resolved.
- Task 5: Created `config-crud-helpers.ts` with `assertRlsIsolation`, `assertAuditLogged`, `assertCrudOperations`. Created `docs/config-page-test-template.md` with full test structure.
- Task 6: Updated deferred items register (items #1, #2, #3 moved to Resolved). Updated `docs/index.md` with new doc links. Created `docs/story-creation-checklist.md`.
- Task 7: 177 Vitest tests pass, Biome lint clean, 4 E2E tests pass, dev server starts clean.

### Change Log

- 2026-03-12: Story 3.0 implementation complete. All 7 tasks done. 177 tests (10 new), 4 docs created, 3 deferred items resolved.

### File List

New files:
- prisma/migrations/20260312005732_fix_grant_all_specific_grants/migration.sql
- src/server/guards/architecture.guard.test.ts
- src/lib/stores/create-tenant-store.ts
- src/lib/stores/use-tenant-id.ts
- src/lib/stores/create-tenant-store.test.ts
- src/server/test-utils/config-crud-helpers.ts
- docs/zustand-stores.md
- docs/middleware.md
- docs/config-page-test-template.md
- docs/story-creation-checklist.md

Modified files:
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/deferred-items.md
- docs/index.md
