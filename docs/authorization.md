# Authorisation — `can()`

Module `src/kernel/auth/can.ts` · phase-0 item 4.2 · constitution §2 (import rules), §6 (roles) · decision D15.

## One function, one table

```
can(identity, action, subject)          // server: services, pages
canRole(role, action, subject)          // client components that only know the role
documentSubject(documentType)           // "financial" → financial_document, else relationship_document
isTenantAdmin(identity)                 // owner | superadmin — used by ownerAction and page guards
roleFromMembership(orgRole)             // Better Auth organisation role → application role
requireCaller({ action, subject }?)     // pages/layouts: caller or redirect (/login, /dashboard)
```

Roles: `superadmin` (app-level), `owner` (tenant admin), `accountant` (read-only, no relationship documents, no settings), `editor` (upload, review, link; no settings, no issuing, no deleting). Actions: `read` `create` `update` `delete` `link` `manage`. Subjects are business-named (`financial_document`, `journal_entry`, `tenant_settings`, …); an attribute-dependent case gets its own subject rather than a condition.

The table is data (`RULES` in `can.ts`) and unit-tested in `can.pure.test.ts`. Replacing it with CASL or another engine later touches `can.ts` only — no call site compares roles (guard rule *authorisation goes through can()*).

## Where checks live

| Layer | How |
|---|---|
| Server actions | `ownerAction` = `authedAction` + `isTenantAdmin`; finer checks inside the service with `can(caller, …)` |
| Services | first statement of a mutation: `if (!can(caller, "update", "financial_document")) return FORBIDDEN` |
| Pages / layouts | `const caller = await requireCaller({ action: "manage", subject: "tenant_settings" })` — one line replaces the headers → session → member → role boilerplate |
| Client components | `canRole(role, …)` for what to show; the server enforces regardless |
| Navigation | `src/kernel/nav/constants.ts` `roles[]` per item (sidebar hides, server enforces — both required) |

## Mapping from Better Auth

Organisation roles `owner` → `owner`, `editor` → `editor`, anything else (`member`) → `accountant`. `superadmin` is not an organisation role; it will be an app-level flag on the user (item 9, admin UI).
