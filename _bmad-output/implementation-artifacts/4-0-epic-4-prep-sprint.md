# Story 4.0: Epic 4 Prep Sprint

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a development team,
I want to complete all prep sprint tasks identified in the Epic 3 retrospective,
so that Epic 4 stories (4.1–4.3) have proper UI patterns, automated formatting, cross-table RLS confidence, client-side quality checklists, and an up-to-date deferred items register.

## Acceptance Criteria

1. **Given** three settings tabs (`bank-accounts-tab`, `vat-registrations-tab`, `document-type-prefixes-tab`) use native `confirm()` for delete confirmations
   **When** the prep sprint is complete
   **Then** a shared `<ConfirmDialog>` component built on shadcn/ui AlertDialog replaces all native `confirm()` calls, providing consistent accessible UX with customizable title, description, action labels, async loading state during the delete action, and Cancel-first focus order for safe keyboard navigation

2. **Given** Biome formatting is a manual step that gets forgotten under time pressure (Story 3.4 had 8 uncommitted files)
   **When** the prep sprint is complete
   **Then** husky + lint-staged is configured so that `biome check --write` runs automatically on staged files at pre-commit, making it impossible to commit unformatted code

3. **Given** Epic 4 introduces the first inter-entity FK relationships (Partner → VatRegistration, Contract → DocumentTypePrefix)
   **When** the prep sprint is complete
   **Then** a spike has verified that RLS isolation holds correctly when querying across related tenant tables via FK joins, and findings are documented in `docs/cross-table-rls.md`

4. **Given** the existing `assertRlsIsolation` helper only tests single-table isolation
   **When** the prep sprint is complete
   **Then** an `assertCrossTableRlsIsolation` test helper exists in `config-crud-helpers.ts` that verifies tenant isolation across FK-joined tables, preventing cross-tenant data leakage through relationships

5. **Given** Epic 3 retro identified recurring client-side bugs (stale closures, missing error toasts, React key collisions, optimistic update rollback)
   **When** the prep sprint is complete
   **Then** the story creation checklist (`docs/story-creation-checklist.md`) includes a "Client-Side UI Checklist" section with mandatory items for error handling with toast, stale closure avoidance, unique React keys, and optimistic update rollback

6. **Given** Epic 3 produced 4 new deferred items (#7–#10) and the register was last updated at Story 3.3
   **When** the prep sprint is complete
   **Then** the deferred items register is updated with: Epic 3 retro items added, all deadlines reviewed for Epic 4 relevance, item #9 (AlertDialog) marked resolved by Task 1 of this story

## Tasks / Subtasks

- [x] Task 0: Retro Gate Check (AC: all)
  - [x] 0.1 Open `_bmad-output/implementation-artifacts/deferred-items.md` and check for items with deadlines at or before Epic 4
  - [x] 0.2 Verify item #9 (replace `confirm()` with AlertDialog) is addressed by Task 1
  - [x] 0.3 Verify no other items have passed their deferral deadline
  - [x] 0.4 Document check result in Dev Agent Record

- [x] Task 1: Shared ConfirmDialog component (AC: #1)
  - [x] 1.1 Add shadcn/ui AlertDialog component: `npx shadcn@latest add alert-dialog` — this installs `@radix-ui/react-alert-dialog` and generates `src/components/ui/alert-dialog.tsx`
  - [x] 1.2 Create `src/components/ui/confirm-dialog.tsx` — a reusable wrapper around AlertDialog with props: `open`, `onOpenChange`, `title` (default: "Are you sure?"), `description`, `confirmLabel` (default: "Delete"), `cancelLabel` (default: "Cancel"), `onConfirm`, `isLoading`, `variant` (default: "destructive"). Use shadcn AlertDialog primitives (AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction). Footer order: Cancel first, then confirm button (so Cancel receives initial focus for safe keyboard navigation). Confirm button shows loading spinner and both buttons are disabled while `isLoading` is true.
  - [x] 1.3 Create `src/hooks/use-confirm-dialog.ts` — a React hook that manages open/close state, pending async action, and loading state. Returns `{ dialogProps, confirm }` where `confirm(asyncAction, opts?)` stores the action, opens the dialog. On confirm click: sets `isLoading=true`, awaits the async action, closes dialog on success, shows error toast on failure and keeps dialog open. On cancel: discards action, closes. `opts` accepts `{ description?: string }` to override the dialog description per call.
  - [x] 1.4 Replace `confirm()` in `src/components/settings/bank-accounts-tab.tsx:170` with `useConfirmDialog` + `<ConfirmDialog>`. Include entity name in description: e.g. `Delete "${account.name}" bank account? This cannot be undone.`
  - [x] 1.5 Replace `confirm()` in `src/components/settings/vat-registrations-tab.tsx:167` with `useConfirmDialog` + `<ConfirmDialog>`. Include entity name in description: e.g. `Delete "${reg.country}" VAT registration? This cannot be undone.`
  - [x] 1.6 Replace `confirm()` in `src/components/settings/document-type-prefixes-tab.tsx:115` with `useConfirmDialog` + `<ConfirmDialog>`. Include entity name in description: e.g. `Delete "${prefix.prefix}" document prefix? This cannot be undone.`
  - [x] 1.7 Write unit tests for `useConfirmDialog` hook: opens on confirm call, closes on cancel, executes async action on confirm with loading state, shows error toast on action failure, handles multiple sequential confirms
  - [x] 1.8 Manually verify all three settings tabs still work: delete flow shows dialog, cancel aborts, confirm deletes

- [x] Task 2: Biome pre-commit hook (AC: #2)
  - [x] 2.1 Install husky and lint-staged: `npm install --save-dev husky lint-staged`
  - [x] 2.2 Initialize husky: `npx husky init` — this creates `.husky/` directory and a pre-commit hook file
  - [x] 2.3 Configure lint-staged in `package.json`: `"lint-staged": { "*.{ts,tsx,js,jsx,json,css}": ["biome check --write --no-errors-on-unmatched"] }`
  - [x] 2.4 Update `.husky/pre-commit` to run `npx lint-staged`
  - [x] 2.5 Test the hook: stage a file with formatting issues, attempt commit, verify Biome auto-fixes and the commit succeeds with formatted code
  - [x] 2.6 Test edge case: stage a file with lint errors (not just formatting), verify the commit is blocked with clear error output

- [x] Task 3: Cross-table FK under RLS spike (AC: #3)
  - [x] 3.1 Design a minimal spike test: create two related tables in a test migration (or use existing tables like `bas_categories` + a temporary FK reference) to verify RLS behavior when querying across FK joins
  - [x] 3.2 Test scenario 1: Prisma `findMany({ include: { relatedTable: true } })` — does RLS on the parent table prevent seeing child records from other tenants?
  - [x] 3.3 Test scenario 2: Prisma `findMany({ where: { relatedTable: { someField: value } } })` — does filtering through FK respect RLS on both tables?
  - [x] 3.4 Test scenario 3: Raw SQL `JOIN` across two RLS-protected tables — verify tenant isolation holds
  - [x] 3.5 Test scenario 4: Prisma `create` with `connect` referencing another tenant's record — can tenant A set a FK to tenant B's entity? (PostgreSQL FK constraints are checked by table owner role, which bypasses RLS. If this succeeds, document that service-level FK validation is required before saving.)
  - [x] 3.6 Document findings in `docs/cross-table-rls.md`: what works, what doesn't, any gotchas for Epic 4's Partner → VatRegistration FK. If FK constraints bypass RLS, document the service-level validation pattern.
  - [x] 3.7 If issues found: document workaround recommendations (e.g., explicit tenant_id WHERE clauses, service-level validation)

- [x] Task 4: `assertCrossTableRlsIsolation` test helper (AC: #4) — **depends on Task 3 findings; helper design may be revised based on spike results**
  - [x] 4.1 Add `assertCrossTableRlsIsolation` to `src/server/test-utils/config-crud-helpers.ts`. Signature: `assertCrossTableRlsIsolation(prisma, parentModel, childModel, parentTenantAId, parentTenantBId, includeRelation)`. Verifies: (a) parent query with `include` only returns own-tenant children, (b) cross-tenant FK references are invisible. If Task 3 reveals FK constraints bypass RLS, also verify that service-level validation catches cross-tenant FK references.
  - [x] 4.2 Write tests for the helper itself using existing RLS-protected tables (e.g., `tenantConfig` + `tenant` if they have a relationship, or the tables identified in the spike)
  - [x] 4.3 Update `docs/config-page-test-template.md` to document the new helper's usage for inter-entity stories

- [x] Task 5: Client-side checklist in story creation template (AC: #5)
  - [x] 5.1 Add a "Client-Side UI Checklist" section to `docs/story-creation-checklist.md` after the existing "Mutation Story Checklist" section
  - [x] 5.2 Include these mandatory checklist items:
    - Error handling: All Server Action failures surfaced via toast (never silent failures)
    - Stale closure avoidance: Callbacks in `useEffect`/event handlers use refs or functional updates for mutable state
    - Unique React keys: List items use stable unique IDs (never array index for dynamic lists)
    - Optimistic update rollback: If using optimistic updates, rollback on Server Action failure
    - Confirm dialog: Delete operations use `<ConfirmDialog>` (never native `confirm()`)
  - [x] 5.3 Add a brief rationale note for each item referencing the Epic 3 retro findings

- [x] Task 6: Update deferred items register (AC: #6)
  - [x] 6.1 Update `_bmad-output/implementation-artifacts/deferred-items.md`:
    - Move item #9 (replace `confirm()`) to Resolved section with note "Story 4.0 Task 1 — shared ConfirmDialog component"
    - Add any new items from Epic 3 retro that aren't already captured (items #7–#10 should already be there from Story 3.3 review)
  - [x] 6.2 Review all active items: verify deadlines are still appropriate for current project stage
  - [x] 6.3 Update "Last updated" date
  - [x] 6.4 Update `docs/index.md` with link to any new docs created (e.g., `cross-table-rls.md`)

- [x] Task 7: Verify everything (AC: all)
  - [x] 7.1 Run full test suite: `npm run test` — all existing 306+ tests + new tests pass
  - [x] 7.2 Run `npm run lint` (Biome check) — clean (only pre-existing warnings)
  - [x] 7.3 Run `npm run e2e` — no regressions (2 pre-existing failures on develop, not introduced by this story)
  - [x] 7.4 Verify the pre-commit hook works: stage a change, commit, confirm Biome runs
  - [x] 7.5 Verify `npm run dev` starts without warnings related to changes

## Dev Notes

### Architecture Patterns & Constraints

- **This is a housekeeping/infrastructure story** — similar to Story 3.0. Mix of UI component work (ConfirmDialog), tooling (husky), research (RLS spike), test utilities, and documentation.
- **No new domain models, no new pages, no new server actions.** The ConfirmDialog is a shared UI component, not domain-specific.
- **shadcn/ui AlertDialog** is the correct primitive — it's built on Radix UI's AlertDialog which handles focus management, keyboard navigation, and screen reader announcements. Current shadcn version: `shadcn@4.0.2`.
- **husky + lint-staged** is the standard pre-commit hook approach for Node.js projects. Biome's `--write` flag auto-fixes formatting and some lint rules. The `--no-errors-on-unmatched` flag prevents failures when no matching files are staged.

### Recommended Execution Order

Tasks are numbered by topic but should be executed in this order for maximum benefit:
1. Task 0 (gate check) → 2. **Task 2 (husky)** → 3. Task 1 (ConfirmDialog) → 4. Task 3 (RLS spike) → 5. Task 4 (helper, depends on Task 3) → 6. Task 5 (checklist) → 7. Task 6 (deferred register) → 8. Task 7 (verification)

Rationale: Installing the pre-commit hook first means all subsequent commits benefit from automated formatting. Tasks 3→4 are sequential because the spike findings inform the helper design.

### ConfirmDialog — Design Decision

The pattern replaces synchronous `window.confirm()` with an async React pattern:

```tsx
// Before (native confirm — blocks thread, unstyled, not accessible):
const handleDelete = (id: string) => {
  if (!confirm("Delete?")) return;
  deleteAction(id);
};

// After (ConfirmDialog — async, styled, accessible, loading-aware):
const { dialogProps, confirm } = useConfirmDialog();
const handleDelete = (id: string) => {
  confirm(
    async () => { await deleteAction(id); },
    { description: `Delete "${item.name}"? This cannot be undone.` }
  );
};
// ... render <ConfirmDialog {...dialogProps} />
```

The `useConfirmDialog` hook stores the pending async action in a ref, opens the dialog. On confirm click: sets `isLoading=true`, awaits the action, closes on success, toasts on error. On cancel: discards action, closes. Footer renders Cancel before Delete so Cancel receives initial focus (Radix default) — safe keyboard navigation for destructive actions.

### Cross-Table RLS Spike — Context

PostgreSQL RLS policies are applied per-table. When Prisma generates JOINs (via `include` or relation filters), each table's RLS policy is evaluated independently. In theory, this means:
- Parent query filtered by tenant → only own-tenant parents
- JOIN to child table → child's RLS also filters by tenant
- Result: complete tenant isolation even across FK joins

The spike needs to **verify** this experimentally, because:
- Prisma's query generation may use subqueries vs JOINs depending on the operation
- Edge cases with `connectOrCreate`, `upsert`, or nested writes might bypass expectations
- The `SET LOCAL app.tenant_id` approach means both tables see the same tenant context within a transaction

Epic 4 FK relationships:
- `partners.default_bas_category_id` → `bas_categories.id` (same-tenant FK)
- `contracts.partner_id` → `partners.id` (same-tenant FK)
- `contracts.vat_registration_id` → `vat_registrations.id` (same-tenant FK)

### Existing `confirm()` Locations (3 files)

1. `src/components/settings/bank-accounts-tab.tsx:170` — "Delete this bank account? This cannot be undone."
2. `src/components/settings/vat-registrations-tab.tsx:167` — "Delete this VAT registration? This cannot be undone."
3. `src/components/settings/document-type-prefixes-tab.tsx:115` — "Delete this document prefix? This cannot be undone."

All three follow the same pattern: `if (!confirm(msg)) return;` at the top of a delete handler.

### Previous Story Intelligence (Story 3.4 & Story 3.0)

- **306 tests passing** across the suite — must not regress
- **Story 3.0 established the prep sprint pattern** — follow the same structure: infrastructure tasks, documentation, test utilities, verification
- **Biome check before commit** — `npx biome check --write` (Task 2 automates this)
- **Conventional commits:** `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`
- **E2E auth setup** requires setting active org after login (see `e2e/auth.spec.ts`)

### What NOT to Build

- No new domain models (partners, contracts — that's Stories 4.1–4.3)
- No new pages or routes
- No new server actions or services
- No changes to the sidebar, dashboard, or navigation
- No database migrations (unless the RLS spike requires a temporary test table)
- Do not change existing delete behavior — only replace the confirmation UI

### Project Structure Notes

New files:
- `src/components/ui/alert-dialog.tsx` (generated by shadcn)
- `src/components/ui/confirm-dialog.tsx`
- `src/hooks/use-confirm-dialog.ts`
- `src/hooks/use-confirm-dialog.test.ts`
- `docs/cross-table-rls.md`
- `.husky/pre-commit`

Modified files:
- `src/components/settings/bank-accounts-tab.tsx` (replace confirm())
- `src/components/settings/vat-registrations-tab.tsx` (replace confirm())
- `src/components/settings/document-type-prefixes-tab.tsx` (replace confirm())
- `src/server/test-utils/config-crud-helpers.ts` (add assertCrossTableRlsIsolation)
- `docs/story-creation-checklist.md` (add client-side checklist)
- `docs/config-page-test-template.md` (document new helper)
- `docs/index.md` (add new doc links)
- `_bmad-output/implementation-artifacts/deferred-items.md` (resolve item #9, update dates)
- `package.json` (husky, lint-staged dependencies)
- `package-lock.json` (husky, lint-staged dependencies)

### References

- [Source: _bmad-output/implementation-artifacts/epic-3-retro-2026-03-13.md — Prep Sprint section (6 tasks), process improvements, tech debt items #9]
- [Source: _bmad-output/implementation-artifacts/deferred-items.md — Item #9 (AlertDialog), all active items for deadline review]
- [Source: _bmad-output/implementation-artifacts/3-0-epic-3-prep-sprint.md — Previous prep sprint pattern and structure]
- [Source: _bmad-output/planning-artifacts/architecture.md — RLS strategy, Prisma patterns, testing tiers]
- [Source: _bmad-output/planning-artifacts/epics.md — Epic 4 stories 4.1-4.3 for FK context]
- [Source: docs/story-creation-checklist.md — Existing checklist to extend with client-side items]
- [Source: src/server/test-utils/config-crud-helpers.ts — Existing helpers to extend with cross-table assertion]
- [Source: src/components/settings/bank-accounts-tab.tsx:170, vat-registrations-tab.tsx:167, document-type-prefixes-tab.tsx:115 — confirm() locations to replace]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

**Task 0 — Retro Gate Check (2026-03-13):**
- Item #9 (replace confirm() with AlertDialog): ✅ Addressed by Task 1 of this story
- Items #11, #12, #13 have Epic 4 deadlines but are SM responsibilities during Story 4.1/4.2 creation — not overdue
- Items #4–#8, #10: deadlines are Epic 5+ — no action needed now
- No items have passed their deferral deadline. Gate check PASSED.

### Completion Notes List

- Task 0: Retro gate check passed — no items past deadline, item #9 confirmed addressed by Task 1
- Task 2: husky + lint-staged installed and configured, pre-commit hook auto-formats staged files via Biome
- Task 1: Shared ConfirmDialog built on Base UI AlertDialog (shadcn v4), useConfirmDialog hook with async loading/error handling, replaced native confirm() in 3 settings tabs, 9 unit tests
- Task 3: RLS spike confirmed: JOINs respect RLS per-table, but FK constraints bypass RLS (PostgreSQL design). Service-level validation required for cross-tenant FK writes.
- Task 4: assertCrossTableRlsIsolation helper added to config-crud-helpers.ts, tested with bankAccount → bankFormat relation, docs updated
- Task 5: Client-Side UI Checklist added to story-creation-checklist.md with 5 mandatory items and rationale from Epic 3 retro
- Task 6: Deferred item #9 resolved, all active items reviewed, docs/index.md updated with cross-table-rls.md link
- Task 7: 321 tests pass (15 new), lint clean (only pre-existing warnings), E2E failures pre-existing on develop, dev server starts clean

### Change Log

- 2026-03-13: Story 4.0 implementation complete — all 8 tasks done, 321 tests passing

### File List

New files:
- .husky/pre-commit
- src/components/ui/alert-dialog.tsx
- src/components/ui/confirm-dialog.tsx
- src/hooks/use-confirm-dialog.ts
- src/hooks/use-confirm-dialog.test.tsx
- src/server/test-utils/cross-table-rls-spike.test.ts
- docs/cross-table-rls.md

Modified files:
- package.json (husky, lint-staged, @testing-library/react, jsdom deps + lint-staged config)
- package-lock.json
- vitest.config.ts (added hooks test glob to client project)
- src/components/ui/button.tsx (shadcn update — cosmetic)
- src/components/settings/bank-accounts-tab.tsx (replace confirm() with ConfirmDialog)
- src/components/settings/vat-registrations-tab.tsx (replace confirm() with ConfirmDialog)
- src/components/settings/document-type-prefixes-tab.tsx (replace confirm() with ConfirmDialog)
- src/server/test-utils/config-crud-helpers.ts (add assertCrossTableRlsIsolation)
- docs/story-creation-checklist.md (add Client-Side UI Checklist section)
- docs/config-page-test-template.md (document cross-table RLS helper)
- docs/index.md (add cross-table-rls.md link)
- _bmad-output/implementation-artifacts/deferred-items.md (resolve item #9)
- _bmad-output/implementation-artifacts/sprint-status.yaml (status updates)
