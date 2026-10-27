# Feature Specification: Expenses — groups, paid-by, owner liability, settlements, reimbursement statement

**Feature Branch**: `feat/expenses-core` (part 1: model, keys, base amounts, derived status, ledger, settlements, statement job, linkables, queries — with the traktamente calculator and rates, `specs/traktamente/spec.md`) · `feat/expenses-pages` (part 2: list, new expense from a document, group page with the trip panel, settle page, statement print route, rate table)

**Created**: 2026-10-20

**Status**: Ready for planning (B10, B11, D-e answered → D26; harvest `specs/expenses/harvest.md`)

> **Superseded in part by F114 / D60** (2026-10-27, `specs/linking/payment-record.md`): the link is the only payment record — `paid_amount`, `base_provisional`, `payment_sources` and `settlement_lines` are gone; a payer is a bank account (`owner_private` for the private instruments); a settlement is the numbered statement over its refund row's `settles` links, its difference derived. Where this spec and that one differ, that one holds.


**Input**: "Every cost the company bears except supplier invoices: card purchases on the Nordea rows, private purchases I reclaim, Swiss VAT payments, subscriptions. They live in groups (`213 — Travel to CH in March 2026`, `217 — Online subscription`), each with a BAS alias and a key that is the receipt's filename (`Ex213-Tr-01_2026-03-11_`), and a *paid by* — AF SEK, AF CHF, private SE, private CH. What I paid privately piles up as a liability in SEK; a refund transfer settles a chosen set of them (FIFO proposed, I adjust), the rest stays in the company; the settlement produces a reimbursement statement PDF for the accountant. Paid / to refund / refunded are facts the app derives, never something I type."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A receipt becomes an expense in a group (Priority: P1)

The owner uploads the hotel receipt (or picks it from the documents inbox), chooses the group *213 — Travel to CH in March 2026* (or creates it inline), the category *Travel (Tr)*, *paid by private CH*, 600.00 CHF on 2026-03-10. The app assigns the key `Ex213-Tr-01`, renames the document `Ex213-Tr-01_2026-03-10_`, computes the SEK base with the ECB rate of 2026-03-10 (6 450.00 at 10.75), links the expense to its document (`created_from`) and shows *to refund*. A second travel receipt in the same group becomes `Ex213-Tr-02`; the first meal becomes `Ex213-Rep-01`. A late taxi receipt joins group 213 a month later.

**Why this priority**: the key, the group and the base are what the accountant package is built from; everything else hangs off them.

**Independent Test**: create a group, three expenses with two aliases, read back keys, bases, statuses; create one from a document and check the document's new business key and the `created_from` link.

**Acceptance Scenarios**:

1. **Given** group 213 **When** two `Tr` expenses and one `Rep` expense are created **Then** their keys are `Ex213-Tr-01`, `Ex213-Tr-02`, `Ex213-Rep-01` (one gap-free counter per group × alias, `number_series` `exg-213-Tr`); the alias is a snapshot — changing the category later never changes the key (the UI warns).
2. **Given** a private CHF expense dated 2026-03-10 and ECB CHF→SEK 10.75 that day **When** created **Then** `amount_base = 6450.00`, `rate = 10.75`, `rate_source = ecb_daily`, `rate_date = 2026-03-10`; a weekend date uses the nearest ECB day (`ecb_nearest`, the date recorded); a SEK expense has rate 1 `same_currency`; no rate at all → refused (*No exchange rate for … — run the ECB sync*).
3. **Given** a company-paid expense (`paid by AF SEK`) **When** created **Then** its base is **provisional** (ECB of the date, `base_provisional = true`) until a bank transaction is attached: then `paid_amount / paid_currency` are the bank row's, `amount_base` and `rate` are the bank row's journal values (`rate_source = bank`), `base_provisional = false`, and a `justifies` link transaction → expense carries the paid amount (D26: a 45.00 CHF receipt on the SEK card → paid 523.17 SEK, base 523.17).
4. **Given** an uploaded document **When** an expense is created from it **Then** the document's business key becomes `Ex213-Tr-01_2026-03-10_` (its file name keeps the extension), the expense links `created_from` → document (D27), and the document counts as the expense's proof; **Given** no document **Then** `document_missing` must be ticked or a note given — the row shows *missing*.
5. **Given** an expense **When** amount, currency, date or paid-by is changed after creation **Then** refused once the expense is settled or linked; allowed while open (the base is recomputed, audited); description, category (alias snapshot kept), note and `document_missing` change freely.
6. **Given** an expense with a settlement line or a `justifies` link **When** deleted **Then** refused (an expense whose only links are its `created_from` and its `occurrence_of` is deleted and its document returns to the inbox — D36, 2026-10-22; `occurrence_of` F94, 2026-10-26); an open expense is deleted (audited) and its key is never reused (the counter does not go back).
7. **Given** a group with expenses **When** deleted **Then** refused; an empty group is deleted. Group numbers come from `number_series` `expense_group` and are never reused.

---

### User Story 2 - The four ways to pay (Priority: P1)

Every expense names its `payment_source`: *AF SEK* and *AF CHF* (the two main bank accounts), *Private SE* and *Private CH* (the owner's own cards). The four are seeded; a source is a bank account or a private instrument with a currency; the currency pre-fills the expense's.

**Acceptance Scenarios**:

1. **Given** the seed **Then** four payment sources exist: `AF SEK` (bank_account → Plusgirokonto SEK), `AF CHF` (bank_account → Plusgirokonto CHF), `Private SE` (private, SEK), `Private CH` (private, CHF).
2. **Given** a private source **When** an expense uses it **Then** the expense is a liability of the owner; **Given** a bank-account source **Then** it awaits its bank row.
3. **Given** a source referenced by an expense **When** deactivated **Then** allowed (no new expenses); deletion refused.

---

### User Story 3 - What the company owes the owner (Priority: P1)

The ledger is the running sum of the open SEK bases of private expenses: per source and in total, with the count of open expenses. It is a read model — nothing is typed. The dashboard's action item reads *open liability to owner: 1 065.00 SEK (1 expense)*.

**Acceptance Scenarios**:

1. **Given** the fixture's three private CHF expenses (6 450 + 1 620 + 2 695) **Then** the ledger reads 10 765.00 SEK open, 3 expenses, all `to_refund`.
2. **Given** a settlement that allocates 9 700 **Then** the ledger reads 1 065.00 open, 1 expense; the statuses are `refunded`, `refunded`, `partially_refunded`.
3. **Given** an open base of 0.37 SEK after a settlement **Then** the expense is `refunded` (tolerance 0.50 SEK, D25/D26) and the settlement line carries the rounding note; 0.51 → `partially_refunded`.

---

### User Story 4 - Settle a refund (Priority: P1)

A −9 700.00 SEK transfer to the owner lands on the SEK account. *Settle* proposes the oldest open private expenses first (FIFO by expense date): 6 450 / 1 620 / 1 630 of the 2 695 — the residual 1 065 stays open ("leave some in the company"). The owner adjusts a row, confirms; the settlement `ST26-001` is created with its lines, the transaction is linked `settles` to it, and the reimbursement statement PDF is generated, stored as a document and linked to the transaction — the justification the refund never had. When the refund is in CHF (or the owner marks an expense fully refunded with less money), the difference between Σ allocations and the refund's SEK base is an **exchange difference** line the owner confirms explicitly; within 0.50 SEK it is rounding.

**Why this priority**: it closes the loop that the Excel never closed — the refund transaction gets a document and the ledger a truth.

**Independent Test**: fixture `owner-flow-settlement.json` variants A, B, C against the service: proposal, confirmation, lines, statuses, ledger, exchange difference / rounding, the stored statement.

**Acceptance Scenarios**:

1. **Given** the three fixture expenses and the −9 700 SEK transaction **When** a settlement is proposed **Then** the FIFO lines are 6 450.00 / 1 620.00 / 1 630.00, Σ = 9 700.00, `exchange_difference = 0`, `residual_open = 1 065.00`.
2. **Given** the proposal **When** confirmed **Then** `ST26-001` exists with three lines, `refund_amount −9700.00 SEK`, `refund_base 9700.00`; one `settles` link bank_transaction → settlement with allocation 9 700.00 SEK; statuses and ledger as US3-2; the statement PDF job is enqueued on commit; the transaction derives `linked`.
3. **Given** variant B (−1 000.00 CHF refund booked at 10.70 = 10 700.00 SEK base, all three fully allocated = 10 765.00) **When** confirmed with `confirmExchangeDifference: true` **Then** `exchange_difference_base = +65.00`, the lines close all three, the ledger is 0; **When** confirmed without the flag **Then** refused: *Allocations exceed the refund by 65.00 SEK — confirm the exchange difference*.
4. **Given** variant C (difference 0.30) **Then** booked as `rounding_base = 0.30`, no confirmation needed, the line note reads *Rounding adjustment: SEK 0.30 (Swedish 50-öre rounding tolerance)*.
5. **Given** a line allocating more than an expense's open base, Σ lines > |refund base| + 0.50, an expense that is company-paid or of another source's owner, or a transaction that is incoming, already settling, or not on an own account **When** confirmed **Then** refused with the matching message.
6. **Given** a confirmed settlement **When** cancelled **Then** `status = cancelled`, the `settles` link removed, the balances reopen (statuses recomputed), the statement document stays (flagged *superseded* on the settlement, kept in retention, D26); a new settlement produces a new statement.
7. **Given** the statement job **When** it runs **Then** the PDF `Reimb_ST26-001_2026-03-31.pdf` is stored (`generated`, financial), referenced by `statement_document_id`, and linked `justifies` transaction → document; idempotent across retries.

---

### User Story 5 - The lists (Priority: P2)

`/expenses` lists every expense on the DataTable: key, group, date, description, category, amount + currency, base SEK, paid by, status, document (✓ / missing), note; Excel-style filters; a KPI strip (open liability, count per status, refunded this year). `/expenses/groups/[id]` is the group page: header `213 — Travel to CH in March 2026`, kind, totals per currency and in SEK, the expenses, *add expense*, and for trips the per-diem panel (traktamente spec). `/expenses/settle` is the work page: open private expenses left (FIFO order, checkboxes, editable allocations, totals), the transaction picker right (outgoing own-account transactions not yet settling, with *Exact match* / *Covers all (x remaining)* / *Does not cover (x short)* / *Available: …*), the confirm dialog with the three states (exact / partial / over-allocated → disabled) and the exchange-difference line.

**Acceptance Scenarios**:

1. **Given** the list filtered on status `to_refund` **When** the paid-by filter opens **Then** its values are those of the open private rows only (Excel semantics).
2. **Given** the settle page **When** a transaction of 9 700 SEK is picked with the fixture expenses ticked **Then** the hint reads *Does not cover total (1 065.00 short)* and the confirm dialog *Partial — 1 065.00 stays open on the ledger*.
3. **Given** the accountant **Then** everything reads, nothing writes.

---

### Edge Cases

- A per-diem expense (traktamente) is created by the trip panel in the trip's group, `kind = per_diem`, SEK, paid by the owner's private SE source; it follows the same statuses; recompute replaces it only while unsettled.
- A Swiss VAT payment is an expense of kind `vat_payment` paid from AF CHF, category *Swiss VAT (Vat)*, no VAT recovery; it lands in the package's `expenses/` folder like the others (D-e).
- No mileage (D26). No approval workflow (D15). No employee dimension: `payment_source.owner_user_id` nullable keeps the door open.
- A company-paid expense whose bank row is a CHF account and the receipt EUR: `paid_amount/paid_currency` = the CHF bank row, base = the row's journal base (ECB of the booking date).
- The provisional base of an unlinked company-paid expense is shown with a *provisional* mark; the package's `notes.md` lists company-paid expenses still awaiting their bank row.
- Cross-currency settlement (CHF refund of CHF expenses): Σ allocations in SEK base vs the refund's SEK base (ECB of the booking date) — the difference is the exchange difference, never hidden.
- Rounding and exchange differences carry the settlement's own BAS pair (D26: 3960 / 7960 — the accountant confirms; stored as `exchange_difference_bas_code` on the settlement, default from the tenant's active set when present).
- The statement number `ST26-001` is a yearly series (`number_series` `ST26`), assigned at confirm inside the transaction, never reused on cancel.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `expense_groups`: tenant running `number` (`number_series` `expense_group`), `description`, `kind ∈ trip | batch`; deletion refused while it has expenses; a trip group carries one `trip` (traktamente spec).
- **FR-002** `payment_sources`: `label`, `kind ∈ bank_account | private`, `bank_account_id?` (validated UUID through banking), `currency`, `is_active`, `owner_user_id?`; seeded with the four (dev seed and on first use when the tenant has none: *AF {currency}* per main account, *Private SE*, *Private CH*). No settings UI beyond activate / deactivate in part 2.
- **FR-003** `expenses`: `group_id` (FK), `key` (unique per tenant, `Ex{group}-{alias}-{seq}` from `number_series` `exg-{group}-{alias}`), `seq`, `alias` (snapshot), `kind ∈ receipt | per_diem | vat_payment`, `date`, `description`, `bas_code` (validated through settings), `amount` (> 0, 2 dp), `currency`, `vat_amount?`, `vat_registration_id?`, `amount_base`, `rate`, `rate_source ∈ same_currency | ecb_daily | ecb_nearest | bank | manual`, `rate_date?`, `base_provisional`, `paid_amount? / paid_currency?` (the bank row's, once attached), `payment_source_id` (FK), `document_missing`, `note?`. Money columns change only while the expense is open (service rule; trigger `expenses_lock_when_settled` refuses changes to amount, currency, date, base, rate, paid_* once a settlement line or a `justifies` link exists — enforced by the service, DB CHECK on amount > 0).
- **FR-004** Base: private → `journal.resolveRate`-style ECB of the expense date (shared through `rates.rateToBase`); company → provisional ECB until `attachBankTransaction(expenseId, transactionId)` copies the bank row's amount / currency and its journal entry's base and rate (`rate_source = bank`), creates the `justifies` link (allocation = paid amount in the paid currency) and clears `base_provisional`. Detaching removes the link and restores the provisional base.
- **FR-005** Derived status (read model, never stored): company-paid → `paid` when a `justifies` link allocates the paid amount (within the paid currency's tolerance), else `awaiting_link`; private → `refunded` when `open ≤ 0.50`, `partially_refunded` when `0 < allocated < base`, else `to_refund`; `open = amount_base − Σ active settlement lines`.
- **FR-006** Ledger (read model): per private source and total — `open_base`, `allocated_base`, `open_count`; `ledgerSnapshot(tx)` for the dashboard and the package's `notes.md`.
- **FR-007** `settlements`: `number` (`ST{yy}-nnn`), `bank_transaction_id` (validated; outgoing, own account, not already settling), `payment_source_id` (the private source), `refund_amount / refund_currency` (the bank row's), `refund_base` (its journal base), `allocated_base`, `exchange_difference_base`, `rounding_base`, `exchange_difference_bas_code?`, `note?`, `status ∈ active | cancelled`, `cancelled_at?`, `statement_document_id?`; `settlement_lines`: `expense_id` (FK), `allocated_base` (> 0), `note?` (the rounding note), unique (settlement, expense). Σ lines per expense ≤ its base (+0.50); Σ lines ≤ `refund_base` + 0.50 unless the exchange difference is confirmed.
- **FR-008** `proposeSettlement(transactionId, sourceId?, preselected?)` → FIFO by expense date then key over the open private expenses of the source (all private sources when none given), `min(open, remaining)` each, stopping at 0; `residual_open`, `unallocated_on_transaction`, `exchange_difference`. `confirmSettlement(input)` validates (FR-007), numbers, writes, links `settles` (allocation = |refund amount| in the refund currency), audits, enqueues `expenses.render-statement` on commit. `cancelSettlement` (US4-6).
- **FR-009** Statement job: renders `/print/settlement/[id]` through `kernel/pdf`, stores `Reimb_{number}_{booking date}.pdf` through `documents.storeGeneratedDocument`, sets `statement_document_id` once, links `justifies` bank_transaction → document; idempotent.
- **FR-010** Linkables: `expense` (amount = `paid_amount ?? amount`, currency likewise; the `justifies` target of a company-paid link; `created_from` source), `settlement` (amount = `|refund_amount|`, currency = refund currency; the `settles` target). `kinds.ts` unchanged (both pairs exist).
- **FR-011** Lists on the DataTable: expenses (`key, groupNumber, groupDescription, date, description, kind, basCode, basLabel, alias, amount, currency, amountBase, baseProvisional, paymentSourceId, paymentSourceLabel, status, allocatedBase, openBase, documentMissing, hasDocument, note, vatAmount, createdAt`), groups, settlements; distinct values and date hierarchy with Excel semantics; sums on `amount` and `amountBase`.
- **FR-012** Every write audited; owner writes, accountant reads (`can(read, expense)`, `can(read, settlement)`).
- **FR-013** Pages (part 2) as in US5 plus the statement print route (`StatementSheet`, print mode only — generated, never edited) and the traktamente rate table under settings.

### Key Entities

- **Expense group**, **Payment source**, **Expense**, **Settlement** (+ lines) as above; **Ledger** and **Status** are read models.

## Success Criteria *(mandatory)*

- **SC-001** Fixture `owner-flow-settlement.json` holds end to end: keys, bases, ledger before, variant A proposal and statuses, variant B exchange difference, variant C rounding — in the DB tests.
- **SC-002** A 200-run property test holds the allocation invariants: Σ lines ≤ |refund base| + tolerance, each line ≤ open base, FIFO fills in date order, residual = refund base − Σ (when no exchange difference).
- **SC-003** Keys never collide or go backwards under 20 concurrent creations in one group and alias.
- **SC-004** No settled expense's money facts can be changed by any route; a linked expense cannot be deleted.
- **SC-005** The statement PDF of the fixture settlement is one page and contains the three keys, the allocations, the residual and the number.

## Assumptions

- The accountant confirms the BAS pair for exchange differences (D26); until then `exchange_difference_bas_code` may be null and the statement prints the amount without a category.
- Supplier invoices (`SI…`) share the per-group counter (D28) and come in their own module next.
- The matching suggestions (which transaction pays which company-paid expense) belong to the linking UI; this feature ships `attachBankTransaction` and the settle page's own picker.
- Swiss input VAT on expenses (`vat_amount` + registration) is recorded; the declaration prep reads it later (exports).
