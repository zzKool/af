# 4.2 — `can()` authorisation + 4.5 prod-like stack

Status: implemented (PR #5) · Constitution §2, §3.3, §6 · Decisions D15, D16 · Phase-0 items 4.2, 4.5

## Goal
One place that knows what a role may do, so CASL or any other engine can be plugged in later without touching call sites; and a prod-like compose + backup so the homelab can be the real production.

## Scope
- `kernel/auth/can.ts`: `Role` (superadmin, owner, accountant, editor), `Action`, business-named `Subject`, rule table, `can`/`canRole`/`documentSubject`/`isTenantAdmin`/`roleFromMembership`.
- `kernel/auth/caller.ts`: `getCaller()`, `requireCaller(permission?)` for pages and layouts.
- Every inline role comparison replaced: tenant middleware, `ownerAction`, documents service (11), 8 pages + layout, the document library client, nav landing map, test fixtures.
- Guard: no role comparison outside `src/kernel/auth`.
- `docker-compose.prod.yml`, `.env.prod.example`, `scripts/backup.sh` (pg_dump + blob tar, retention, optional off-site copy).

## Acceptance
- [x] `can.pure.test.ts` covers the four roles; guard green; full server test project green locally (457 tests)
- [x] behaviour unchanged for owner/accountant (same decisions, now table-driven)
- [x] `docs/authorization.md`; constitution rule marked enforced; phase-0 ticked
