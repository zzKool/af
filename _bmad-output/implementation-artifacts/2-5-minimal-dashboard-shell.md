# Story 2.5: Minimal Dashboard Shell

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an owner,
I want to see a welcome screen with basic orientation when I log in,
So that I immediately know I'm in the right tenant and have a home base for future features.

## Acceptance Criteria

1. **Given** authentication and tenant context are working from Epic 1
   **When** the owner logs in and is redirected to `/(app)/dashboard`
   **Then** the dashboard page displays "Welcome back, [user name]" with the company name from tenant profile

2. **Given** the user is logged in
   **When** the dashboard loads
   **Then** the page shows last login timestamp

3. **Given** the dashboard is rendered
   **When** the owner views the page
   **Then** placeholder sections are visible for future Business Pulse content (Action Items, Status Briefing) with empty state messages and CTAs

4. **Given** the dashboard page exists
   **When** it is loaded
   **Then** the page is server-rendered and loads within 2 seconds (FR31 shell)

5. **Given** an accountant logs in
   **When** the accountant views the dashboard
   **Then** the accountant sees the same shell but with role-appropriate placeholder content

6. **Given** the `(app)` layout exists
   **When** rendered
   **Then** the layout includes a sidebar navigation component with links to app pages (dashboard, journal, banking, documents, reconciliation, partners, invoicing, settings)

7. **Given** the sidebar navigation exists
   **When** rendered
   **Then** sidebar navigation reads enabled routes from a configuration array in `src/lib/constants.ts` that is updated as new pages are built in subsequent epics

8. **Given** the sidebar uses the route configuration
   **When** rendered
   **Then** sidebar navigation hides links to pages that don't exist yet — only shows pages that have been built in completed epics

9. **Given** the sidebar uses role-based filtering
   **When** rendered for different roles
   **Then** sidebar navigation hides menu items based on user role (accountant sees fewer items)

10. **Given** any loading state exists
    **When** content is loading
    **Then** loading states use skeleton components, never spinners

11. **Given** the dashboard route group exists
    **When** an error occurs
    **Then** `error.tsx` boundary exists for the dashboard route group

12. **Given** the story is complete
    **When** documentation is reviewed
    **Then** `docs/` is updated with Obsidian-style `[[wiki-links]]` documenting any new concepts, patterns, or configurations introduced in this story

## Tasks / Subtasks

- [x] Task 1: Refactor sidebar navigation to use route config (AC: #6, #7, #8, #9)
  - [x] 1.1 Create `NAV_ITEMS` config array in `src/lib/constants.ts` with typed `NavItem` interface: `{ path, label, icon, roles: Role[], enabled: boolean }`. Use `as const` assertion. Icons from `lucide-react`.
  - [x] 1.2 Add `ROLE_LANDING_PAGE` config: `Record<string, string>` mapping role → default landing path (both `owner` and `accountant` → `/dashboard` for now; future: accountant → `/periods`)
  - [x] 1.3 Refactor `src/components/domain/sidebar.tsx` to read from `NAV_ITEMS`. Filter: `item.enabled === true` AND `item.roles.includes(role)`. Data source change ONLY — do not modify collapse/expand behavior, animation, or toggle position.
  - [x] 1.4 Enable only Dashboard and Settings routes initially (all others `enabled: false`)
  - [x] 1.5 Write unit tests for nav filtering logic: owner sees Dashboard + Settings, accountant sees Dashboard only, future-enabled items appear for correct roles

- [x] Task 2: Locale infrastructure + dashboard data fetching (AC: #1, #2, #4)
  - [x] 2.1 Create `src/lib/locale.ts` — `resolveLocale(acceptLanguageHeader: string | null): string` that parses `Accept-Language` header with quality-factor support, falls back to `'en'`. NEVER hardcode `sv-SE` for display.
  - [x] 2.2 Create `src/lib/format-date.ts` — `formatDateTime(date: Date | string, locale: string): string` using `Intl.DateTimeFormat` with the resolved locale. Also export `formatDateShort`. These utilities take an explicit locale parameter — no module-level globals.
  - [x] 2.3 Create `src/server/services/dashboard.ts` with `getDashboardData()`. CRITICAL: this service needs TWO data access paths — base Prisma client for auth tables (`user`, `session` — no `tenant_id`, outside RLS) AND tenant-scoped `tx` for tenant data (`organization` for company name). This dual-client pattern is an intentional exception — document it in the service.
  - [x] 2.4 Return type: `{ userName: string; companyName: string | null; lastLoginAt: string | null; role: string }`. Nullable fields degrade gracefully — never throw for missing optional data.
  - [x] 2.5 Last login: query `session` table ordered by `createdAt DESC`, skip first row (current session), take second. If null → show "First login" text on page.
  - [x] 2.6 Create `src/server/actions/dashboard.ts` using `authedAction` (not `ownerAction` — accountant needs access too)
  - [x] 2.7 Write unit tests: happy path, first-login (null lastLoginAt), missing company name (null companyName), locale resolution with various Accept-Language headers
  - [x] 2.8 Write unit tests for `format-date.ts` with different locales (`en`, `en-US`, `de-DE`)

- [x] Task 3: Build dashboard page (AC: #1, #2, #3, #5)
  - [x] 3.1 Replace placeholder in `src/app/(app)/dashboard/page.tsx` with async server component. Read `Accept-Language` header via `headers()`, resolve locale, call dashboard action, render content.
  - [x] 3.2 Compact welcome: `<h1>` with "Welcome back, {name}" + company name as subtitle `<p>`. One line, not a full card. This is NOT the focus — the action sections below are.
  - [x] 3.3 Last login timestamp formatted using `formatDateTime()` with resolved locale
  - [x] 3.4 Define types in `src/types/dashboard.ts`: `DashboardActionItem` and `BusinessPulseMetric` interfaces. Services return `[]` for now — empty states render from `items.length === 0`, not boolean flags. This enables zero-refactoring integration when Epic 8 populates them.
  - [x] 3.5 Create `ActionItemsWidget` component — renders FIRST in DOM order (before Business Pulse). Accepts typed `items: DashboardActionItem[]` prop. Empty state: card with descriptive message "No pending items — action items will appear here as you import bank statements and documents"
  - [x] 3.6 Create `BusinessPulseWidget` component — renders SECOND. Accepts typed `metrics: BusinessPulseMetric[]` prop. Empty state: card with "Business overview will appear here as your financial data grows"
  - [x] 3.7 Responsive: two-column grid on desktop (≥1024px), single column stacked on mobile. Action Items always first.
  - [x] 3.8 Use shadcn `Card` / `CardHeader` / `CardContent` components — NOT custom divs with manual shadows. Card handles dark mode automatically.
  - [x] 3.9 All colors via CSS variable tokens (`bg-background`, `text-foreground`, `bg-muted`, etc.) — NEVER literal colors (`bg-white`, `text-black`). Design system handles light/dark mode.

- [x] Task 4: Toast infrastructure + error boundary (AC: #11)
  - [x] 4.1 Install Sonner: `npx shadcn@latest add sonner`
  - [x] 4.2 Add `<Toaster position="bottom-right" visibleToasts={3} />` to `src/app/layout.tsx` (root layout). No toast calls in this story — first consumers arrive in Epic 3.
  - [x] 4.3 Create `src/app/(app)/dashboard/error.tsx` — user-friendly error card with "Something went wrong" message + "Try again" button (calls `reset()`). The error boundary replaces only the page content; sidebar remains rendered and navigable.

- [x] Task 5: Update documentation (AC: #12)
  - [x] 5.1 Create `docs/dashboard.md` — route config pattern, NAV_ITEMS usage, locale resolution, page archetype model (Dashboard / Entity List / Entity Detail / Workbench / Multi-step Flow), how to enable new routes
  - [x] 5.2 Update `docs/index.md` with link. Use Obsidian `[[wiki-links]]`.
  - [x] 5.3 Add code comment in `(app)/layout.tsx`: `main.overflow-auto` is the intentional scroll container — do not change, future sticky positioning depends on it.

- [x] Task 6: Verify and test (AC: all)
  - [x] 6.1 Run full test suite — ensure no regressions (137+ existing tests)
  - [x] 6.2 Run `npx biome check --write` before each commit
  - [x] 6.3 Verify dashboard loads within 2 seconds (server-rendered, no client JS for initial paint)
  - [x] 6.4 Manual verification: login as owner → see welcome + last login + placeholder cards
  - [x] 6.5 Manual verification: login as accountant → see dashboard with appropriate content

## Dev Notes

### Architecture Patterns & Constraints

- **Server-rendered page**: Dashboard is a static async server component. No streaming, no Suspense boundaries for this story — the data fetches are fast (simple queries returning near-instant results). Suspense/streaming infrastructure deferred until widgets fetch real aggregation data (Epic 8+).
- **Hexagonal architecture**: `dashboard/page.tsx` → `actions/dashboard.ts` → `services/dashboard.ts` → Prisma. Services MUST NOT import `next/*`.
- **Dual Prisma client (INTENTIONAL EXCEPTION)**: The dashboard service queries both auth tables (no RLS — `user`, `session`) via base Prisma client AND tenant tables (RLS-scoped) via `tx`. This is because Better Auth's tables don't have `tenant_id`. The service accepts both `prisma` (base) and `tx` (tenant-scoped) as parameters. Document this in the service file — it is not a violation of the architecture.
- **Server Actions never throw**: Return `AppError` objects. Use `authedAction` (not `ownerAction`) since accountant also accesses dashboard.
- **Graceful degradation**: The dashboard NEVER shows error.tsx for partial data failures. If company name query fails → show greeting without company. If last login query fails → hide the field. Only show error boundary for complete failures (DB unreachable). Service returns nullable fields, page renders what's available.
- **Loading = skeletons, never spinners**: Per architecture UI Process Patterns. However, for this story the placeholder widgets render static empty-state text — no skeleton wrappers needed on static cards. Skeletons become relevant when widgets fetch async data in future stories.

### Locale — CRITICAL

- **NEVER hardcode `sv-SE` for display formatting.** The user lives in Sweden but does not speak Swedish. Use browser `Accept-Language` header for display locale.
- `clock.ts` continues using `sv-SE` internally — that's a server-side hack for YYYY-MM-DD business keys, NOT a display locale choice. Do not change it.
- `format-currency.ts` is currency-driven (not locale-driven) — already correct, no changes needed.
- New `format-date.ts` takes explicit `locale` parameter. No globals, no auto-detection inside the utility.
- Server components read locale from `headers()` → `Accept-Language`. Client components can use `navigator.language` or receive locale via props from server parent.

### Sidebar Refactor — Scope Boundary

- **Data source change ONLY.** Move nav items from hardcoded JSX to `NAV_ITEMS` constant. Do NOT modify: collapse/expand behavior, animation, toggle position, transition timing, localStorage key/shape.
- If localStorage key changes during refactor, that's OK — sidebar resets to expanded (good default). Don't add migration logic.
- With only 2 enabled items (Dashboard, Settings), the sidebar will look sparse. That's expected — it fills up as future epics enable routes.

### Toast Infrastructure

- Install Sonner via `npx shadcn@latest add sonner`. Add `<Toaster />` to root layout. Zero runtime cost when no toasts fired (~4KB gzipped).
- NO toast calls in this story. First consumers: Epic 3 mutations.
- Sonner replaces the planned `toast-provider.tsx` from architecture skeleton — no custom wrapper needed.
- Auto-save pattern (settings forms) stays as-is: silent on success, inline error messages on failure. Toast.error can be added to auto-save failures in future stories.

### Dark Mode

- All colors MUST use Tailwind CSS variable tokens (`bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, etc.). NEVER use literal colors (`bg-white`, `text-black`, `text-gray-500`).
- Use shadcn `Card` component — it handles dark mode borders/shadows automatically. Don't create custom card divs.
- Empty state text: use `text-muted-foreground` on `bg-card` (white/card background). NOT on `bg-muted` — that combination fails WCAG AA contrast (3.8:1 < 4.5:1 required).

### Action Visibility & Page Layout

- **Action Items widget renders FIRST** in DOM and visual order — before Business Pulse, before any decorative content.
- Welcome/greeting is compact: one `<h1>` + one `<p>` in the page header area. Not a full card. Never pushes actionable content below the fold.
- On mobile, Action Items stacks above Business Pulse.
- **Layout constraint**: `(app)/layout.tsx` uses `main.overflow-auto` as the scroll container. Do not change this — future sticky action bar positioning depends on it. Add a code comment documenting this.

### Security Note

- `NAV_ITEMS` array is in client-accessible code. All route paths visible to all users in JS bundle, even disabled ones. An accountant could manually navigate to `/settings` by URL. This is fine — `ownerAction` middleware enforces RBAC server-side. Sidebar hiding is UI convenience; action enforcement is the security layer. Both are required (architecture: "dual enforcement").

### Existing Code to Build On

- **Sidebar**: `src/components/domain/sidebar.tsx` — REFACTOR, don't rewrite
- **Tenant switcher**: `src/components/domain/tenant-switcher.tsx` — no changes needed
- **App layout**: `src/app/(app)/layout.tsx` — no structural changes
- **Dashboard page**: `src/app/(app)/dashboard/page.tsx` — replace content, keep route
- **Settings action**: `src/server/actions/settings.ts` — follow this pattern for dashboard action
- **Skeleton**: `src/components/ui/skeleton.tsx` — available via shadcn
- **Card**: `src/components/ui/card.tsx` — available via shadcn

### Previous Story Intelligence (Story 2.4)

- **Middleware chain**: auth → rateLimit → logging → tenant → audit. Dashboard action uses `authedAction`.
- **Pino logger**: `import { logger } from "@/server/logger"` — use `ctx.log` from middleware for request-scoped logging.
- **Test patterns**: Co-located `.test.ts`, `vi.mock()`, `vi.hoisted()` for mock variables, silent Pino logger: `pino({ level: "silent" })`.
- **137 tests passing** across 14 files. Must not regress.
- **Always `npx biome check --write`** before committing.
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`

### What NOT to Build (Explicitly Cut)

- No first-login vs returning-user conditional greeting logic — just show "Welcome back, {name}" always per AC
- No time-of-day greetings
- No Suspense boundaries or skeleton wrappers around static placeholder cards
- No error boundaries per widget (defer until widgets have real data)
- No role-based widget visibility logic (both roles see same layout for now)
- No relative "time ago" date formatting
- No tablet-specific breakpoints (tablet matches desktop)
- No `StickyActionBar` component (first consumer is Epic 6 CSV import wizard)

### Project Structure Notes

- `src/app/(app)/dashboard/page.tsx` — replace content (exists)
- `src/app/(app)/dashboard/error.tsx` — new
- `src/server/services/dashboard.ts` — new
- `src/server/actions/dashboard.ts` — new
- `src/lib/constants.ts` — add NAV_ITEMS, ROLE_LANDING_PAGE (exists)
- `src/lib/locale.ts` — new
- `src/lib/format-date.ts` — new
- `src/types/dashboard.ts` — new (DashboardActionItem, BusinessPulseMetric types)
- `docs/dashboard.md` — new

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 2, Story 2.5 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/architecture.md — D6 Streaming/Loading, UI Process Patterns, Error boundaries]
- [Source: _bmad-output/planning-artifacts/architecture.md — Action Client Pattern, CallerIdentity, RBAC dual enforcement]
- [Source: _bmad-output/planning-artifacts/architecture.md — Toast patterns: success/error/auto-save, max 1→3 visible]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Dashboard layout, Action Items first, Business Pulse]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Sidebar specs, role-based nav, TenantSwitcher]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Color system, typography, spacing, WCAG contrast]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Page archetypes, responsive breakpoints]
- [Source: _bmad-output/implementation-artifacts/2-4-observability-error-tracking.md — Middleware, test patterns]
- [Source: Party Mode feedback — Locale: browser Accept-Language, not sv-SE]
- [Source: Party Mode feedback — Scope reset: cut over-engineering, 2-point story]
- [Source: Party Mode feedback — Toast: Sonner infrastructure, no consumers until Epic 3]
- [Source: Party Mode feedback — Action visibility: Action Items first, compact greeting]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- Story context created with party mode review (20 rounds)
- Scope trimmed per user feedback: locale, action visibility, toast infrastructure, cut over-engineering
- Estimated effort: 2-3 points (1-2 days)
- Task 1: Refactored sidebar to read from centralized NAV_ITEMS config with role+enabled filtering. Extracted filterNavItems() for testability. 9 unit tests.
- Task 2: Created locale.ts (Accept-Language parser), format-date.ts (Intl.DateTimeFormat wrappers), dashboard service with dual Prisma client pattern, dashboard action via authedAction. 21 unit tests.
- Task 3: Replaced placeholder dashboard with server-rendered page showing welcome header, last login, and two widget cards (ActionItemsWidget, BusinessPulseWidget) with empty states. Responsive two-column grid.
- Task 4: Installed Sonner toast infrastructure, added Toaster to root layout. Created error.tsx boundary for dashboard route group.
- Task 5: Created docs/dashboard.md with page archetypes, route config pattern, locale resolution docs. Updated docs/index.md.
- Task 6: Full test suite passes (167 tests, 0 regressions). TypeScript compiles. Biome clean.

### Change Log

- 2026-03-11: Story implemented — all 6 tasks completed, 30 new tests added (137 → 167)

### File List

New files:
- src/lib/locale.ts
- src/lib/locale.test.ts
- src/lib/format-date.ts
- src/lib/format-date.test.ts
- src/lib/nav-filter.ts
- src/lib/nav-filter.test.ts
- src/server/services/dashboard.ts
- src/server/services/dashboard.test.ts
- src/server/actions/dashboard.ts
- src/types/dashboard.ts
- src/components/domain/action-items-widget.tsx
- src/components/domain/business-pulse-widget.tsx
- src/app/(app)/dashboard/error.tsx
- src/components/ui/sonner.tsx
- docs/dashboard.md

Modified files:
- src/lib/constants.ts (added NAV_ITEMS, ROLE_LANDING_PAGE)
- src/components/domain/sidebar.tsx (refactored to use NAV_ITEMS)
- src/app/(app)/dashboard/page.tsx (replaced placeholder with server component)
- src/app/(app)/layout.tsx (added scroll container comment)
- src/app/layout.tsx (added Toaster)
- docs/index.md (added Pages section with dashboard link)
- package.json (added sonner dependency)
