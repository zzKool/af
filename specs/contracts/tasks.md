# Tasks: Contract rate history

**Input**: `specs/contracts/spec.md`, `plan.md` · **Branch**: `feat/contracts-rate-history` · one PR

## Phase 1: Setup
- [x] T001 Kernel dictionary: `src/kernel/i18n/dictionaries/en.ts` + `fr.ts` (typed by `en`), `translate.ts`, `use-t.ts`; pure test for fallback (`fr-CH` → fr, unknown → en) and params

## Phase 2: Foundational (blocks every story)
- [x] T002 `prisma/schema/contracts.prisma`: `RateUnit` enum (`day`), `ContractRate` model, `Contract.billingRate` removed, relation `rates`
- [x] T003 Migration `20261020220000_add_contract_rates`: `CREATE EXTENSION IF NOT EXISTS btree_gist`, enum, table, RLS + FORCE, grants (app role S/I/U/D), `CHECK valid_to >= valid_from`, `EXCLUDE USING gist`, FK `ON DELETE RESTRICT`, index `(tenant_id, contract_id, valid_from DESC)`, carry-over `INSERT … SELECT` from `contracts.billing_rate`, `DROP COLUMN billing_rate`
- [x] T004 `types.ts`: `RateUnit`, `RateState`, `ContractRateDto`, `ContractDto` (−`billingRate`, +`currentRate: {id, rate, unit} | null`)

## Phase 3: User Story 2 — rate lookup (P1, the contract other modules call)
- [x] T005 `contract-rates.ts`: pure `pickRate(rates, date)` + `rateFor(tx, contractId, date)`; `listContractRates(tx, contractId)` with derived `state`
- [x] T006 `rate-for.pure.test.ts`: fixture cases from `fixtures/rate-history-cases.json` + fast-check property (non-overlapping intervals → unique containing interval or null)

## Phase 4: User Story 1 — record a rate change (P1)
- [x] T007 `createContractRate` (Zod: `validFrom` date, `validTo?` ≥ `validFrom`, `rate` > 0 two decimals, `note?` ≤ 500): overlap pre-check with the harvest message, auto-close of the earlier open rate on `validFrom − 1` (audited as `update`), insert audited as `create`; exclusion-constraint error (SQLSTATE 23P01) translated to the same `BUSINESS_RULE_VIOLATION`
- [x] T008 `contracts.ts`: `getContract`/`getContracts` return `currentRate` (one `rateFor(today)` per contract, batched for the list); `billingRate` out of the schemas
- [x] T009 `contract-rates.test.ts` (DB): acceptance scenarios 1–5 of US1 (the carry-over SQL is verified by hand on the local DB in T015 — the test DB has the migration applied already)
- [x] T010 Actions: `createContractRateAction`, `updateContractRateAction`, `deleteContractRateAction` (ownerAction, schemas from the service)
- [x] T011 `components/contract-rates.tsx`: table (`Valid from · Valid to · Rate · Note · state chip`), inline add row (valid from = today, rate, note, tip), edit-in-place on blur, delete with confirm; strings via `useT()`
- [x] T012 `contract-list.tsx`: billing rate input → read-only *Current rate* in the row and the form; `<ContractRates>` section in the expanded row; `partners/[id]/page.tsx` loads `listContractRates` for all contracts in the same transaction and passes them down

## Phase 5: User Story 3 — correct or remove (P2)
- [x] T013 `updateContractRate` (partial: validFrom/validTo/rate/note; overlap pre-check excluding itself), `deleteContractRate` with a `rateUsage(tx, rateId)` hook (returns 0 until invoices) → `BUSINESS_RULE_VIOLATION` "used on n invoice line(s)"; both audited
- [x] T014 Tests for US3 scenarios 1–4 + RLS isolation + direct-SQL overlap refused by the exclusion constraint

## Phase 6: User Story 4 — existing contracts keep their rate (P2)
- [x] T015 Carry-over verified on the local DB (a contract seeded with `billing_rate = 1200`, `start_date = 2025-01-01` → one open rate `2025-01-01 → open · 1200.00 · source migration`; a contract without a rate gets none; `btree_gist` installed; column gone) — `prisma/seed.ts` seeds no contracts

## Phase 7: Polish
- [x] T016 `e2e/contracts.spec.ts`: partner → contract → add 2025 rate → add 2026 rate → chips Current/Expired, first row closed 2025-12-31
- [x] T017 `docs/contracts.md` (module doc), `docs/index.md`, `docs/feature-folders.md`, `contract-pattern.md` billing-rate pipeline section rewritten; screenshots in `specs/contracts/screenshots/`
- [x] T018 Gate: lint, typecheck, full tests, build; PR with screenshots; merge; main e2e green — merged as #15

## Dependencies
T001 ∥ T002–T004 → T005–T006 → T007–T009 → T010 → T011–T012 → T013–T014 → T015 → T016–T018. T001 is independent of the schema work.

## Phase 8: F63 — a used rate only closes; one lookup rule (audit lesson 18) · branch `feat/contracts-used-rate-closes`
- [x] T019 `updateContractRate`: `lockedFieldsChanged(before, patch)` (start, amount; decimal equality) → when non-empty and `rateUsage > 0`, `BUSINESS_RULE_VIOLATION` with `details {usedOn, fields}`; `validTo` / note and the auto-close stay allowed (FR-006 amended)
- [x] T020 `rateFor` / `currentRatesFor` load candidates (`valid_from ≤ day`) and call `pickRate` — the rule lives once
- [x] T021 Tests: pure `lockedFieldsChanged`; DB — used rate's amount / start / mixed edit refused and unchanged, same value re-posted accepted, closing works + audited, a date after `validTo` picks the next rate (manual close and auto-close, `currentRate`), fixture cases through `rateFor` / `currentRatesFor`
- [x] T022 Docs: `docs/contracts.md`, F63 row, lesson 18
- [x] T023 `contracts.rates.error.usedLocked` in en / fr / sv; `rate-error.ts` maps a refusal's `details` to its key (`usedOn` before `n`, so an edit never reads as the delete text) — the Rates section calls it; `errors.generic` instead of *Error*. Test: `rate-error.pure.test.ts`. Branch `feat/contracts-used-locked-key`
- [ ] T024 *(invoices + contracts)* refuse closing a used rate before the last `period_start` priced on it — needs a richer usage hook from invoices

## Phase 9: F71 — contracts adopts the D40 kit · branch `feat/contracts-d40-kit`
- [x] T025 `state-family.ts` — the one map: rate `current → done`, `future → progress`, `expired → neutral`; contract `active → done`, `inactive → neutral` (from `isActive`, never typed); `<StateLabel>` in the contract rows and the Rates section (no Tailwind palette pills); on-screen money through `formatMoney` with the plain decimal on `data-amount` (row, *Current rate*, rate cells, the delete confirm); the currency as a `<Tag>`; Deactivate / Reactivate and the rate's Delete in the row's ⋮ menu (the kernel's `RowActionsMenu`, lifted out of the DataTable for kit `Table`s); the expanded contract's *External References* and *Rates* as `DetailsSection`s; one primary on the tab (*+ New Contract*). No `<CodeChip>` (a contract has no business key) and no `quickFilter` (no Month / Client filter — a handful of rows on the partner page, not a DataTable). Tests: `state-family.pure.test.ts`; `e2e/contracts.spec.ts` reads `data-amount`, deletes and deactivates through the ⋮ menu; `e2e/screenshots.spec.ts` shoots the Contracts tab (`partner-contracts-*`)


## Phase 10: F66 — read through the owners (lessons audit 24, 25) · lane 9, DIRECT
- [x] T026 Read APIs (`feat/settings-read-apis`): `activeContractCount(tx, { partnerId } | { assignedEmployeeId })` in contracts' `queries.ts`; settings' `getVatRegistration(tx, id)` and `isBasActivated(tx, code)`; settings' commented-out currency guard and its stale TODO deleted (the lock is F70's, D46). Tests: each on the real DB, RLS included
- [x] T027 `createContract` / `updateContract` read the client and the employee through `partners.getPartner`, the VAT registration through `settings.getVatRegistration` — no `tx.partner` / `tx.vatRegistration` left in `modules/contracts` (`feat/contracts-partners-read-through`)
