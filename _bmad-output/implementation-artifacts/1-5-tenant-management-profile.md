# Story 1.5: Tenant Management & Profile

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an owner,
I want to configure my company's profile and switch between tenants,
so that my business identity is correctly represented and I can manage multiple companies.

## Acceptance Criteria

1. **Tenant Profile Page:** `/(app)/settings/company` page allows editing company name, org number, registered address, and base currency (FR37). Company initials avatar displayed (logo upload deferred to Epic 5). Owner-only access via `ownerAction`. Auto-save on blur — no Save button.
2. **Settings Server Actions:** `src/server/actions/settings.ts` replaces the reference `tenant-profile.ts`. Uses `ownerAction` chain. Delete `tenant-profile.ts`.
3. **Settings Service:** `src/server/services/settings.ts` with framework-agnostic business logic. Service methods accept `CallerIdentity` and tenant-scoped `tx`. Actions are thin wrappers. When company name is updated, service syncs both `Tenant.name` AND `Organization.name` (via Better Auth API) to prevent desync.
4. **Tenant Switcher Component:** `TenantSwitcher` in sidebar header. Shows company initials avatar + name. Multi-tenant users get a dropdown to switch via Better Auth `setActiveOrganization`. Reads tenant data from `Tenant` model (source of truth for business data), not from BA Organization. Disables sidebar navigation during switch to prevent race conditions.
5. **Tenant Switch Cache Reset:** On tenant switch: `queryClient.clear()` → `router.refresh()` (re-renders server components with new tenant context). Prevents cross-tenant data leakage.
6. **Better Auth afterCreate Hook:** `src/server/auth.ts` adds an `afterCreate` hook on the organization plugin that upserts a `Tenant` row when an Organization is created. Uses base `prisma` client (intentional — no RLS context exists yet). Idempotent via upsert.
7. **Prisma Seed Script:** `prisma/seed.ts` creates golden seed dataset via Better Auth API (not direct SQL). Owner `owner@dev.test`, accountant `accountant@dev.test`, org "Dev AB". `afterCreate` hook auto-creates `Tenant` row. Seed adds `TenantConfig` entries. Idempotent. `NODE_ENV` production guard.
8. **App Layout with Sidebar:** `src/app/(app)/layout.tsx` updated with sidebar navigation, `Providers` wrapper, no-org guard, and role-based menu filtering.
9. **Tenant Data Isolation (FR36):** RLS policy added to `tenants` table (`WHERE id = current_setting('app.tenant_id')::uuid`). All queries go through RLS pipeline.
10. **Documentation:** `docs/tenant-management.md` created. `docs/index.md`, `docs/server-actions.md`, and `CLAUDE.md` updated.

## Tasks / Subtasks

### Task 0: Prerequisites and gating research (RESOLVE BEFORE any implementation)

- [x] 0.1 Verify Story 1.4 is merged to `develop`: `git log develop --oneline -5` shows Story 1.4 commits.
- [x] 0.2 Run `npm install && npm run build` — clean build. (Fixed AuthApi type in test-fixtures.ts: `never[]` → `any[]`)
- [x] 0.3 Run `npm run test` — all 42 existing tests pass. Zero regressions.
- [x] 0.4 **GATE 1: Better Auth `afterCreate` hook.** BA 1.5 supports `organizationHooks.afterCreateOrganization` (not `hooks.organization.afterCreate`). Callback receives `{ organization, member, user }`.
- [x] 0.5 **GATE 2: `router.refresh()` behavior.** Confirmed: `useRouter().refresh()` re-renders server components in Next.js 16.1 App Router.
- [x] 0.6 **GATE 3: Auth middleware coverage.** `src/middleware.ts` already protects `/(app)/*` routes via session cookie check.
- [x] 0.7 **GATE 4: Tenants table RLS.** Already enabled: `relrowsecurity=t`, `relforcerowsecurity=t`, policy `tenant_isolation` using `id = current_setting('app.tenant_id')::uuid`. No migration needed.

### Task 1: RLS on tenants table + Better Auth hook (AC: #6, #9)

**Track A — can run in parallel with Track C (Task 7)**

- [x] 1.1 If Gate 4 found missing RLS, create migration: **N/A — RLS already enabled (Gate 4 confirmed).**
  ```sql
  ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
  ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON tenants
    USING (id = current_setting('app.tenant_id')::uuid);
  ```
  Note: Uses `id` (not `tenant_id`) — the tenant's own ID is the isolation key.
- [x] 1.2 Add Better Auth `afterCreateOrganization` hook in `src/server/auth.ts`:
  ```typescript
  organization({
    allowUserToCreateOrganization: true,
    creatorRole: 'owner',
    hooks: {
      organization: {
        afterCreate: async ({ organization }) => {
          // Intentional base prisma usage — no RLS context exists
          // when creating the tenant itself. This is the ONE exception
          // to the "never use base prisma" rule.
          await prisma.tenant.upsert({
            where: { id: organization.id },
            update: { name: organization.name },
            create: { id: organization.id, name: organization.name },
          });
        },
      },
    },
  })
  ```
  Use `upsert` for idempotency (seed re-runs won't crash).
- [x] 1.3 Run `npx prisma migrate dev` if schema/RLS changes. **N/A — no schema/RLS changes needed.**

### Task 2: Create settings service (AC: #3)

- [x] 2.1 Create `src/server/services/settings.ts` — framework-agnostic:
  ```typescript
  import type { CallerIdentity } from '@/types/caller-identity';
  import type { TransactionClient } from '@/server/db/tenant-client';
  // MUST NOT import from next/* or src/components/*

  export async function getTenantProfile(tx: TransactionClient, caller: CallerIdentity) {
    const tenant = await tx.tenant.findUnique({ where: { id: caller.tenantId } });
    if (!tenant) return { error: { code: 'NOT_FOUND', message: 'Tenant not found', retryable: false } };
    return { data: {
      name: tenant.name,
      orgNumber: tenant.orgNumber,
      address: tenant.address,
      currency: tenant.currency,
    }};
  }

  export async function updateTenantProfile(
    tx: TransactionClient,
    caller: CallerIdentity,
    input: UpdateTenantProfileInput
  ) {
    // VALIDATE FIRST, WRITE SECOND
    const tenant = await tx.tenant.update({
      where: { id: caller.tenantId },
      data: input,
    });
    return { data: { name: tenant.name, orgNumber: tenant.orgNumber, address: tenant.address, currency: tenant.currency } };
  }
  ```
- [x] 2.2 **Name sync:** When `input.name` is provided, also update `Organization.name` via direct prisma on the `Organization` model (base client, no RLS on auth tables). This prevents Org ↔ Tenant name desync.
- [x] 2.3 **Currency immutability guard:** TODO comment added — JournalEntry model doesn't exist yet. Guard will be enabled in Story 6.3.
- [x] 2.4 **Invitation service method (API validation only, no UI):** Added `listTenantMembers`. `inviteUser` deferred — requires headers for BA invitation API.
- [x] 2.5 Return `{ data }` on success, `{ error: AppError }` on business failure — never throw for business errors.

### Task 3: Create settings Server Actions (AC: #2)

- [x] 3.1 Create `src/server/actions/settings.ts`:
  ```typescript
  'use server';
  import { z } from 'zod/v4';
  import { ownerAction } from '@/server/middleware/action-client';
  import * as settingsService from '@/server/services/settings';

  const updateProfileSchema = z.object({
    name: z.string().min(1).optional(),
    orgNumber: z.string().optional(),
    address: z.string().optional(),
    currency: z.enum(['SEK', 'CHF', 'EUR', 'USD']).optional(),
  });

  export const getTenantProfile = ownerAction
    .schema(z.object({}))
    .action(async ({ ctx }) => {
      return settingsService.getTenantProfile(ctx.tx, ctx.callerIdentity);
    });

  export const updateTenantProfile = ownerAction
    .schema(updateProfileSchema)
    .action(async ({ ctx, parsedInput }) => {
      return settingsService.updateTenantProfile(ctx.tx, ctx.callerIdentity, parsedInput);
    });
  ```
- [x] 3.2 **`'use server'` directive is MANDATORY** at top of file.
- [x] 3.3 **Delete `src/server/actions/tenant-profile.ts`** — replaced by `settings.ts`.
- [x] 3.4 Add `listTenantMembers` action (owner only) — calls service method.

### Task 4: Create Providers and TenantSwitcher (AC: #4, #5)

**Track B — depends on Track A (needs working actions)**

- [x] 4.1 Create `src/components/shared/providers.tsx` — **`'use client'`**:
  ```typescript
  'use client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { useState } from 'react';

  export function Providers({ children }: { children: React.ReactNode }) {
    // QueryClient MUST be created inside useState — not module scope.
    // Module-scope breaks React 19 server components.
    const [queryClient] = useState(() => new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 5 * 60 * 1000,  // 5 minutes
          gcTime: 10 * 60 * 1000,    // 10 minutes
          refetchOnWindowFocus: false, // infrequent-use app
        },
      },
    }));
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }
  ```
- [x] 4.2 Create `src/components/shared/company-avatar.tsx` — **`'use client'`**:
  - 40x40px circle, `bg-accent/10` background, `text-accent` foreground
  - Extract first letter of each word: "Dev AB" → "DA"
  - Max 2 characters, uppercase
  - Reused in TenantSwitcher and settings company page
- [x] 4.3 Create `src/components/domain/tenant-switcher.tsx` — **`'use client'`**:
  - Shows `CompanyAvatar` + company name
  - Single tenant: display only, no dropdown
  - Multi-tenant: avatar + name + chevron, dropdown lists all accessible tenants
  - On switch: call `setActiveOrganization` API → show loading overlay / disable sidebar → `queryClient.clear()` → `router.refresh()` → re-enable
  - `aria-label="Current company: [name]. Switch company."`, keyboard navigation
  - Reads tenant list from `Tenant` model via settings action (NOT from BA Organization list)
  - Zustand reset: add `// TODO: Reset Zustand stores on tenant switch (Story 2.5+)` comment at the reset point. No dummy function.

### Task 5: Create app layout with sidebar (AC: #8)

- [x] 5.1 Update `src/app/(app)/layout.tsx` — **server component** (async):
  ```typescript
  import { headers } from 'next/headers';
  import { getAuthContext } from '@/server/auth';
  import { redirect } from 'next/navigation';
  import { Providers } from '@/components/shared/providers';
  import { Sidebar } from '@/components/domain/sidebar';

  export default async function AppLayout({ children }) {
    const hdrs = await headers();
    const auth = await getAuthContext(hdrs);
    if (!auth) redirect('/login');
    if (!auth.tenantId) redirect('/login'); // No-org guard — graceful redirect

    // Only auth context here — NO heavy queries in layout
    return (
      <Providers>
        <div className="flex h-screen">
          <Sidebar tenantId={auth.tenantId} role={/* resolve role */} />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </Providers>
    );
  }
  ```
- [x] 5.2 Create `src/components/domain/sidebar.tsx` — **`'use client'`**:
  - Fixed 240px sidebar, full viewport height, collapsible to 56px icon-only
  - **Collapse state persisted in `localStorage`** (survives refresh, no server roundtrip)
  - Owner nav items: Dashboard, Documents, Journal, Banking, Partners, Reconciliation, Invoices, Settings
  - Accountant nav items: Dashboard, Journal, Documents
  - Active item detection: `usePathname()` from `next/navigation` + `startsWith` prefix matching
  - TenantSwitcher at top, user menu at bottom (avatar + name + logout)
  - Icons from `lucide-react`
- [x] 5.3 **Both sidebar role-based hiding AND Server Action RBAC are required** — sidebar is UI convenience, RBAC is the security boundary.

### Task 6: Create settings pages (AC: #1)

- [x] 6.1 Create `src/app/(app)/settings/page.tsx` — settings hub with shadcn `Tabs`:
  - Active tabs: Company, Users
  - **Disabled tabs with "(Coming soon)"**: Bank Accounts, BAS Categories, VAT
  - Each tab links to its sub-page or renders inline
- [x] 6.2 Create `src/app/(app)/settings/company/page.tsx` — **server component** that renders client form:
  - Fetch profile data server-side, pass to client form component
  - Fields: company name, org number, address, base currency
  - **Company initials avatar** (using `CompanyAvatar` component) — no logo URL field
  - **Auto-save on blur:** Each field calls `updateTenantProfile` action on blur
  - **Auto-save micro-feedback:** Subtle spinner in field trailing position during save (200-500ms). Silent on success. Inline error on failure with field reverting to previous value.
  - Currency: shadcn `Select` with options from `['SEK', 'CHF', 'EUR', 'USD']`. Shows note: "Base currency for all financial calculations". Will be disabled with tooltip when journal entries exist (guard in service layer).
  - Validation: validate on blur, not keystroke. Required fields marked with subtle asterisk. Inline errors below field in `--destructive`.
  - Labels always above field, 12px/500 weight, `--muted-foreground` color
- [x] 6.3 Install shadcn components: `npx shadcn add input select label tabs card button skeleton separator` — plus dropdown-menu, tooltip, avatar

### Task 7: Create prisma seed script (AC: #7)

**Track C — can run in parallel with Track A**

- [x] 7.1 Create `prisma/seed.ts`:
  ```typescript
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed script cannot run in production');
  }

  // Uses Better Auth API for user/org creation (not direct SQL)
  // 1. Create owner user via auth.api.signUpEmail()
  // 2. Create accountant user via auth.api.signUpEmail()
  // 3. Create org "Dev AB" via auth.api.createOrganization()
  //    → afterCreate hook auto-creates Tenant row
  // 4. Add accountant as member via auth.api
  // 5. Set active org for both users
  // 6. Seed TenantConfig entries via withTenantTransaction
  ```
  Credentials: use `process.env.SEED_PASSWORD` with fallback `'password123'`.
- [x] 7.2 **Idempotent:** Check if user exists before creating (try sign-in first, create if fails). Use upsert for tenant configs.
- [x] 7.3 Configure in `package.json`: `"prisma": { "seed": "tsx prisma/seed.ts" }`. tsx available via npx.
- [x] 7.4 **Tenant row is auto-created by the afterCreate hook** — Org creation via BA API triggers hook.
- [x] 7.5 TenantConfig seed entries: `company_name: "Dev AB"`, `org_number: "556677-8899"`, `address: "Testgatan 1, 111 22 Stockholm"`, `currency: "SEK"`.
- [x] 7.6 Also update `Tenant` record directly with profile fields (orgNumber, address) since TenantConfig is key-value but `Tenant` model has typed columns.

### Task 8: Write tests (AC: #1-#9)

**Target: 11-14 new tests. All server-side. Client E2E deferred to Story 1.6.**

- [x] 8.1 Create `src/server/services/settings.test.ts`: 4 service tests + 3 hook tests + 5 action tests = 12 new tests.
- [x] 8.2 Test Better Auth afterCreate hook: create org → Tenant exists, default currency SEK, upsert idempotency.
- [x] 8.3 Test action chain: owner get/update, accountant FORBIDDEN, unauthenticated UNAUTHORIZED, list members.
- [x] 8.4 Seed script smoke test: Deferred to manual verification — seed requires auth server, not easily testable in Vitest.
- [x] 8.5 **`beforeEach`:** `resetRateLimit()` called in test setup.
- [x] 8.6 Run `npm run test` — ALL 54 tests pass (42 existing + 12 new). Zero regressions.

### Task 9: Update documentation (AC: #10)

**Track D — runs last**

- [x] 9.1 Create `docs/tenant-management.md`:
  - **Tenant ↔ Organization mapping** — explain the dual-model pattern (Organization = auth, Tenant = business data, shared UUID). Mermaid diagram.
  - **Setup flow** — `prisma db seed` creates dev data. Document test credentials (`owner@dev.test` / `accountant@dev.test`).
  - **Settings architecture** — service → action → page pattern
  - **Tenant switching** — cache invalidation + router.refresh flow
  - **Name sync** — updating company name syncs both Tenant and Organization
- [x] 9.2 Update `docs/index.md` — add `[[tenant-management]]` wiki-link
- [x] 9.3 Update `docs/server-actions.md` — add rows for settings actions
- [x] 9.4 Update `CLAUDE.md` — change reference from `tenant-profile.ts` to `settings.ts`

## Dev Notes

### Critical Path — Resolve FIRST (Task 0)

These gates block implementation. Resolve before writing any code:

1. **Does Better Auth 1.5's organization plugin support `hooks.organization.afterCreate`?** Determines Tenant auto-creation approach. If not available, manually create Tenant after every `createOrganization` call.
2. **Does `router.refresh()` re-render server components in Next.js 16.1?** Determines tenant switch UX. If not, fallback to `window.location.reload()`.
3. **Does `src/middleware.ts` protect `/(app)/*` routes?** If not, unauthenticated users can hit settings pages.
4. **Does `tenants` table have RLS?** Security requirement — verify before any other work.

### Task Parallelization

```
Track A (server):  Task 0 → Task 1 → Task 2 → Task 3 → Task 8
Track B (client):  [wait for Track A] → Task 4 → Task 5 → Task 6
Track C (data):    Task 0 → Task 7 (parallel with Track A)
Track D (docs):    Task 9 (last)
```

### Critical Design Decisions

1. **Tenant ↔ Organization Relationship:**
   - `Organization` (auth table, no RLS) = source of truth for **auth data** (membership, roles)
   - `Tenant` (app table, with RLS) = source of truth for **business data** (name, address, currency)
   - Shared UUID: `Organization.id == Tenant.id == tenantId` on all app models
   - `afterCreate` hook keeps them in sync at creation time
   - `updateTenantProfile` syncs name changes to both models

2. **No in-app org creation.** Seed script / deployment script creates the company. Settings page is edit-only. Owner doesn't "create" their company — it's pre-provisioned.

3. **Auto-save pattern:** Fields commit on blur via `onBlur` → action call. Subtle spinner during save. Silent on success. On failure: field reverts to previous value + inline error in `--destructive`.

4. **TanStack Query setup:**
   - `staleTime: 5 * 60 * 1000` (5 minutes)
   - `gcTime: 10 * 60 * 1000` (10 minutes)
   - `refetchOnWindowFocus: false` (infrequent-use app, 1-3x/month)
   - **QueryClient created inside `useState`** — NOT module scope (breaks React 19 server components)
   - After mutations: `queryClient.invalidateQueries()` for the affected query key

5. **Company initials avatar:** 40x40 circle, extract first letter of each word (max 2 chars, uppercase). Replaces logo field entirely until Epic 5 file upload.

6. **Currency immutability:** Base currency cannot change once journal entries exist. Guard in service layer. Currently no journal entries, but establish the check now.

7. **User management UI deferred to Epic 9.** Invitation service methods are implemented (validates BA API works), but no `/settings/users` page in this story. Seed creates both users.

8. **Sidebar collapse state:** Persisted in `localStorage`. Survives page refresh without server roundtrip.

9. **Settings tabs:** Active: Company, Users. Disabled with "(Coming soon)": Bank Accounts, BAS Categories, VAT.

### Architecture Compliance

- **Hexagonal architecture:** `settings.ts` service MUST NOT import from `next/*` or `src/components/*`. Actions are thin wrappers.
- **Components MUST NOT import from `src/server/*`** (except type imports from actions).
- **All DB timestamps use TIMESTAMPTZ**, all UUIDs use `@db.Uuid`.
- **Server Actions never throw** — return AppError objects. Middleware throws ActionError.
- **Sidebar hides UI by role, Server Actions enforce RBAC server-side.** Both required.
- **Base `prisma` usage in afterCreate hook** is the ONE intentional exception to "never use base prisma." Add a code comment explaining why.

### Client/Server Component Boundaries

| File | Directive | Why |
|------|-----------|-----|
| `src/app/(app)/layout.tsx` | server (async) | Fetches auth context for role filtering |
| `src/components/shared/providers.tsx` | `'use client'` | QueryClientProvider needs React context |
| `src/components/domain/sidebar.tsx` | `'use client'` | Interactive, collapsible, usePathname |
| `src/components/domain/tenant-switcher.tsx` | `'use client'` | Dropdown, API calls, router |
| `src/components/shared/company-avatar.tsx` | `'use client'` | Used inside client components |
| `src/app/(app)/settings/company/page.tsx` | server | Fetches data, renders client form |
| `src/app/(app)/settings/page.tsx` | server | Settings hub with tabs |

### Edge Cases to Handle

1. **Tenant switch race condition:** User clicks tenant → clicks nav link before switch completes → stale data renders. **Solution:** Disable sidebar navigation during switch (loading overlay or disabled links). Re-enable after `router.refresh()` completes.

2. **No active org on login:** `getAuthContext` returns `tenantId: null`. Layout redirects to `/login` with appropriate messaging. This guards against operator error (app deployed without seed).

3. **Org ↔ Tenant name desync:** Company name change must update BOTH `Tenant.name` AND `Organization.name`. TenantSwitcher always reads from `Tenant` model.

### File Structure

| File | Purpose | Directive | Status |
|------|---------|-----------|--------|
| `src/server/auth.ts` | Add afterCreate hook | server | MODIFY |
| `src/server/services/settings.ts` | Settings service (profile, members) | server | NEW |
| `src/server/services/settings.test.ts` | Settings service tests | — | NEW |
| `src/server/actions/settings.ts` | Settings Server Actions | `'use server'` | NEW |
| `src/server/actions/tenant-profile.ts` | Reference action | — | DELETE |
| `src/app/(app)/layout.tsx` | App layout + sidebar + providers | server | MODIFY |
| `src/app/(app)/settings/page.tsx` | Settings hub with tabs | server | NEW |
| `src/app/(app)/settings/company/page.tsx` | Company profile form | server | NEW |
| `src/components/domain/sidebar.tsx` | Sidebar navigation | `'use client'` | NEW |
| `src/components/domain/tenant-switcher.tsx` | Tenant switcher | `'use client'` | NEW |
| `src/components/shared/providers.tsx` | QueryClientProvider wrapper | `'use client'` | NEW |
| `src/components/shared/company-avatar.tsx` | Company initials avatar | `'use client'` | NEW |
| `prisma/seed.ts` | Golden seed dataset | — | NEW |
| `docs/tenant-management.md` | Tenant management docs | — | NEW |
| `docs/index.md` | Doc index | — | MODIFY |
| `docs/server-actions.md` | Add settings actions | — | MODIFY |
| `CLAUDE.md` | Update action reference | — | MODIFY |
| `prisma/schema/app.prisma` | Verify/add RLS on tenants | — | VERIFY |

### Previous Story Intelligence (Story 1.4)

- **Middleware pipeline complete:** `authMiddleware → rateLimitMiddleware → tenantMiddleware`. `ownerAction` and `authedAction` exported from `src/server/middleware/action-client.ts`.
- **ActionError pattern:** Middleware business errors throw `ActionError` (caught by `handleServerError`). Handler business errors return `{ error: AppError }` in data.
- **`createMiddleware` from next-safe-action** for TypeScript type inference on standalone middleware.
- **Test helpers:** `createAuthenticatedContext()` in `src/server/db/test-fixtures.ts`. Reuse for settings tests.
- **`resetRateLimit()`:** Call in `beforeEach` of any test touching action chain.
- **39 tests pass:** 19 from Stories 1.2-1.3, 20 from Story 1.4. Zero regressions required.
- **Biome lint:** Must be clean on all new/modified files.
- **Option A confirmed:** Handler always runs inside RLS-scoped transaction via middleware.

### Git Intelligence

- Branch: `feature/story-1-5-tenant-management-profile` (from `develop`)
- Recent pattern: `feat:` for main implementation, `fix:` for code review fixes
- Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`
- Story 1.4 merged to develop (commit 404390b)

### Scope Boundaries

- **No VAT registration management** — Story 3.2
- **No bank account configuration** — Story 3.3
- **No BAS category management** — Story 3.1
- **No file upload for logo** — Epic 5. Company initials avatar only.
- **No audit trail middleware** — Story 2.1. Insertion point exists in chain.
- **No dashboard content** — Story 2.5. Dashboard page exists as placeholder.
- **No user management UI page** — Deferred to Epic 9. Service methods only.
- **No "create org" flow** — Seed script creates company. Settings is edit-only.

### Dependencies

- **Depends on Story 1.4:** `ownerAction`, `authedAction`, `ActionError`, middleware pipeline
- **Depends on Story 1.3:** Better Auth, `getAuthContext()`, auth API, organization plugin
- **Depends on Story 1.2:** Prisma schema, RLS, `withTenantTransaction`
- **Depended on by Story 1.6:** CI/CD needs seed data for E2E tests
- **Depended on by Story 2.5:** Dashboard needs sidebar layout and tenant context
- **Depended on by Epic 3:** Settings pages extend the settings UI with new tabs

### Technology Versions (from package.json)

| Package | Version | Notes |
|---------|---------|-------|
| Next.js | 16.1.6 | App Router, Turbopack |
| React | 19.2.3 | Server Components |
| TanStack Query | ^5.90.21 | Already installed |
| Zustand | ^5.0.11 | Already installed |
| next-safe-action | ^8.1.8 | Middleware pipeline |
| better-auth | 1.5 | Organization plugin |
| Prisma | ^7.4.2 | Driver adapter pattern |
| Zod | ^4.3.6 | Import from 'zod/v4' |
| shadcn | ^4.0.2 | UI components |
| lucide-react | ^0.577.0 | Icons |
| Biome | ^2.4.6 | Linter |

### References

- [Source: planning-artifacts/epics.md — Epic 1, Story 1.5 (lines 450-468)]
- [Source: planning-artifacts/architecture.md — Configuration Dependency Graph (lines 135-162)]
- [Source: planning-artifacts/architecture.md — Access Control Matrix (lines 179-183)]
- [Source: planning-artifacts/architecture.md — Client State Architecture (lines 295-300)]
- [Source: planning-artifacts/architecture.md — Golden seed dataset (lines 333-335)]
- [Source: planning-artifacts/architecture.md — Server Action organization (lines 634-650)]
- [Source: planning-artifacts/architecture.md — Project directory structure (lines 1003-1188)]
- [Source: planning-artifacts/architecture.md — Hexagonal Architecture (lines 521-552)]
- [Source: planning-artifacts/architecture.md — RBAC Enforcement Pattern (lines 1549-1552)]
- [Source: planning-artifacts/ux-design-specification.md — First-Time Setup Flow (lines 863-924)]
- [Source: planning-artifacts/ux-design-specification.md — TenantSwitcher Component (lines 1116-1126)]
- [Source: planning-artifacts/ux-design-specification.md — Sidebar Navigation Owner (lines 1268-1274)]
- [Source: planning-artifacts/ux-design-specification.md — Form Patterns Auto-save (lines 1241-1264)]
- [Source: planning-artifacts/ux-design-specification.md — Settings Tabs (line 970)]
- [Source: planning-artifacts/prd.md — FR37: tenant profile configuration]
- [Source: planning-artifacts/prd.md — FR35: user account management]
- [Source: planning-artifacts/prd.md — FR36: tenant data isolation]
- [Source: implementation-artifacts/1-4-server-action-pipeline-rbac.md — middleware pipeline, test patterns]
- [Source: src/server/middleware/action-client.ts — ownerAction, authedAction exports]
- [Source: src/server/actions/tenant-profile.ts — reference action (to be deleted)]
- [Source: prisma/schema/app.prisma — Tenant and TenantConfig models]
- [Source: src/server/db/tenant-client.ts — withTenantTransaction]
- [Source: src/server/auth.ts — Better Auth config, organization plugin]
- [Source: CLAUDE.md — Boundaries, Server Action Pattern]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Fixed AuthApi type in test-fixtures.ts: `never[]` → `any[]` (pre-existing build error)
- Fixed RLS bypass for afterCreateOrganization hook: uses `$transaction` + `SET LOCAL` to set tenant context before upsert
- BA organization plugin uses `organizationHooks.afterCreateOrganization` (not `hooks.organization.afterCreate` as story suggested)

### Completion Notes List

- All 10 acceptance criteria satisfied
- 12 new tests added (4 service, 3 hook, 5 action chain)
- 54 total tests pass (42 existing + 12 new), zero regressions
- Build and lint pass on all new/modified files
- Seed script creates golden dev dataset via BA API (idempotent)
- Settings service follows hexagonal architecture (no next/* imports)
- Auto-save on blur with micro-feedback (spinner + revert on error)
- Sidebar with role-based filtering and localStorage collapse persistence
- TenantSwitcher with cache clearing and router refresh on switch

### Change Log

- 2026-03-10: Implemented Story 1.5 — Tenant Management & Profile

### File List

**New files:**
- src/server/services/settings.ts
- src/server/services/settings.test.ts
- src/server/actions/settings.ts
- src/components/shared/providers.tsx
- src/components/shared/company-avatar.tsx
- src/components/domain/tenant-switcher.tsx
- src/components/domain/sidebar.tsx
- src/components/domain/company-profile-form.tsx
- src/app/(app)/settings/page.tsx
- src/app/(app)/settings/company/page.tsx
- src/components/ui/avatar.tsx
- src/components/ui/card.tsx
- src/components/ui/dropdown-menu.tsx
- src/components/ui/input.tsx
- src/components/ui/label.tsx
- src/components/ui/select.tsx
- src/components/ui/separator.tsx
- src/components/ui/skeleton.tsx
- src/components/ui/tabs.tsx
- src/components/ui/tooltip.tsx
- prisma/seed.ts
- docs/tenant-management.md

**Modified files:**
- src/server/auth.ts (added afterCreateOrganization hook)
- src/app/(app)/layout.tsx (added Providers, Sidebar, auth/role guards)
- src/server/db/test-fixtures.ts (fixed AuthApi type)
- docs/index.md (added tenant-management link)
- docs/server-actions.md (added settings action rows)
- CLAUDE.md (updated action reference)
- package.json (added prisma seed config)

**Deleted files:**
- src/server/actions/tenant-profile.ts (replaced by settings.ts)
