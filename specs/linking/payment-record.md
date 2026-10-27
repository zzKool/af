# Feature Specification: The link is the only payment record (F114, D60)

**Feature Branch**: `feat/linking-payment-record` (PR 1, the schema alone), `feat/linking-payment-services` (PR 2, the services and the UI), `feat/package-payment-columns` (PR 3, the accountant's sheets)

**Created**: 2026-10-27

**Status**: Draft for the owner's read · the schema PR is prepared behind it and merges after his word (its migration drops columns)

**Input**: D60 (the owner, 2026-10-27, [[audit-2026-10-27]] §2.3): "A `justifies` / `settles` link carries `allocated_amount`, `currency` and `allocated_base`; paid / open and the FX gain **or loss** are derived from Σ links, one rule for receivables, payables and reimbursements; `paid_amount`, `paid_currency`, `base_provisional`, settlement lines and `payment_sources` go — private payers are `bank_accounts` with `role = owner_private`. A deposit + a balance, or two receipts on one card row, are allowed." Audit rows A1, A2, A3, A5, A6, A7, A8, A10, A12, A13.

## Why (the audit)

```
today      a payment is recorded three ways, and they disagree
           expense / supplier invoice:  paid_amount · paid_currency · amount_base rewritten to the row's (rate_source = bank)
           the link:                    allocated_amount · currency           (one row ↔ one entity, forced by paid_amount)
           a settlement:                refund_* · allocated_base · exchange_difference_base · rounding_base + settlement_lines
           "the SEK of this entity" has three conventions (A8); the FX loss is "unallocated" (A5); two tolerances
           decide "paid" (A6); sum(allocations) ≤ amount lives in TypeScript only (A1); supplier invoices have no
           money lock (A2); payment_sources copies bank_accounts (A10)

after      the entity:  amount · currency · amount_base at ITS date (ECB / manual / same) — written once, never rewritten
           the link:    allocated_amount in the ENTITY's currency · allocated_base = what the BANK ROW gave, in base
           derived:     paid / open  = Σ allocated_amount vs amount, one tolerance
                        FX difference = Σ allocated_base − the paid share of amount_base, signed
           in Postgres: Σ amount onto an entity ≤ its amount · Σ base from a row ≤ |row base| · money locked once linked
           one table of payers: bank_accounts (main · savings · owner_private)
```

### The rule, in four lines

1. **An entity's base is written once, at its date.** A receipt dated 2026-03-04 for 45.00 CHF carries `amount_base` = 45 × ECB(2026-03-04), `rate_source = ecb_daily`, whatever pays it later. `rate_source = bank` is no longer written on an entity (CHECK) — the bank's truth lives on the link.
2. **A payment is a link, and only a link.** `justifies` (a bank row pays an invoice, a supplier invoice or a company-paid expense) and `settles` (a refund row reimburses a private expense) carry `allocated_amount` **in the entity's currency** (what part of the entity this row pays), `currency` (= the entity's) and `allocated_base` (what the row gave for it, in the tenant's base — the row's own base, or its share of it).
3. **Paid is Σ amount; the difference is Σ base.** An entity is paid when Σ `allocated_amount` covers its amount within the one tolerance (`max(0.05, 0.5 %)`, D25). Its realised base is Σ `allocated_base`; the **FX difference** = Σ `allocated_base` − `amount_base` × paid share, signed: on a payable and a reimbursement, > 0 is a loss (7960), < 0 a gain (3960); on a receivable the reverse. Within the tolerance of the base it is *rounding*. Nothing of this is stored.
4. **The database keeps the invariants** (A1, A2): an `AFTER INSERT` trigger on `links` refuses an allocation that would take an entity over its amount or a bank row over its base; one `lock_money_when_linked()` on `expenses` and `supplier_invoices` refuses a change of the money facts once an allocating link points at the row.

### Worked examples (invented values)

| Case | Entity | Row | Links | Derived |
|---|---|---|---|---|
| A card receipt in CHF on the SEK card (D26) | expense 45.00 CHF, base 523.17 (ECB at the receipt date) | −531.40 SEK | justifies: 45.00 CHF · base 531.40 | paid · FX difference +8.23 (the card's margin, a loss) |
| A CHF invoice paid from the CHF account two weeks later | supplier invoice 2 500.00 CHF, base 29 150.00 | −2 500.00 CHF, base 29 310.00 (ECB at the row date) | justifies: 2 500.00 CHF · base 29 310.00 | paid · FX difference +160.00 (7960) |
| A deposit and a balance (new) | supplier invoice 12 000.00 SEK | −4 000.00 SEK, then −8 000.00 SEK | two `justifies`: 4 000 · base 4 000, 8 000 · base 8 000 | partially paid, then paid |
| Two receipts on one card row (new) | expenses 120.00 SEK and 80.00 SEK | −200.00 SEK | two `justifies` from the one row | both paid; the row fully allocated |
| A short payment within tolerance (D25) | invoice 25 000.00 CHF | +24 985.00 CHF | justifies: 24 985.00 CHF | paid; 15.00 CHF open = bank fees, as today |
| A refund of two private expenses (SEK) | E1 999.70 SEK, E2 400.00 SEK | +1 400.00 SEK (the owner rounds up) | settles: 999.70 · base 1 000.00; 400.00 · base 400.00 | both refunded; E1's difference +0.30 = rounding |
| A private CHF receipt refunded in SEK | E3 100.00 CHF, base 1 140.00 | +1 100.00 SEK | settles: 100.00 CHF · base 1 100.00 | refunded; FX difference −40.00 (3960) — the owner was paid less than the ECB value, shown on the statement |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One payment record (Priority: P1)

The owner links a bank row to an expense or a supplier invoice — from the entity's panel (the payment picker, F97 US2), from the Justify panel on the row (F97) or from the inbox — and the link is the whole record: the entity's money columns do not move. The panel lists the entity's payments as its links: the row, the allocated amount in the entity's currency, the base the row gave and the running FX difference. *Remove* takes one link away and the status follows.

**Acceptance**: (1) a 45.00 CHF expense attached to a −531.40 SEK row: `expenses.amount_base` unchanged (its ECB base), the link carries `45.00 CHF · 531.40`, the panel says *Paid* and *FX difference +8.23 SEK*. (2) A 12 000 SEK supplier invoice paid 4 000 then 8 000: two links, *Partially paid* after the first, *Paid* after the second; `paid_amount` does not exist. (3) Two receipts on one −200 SEK row: both links accepted; a third of 1.00 SEK refused with the remaining 0.00 named. (4) The expense's *Paid by* is a bank account; a row on another account is refused with both names, as today.

### User Story 2 - The existing books move once (Priority: P1)

One migration: `payment_sources` become `bank_accounts` rows (`role = owner_private` for the private instruments; the bank-account sources map to the account they pointed at); every expense and subscription points at its account; every `justifies` link gets its `allocated_base` from its row; every cross-currency attachment (today one link in the *paid* currency) is rewritten into the entity's currency in full; every entity whose base was replaced by the row's (`rate_source = bank`) gets its base back at its date from the ECB table, or keeps the realised base as a manual rate when no rate exists for that day; every active settlement's lines become `settles` links from its refund row; then `paid_amount`, `paid_currency`, `base_provisional`, `settlement_lines`, the settlement's derived columns and `payment_sources` are dropped. The migration logs its counts and refuses to run if any link would break an invariant, naming it.

**Acceptance**: a migration test on a fixture with the seven cases above as *today's* records asserts the links, bases and statuses after; the package golden of the seed changes only in the new columns (US5).

### User Story 3 - Reimbursements are links (Priority: P1)

A settlement is a numbered statement (`ST26-001`, its PDF, cancel with the number kept) over the `settles` links of one refund row. *Propose* allocates the row's base FIFO over the open private expenses (the owner's per-row override stays); *Confirm* writes the links (amount in each expense's currency, base = the slice) — no lines, no stored sums. The statement and the panel show Σ base, the rounding within tolerance and the FX difference, signed, **without a confirmation step**: the sign says 3960 or 7960, the accountant books it. *Cancel* removes the links; the expenses reopen; the statement is superseded (derived, as today).

**Acceptance**: the e2e of specs/expenses US3–US4 passes with the stored columns gone; the cross-currency case (E3 above) prints *FX difference −40.00 SEK (3960)* on the statement; cancelling returns E1 and E2 to *To refund*.

### User Story 4 - One table of payers (Priority: P2)

Banking → Accounts lists the private instruments under the bank accounts (*Private SE · SEK*, *Private CH · CHF*) and offers *Add private instrument* (alias, currency) — the only place a payer is created. Imports, the Months grid, completeness, rules, transfer pairs and the inbox never see an `owner_private` account (no CSV format, no rows). *Paid by* on an expense, a subscription and the new-expense dialog lists main accounts and private instruments, never savings.

**Acceptance**: the seed shows two private instruments; adding *Private EUR* makes it pickable at once; the import dialog's account list does not contain it; the e2e journeys that pick *Private SE* pass unchanged (the alias is the old label).

### User Story 5 - The accountant reads the difference (Priority: P2)

The package's expenses and supplier-invoices sheets carry *Base* (at the entity's date), *Paid base* (Σ links) and *FX difference* (signed, with 3960 / 7960); the settlements sheet reads the links; a row's *Related documents* lists every entity it pays, each with its allocation. Invoices (receivables) show the same three columns.

**Acceptance**: the golden captured once; the 45.00 CHF case prints `523.17 · 531.40 · +8.23`.

### Edge Cases

- **Cross-currency allocation default**: when the row's currency differs from the entity's, the default allocation is the entity's whole open amount and the whole remaining base of the row; the owner may state another amount (a SEK deposit on a CHF invoice) and then states the base too (the panel shows the row's remaining base as the default).
- **Rounding on same-currency slices**: `allocated_base` = |row base| × amount ÷ |row amount|, 2 dp; the link that exhausts the row takes the exact remainder, so Σ base of a fully used row equals its base to the öre.
- **Overpayment**: a link beyond the entity's open amount is refused (the trigger and the service, same message); the owner splits the row over two entities instead.
- **A row's unallocated remainder within the tolerance** (the owner rounded a refund up, a foreign fee was deducted) is *rounding* / *bank fees* on the row — derived, as D25 says; above it the row stays *partially justified*.
- **Documents** (`justifies` onto a document) carry no allocation: `allocated_amount`, `currency` and `allocated_base` are null together (CHECK).
- **Invoices** keep their rule (paid = Σ links vs total − credit notes); cross-currency receipts become possible through the same link shape (today refused) — F116's engine decides when to propose them.
- **Legacy `rate_source = bank`**: none is written after the migration; the enum keeps the value for the bank rows' CHECK and for history reads.

## Requirements *(mandatory)*

- **FR-001** Schema (PR 1, the migration alone touches it; two migration files — Postgres cannot use a new enum value in the transaction that adds it): (a) `bank_account_role` + `owner_private`; `bank_accounts.bank_format_id` nullable with `CHECK (role = 'owner_private' OR bank_format_id IS NOT NULL)`; the private rows `account_number = alias`. (b) `links.allocated_base DECIMAL(15,2)` with `CHECK ((allocated_amount IS NULL) = (allocated_base IS NULL))`; `expenses.paid_from_account_id UUID NOT NULL` and `subscriptions.paid_from_account_id UUID NOT NULL`, composite FKs to `bank_accounts(tenant_id, id)` `RESTRICT` (D63); `settlements.bank_transaction_id` gets its composite FK; the data moves of US2; drop `expenses.paid_amount / paid_currency / base_provisional / payment_source_id`, `supplier_invoices.paid_amount / paid_currency`, `settlements.payment_source_id / refund_amount / refund_currency / refund_base / allocated_base / exchange_difference_base / rounding_base / exchange_difference_bas_code`, table `settlement_lines`, table `payment_sources`, enum `payment_source_kind`; `CHECK (rate_source <> 'bank')` on `expenses` and `supplier_invoices`. (c) Triggers: `links_check_allocation()` `AFTER INSERT ON links` — locks the target row and the bank row `FOR UPDATE`, then Σ `allocated_amount` onto the target ≤ its amount (`invoices.total_amount`, `supplier_invoices.amount_total`, `expenses.amount`) and Σ `allocated_base` from the bank row ≤ |`bank_transactions.amount_base`|, else `RAISE link_allocation_exceeded` naming the remaining; `lock_money_when_linked()` `BEFORE UPDATE` on `expenses` (replacing `expenses_lock_when_settled`) and `supplier_invoices`: `amount, currency, vat_amount, date / invoice_date, amount_base, rate, rate_source, rate_date, paid_from_account_id, group_id` immutable while an allocating link onto the row exists (A2, A13); `settlements_lock` reduced to number, bank row, status and the PDF.
- **FR-002** `linking.createLink` takes `{ allocatedAmount, allocatedBase? }`; computes the base by the Edge-Case rules when absent; checks both sums in the service (the message names the remaining) before the trigger does; `removeLink` as today. `allocatedSums` returns amount and base; `AllocationStatus` gains `allocatedBase`; the DTO carries `allocatedBase`. `OWN_PAYMENT_FLOW` stays (the owner modules validate the payer / account pair); nothing else in linking changes shape.
- **FR-003** `kernel/money/settlement.ts` is the one tolerance: `OPEN_BASE_TOLERANCE_SEK` and `fifo.ts`'s own rounding go; `fxDifference(amountBase, amount, allocated: {amount, base}[])` and `paidShare` live beside `isSettled` / `openAmount`, pure, property-tested (Σ of slices = the row base; the difference's sign).
- **FR-004** `expenses`: `payExpense(expenseId, bankTransactionId, amount?, base?)` and `unpay(linkId)` replace `attachBankTransaction` / `detachBankTransaction`; `deriveExpenseStatus({ paidByPrivate, amount, justified, settled })` reads amounts in the expense's currency; `owed` = open amount, its base equivalent derived for the settlement proposal; `settlements.ts` as US3 (`propose`, `confirm` → links, `cancel` → links removed), `statement.ts` reads the links; `payment-sources.ts` deleted, `ensureDefaultSources` deleted (the migration creates the two defaults; a new tenant adds its own under Accounts); `listPaymentSources` consumers read `banking.payerAccounts()`.
- **FR-005** `supplier-invoices`: one `recordPayment(invoiceId, bankTransactionId, amount?, base?)` for any currency and one `removePayment(linkId)`; `attachPayment` / `detachPayment` deleted; the linkable exposes the invoice's own amount and currency always; `status.ts` reads `total = amount_total`.
- **FR-006** `banking`: `owner_private` accounts — `payerAccounts(tx)` (main + owner_private, for *Paid by*), `createPrivateAccount(alias, currency)`, the Accounts page section and form (US4); every read that lists importable accounts or main rows filters `role IN ('main', 'savings')` as today (`role = main` where it says main).
- **FR-007** `subscriptions`: `paid_from_account_id` replaces `payment_source_id` in the service, the matcher, the form and the table (labels from `banking.payerAccounts`).
- **FR-008** UI: the expense and supplier-invoice payment sections list links with amount, base and the FX difference line; the settlement panel and statement show Σ base, rounding and the signed difference with its BAS; the Justify panel sets *Paid by* = the row's account (no choice); the new-expense dialog's *Paid by* reads `payerAccounts`. i18n in `en.ts` only (D62).
- **FR-009** `package/collect.ts` (PR 3): the three columns on expenses, supplier invoices and invoices; settlements from links; new goldens captured once, reviewed in the PR.
- **FR-010** Tests: the migration test on the seven-case fixture (US2); the two triggers hit directly (an allocation over the amount, over the base, a money update on a linked expense and supplier invoice); property tests on `fxDifference` and the slice arithmetic; the services' tests rewritten on links (deposit + balance, two receipts on one row, cross-currency attach, settlement confirm / cancel); e2e: expenses, supplier-invoices, settlements, subscriptions, justify unchanged in journey, plus the deposit-and-balance step on the supplier invoice journey; `kernel/guards` green.
- **FR-011** Docs in the same PRs: `docs/linking.md` (the link as the record, the triggers), `docs/expenses.md`, `docs/supplier-invoices.md`, `docs/banking.md` (private instruments), `docs/accountant-package.md`, `docs/constitution.md` §1.6 (D37's wording: "from the first allocating link"), `docs/feature-inventory.md` (D60 applied, D26's card-FX sentence superseded), `specs/expenses/spec.md` and `specs/supplier-invoices/spec.md` pointed here.

## Success Criteria *(mandatory)*

- **SC-001** After PR 1 on the seed: `grep -rn "paidAmount\|paymentSource\|settlementLine\|baseProvisional" src/modules` is empty; every allocating link has a base; Σ base of every fully allocated row equals its base.
- **SC-002** A deposit + a balance and two receipts on one row are accepted end to end (e2e); an allocation over the amount is refused by the trigger with the remaining named, even from a raw SQL insert.
- **SC-003** The expense status, the supplier-invoice status, the invoice state and the settlement's "refunded" all call `isSettled` with the one tolerance — no other tolerance constant exists in `src/`.
- **SC-004** The FX difference is signed in both directions in the unit tests and on the package sheet (A5 closed).
- **SC-005** The e2e journeys of expenses, supplier invoices, settlements, subscriptions and justify pass with their steps unchanged apart from the new ones.

## Migration plan (PR 1, one transaction after the enum value)

1. `ALTER TYPE bank_account_role ADD VALUE 'owner_private'` (its own migration file).
2. `bank_accounts`: nullable format + CHECK; `INSERT` one account per `payment_sources` row of kind `private` (alias = label, number = label, currency, `created_by`, `source = 'migration'`); the map `source_id → account_id` (bank-account sources → their `bank_account_id`).
3. `expenses` / `subscriptions`: add `paid_from_account_id`, fill from the map, `NOT NULL`, FK; fail by name if a source maps to nothing.
4. `links.allocated_base`: for `justifies` from a bank row whose `currency` = the entity's own currency: |row base| × amount ÷ |row amount| (the last link of a fully used row takes the remainder); whose currency ≠ the entity's (today's cross-currency attach, one link in the paid currency): amount = the entity's full amount, currency = the entity's, base = |row base|; CHECK, NOT NULL together.
5. `expenses` / `supplier_invoices` with `rate_source = 'bank'`: base = amount × ECB of the entity's date when `ecb_rates` has it (`ecb_daily`, or `ecb_nearest` by the banking rule), else keep the base with `rate = base ÷ amount` (6 dp), `rate_source = 'manual'`, `rate_date = date`; log both counts; add the CHECKs.
6. `settlements`: FK on the row; for each **active** settlement, one `settles` link per line from its row to the expense (amount = expense amount × line base ÷ expense base, capped at the expense's amount; base = the line's); delete the `settles` links that pointed at settlements; drop `settlement_lines` and the derived columns; cancelled settlements keep number, row, status, note and PDF (their lines are in the audit trail).
7. Drop `paid_amount`, `paid_currency`, `base_provisional`, `payment_source_id`, `payment_sources`, `payment_source_kind`; the triggers of FR-001 (c); the audit rows of `settlement_line` stay as they are.
8. A guard before step 7 runs the two sums over every row and entity and raises with the offenders if any (none expected on the box — B1 has not started).

## Assumptions

- The owner's box holds no real payment yet that the migration cannot rewrite (B1 starts after this lane); the migration still handles every case, logged.
- The tenant's base currency is read once (D39); every `allocated_base` is in it.
- D26's card-FX sentence ("the bank row's SEK as base") is superseded by the four-line rule: the receipt keeps its ECB base, the card's SEK is the link's base, the difference is shown. The accountant books the paid base for a card purchase (no payable in between) and the difference as 3960 / 7960 for an invoice paid later — his call, both numbers on his sheet.
- Rollback of PR 1 = the snapshot taken before the deploy ([[deployment]]).

## Questions for the owner (one batch; the recommended answer is the spec's)

1. The receipt's base stays ECB at its date, the card's SEK goes on the link, and the sheet shows both with the difference — instead of the Excel's "the expense cost what the card paid". Yes (D60 / A8), or keep the card's SEK as the expense's base and show only the row?
2. The settlement's exchange difference needs no confirmation any more — derived and signed, 3960 / 7960 by sign. Yes?
3. Private instruments live under Banking → Accounts (the migration creates *Private SE* and *Private CH* from today's rows). Yes?

## Out of scope

- The one engine (F116): candidates, cross-currency proposals and amount rules land on the link this spec defines.
- `invoices.rate_source` as an enum and `base_currency` (A15) — a cleanup PR of its own.
- Splitting one bank row across categories (F113's *mixed* tag covers the justified case).
