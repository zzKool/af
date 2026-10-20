# Implementation Plan: Expenses + traktamente

**Branches**: `feat/expenses-core` (part 1: model, keys, base amounts, derived status, ledger, settlements, statement job, traktamente rates + calculator + trip, linkables, queries, tests, docs) → `feat/expenses-pages` (part 2: pages, dialogs, the trip panel, the rate table, the statement print route, e2e, screenshots) | **Date**: 2026-10-20 | **Specs**: `specs/expenses/spec.md`, `specs/traktamente/spec.md`

## Summary

Two modules. `expenses` owns groups, payment sources, expenses, settlements (+ lines) and the reimbursement statement; `traktamente` owns the normalbelopp table, the trip of a trip group and the pure per-diem calculator, and writes its result as one `per_diem` expense through the expenses module. Status (`paid / awaiting_link / to_refund / partially_refunded / refunded`) and the owner's ledger are read models over `settlement_lines` and `links`. Expenses depends on numbering, rates, documents, linking, banking (bank row + its journal base, through `banking.getTransaction` / `journal.entriesForSources`), settings (BAS codes and aliases), kernel pdf/jobs. Traktamente depends on expenses (`createPerDiemExpense`, `replacePerDiemExpense`, `getExpenseGroup`). Nothing imports traktamente except the pages and the group page's panel.

## Technical Context

**Language/Version**: TypeScript, Next.js 16 / React 19 (unchanged)
**Primary Dependencies**: Prisma 7, Zod 4, next-safe-action, fast-check, `date-fns-tz`-free calendar arithmetic (Intl + own helpers); no new packages
**Storage**: PostgreSQL 17 — enums `expense_group_kind`, `payment_source_kind`, `expense_kind`, `settlement_status`; tables `expense_groups`, `payment_sources`, `expenses`, `settlements`, `settlement_lines`, `normalbelopp`, `trips`; triggers `expenses_lock_when_settled` (money columns immutable once a settlement line exists), `settlements_lock` (number, refund_*, base columns written once; `statement_document_id` NULL → value once), `block_delete_when_linked` on `expenses` and `settlements`; partial unique index `trips_per_diem_expense_id`
**Testing**: `keys.pure.test.ts` (+ expense / settlement series), `status.pure.test.ts`, `fifo.pure.test.ts` (fixture + 200-run property), `expenses.test.ts` (DB: fixture end to end, keys under concurrency, lock trigger, delete guards, RLS), `settlements.test.ts` (DB: variants A / B / C, cancel, job idempotence with a stubbed renderer), `calculator.pure.test.ts` (every `day-count-cases.json` case, the worked examples, property), `rates.test.ts` (DB: CSV paste, copy year, delete guard), `trip.test.ts` (DB: upsert, preview, per-diem expense create / replace / refuse once settled), `e2e/expenses.spec.ts` (part 2)
**Constraints**: no other open PR on `prisma/schema`, nav constants, i18n dictionaries; part 2 waits for part 1 on `main`; `number_series` keyed `exg-{group}-{alias}` (the doc said `exg-{group}` — corrected, D28 keeps "same counter" = same scheme and shared by `SI` with the same alias)

## Constitution Check

- §1 *derived never typed*: status and ledger computed in `status.ts` / `queries.ts` from lines and links; `base_provisional` is a fact (which rate was used), not a status. ✔
- §1 *immutable money facts*: `expenses` money columns locked by trigger once a settlement line exists and by the service once linked; `settlements` money written once; `number` never reused on cancel (status `cancelled`, row kept). ✔
- §1 *linking is the product*: `created_from` expense → document, `justifies` bank_transaction → expense (company-paid), `settles` bank_transaction → settlement, `justifies` bank_transaction → statement document. `settlement_lines` is intra-module (an allocation of a settlement to its own expenses, not a cross-entity relationship). ✔
- §2 *module boundaries*: expenses → numbering, rates, documents (`storeGeneratedDocument`, `assignBusinessKey` — new, the one write documents did not have), linking, banking (`getTransaction`), journal (`entriesForSources` for the bank row's base), settings (`getBasCategory`, `basAliases` — new read: tenant short code ?? suggested alias), partners (none). Traktamente → expenses (`index.ts` only). ✔
- §2 *cross-module references are validated UUIDs*: `payment_sources.bank_account_id`, `settlements.bank_transaction_id`, `settlements.statement_document_id`, `expenses.vat_registration_id`, `trips.per_diem_expense_id` (expenses module, validated through its `index.ts`). Intra-module FKs: `expenses.group_id / payment_source_id`, `settlement_lines.settlement_id / expense_id`, `trips.group_id`. ✔
- §2 *money*: Decimal in services; strings on the surface; the calculator returns Decimal strings. ✔
- §2 *no setting for a single use*: the four payment sources are rows (data), seeded; tolerance 0.50 SEK and the traktamente percentages are constants; the tenant zone is a constant. ✔
- §3b UI (part 2): `/expenses` list + side panel, `/expenses/groups/[id]` entity page, `/expenses/settle` work page, settings tab for rates. ✔
- i18n: `expenses.*`, `traktamente.*` en + fr. ✔
- Jobs: `expenses.render-statement` (same shape as `invoices.render-pdf`, registered in `instrumentation.ts`). ✔

## Data model

```
expense_groups      id · tenant_id · number int (series expense_group) · description text · kind expense_group_kind (trip | batch)
                    created_at · updated_at · created_by · source
                    UNIQUE (tenant_id, number) · trigger block delete while expenses exist (FK RESTRICT does it)

payment_sources     id · tenant_id · label varchar(60) · kind payment_source_kind (bank_account | private)
                    bank_account_id uuid? · currency char(3) · is_active bool · owner_user_id uuid?
                    created_at · updated_at · created_by · source
                    UNIQUE (tenant_id, label) · CHECK ((kind = 'bank_account') = (bank_account_id IS NOT NULL))

expenses            id · tenant_id · group_id (FK RESTRICT) · key varchar(30) · seq int · alias varchar(6)
                    kind expense_kind (receipt | per_diem | vat_payment) · date date · description text
                    bas_code varchar(4) · amount dec(15,2) > 0 · currency char(3) · vat_amount dec(15,2)? · vat_registration_id uuid?
                    amount_base dec(15,2) · rate dec(18,6) > 0 · rate_source varchar(20) (same_currency | ecb_daily | ecb_nearest | bank | manual) · rate_date date?
                    base_provisional bool · paid_amount dec(15,2)? · paid_currency char(3)? · payment_source_id (FK RESTRICT)
                    document_missing bool · note text? · created_at · updated_at · created_by · source
                    UNIQUE (tenant_id, key) · UNIQUE (group_id, alias, seq)
                    idx (tenant, date desc), (tenant, group_id), (tenant, payment_source_id), (tenant, bas_code)
                    CHECK ((paid_amount IS NULL) = (paid_currency IS NULL)) · CHECK currency = upper(currency)
                    trigger expenses_lock_when_settled BEFORE UPDATE: when a settlement_line references OLD.id, amount / currency / date /
                      amount_base / rate / rate_source / rate_date / paid_* / payment_source_id / group_id must not change
                    trigger expenses_block_delete_when_linked → block_delete_when_linked('expense'); FK RESTRICT from settlement_lines

settlements         id · tenant_id · number varchar(20) · bank_transaction_id uuid · payment_source_id (FK RESTRICT)
                    refund_amount dec(15,2) (signed, the bank row's) · refund_currency char(3) · refund_base dec(15,2) (the row's journal base, abs)
                    allocated_base dec(15,2) · exchange_difference_base dec(15,2) · rounding_base dec(15,2) · exchange_difference_bas_code varchar(4)?
                    note text? · status settlement_status (active | cancelled) · cancelled_at timestamptz? · statement_document_id uuid?
                    statement_superseded bool · created_at · updated_at · created_by · source
                    UNIQUE (tenant_id, number) · partial UNIQUE (bank_transaction_id) WHERE status = 'active'
                    trigger settlements_lock BEFORE UPDATE: number, bank_transaction_id, payment_source_id, refund_*, allocated_base,
                      exchange_difference_base, rounding_base immutable; statement_document_id only NULL → value
                    trigger settlements_block_delete_when_linked → block_delete_when_linked('settlement')

settlement_lines    id · tenant_id · settlement_id (FK CASCADE) · expense_id (FK RESTRICT) · allocated_base dec(15,2) > 0 · note text?
                    created_at · created_by · source
                    UNIQUE (settlement_id, expense_id) · idx (tenant, expense_id)

normalbelopp        id · tenant_id · year int · country_code char(2) · country_name_sv varchar(100) · country_name_en varchar(100)?
                    day_amount dec(10,2) > 0 · night_amount dec(10,2)? · meal_breakfast / meal_lunch / meal_dinner / meal_all dec(10,2)?
                    source varchar(60) · created_at · updated_at · created_by · source
                    UNIQUE (tenant_id, year, country_code)

trips               id · tenant_id · group_id (FK CASCADE, UNIQUE) · departure_at timestamptz · return_at timestamptz · country_code char(2)
                    agency varchar(100)? · breakfasts int · lunches int · dinners int · nights_without_paid_lodging int · long_stay_factor dec(3,2)?
                    computed jsonb? · per_diem_expense_id uuid? · created_at · updated_at · created_by · source
                    CHECK return_at > departure_at · CHECK counts ≥ 0 · CHECK long_stay_factor IS NULL OR (> 0 AND ≤ 1)
```

Status (read model, `status.ts`): `deriveExpenseStatus({paidByPrivate, amountBase, allocatedBase, paidAmount, justified})`. Ledger: Σ over private sources of `amount_base − Σ active lines` where `> 0.50`.

## Services

- `groups.ts`: `createGroup` (number from `nextInSeries('expense_group')`), `updateGroup` (description, kind — kind locked once a trip exists or expenses are per_diem), `deleteGroup` (refused with expenses), `getGroup`, `listGroups`.
- `payment-sources.ts`: `ensureDefaultSources(tx, caller)` (four rows when none: *AF {currency}* per main bank account, *Private SE*, *Private CH*), `listSources`, `setSourceActive`, `getSource`.
- `expenses.ts`: `expenseInputSchema`; `createExpense` (validate group, category → alias via `settings.basAlias`, source; base via `rates.rateToBase`; key = `nextInSeries(expenseSeries(group, alias))` after validation; optional `documentId` → `documents.assignBusinessKey(expenseDocumentKey(key, date))` + `created_from` link; audited); `updateExpense` (facts always; money only while open, recomputes base); `deleteExpense`; `attachBankTransaction` / `detachBankTransaction` (company-paid only; copies `banking.getTransaction` amount / currency and the journal entry's base / rate; `justifies` link with the paid amount in the paid currency); `createPerDiemExpense` / `replacePerDiemExpense` (kind `per_diem`, SEK, the private SE source, the `Tr` category of the tenant — the alias of the category passed by traktamente).
- `settlements.ts`: `proposeSettlement`, `confirmSettlement` (validations → `nextInSeries(settlementSeries(date))` → row + lines → `settles` link → audit → `onCommit` enqueue), `cancelSettlement`, pure `fifoAllocate(open[], refundBase)` in `fifo.ts`.
- `statement.ts` + `jobs/render-statement.ts`: `resolveStatement(tx, id)` → the sheet data; the job renders `/print/settlement/[id]`, stores `Reimb_{number}_{date}.pdf`, sets `statement_document_id`, links `justifies` transaction → document.
- `queries.ts`: `EXPENSE_COLUMNS`, `listExpenses` / `distinctExpenseValues` / `expenseDateHierarchy` (two-step), `getExpense` (+ links, lines, document), `listGroupsWithTotals`, `getGroupDetail`, `listSettlements`, `getSettlementDetail`, `ledgerSnapshot`, `openPrivateExpenses(sourceId?)`, `settleableTransactions()`.
- `linkable.ts`: `expenseLinkable`, `settlementLinkable`.
- traktamente `rates.ts` (`upsertRate`, `deleteRate`, `copyRatesFromYear`, `parseSkatteverketCsv` pure, `pasteSkatteverketCsv`), `calculator.ts` (pure `countDays`, `computePerDiem`), `trip.ts` (`upsertTrip`, `previewPerDiem`, `createOrReplacePerDiemExpense`), `queries.ts`.

New in other modules: `documents.assignBusinessKey(tx, caller, audit, id, businessKey)` (uploaded / extracted documents only, audited, used once a document becomes something); `settings.basAlias(tx, code)` + `basAliases(tx, codes)` (tenant short code ?? suggested alias); `numbering.expenseSeries(group, alias)` replaces `expenseGroupSeries`, `settlementSeries(date)` / `settlementNumber(date, seq)` / `statementPdfKey(number, date)`; `banking.getTransaction` already exposes the entry; `kernel/db/test-fixtures` TRUNCATE list; `instrumentation.ts` registers `expenseJobs`.

## Project Structure

```
prisma/schema/expenses.prisma · prisma/schema/traktamente.prisma · prisma/migrations/20261021120000_add_expenses_and_traktamente/
src/modules/expenses/{types,groups,payment-sources,expenses,status,fifo,settlements,statement,queries,linkable,expenses.actions,index,ui}.ts · jobs/render-statement.ts · components/ (part 2)
src/modules/traktamente/{types,calculator,rates,trip,queries,traktamente.actions,index,ui}.ts · components/ (part 2)
src/app/(app)/expenses/{page,groups/[id]/page,settle/page}.tsx · src/app/print/settlement/[id]/page.tsx · settings tab (part 2)
docs/expenses.md · docs/traktamente.md · docs/numbering.md (series) · docs/index.md · docs/feature-folders.md · docs/feature-inventory.md
```

## Complexity Tracking

None — no new packages, no settings, two modules with one dependency direction.
