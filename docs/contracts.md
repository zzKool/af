# Contracts — rate history

Module `src/modules/contracts` · schema `prisma/schema/contracts.prisma` · migration `20261020220000_add_contract_rates` · spec `specs/contracts/` · decisions D11, D24.

> A contract is the agreement with one client in one currency; its **rates** are the dated history of what a day costs. The invoice line (next slice) is `days × rate_for(contract, period_start)` and keeps that amount for ever. The contract's *current rate* is derived from the history, never typed.

## Model

```
contracts        (v2, unchanged except: billing_rate column DROPPED — carried over as one open rate per contract)
contract_rates   (id, tenant_id, contract_id → contracts ON DELETE RESTRICT, valid_from DATE, valid_to DATE?,
                  rate DECIMAL(15,2) > 0, unit rate_unit = 'day', note VARCHAR(500)?, created/updated, created_by, source)
  CHECK  valid_to IS NULL OR valid_to >= valid_from
  EXCLUDE USING gist (contract_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)   -- never overlapping, both ends inclusive
  RLS tenant_isolation · app role SELECT/INSERT/UPDATE/DELETE · index (tenant_id, contract_id, valid_from DESC)
rate_unit        ENUM ('day')  -- D24: a new unit is `ALTER TYPE rate_unit ADD VALUE` + two dictionary labels
```

No currency on the rate: the contract's currency is the one (one contract per currency, D24). The currency select locks once a rate exists.

## Rules (spec FR-001 … FR-012)

| Rule | Service (`contract-rates.ts`) | Database |
|---|---|---|
| intervals never overlap, both bounds inclusive | `overlaps()` pre-check → `BUSINESS_RULE_VIOLATION` "This rate overlaps an existing rate (from → to)" with `details {from, to, rateId}` | `contract_rates_no_overlap` (btree_gist exclusion); SQLSTATE 23P01 from a concurrent writer is translated to the same error |
| `valid_to ≥ valid_from`, `rate > 0` | Zod schemas | `contract_rates_valid_range_check`, `contract_rates_rate_positive_check` |
| adding an **open** rate closes the earlier open rate on `valid_from − 1` | `createContractRate` — only when the open rate started earlier; audited as `update` with `reason: auto-close` | — |
| a **closed** rate closes nothing — it must fit a gap | `createContractRate` | exclusion constraint |
| `rate_for(contract, date)` = the one interval containing the day | `rateFor(tx, contractId, iso)` — independent of today, of the contract's dates and of `is_active`. The query loads the candidates (`valid_from ≤ day`), **`pickRate` chooses** — the same function the fixture and property tests cover (F63) | index |
| current rate is derived | `getContract(s)(tx, …, { today })` → `currentRate` via `currentRatesFor` (one query for a partner's contracts, `pickRate` per contract); without `today` the DTO carries null | no column |
| states `current / expired / future` are derived | `rateState(rate, today)` in `listContractRates` | no column |
| a rate used by an invoice line cannot be deleted | `deleteContractRate` asks the `rateUsage` hook (`setRateUsage` — wired by the invoices module in `instrumentation.ts`) → "used on n invoice line(s) — close it instead" | the invoices slice adds the trigger with `invoice_lines` |
| a rate used by an invoice line **only closes**: `valid_to` and note change, `valid_from` and the amount do not (F63) | `updateContractRate` → `lockedFieldsChanged(before, patch)` (decimal equality: `1000` = `1000.00`), then the `rateUsage` hook → `BUSINESS_RULE_VIOLATION` "used on n invoice line(s) — only its end date and note can change…" with `details {usedOn, fields}`; the Rates section shows it as `contracts.rates.error.usedLocked` in the user's language (T023, `rate-error.ts` — one mapping of a refusal's `details` to its key: `{from, to}` overlap, `{usedOn}` edit, `{n}` delete). The auto-close of a newer open rate is a close, so it stays allowed. A wrong amount on a used rate is fixed by closing it and adding a new rate | — |
| a used rate **never closes before the last day it priced** (T024): `valid_to` ≥ the latest `period_start` an invoice line was priced on (line → document → issue date, drafts included) — by hand or by the auto-close | the hook is `setRateUsage(fn)` → `RatePricing { lines, lastPeriodStart }` (invoices' `ratePricingFromInvoiceLines`, wired in `src/instrumentation.ts`); `closesBeforePriced(validTo, pricing)` in `updateContractRate` (only when `validTo` changes) and before `createContractRate`'s auto-close → `BUSINESS_RULE_VIOLATION` `details {pricedUntil, validTo}`, nothing written; `contracts.rates.error.closesBeforePriced` (en / fr / sv) | `contract-rates.test.ts` T024, `rate-error.pure.test.ts` |
| every write audited | `contract_rate` create / update / delete with before/after | — |
| owner only | `ownerAction` (`can()`) | — |

Calendar dates travel as ISO `YYYY-MM-DD` strings in the DTO (`ContractRateDto`), not as instants: the question is always "which rate applies on this day", and `@db.Date` columns map to UTC-midnight `Date`s in Prisma — `calendar.ts` holds the day arithmetic.

## Surface

- `index.ts`: `rateFor`, `listContractRates`, `listContractRatesFor`, `currentRatesFor`, `createContractRate`, `updateContractRate`, `deleteContractRate`, `setRateUsage`, schemas, DTOs (`ContractRateDto`, `ContractRateWithState`, `CurrentRate`, `RateUnit`, `RateState`); `getContract(s)` now take `{ today }`; `activeContractCount(tx, { partnerId } | { assignedEmployeeId })` for partners' type-removal guard ([[lessons]] audit 25).
- `ui.ts`: `ContractRates` (the section), `ContractList` (+ `ContractRow` type with `currentRate` and `rates`), the rate actions.
- Actions: `getContractRatesAction`, `createContractRateAction`, `updateContractRateAction`, `deleteContractRateAction`.

## UI

The Rates section sits inside the contract's expanded row on the partner page (child of a child — no route): newest first, inline add (valid from = today in Stockholm — the kernel clock, T028 —, valid to, rate, note, the tip "Leave *valid to* empty for an ongoing rate."), edit-in-place on blur (dates, note; the amount by click — on a used rate only *valid to* and note are accepted, the refusal is an English toast until its dictionary key lands, lesson 18), delete (the row's ⋮ menu) with confirm, the state as a `<StateLabel>`. The contract row and form show *Current rate* read-only. After every change the section reloads its list from the server and hands it up (`onRatesChange`) so the derived current rate follows.

Strings are keys in the kernel dictionary (`contracts.rates.*`, `contracts.currentRate*`, en + fr) — the first module on it; see [[ui-conventions]] §i18n. Errors arrive in English with `details`; the component renders the overlap / in-use messages in the user's language from those details.

**The D40 kit (F71, 2026-10-23).** States go through **one** map, `state-family.ts`: rate `current` → done, `future` → progress, `expired` → neutral; contract `active` → done, `inactive` → neutral (from `isActive`) — rendered with `<StateLabel>`, no coloured pill. Money on screen is `formatMoney` (`1 200.00 CHF`, U+202F thousands) with the plain decimal on `data-amount` for the e2e; the currency is a `<Tag>` column. Row actions sit in the ⋮ menu (`RowActionsMenu` from `kernel/ui/data-table`): Deactivate / Reactivate on a contract, Delete on a rate. The expanded contract shows its form, then *External References* and *Rates* as `DetailsSection`s. The list stays a kit `Table` — a handful of rows on an entity tab, expanded in place; no `<CodeChip>` (no business key) and no quick filter (no Month / Client column).

Screenshots: `specs/contracts/screenshots/` (since F71 `contracts-tab-light.png` / `-dark.png`, from `e2e/screenshots.spec.ts` › *partner-contracts*).

## For the invoices slice

```ts
import { rateFor, setRateUsage } from "@/modules/contracts";
const rate = await rateFor(tx, contractId, periodStart); // null → "No contract rate for this period — enter manually"
// line: unit_price = rate.rate, rate_source_id = rate.id, unit = rate.unit — written once, never re-read
setRateUsage((tx, rateId) => tx.invoiceLine.count({ where: { rateSourceId: rateId } }));
```
Split proposal when `rate.validTo` falls inside the invoiced period: one line per rate, the owner adjusts the day counts (spec US2, harvest §4.3).

## Tests

`rate-for.pure.test.ts` (fixture cases from `specs/contracts/fixtures/rate-history-cases.json` + fast-check property: non-overlapping history → unique containing interval or null; `lockedFieldsChanged`) · `contract-rates.test.ts` (DB, RLS on: the spec's acceptance scenarios, audit rows, exclusion constraint and CHECKs hit by direct SQL, FK RESTRICT, cross-tenant; F63: a used rate refuses amount / start, closes, the next rate is picked after its `valid_to`, and the fixture cases through `rateFor` / `currentRatesFor`) · `contracts.test.ts` (v2 CRUD, `billingRate` removed) · `rate-error.pure.test.ts` (T023: `usedOn` → *usedLocked* in en / fr / sv, never the delete text; overlap and `n` keep theirs) · `components/contract-rates.test.tsx` (T028: the default *valid from* is the Stockholm day just after midnight) · `state-family.pure.test.ts` (F71: every rate state mapped; the rate `pickRate` takes today is the only *done* one; a contract's state from its flag) · `e2e/contracts.spec.ts` (partner → contract → two rates → auto-close → overlap refused → delete through the ⋮ menu → deactivate through the contract's ⋮ menu).

Related: [[contract-pattern]] (v2 child-entity pattern; its billing-rate pipeline section is superseded by this page), [[partners]], [[numbering]], [[feature-inventory]] D24.
