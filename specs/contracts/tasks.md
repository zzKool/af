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
- [ ] T018 Gate: lint, typecheck, full tests, build; PR with screenshots; merge; main e2e green

## Dependencies
T001 ∥ T002–T004 → T005–T006 → T007–T009 → T010 → T011–T012 → T013–T014 → T015 → T016–T018. T001 is independent of the schema work.
