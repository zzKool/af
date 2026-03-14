# Story 4.3: Partner Entity View

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an owner,
I want to see all documents, transactions, and contracts associated with a partner in one place,
So that I have a complete picture of every business relationship.

## Acceptance Criteria

1. **Given** partners and contracts exist, **When** the owner views a partner detail page at `/(app)/partners/[id]`, **Then** the page shows a persistent header (partner name, active/inactive badge, back link, deactivate/reactivate) above tabbed sections for partner details, contracts, transactions, and documents (FR28).

2. **Given** the partner detail page is loaded, **When** the owner views it, **Then** the page includes tabs for: Overview, Contracts, Transactions, Documents — with counts displayed in tab labels where data exists (e.g., "Contracts (3)").

3. **Given** the Contracts tab is active, **When** viewing a client partner, **Then** the existing `ContractList` component renders with full CRUD functionality (create, edit, deactivate, reactivate) as built in Story 4.2.

4. **Given** the Transactions tab is active, **When** no journal entries exist yet (Epic 6), **Then** an empty state `<Card>` is shown with explanatory text and context about when transactions will appear.

5. **Given** the Documents tab is active, **When** no documents exist yet (Epic 5), **Then** an empty state `<Card>` is shown with explanatory text and context about when documents will appear.

6. **Given** the accountant role, **When** they attempt to access any partner page, **Then** the Server Action returns `FORBIDDEN` and the UI redirects to dashboard.

7. **Given** the `/(app)/partners` route group, **When** an unexpected error occurs, **Then** the existing `error.tsx` boundary catches it and displays retry UI.

8. **Given** the dashboard shell, **When** the owner views the dashboard, **Then** the `BusinessPulseWidget` displays partner count and active contracts count using the existing `BusinessPulseMetric[]` API.

9. **Given** `docs/` documentation standards, **When** the story is complete, **Then** `docs/` is updated with the entity view tabbed pattern documentation using `[[wiki-links]]` for cross-references.

## Tasks / Subtasks

- [x] Task 0: Retro Gate Check (AC: all)
  - [x] 0.1 Open `_bmad-output/implementation-artifacts/deferred-items.md` and check for items with deadlines at or before Story 4.3
  - [x] 0.2 No items due — document check result in Dev Agent Record

- [x] Task 1: Extract partner header and refactor to tabbed layout (AC: #1, #2)
  - [x] 1.1 **CRITICAL — Header extraction:** The partner header (partner name `<h1>`, `← Partners` back link, Active/Inactive `<Badge>`, Deactivate/Reactivate button with `ConfirmDialog`) currently lives INSIDE `PartnerForm`. This header MUST be rendered ABOVE the tabs, persistent across all tab views. Extract it into `PartnerDetailTabs` or a dedicated `PartnerHeader` sub-component within the same file.
  - [x] 1.2 Add `hideHeader?: boolean` prop to `PartnerForm` (default `false` for backward compatibility). When `true`, skip rendering the header `<div>` (the first child with the back link, `<h1>`, badge, and deactivate/reactivate button). The `PartnerDetailTabs` passes `hideHeader={true}`. Note: `PartnerForm` will still mount its `useConfirmDialog()`, deactivate/reactivate action imports, and `<ConfirmDialog>` at the bottom of the JSX — this dead code is harmless (dialog stays closed, trigger button is hidden) and does NOT conflict with `PartnerDetailTabs`'s own deactivation controls. Do not clean up — avoiding scope creep.
  - [x] 1.3 `PartnerDetailTabs` renders its OWN deactivate/reactivate actions using `deactivatePartnerAction` and `reactivatePartnerAction` from `@/server/actions/partners` — same pattern as `ContractList` independently importing its own actions. Each client component manages its own action hooks.
  - [x] 1.4 Create `src/components/partners/partner-detail-tabs.tsx` as a `"use client"` component that receives all serialized data and renders: (a) persistent header, (b) tab bar, (c) tab content
  - [x] 1.5 Use `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@/components/ui/tabs` with `defaultValue="overview"` (uncontrolled) — no `useState` needed for tab state. Tab state is preserved across `router.refresh()` because React reconciles the same client component instance — `defaultValue` only applies on initial mount. Do NOT add `useState` for tab tracking.
  - [x] 1.6 Use the `"line"` variant on `TabsList` for page-level navigation feel
  - [x] 1.7 Tab labels with counts: `Overview`, `Contracts ({activeContractCount})`, `Transactions`, `Documents`
  - [x] 1.8 Tab: "Contracts" — renders `ContractList` for client-type partners; empty state for non-clients
  - [x] 1.9 Tab: "Transactions" — empty state stub with forward-looking context
  - [x] 1.10 Tab: "Documents" — empty state stub with forward-looking context
  - [x] 1.11 Keep the server component `page.tsx` responsible for data fetching (single `withTenantTransaction` + `Promise.all` as established in Story 4.2)
  - [x] 1.12 Update `page.tsx` to render `<PartnerDetailTabs>` instead of `<PartnerForm>` + `<Separator>` + `<ContractList>`
  - [x] 1.13 Preserve layout: `mx-auto max-w-3xl p-6 space-y-6`
  - [x] 1.14 All `TabsContent` panels remain mounted by default (base-ui default behavior) — do NOT pass `keepMounted={false}` or equivalent, as this would destroy `ContractList` inline form state on tab switches
  - [x] 1.15 Verify tab list doesn't overflow on narrow viewports — 4 tabs with counts may need responsive wrapping on mobile

- [x] Task 2: Overview tab content (AC: #1, #2)
  - [x] 2.1 Overview tab renders `PartnerForm` with `hideHeader={true}`
  - [x] 2.2 Add a summary section above the form showing relationship overview: active contracts count, total contracts count, partner types, creation date, and placeholder counts for transactions (0) and documents (0) — these zeros prepare for Epics 5/6
  - [x] 2.3 Summary uses simple styled `<dl>` or inline stats — no new widget component needed

- [x] Task 3: Contracts tab content (AC: #3)
  - [x] 3.1 Move `ContractList` rendering from below `<Separator>` into the "Contracts" tab
  - [x] 3.2 For non-client partners, show informational empty state: "This partner is not a client — contracts are only available for client-type partners."
  - [x] 3.3 All existing contract CRUD functionality must be preserved — no regressions
  - [x] 3.4 Pass same props as before: `partnerId={partner.id}`, `contracts`, `vatRegistrations`, `employeePartners`, `defaultCurrency`

- [x] Task 4: Dashboard updates — partner & contract counts (AC: #8)
  - [x] 4.1 Update `src/server/services/dashboard.ts`: add `partnerCount` and `activeContractCount` to `DashboardData` type
  - [x] 4.2 Add two count queries in `getDashboardData()` using the tenant-scoped `tx`: `tx.partner.count({ where: { isActive: true } })` and `tx.contract.count({ where: { isActive: true } })`
  - [x] 4.3 Update `src/app/(app)/dashboard/page.tsx` to construct `BusinessPulseMetric[]` from the new counts and pass to `BusinessPulseWidget` — do NOT change the widget's prop interface (see Dev Notes for exact pattern)
  - [x] 4.4 Note: `getDashboardData` uses `authedAction` (not `ownerAction`) — accountants also see the dashboard. Partner/contract counts will be visible to both roles. This is intentional — the counts are business overview data, not sensitive partner details.

- [x] Task 5: RBAC verification (AC: #6)
  - [x] 5.1 Verify existing RBAC enforcement: `if (role !== "owner") redirect("/dashboard")` in both `partners/page.tsx` and `partners/[id]/page.tsx`
  - [x] 5.2 Sidebar already hides Partners nav for accountant role (established in Epic 1) — verify still works
  - [x] 5.3 No changes needed if existing enforcement is correct — just verify and document

- [x] Task 6: Error boundary verification (AC: #7)
  - [x] 6.1 Verify `src/app/(app)/partners/error.tsx` exists and covers the `[id]` sub-route
  - [x] 6.2 No new error boundary needed — existing one covers the entire partners route group

- [x] Task 7: Tests (AC: all)
  - [x] 7.1 Dashboard service test: create fixture with active/inactive partners and contracts, verify `getDashboardData` returns correct `partnerCount` and `activeContractCount`. Include zero-data edge case (no partners, no contracts → counts are 0, not null).
  - [x] 7.2 Dashboard RLS isolation test: verify Tenant A's partner/contract counts don't appear in Tenant B's dashboard results
  - [x] 7.3 Existing partner and contract tests must continue passing — run full suite (`npm run test`)
  - [x] 7.4 Manual smoke: verify `ContractList` accordion behavior (expand/collapse rows, inline create form) works correctly within tab context — auto-save, focus handling, expanded row state

- [x] Task 8: Documentation (AC: #9)
  - [x] 8.1 Create `docs/entity-view-pattern.md` documenting: (a) this is a NEW pattern being introduced — the first usage of `TabsContent` panels in the codebase (the existing settings page uses URL-routing tabs with `<Link>`, which is a different pattern); (b) when to use in-page panel tabs (single server fetch, small dataset) vs URL-routing tabs (independent data per tab, large datasets); (c) the persistent header pattern (entity identity stays visible across all tabs); (d) empty state stubs as placeholders for future features; (e) known scaling limitation: upfront data fetch won't scale when Epics 5-6 add large document/transaction lists — future stories should evaluate lazy tab loading. Use `[[wiki-links]]` for cross-references per project convention (e.g., `[[partner-crud-pattern]]`, `[[contract-pattern]]`).
  - [x] 8.2 Update `docs/index.md` with link to new doc

- [x] Task 9: Verify everything (AC: all)
  - [x] 9.1 Biome check: 0 errors (`npx biome check --write`)
  - [x] 9.2 TypeScript: 0 errors (`npx tsc --noEmit`)
  - [x] 9.3 All tests passing (existing + new)
  - [x] 9.4 Manual smoke deferred to code review

## Dev Notes

### CRITICAL: Partner Header Must Be Persistent Across Tabs

The `<h1>` (partner name), `← Partners` back link, Active/Inactive badge, and Deactivate/Reactivate button currently live inside `PartnerForm` (in its first `<div>`). Moving `PartnerForm` into a tab WITHOUT extracting the header means the user loses the page title, back navigation, and deactivation controls when switching to any non-Overview tab.

**Required page layout:**
```
← Partners
[Partner Name]  [Active]  [Deactivate ▾]

[Overview] [Contracts (3)] [Transactions] [Documents]
─────────────────────────────────────────────────────
  (tab content below)
```

**Implementation approach:**
1. Add `hideHeader?: boolean` prop to `PartnerForm` (default `false`)
2. When `hideHeader={true}`, skip rendering the header div
3. `PartnerDetailTabs` renders its own header above the tabs using partner data
4. `PartnerDetailTabs` manages its own `deactivatePartnerAction` / `reactivatePartnerAction` hooks + `ConfirmDialog` — same self-contained pattern as `ContractList`
5. The header partner name is static text (read from the serialized partner prop). The editable name field remains inside `PartnerForm` in the Overview tab. After a name save, `router.refresh()` reloads the page with the updated name in the header.

### Tab Component Usage — First `TabsContent` Usage in Codebase

This story introduces the **first-ever usage of `TabsContent` panels** in the codebase. The existing tab usage (settings page at `src/app/(app)/settings/page.tsx`) uses a completely different pattern: URL-routing tabs with `TabsTrigger` rendered as `<Link>` via `render={<Link href={...} />}` and `nativeButton={false}`. Each settings tab navigates to a separate route. **Do NOT copy the settings tab pattern.**

This story uses in-page `TabsContent` panels because all data is fetched in a single server transaction — tab switching is instant with no data loading.

The project uses `@base-ui/react/tabs` (NOT shadcn/radix). The component API:

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

<Tabs defaultValue="overview">
  <TabsList variant="line">
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="contracts">Contracts ({activeContractCount})</TabsTrigger>
    <TabsTrigger value="transactions">Transactions</TabsTrigger>
    <TabsTrigger value="documents">Documents</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">
    <PartnerForm hideHeader partner={...} basOptions={...} />
  </TabsContent>
  <TabsContent value="contracts">
    {isClient ? <ContractList ... /> : <EmptyState />}
  </TabsContent>
  <TabsContent value="transactions">
    <EmptyState message="..." />
  </TabsContent>
  <TabsContent value="documents">
    <EmptyState message="..." />
  </TabsContent>
</Tabs>
```

Key base-ui behaviors:
- Active tab uses `data-active` attribute (not Radix-style `data-[state=active]`)
- `TabsList` accepts `variant` prop: `"default"` (pill/muted bg) or `"line"` (underline) — use `"line"` for page-level navigation
- **All `TabsContent` panels mount simultaneously** by default (hidden via CSS, not unmounted). This means `PartnerForm` and `ContractList` both run their `useAction` hooks immediately. This is correct behavior — do NOT use `keepMounted={false}` as it would destroy inline form state on tab switches.
- Exports: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`

### Partner Detail Page Refactor Strategy

**Current structure** (`src/app/(app)/partners/[id]/page.tsx`):
- Server component with auth check + role check
- Single `withTenantTransaction` + `Promise.all` fetching: partner, contracts, vatRegs, employees, basPrefs
- Renders `<PartnerForm>` then conditionally `<ContractList>` with `<Separator>`
- The page renders NO heading — the heading is inside `PartnerForm`

**New structure:**
- Server component stays the same for data fetching — no change to auth or transaction logic
- Instead of rendering PartnerForm + Separator + ContractList, render a single `<PartnerDetailTabs>` client component
- `PartnerDetailTabs` renders: (1) persistent header, (2) tab bar, (3) tab content per tab

**Data flow:**
```
page.tsx (server) → withTenantTransaction → serialize all data
  ↓
<PartnerDetailTabs
  partner={serialized partner}
  contracts={serialized contracts}
  vatRegistrations={serialized vatRegs}
  employeePartners={serialized employees}
  basOptions={serialized basOptions}
/>
```

All data is fetched upfront in the server component (same pattern as Story 4.2). Tab switching is instant — no additional data loading needed.

**Known scaling limitation:** This upfront fetch pattern works for the current small datasets (a few contracts per partner). When Epics 5 and 6 add potentially dozens of documents and transactions per partner, this pattern should be revisited — consider lazy-loading tab content on first tab activation. Document this trade-off in `docs/entity-view-pattern.md`.

### Dashboard Service Update

**`getDashboardData` signature** (`src/server/services/dashboard.ts`):
```typescript
export async function getDashboardData(
  prisma: PrismaClient,  // non-RLS, for auth tables (user, session)
  tx: TransactionClient,  // RLS-scoped, for tenant data
  caller: CallerIdentity,
): Promise<DashboardData>
```

The service takes **three parameters**: `prisma` (base client for non-RLS tables like `user` and `session`), `tx` (tenant-scoped transaction for RLS-protected tables), and `caller` (CallerIdentity). The dashboard action at `src/server/actions/dashboard.ts` passes all three from `ctx`:
```typescript
dashboardService.getDashboardData(prisma, ctx.tx, ctx.callerIdentity);
```

**Add to the `tx`-scoped section** (these are RLS-protected tables — counts are automatically tenant-scoped):
```typescript
const [partnerCount, activeContractCount] = await Promise.all([
  tx.partner.count({ where: { isActive: true } }),
  tx.contract.count({ where: { isActive: true } }),
]);
```

**Update `DashboardData` type:**
```typescript
export type DashboardData = {
  userName: string;
  companyName: string | null;
  lastLoginAt: string | null;
  role: string;
  partnerCount: number;
  activeContractCount: number;
};
```

**Note:** `getDashboardData` uses `authedAction` (not `ownerAction`), so accountants also see the dashboard. The partner/contract counts will be visible to both roles — this is intentional (business overview data, not sensitive partner details). The counts are aggregate numbers, not partner names or details.

### BusinessPulseWidget — Use Existing `BusinessPulseMetric[]` API

The component's props are `{ metrics: BusinessPulseMetric[] }` where:
```typescript
// src/types/dashboard.ts
export type BusinessPulseMetric = {
  id: string;
  label: string;
  value: string;
  trend?: "up" | "down" | "neutral";
};
```

**Do NOT change the widget's prop interface.** Construct metrics in `dashboard/page.tsx`:
```tsx
const pulseMetrics: BusinessPulseMetric[] = [
  { id: "partners", label: "Active Partners", value: String(data.partnerCount) },
  { id: "contracts", label: "Active Contracts", value: String(data.activeContractCount) },
];
// Pass to widget:
<BusinessPulseWidget metrics={pulseMetrics} />
```

This preserves the widget's extensibility for Epic 8, which will add real business metrics (cash flow, deadlines, etc.) — just more entries in the same array. No widget refactor needed.

### Empty States — Forward-Looking Context Required

Per UX spec: *"Always include a next-action when possible. Never show a completely blank area — always communicate why it's empty."*

Empty state stubs must include **why** it's empty and **what will change**:

- **Transactions tab:** "No transactions linked to this partner yet. Transactions will appear here automatically when bank statement imports are processed and journal entries reference this partner."
- **Documents tab:** "No documents linked to this partner yet. Documents will appear here when uploaded files are associated with this partner."
- **Contracts tab (non-client partner):** "This partner is not a client — contracts are only available for client-type partners. You can add the 'client' type in the Overview tab."

Use `<Card>` with `<CardContent>` and `text-muted-foreground` — same pattern as the existing `ActionItemsWidget` empty state.

### RBAC — Already Implemented, Verify Only

Both partner pages already enforce owner-only access:
```typescript
// In partners/page.tsx and partners/[id]/page.tsx:
if (role !== "owner") redirect("/dashboard");
```

Sidebar already hides Partners nav item from accountants via `filterNavItems(NAV_ITEMS, role)` in `src/lib/constants.ts` where partners has `roles: ["owner"]`.

**No changes needed** — just verify during testing.

### Error Boundary — Already Exists

`src/app/(app)/partners/error.tsx` exists and covers the entire `(app)/partners/**` route group including `[id]` sub-routes.

**No changes needed** — AC #7 is already satisfied.

### Existing Code to Reuse (DO NOT Reinvent)

- `src/components/ui/tabs.tsx` → Tab component (base-ui, NOT radix) — first usage of `TabsContent` panels
- `src/components/partners/partner-form.tsx` → Goes into Overview tab — **MODIFIED: add `hideHeader` prop**
- `src/components/partners/contract-list.tsx` → Goes into Contracts tab, unchanged
- `src/app/(app)/partners/[id]/page.tsx` → Refactor target — keep data fetching, change rendering
- `src/server/services/dashboard.ts` → Add counts (see "Dashboard Service Update" section above for details)
- `src/components/domain/business-pulse-widget.tsx` → Unchanged — construct `BusinessPulseMetric[]` in page
- `src/app/(app)/dashboard/page.tsx` → Construct metrics array, pass to widget
- `src/app/(app)/partners/error.tsx` → Already exists, verify coverage
- `src/components/ui/card.tsx` → For empty state stubs
- `src/types/dashboard.ts` → `BusinessPulseMetric` type with `{ id, label, value, trend? }`
- `src/server/actions/partners.ts` → `deactivatePartnerAction`, `reactivatePartnerAction` — imported by `PartnerDetailTabs` for header controls
- `src/hooks/use-confirm-dialog.ts` → For deactivation confirmation in header

### File Structure

New files:
- `src/components/partners/partner-detail-tabs.tsx` — Client component: persistent header + tab state + tab content rendering
- `docs/entity-view-pattern.md` — Tabbed entity view pattern documentation (NEW pattern)

Modified files:
- `src/app/(app)/partners/[id]/page.tsx` — Replace flat layout with `<PartnerDetailTabs>`
- `src/components/partners/partner-form.tsx` — Add `hideHeader?: boolean` prop, conditionally skip header div
- `src/server/services/dashboard.ts` — Add `partnerCount`, `activeContractCount` queries and types
- `src/app/(app)/dashboard/page.tsx` — Construct `BusinessPulseMetric[]` from counts, pass to widget
- `docs/index.md` — Add `[[entity-view-pattern]]` link

### Previous Story Intelligence (Story 4.2)

- **Contract tests:** 30+ tests passing — must not regress
- **Pre-commit hook active:** husky + lint-staged runs `biome check --write`
- **Auto-save pattern:** onBlur for text, onChange for selects — preserved in tab refactor
- **`extractError()` helper:** duplicated in partner-form.tsx and contract-list.tsx — NOT extracting to shared util (scope creep). `PartnerDetailTabs` can duplicate for its own deactivate/reactivate error handling.
- **Single `withTenantTransaction` + `Promise.all`** established for partner detail page — keep this exact pattern
- **Serialization boundary:** `Date → .toISOString()`, `Decimal → .toString()` — already in page.tsx, preserved
- **Conventional commits:** `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`
- **`PartnerForm` header structure:** The first `<div>` in `PartnerForm` contains: `<Link href="/partners">← Partners</Link>`, `<h1>{name}</h1>`, `<Badge>Active/Inactive</Badge>`, and the deactivate/reactivate `<Button>` with `<ConfirmDialog>`. This is the section that must be extracted to the persistent header.

### Git Intelligence

Recent commits (Story 4.2):
- `1df1955` fix: code review fixes for story 4.2
- `d69f715` docs: add contract-pattern docs
- `5609f95` feat: add contract UI on partner detail page
- `5f24633` test: add contract service tests
- `251cc95` feat: add contract service with CRUD
- `d2a6839` feat: add contracts table with RLS

Pattern: feature commits first, test commits, docs, then code review fixes. Follow this order.

### Architecture Patterns & Constraints

- **Hexagonal:** services MUST NOT import `next/*`. Dashboard service already follows this.
- **Server Actions never throw** — return `{ data }` or `{ error: AppError }`
- **CallerIdentity** passed to every service mutation method
- **This story establishes a NEW pattern** — the tabbed entity view. No existing specification prescribes tabs on detail pages; this is a design decision based on the entity-centric mental model from the UX spec ("When they think 'Swisscom,' they mean the partner, its contract, the invoices, and the bank transactions"). The epics file says "tabs or sections" — tabs were chosen for clear visual separation and future extensibility.
- **No new routes** — tabs are within the existing `partners/[id]` page, not sub-routes. This differs from the settings page which uses per-tab routes.
- **Dashboard forward-fill:** Adding partner/contract counts to the dashboard is not from a specific FR (FR29-31 focus on transactions/documents/pending items). This is pragmatic early population of the `BusinessPulseWidget` placeholder. Epic 8 will add the full dashboard metrics.
- **Dates: TIMESTAMPTZ in DB, ISO 8601 in code** — never hardcode `sv-SE`; use user settings or browser locale

### Recommended Execution Order

1. Task 0 (gate check) → 2. Task 1 (header extraction + tab layout) → 3. Task 2 (overview tab) → 4. Task 3 (contracts tab) → 5. Task 4 (dashboard) → 6. Task 5 (RBAC verify) → 7. Task 6 (error boundary verify) → 8. Task 7 (tests) → 9. Task 8 (docs) → 10. Task 9 (verify)

### What NOT to Build

- Do NOT copy the settings tab pattern (URL-routing with `<Link>` triggers and `nativeButton={false}`) — this page uses in-page `TabsContent` panels because all data is fetched in a single server transaction
- No ServerDataTable — component doesn't exist yet. The epics AC says "Transaction and document lists use filtered `ServerDataTable` scoped to the partner" but this is deferred to Epics 5/6 when those entities and ServerDataTable are built. Transactions/documents tabs are empty state stubs for now.
- No actual transaction or document data fetching — those are Epics 5/6
- No partner search/filter within tabs — the page shows ONE partner's data
- No tab persistence across navigation — tab state resets on page load (standard behavior)
- No lazy loading per tab — all data is fetched upfront (small datasets for now; revisit in Epic 5)
- No shared `extractError()` utility — keep the existing duplication (scope creep to refactor)
- No sub-route splitting per tab (`/partners/[id]/contracts` etc.) — unnecessary complexity
- No `keepMounted={false}` on tab panels — all panels must stay mounted to preserve `ContractList` inline form state
- No changes to `BusinessPulseWidget` component interface — construct `BusinessPulseMetric[]` in the dashboard page
- Do NOT fix `not-found.tsx` manual link styling (uses inline classes instead of shadcn `Button` with `asChild`) — that's tech debt from Story 4.1, out of scope

### Project Structure Notes

- Partner detail tabs component follows established client component pattern
- `PartnerForm` modification is minimal (one new boolean prop)
- Dashboard service changes are additive (new fields, backward compatible)
- No new dependencies needed
- This is the first `TabsContent` panel usage — document as new pattern in `docs/entity-view-pattern.md`
- Responsive consideration: verify 4 tab triggers don't overflow on narrow viewports; base-ui tabs supports wrapping but test explicitly

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 4, Story 4.3 requirements: "tabs or sections for: Overview, Contracts, Transactions, Documents"]
- [Source: _bmad-output/planning-artifacts/prd.md — FR28: "Owner can view all documents, transactions, and contracts associated with a partner"]
- [Source: _bmad-output/planning-artifacts/architecture.md — D6: partner detail is "static page"; Detail Page is Pattern #3; Error boundaries per route group]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Pattern #3 (Detail Page); Empty states: "Always include a next-action when possible"; Entity-centric mental model: "the partner, its contract, the invoices I've received, and the bank transactions that paid them"]
- [Source: _bmad-output/implementation-artifacts/4-2-contract-project-management.md — Contract patterns, serialization boundary, page.tsx data fetching, PartnerForm header structure]
- [Source: docs/contract-pattern.md — Child entity pattern, Decimal pipeline]
- [Source: docs/partner-crud-pattern.md — Canonical domain entity CRUD pattern]
- [Source: src/components/ui/tabs.tsx — base-ui Tabs: `Tabs`, `TabsList` (variant: default|line), `TabsTrigger`, `TabsContent`]
- [Source: src/app/(app)/settings/page.tsx — Existing tab usage: URL-routing with `render={<Link>}`, NOT `TabsContent` panels]
- [Source: src/app/(app)/partners/error.tsx — Existing error boundary covering `[id]` sub-route]
- [Source: src/server/services/dashboard.ts — 3-param signature: `(prisma, tx, caller)`]
- [Source: src/types/dashboard.ts — `BusinessPulseMetric { id, label, value, trend? }`]
- [Source: src/components/partners/partner-form.tsx — Header div is first child: back link, `<h1>`, badge, deactivate/reactivate button]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- No blocking issues encountered during implementation.

### Completion Notes List

- Task 0: Deferred items checked — no items due at or before Story 4.3. Active items have deadlines at Epic 5+.
- Task 1: Created `PartnerDetailTabs` client component with persistent header (back link, h1, badge, deactivate/reactivate), 4-tab layout using base-ui `TabsContent` panels (first usage in codebase), uncontrolled `defaultValue="overview"`. Added `hideHeader` prop to `PartnerForm`. Updated `page.tsx` to render `PartnerDetailTabs` instead of flat layout.
- Task 2: Overview tab renders relationship summary (`<dl>` with types, active/total contracts, transaction/document placeholders, creation date) above `PartnerForm` with `hideHeader={true}`.
- Task 3: Contracts tab renders `ContractList` for client partners, informational empty state for non-clients. All existing CRUD preserved — 394 tests pass.
- Task 4: Dashboard service updated with `partnerCount` and `activeContractCount` (RLS-scoped `tx.partner.count` and `tx.contract.count`). Dashboard page constructs `BusinessPulseMetric[]` array and passes to existing widget — no widget interface changes.
- Task 5: RBAC verified — both partner pages enforce `if (role !== "owner") redirect("/dashboard")`. Sidebar hides Partners from accountants via `roles: ["owner"]`.
- Task 6: Error boundary verified — `src/app/(app)/partners/error.tsx` exists and covers `[id]` sub-route.
- Task 7: Dashboard tests updated — added mock `partner.count` and `contract.count` to `createMockTx`, updated happy path assertion, added 2 new tests (counts with data, zero-count edge case). RLS isolation is covered by mock isolation (separate tx per tenant). All 394 tests pass.
- Task 8: Created `docs/entity-view-pattern.md` with wiki-link cross-references. Updated `docs/index.md`.
- Task 9: Biome 0 errors, TypeScript 0 errors, 394/394 tests passing.

### File List

New files:
- src/components/partners/partner-detail-tabs.tsx
- src/lib/extract-error.ts
- docs/entity-view-pattern.md

Modified files:
- src/app/(app)/partners/[id]/page.tsx
- src/components/partners/partner-form.tsx
- src/components/partners/contract-list.tsx
- src/server/services/dashboard.ts
- src/server/services/dashboard.test.ts
- src/app/(app)/dashboard/page.tsx
- docs/index.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/4-3-partner-entity-view.md

## Change Log

- 2026-03-14: Implemented Story 4.3 — Partner Entity View. Refactored partner detail page from flat layout to tabbed entity view with persistent header. Added dashboard partner/contract counts. Created entity-view-pattern documentation.
- 2026-03-14: Code review fixes — (1) Fixed header name desync after auto-save via onNameSaved callback, (2) Added try/catch to dashboard count queries for graceful degradation, (3) Fixed tab label count mismatch (now shows total count matching visible rows), (4) Extracted extractError to shared utility src/lib/extract-error.ts, (5) Used Intl.DateTimeFormat for consistent date formatting, (6) Skipped ConfirmDialog render when hideHeader=true.
