---
name: server-action-pattern
description: How to write a Server Action + service pair in AF (middleware chain, RBAC via can(), Zod at the boundary, ServiceResult/AppError, audit). Use whenever adding or changing any write path.
---

# Server action pattern

Read first: `docs/server-actions.md`, `docs/error-handling.md`, `docs/audit-trail.md`. Reference implementation: `src/modules/settings/settings.actions.ts` + `src/modules/settings/settings.ts` (will move to `src/modules/settings/` after the feature-folder move).

## Shape

```
action (thin)                       service (framework-free)
─────────────────────────────       ─────────────────────────────────────
authedAction | ownerAction          export async function doX(
  .schema(zodSchema)                  tx: TransactionClient,      // tenant-scoped, RLS set
  .metadata({ action: "x.do" })       caller: CallerIdentity,
  .action(({ parsedInput, ctx }) =>   input: XInput,
     service.doX(ctx.tx, ctx.caller, parsedInput))
                                    ): Promise<ServiceResult<XDto>>
```

## Rules
0. Name: `<verb><Entity>Action` (`createPartnerAction`); the service function keeps the plain name (`createPartner`). Both are exported from the module's `index.ts`; the action also from `ui.ts`.
1. Validation with Zod in the action; reject unknown fields. The service trusts its input type.
2. Permission check: `can(caller, "update", "invoice")` at the top of the service. Nowhere else.
3. Business errors are returned: `{ error: { code, message, retryable } }`. Never `throw` from an action.
4. Every financial or linked mutation writes an audit row (`toAuditData`) with `source` provenance inside the same transaction.
5. Return a DTO from the module's `index.ts` types, never a raw Prisma row across the module boundary.
6. Money in and out of the service is `Decimal`; convert to `number` only in components.
7. Cross-module references: validate the UUID through the other module's `index.ts` (`exists(id)`), not a Prisma FK.

## Checklist before PR
- [ ] `*.test.ts` next to the service covers: happy path, permission denied, validation error, tenant isolation (second tenant cannot see/alter)
- [ ] Action has a metadata name used in logs
- [ ] Audit row asserted in a test for mutations
