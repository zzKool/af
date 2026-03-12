# Deferred Items Register

Living document tracking all deferred technical debt, feature gaps, and process improvements.
Updated after every code review and retrospective. Checked before every story creation.

**Last updated:** 2026-03-12 (Story 3.3 Code Review)

---

## Active Items

| # | Item | Origin | Priority | Owner | Latest Safe Deferral | Rationale |
|---|------|--------|----------|-------|---------------------|-----------|
| 4 | Sentry integration (`@sentry/nextjs`) | Epic 2, Story 2.4 | Medium | Charlie (Dev) | Before Epic 5 | Document upload + OCR = real error surface area |
| 5 | Error handler lacks request context (userId, tenantId) | Epic 2, Story 2.4 review | Medium | Charlie (Dev) | Before Epic 6 | Banking import errors need correlation for debugging |
| 6 | `action: "server_action"` is generic in logs | Epic 2, Story 2.4 review | Low | — | Before Epic 5 | More actions = harder to debug without action identity |
| 7 | Decimal boundary lint rule (no `.toNumber()` on Prisma.Decimal) | Epic 2, Story 2.2 | Low | — | Before Epic 6 | Journal entries introduce real currency columns |
| 8 | Branch protection (requires GitHub Pro) | Epic 0 retro | Low | Zik | Before production deploy | PR protection for develop branch |
| 9 | Replace `confirm()` with shadcn AlertDialog for delete confirmations | Story 3.3 review | Low | — | Before Epic 5 | All 3 settings tabs (bank-accounts, vat-registrations, bas-categories) use native `confirm()`. Add shared AlertDialog component and update all tabs together for consistency |
| 10 | Bank format FK change test needs second seeded format | Story 3.3 review | Low | — | Before Epic 9 | "Update bankFormatId" test only verifies same format (only Nordea seeded). Story 9.1 adds more formats — add proper FK-change test then |

---

## Resolved Items

| # | Item | Origin | Resolved In | Resolution |
|---|------|--------|-------------|------------|
| 1 | GRANT ALL → specific grants on init migration tables | Epic 1 retro | Story 3.0 | New migration revokes GRANT ALL, re-grants with specific permissions per table |
| 2 | Zustand store reset on tenant switch | Epic 1 retro | Story 3.0 | createTenantStore factory with auto-reset on activeOrganizationId change |
| 3 | Run proxy.ts codemod (`middleware.ts` → `proxy.ts`) | Epic 1 retro | Story 3.0 | Already migrated — `src/proxy.ts` exists. Documented in `docs/middleware.md` |

---

## Process

1. **After code review:** If a review identifies a deferred item, add it here with origin and latest safe deferral
2. **Before story creation:** SM checks this register for items that have reached their deferral deadline
3. **After retrospective:** Review all items, update priorities, remove resolved items
4. **Items past deadline:** Must be addressed in the next story or explicitly re-deferred with justification
