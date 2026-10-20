# 3c — Linking module skeleton

Status: implemented (PR #4) · Constitution §1.2, §2 "Linking invariants" · Decision D18 · Phase-0 item 3c

## Goal
Make the single `links` table and its invariants exist before any business module lands, so invoices, banking, expenses and settlements register into a contract that already holds — "rock solid" (owner requirement).

## Scope
- `links` table: polymorphic endpoints, four kinds (CHECK), allocation columns, unique/self/positive/currency constraints, RLS, grants without UPDATE, indexes both directions.
- Delete trigger `block_delete_when_linked(entity_type)` applied to `documents` now; reusable for every linkable table.
- Service: `createLink` (kind matrix, endpoint existence via registry, allocation ≤ remaining, currency match, audit), `removeLink` (audit), `getLinksFor`, `isLinked`, `getAllocationStatus`.
- `Linkable` registry; `partners`, `contracts`, `documents` register; fake amount-carrying linkables in tests until invoices/transactions exist.
- Guard: only `modules/linking` writes `links`.
- `deleteDocument` translates the trigger error into `BUSINESS_RULE_VIOLATION` (status `linked` stays for compatibility until phase 1 derives it from links).

## Out of scope (phase 1)
Suggestion scorer (H3), workbench UI, graph read model, accountant export, settlement entity, typed-status removal on documents.

## Acceptance
- [x] migration applies in CI; `prisma generate` includes `Link`; schema ↔ migrations in sync
- [x] property tests on allocation math; DB tests for link/audit, rejections, allocations, remove, trigger, RLS
- [x] guard green; tsc, Biome, pure/client tests green locally; server tests + build in CI
- [x] `docs/linking.md` linked from the index; phase-0 ticked
