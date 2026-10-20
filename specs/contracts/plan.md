# Implementation Plan: Contract rate history

**Branch**: `feat/contracts-rate-history` | **Date**: 2026-10-20 | **Spec**: `specs/contracts/spec.md`

## Summary

Add a dated, non-overlapping rate history to the existing v2 contracts module (`contract_rates`), expose `rateFor(contract, date)` to the invoices slice, derive the contract's current rate instead of storing it, and give the owner an inline Rates section inside the contract's expanded row on the partner page. First module to use the kernel string dictionary (en + fr), which this slice adds to `kernel/i18n`.

## Technical Context

**Language/Version**: TypeScript on Node 24, Next.js 16 / React 19 (unchanged)
**Primary Dependencies**: Prisma 7 (multi-file schema), Zod 4, next-safe-action, fast-check, Vitest 4, Playwright
**Storage**: PostgreSQL 17 — new table `contract_rates`, enum `rate_unit`, exclusion constraint (needs `btree_gist`, contrib module shipped with the official image)
**Testing**: `contract-rates.test.ts` (DB, RLS on), `rate-for.pure.test.ts` (fast-check property), `e2e/contracts.spec.ts`
**Target Platform**: same image everywhere (docker compose local / homelab / Azure)
**Project Type**: module slice inside the existing `src/modules/contracts`
**Performance Goals**: n/a (one client, tens of rows)
**Constraints**: no other open PR on `prisma/schema`, nav constants or i18n dictionaries during this branch (constitution §5)
**Scale/Scope**: one table, ~6 service functions, 3 actions, one component section, one migration with data carry-over

## Constitution Check

- §1 *derived never typed*: `currentRate` derived from `rateFor(today)`; `billing_rate` column dropped after carry-over. State chips derived at read time. ✔
- §1 *immutable money facts*: the rate row itself is editable (it is a tariff, not a transaction); the money fact is the invoice line's snapshot (invoices slice). ✔
- §1 *settings only when two tenants differ*: no unit picker while the enum has one value. ✔
- §2 *invariants in DB and service*: `CHECK (valid_to IS NULL OR valid_to >= valid_from)`, `EXCLUDE USING gist (contract_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)`; service pre-checks for a clean message. ✔
- §2 *module contract*: DTOs in `types.ts`, `ServiceResult`, `can()` through `ownerAction`, audit on every write, `index.ts` exports `rateFor`/`listContractRates`. ✔
- §2 *cross-module references validated, no cross-table FKs*: `contract_rates.contract_id` → `contracts.id` is **intra-module** (same module, same RLS tenant) so a real FK is allowed, `ON DELETE RESTRICT`. ✔
- §3b UI: section inside the contract accordion (child of a child), full width, kernel table primitives; no DataTable (not a list page). ✔
- §4 definition of done: tests, screenshots of the partner page with the rates section, `docs/contracts.md`, index link. ✔
- i18n from day one: `kernel/i18n/dictionaries/{en,fr}.ts` + `useT()` / `translate()`; keys `contracts.rates.*`. Partners' literals migrate later (follow-up, not this PR). ✔

## Project Structure

### Documentation (this feature)

```
specs/contracts/
  harvest.md         v1 behaviour (done)
  spec.md            this feature's spec
  plan.md            this file
  tasks.md           ordered tasks, ticked as they land
  fixtures/          rate-history-cases.json (lookup cases) + v1 reference data
  screenshots/       partner page → contract → rates (PR evidence)
```

### Source Code (repository root)

```
prisma/schema/contracts.prisma         + ContractRate model, RateUnit enum; Contract loses billingRate
prisma/migrations/20261020220000_add_contract_rates/migration.sql
                                       btree_gist, rate_unit, contract_rates (RLS, grants, CHECK, EXCLUDE, FK RESTRICT),
                                       carry-over INSERT from contracts.billing_rate, DROP COLUMN billing_rate
src/kernel/i18n/
  dictionaries/en.ts, fr.ts            string tables (keys typed from en)
  translate.ts                         translate(locale, key, params) — server-safe
  use-t.ts                             "use client" useT() on useLocale()
src/modules/contracts/
  types.ts                             + ContractRateDto, RateState, RateUnit; ContractDto: −billingRate +currentRate
  contract-rates.ts                    service: schemas, rateFor, listContractRates, createContractRate (auto-close),
                                       updateContractRate, deleteContractRate (rateUsage hook)
  contract-rates.test.ts               DB tests (fixture cases, auto-close, overlap, edit, delete, RLS, direct-SQL refusal)
  rate-for.pure.test.ts                fast-check property on the pure interval picker
  contracts.ts                         getContract(s) enrich with currentRate (one query); billingRate removed from schemas
  contracts.actions.ts                 + createContractRateAction, updateContractRateAction, deleteContractRateAction
  components/contract-rates.tsx        the Rates section (table + inline add + inline edit + delete)
  components/contract-list.tsx         billing rate field → current rate (read-only) + <ContractRates>
  index.ts / ui.ts                     surfaces
src/app/(app)/partners/[id]/page.tsx   loads rates for the partner's contracts in the same transaction
e2e/contracts.spec.ts                  add two rates, see auto-close + chips
docs/contracts.md                      module doc (replaces contract-pattern.md's billing-rate section), docs/index.md
```

## Complexity Tracking

| Item | Why | Simpler alternative rejected because |
|---|---|---|
| `btree_gist` + exclusion constraint | overlaps impossible under concurrency (harvest B4/B9) | a service-only check leaves the race open; a unique index cannot express ranges |
| kernel dictionary now | first module with fr strings in its harvest; invoices PDF needs it next | a per-module strings file would be the second mechanism to unify later |
| `rate_unit` enum with one value | D24: owner wants units addable without a rewrite | a column added later would mean touching every rate row and every consumer at once |
