# Deferred Items Register

Living document tracking all deferred technical debt, feature gaps, and process improvements.
Updated after every code review and retrospective. Checked before every story creation.

**Last updated:** 2026-03-17 (Story 6.0 — items #5, #7 re-deferred to Before Story 6.2; Tier 2 tasks deferred)

---

## Active Items

| # | Item | Origin | Priority | Owner | Latest Safe Deferral | Rationale |
|---|------|--------|----------|-------|---------------------|-----------|
| ~~4~~ | ~~Sentry integration (`@sentry/nextjs`)~~ | ~~Epic 2, Story 2.4~~ | ~~Medium~~ | — | ~~Before Epic 5~~ | **RESOLVED** — See Resolved Items |
| 5 | Error handler lacks request context (userId, tenantId) | Epic 2, Story 2.4 review | Medium | Charlie (Dev) | Before Story 6.2 | Banking import errors need correlation for debugging. Story 6.0 Tier 2 deferred — re-deferred from "Before Epic 6" |
| ~~6~~ | ~~`action: "server_action"` is generic in logs~~ | ~~Epic 2, Story 2.4 review~~ | ~~Low~~ | — | ~~Before Epic 5~~ | **RESOLVED** — See Resolved Items |
| 7 | Decimal boundary lint rule (no `.toNumber()` on Prisma.Decimal) | Epic 2, Story 2.2 | Low | — | Before Story 6.2 | Journal entries introduce real currency columns. Story 6.0 Tier 2 deferred — re-deferred from "Before Epic 6" |
| 8 | Branch protection (requires GitHub Pro) | Epic 0 retro | Low | Zik | Before production deploy | PR protection for develop branch |
| ~~9~~ | ~~Replace `confirm()` with shadcn AlertDialog for delete confirmations~~ | ~~Story 3.3 review~~ | ~~Low~~ | — | ~~Before Epic 5~~ | **RESOLVED** — See Resolved Items |
| 10 | Bank format FK change test needs second seeded format | Story 3.3 review | Low | — | Before Epic 9 | "Update bankFormatId" test only verifies same format (only Nordea seeded). Story 9.1 adds more formats — add proper FK-change test then |
| 14 | Two-step entity creation UX friction (create minimal then open to edit) | Epic 4 retro | Low | — | Before Epic 8 | Functional but adds friction for partners/contracts. Richer create form or modal possible — Zod schemas already validate all fields on create |
| 15 | Inngest signing key for `/api/inngest` route | Story 5.0 Task 3 | Medium | — | Before production deploy | Serve route has no signing verification — arbitrary HTTP clients can trigger function execution. Configure `INNGEST_SIGNING_KEY` before production |
| ~~11~~ | ~~Test data factory pattern (`createTestPartner`, `createTestContract`, etc.)~~ | ~~Epic 3 retro party review~~ | ~~Medium~~ | — | ~~Before Story 4.2~~ | **RESOLVED** — See Resolved Items |
| ~~12~~ | ~~Soft-delete pattern decision (boolean `active` vs `deleted_at`, default query filtering, audit action naming, cascade to child entities)~~ | ~~Epic 3 retro party review~~ | ~~Medium~~ | — | ~~During Story 4.1 creation~~ | **RESOLVED** — See Resolved Items |
| ~~13~~ | ~~Flag Story 4.1 as pattern-setter during creation~~ | ~~Epic 3 retro process improvement #3~~ | ~~Low~~ | ~~Bob (SM)~~ | ~~During Story 4.1 creation~~ | **RESOLVED** — See Resolved Items |

---

## Resolved Items

| # | Item | Origin | Resolved In | Resolution |
|---|------|--------|-------------|------------|
| 1 | GRANT ALL → specific grants on init migration tables | Epic 1 retro | Story 3.0 | New migration revokes GRANT ALL, re-grants with specific permissions per table |
| 2 | Zustand store reset on tenant switch | Epic 1 retro | Story 3.0 | createTenantStore factory with auto-reset on activeOrganizationId change |
| 3 | Run proxy.ts codemod (`middleware.ts` → `proxy.ts`) | Epic 1 retro | Story 3.0 | Already migrated — `src/proxy.ts` exists. Documented in `docs/middleware.md` |
| 9 | Replace `confirm()` with shadcn AlertDialog for delete confirmations | Story 3.3 review | Story 4.0 Task 1 | Shared `<ConfirmDialog>` component built on Base UI AlertDialog. Replaced native `confirm()` in all 3 settings tabs (bank-accounts, vat-registrations, document-type-prefixes). Hook `useConfirmDialog` with async loading state, error toast, and accessible keyboard navigation. |
| 12 | Soft-delete pattern decision | Epic 3 retro party review | Story 4.1 | Boolean `is_active` column. Audit actions `deactivate`/`reactivate`. UI ConfirmDialog for deactivation. Pattern documented in `docs/partner-crud-pattern.md`. |
| 11 | Test data factory pattern | Epic 3 retro party review | Story 4.2 | `createTestPartner()` added in Story 4.1, `createTestContract()` added in Story 4.2. Pattern established in `src/server/db/test-fixtures.ts` with cleanup order respecting FK dependencies. |
| 13 | Flag Story 4.1 as pattern-setter | Epic 3 retro process improvement #3 | Story 4.1 | Story explicitly flagged as pattern-setter. Documented CRUD, soft-delete, FK validation, entity page patterns in `docs/partner-crud-pattern.md`. |
| 4 | Sentry integration (`@sentry/nextjs`) | Epic 2, Story 2.4 | Story 5.0 Task 4 | `@sentry/nextjs` configured with error-only tracking. `sentryEventId` returned in error responses. Auth/logging middleware set Sentry user/tenant/requestId context. |
| 6 | `action: "server_action"` is generic in logs | Epic 2, Story 2.4 review | Story 5.0 Task 5 | `defineMetadataSchema` on base client, `.metadata({ name })` on all 37 actions across 9 files. Logging middleware uses `metadata.name` instead of generic string. |

---

## Process

1. **After code review:** If a review identifies a deferred item, add it here with origin and latest safe deferral
2. **Before story creation:** SM checks this register for items that have reached their deferral deadline
3. **After retrospective:** Review all items, update priorities, remove resolved items
4. **Items past deadline:** Must be addressed in the next story or explicitly re-deferred with justification
