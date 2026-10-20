# Harvest — expenses (H8: Expenses, groups, owner liability ledger, settlements, reimbursement statement)
Sources read (af_core, commit a2fe220): `prisma/schema.prisma` models `ExpenseClaim` (l.1119), `ExpenseClaimLine` (1175), `ExpenseCategory` (1204), `EntitySequence` (1227), `ExpensePayment` (1247), `CompanyPurchase` (2073), `CompanyPurchasePayment` (2139) · `app/api/expenses/route.ts` (GET list, POST create) · `app/api/expenses/[id]/route.ts` (GET, PUT, DELETE) · `app/api/expenses/[id]/{submit,approve,reject}/route.ts` + `approve/__tests__`, `reject/__tests__` · `app/api/expenses/__tests__/base-currency.test.ts` · `app/api/expenses/upload/route.ts` + tests · `app/api/expenses/categories/route.ts` · `app/dashboard/expenses/reimburse/{page.tsx,ReimburseClient.tsx,TransactionPickerModal.tsx,BatchConfirmDialog.tsx}` · `app/api/banking/transactions/[id]/reconcile-batch/route.ts` (the server side of the reimburse flow) · `app/api/banking/transactions/[id]/reconcile/route.ts` `reconcileToExpenseClaim` (l.578) · `app/api/banking/transactions/[id]/unreconcile/route.ts` (STATUS_REVERT_MAP l.47) · `lib/utils/rounding.ts` · `lib/posting/posting-service.ts` `postExpenseClaim` (l.187), `postPaymentJournal` (l.358) · `lib/utils/sequence-numbering.ts` · `lib/validation/expenses.ts`, `lib/validation/company-purchases.ts` + their `__tests__` · `app/api/company-purchases/route.ts`, `[id]/route.ts` · `lib/banking/matching.ts` expense finder (l.494–620) · `prisma/seed.ts` expense categories (l.178–249) · `app/dashboard/expenses/{ExpensesClient,ExpenseFormClient,[id]/ExpenseDetailClient}.tsx` · `components/expenses/{DocumentUpload,OCRReview}.tsx` · `app/api/documents/[id]/create-entity/route.ts` (EXPENSE_CLAIM / COMPANY_PURCHASE branches) · `app/api/reports/swiss-vat/route.ts` (expense VAT, l.250–310).

v3 context applied: `docs/feature-inventory.md` §3.7 (module verdict + reimbursement model), D3, D4, D6, D8, D9, D13, D15, D18; `docs/excel-to-v3-mapping.md` Sheet 3; `.claude/skills/bas-accounting/SKILL.md`.

## 1. What the feature is for
Every cost AnalyticsFab bears, except supplier invoices (D8): company-card purchases from the Nordea rows, private purchases the owner reclaims, Swiss VAT payments, monthly subscriptions. Expenses live in **groups** (`213 — Travel to CH in March 2026`, `217 — Online subscription`); each has a BAS category, a business key `Ex{group}-{alias}-{seq}` used as the receipt's filename, and a `paid by` ∈ {AF SEK, AF CHF, private SE, private CH}. Private payments accumulate on an **owner liability ledger** in SEK; a refund transfer from a company account is linked as a **settlement** with allocations, and the settlement produces a **reimbursement statement PDF** — the justification the refund transaction never had. Statuses (paid / to refund / refunded) are derived, never typed.

v1 had two parallel objects for this: `ExpenseClaim` (a multi-line claim with an approval workflow and reimbursement by linking a bank transaction) and `CompanyPurchase` (a single card purchase with a hand-typed PENDING → DOCUMENTED → RECONCILED status). v3 merges them into one `expense` that differs only by `paid_by`.

## 2. Behaviour — rules as numbered statements

### 2.1 What v1 did — expense claims
- R1 A claim is a header (`title`, `description`, `claimDate`, `currency`, totals) with ≥ 1 line; each line has `expenseDate`, `categoryId`, `description`, `justification`, `amount`, `currency`, `isAllowance`, `location` (`schema.prisma` 1119–1202; `ExpenseClaimCreateSchema` requires `lines.min(1)` and unique `lineNumber`s — `lib/validation/expenses.ts`).
- R2 Claim number `EC{yy}-{nnn}` from `EntitySequence(tenant, 'EXPENSE_CLAIM', year)`, 3-digit zero padded, resets per year (`lib/utils/sequence-numbering.ts` l.23–30, 123). Other prefixes: `CP` company purchase, `TA` travel allowance, `SI` supplier invoice (l.43–47).
- R3 Header total = Σ line amounts, computed on the server at create and update (`app/api/expenses/route.ts` l.104–107; `[id]/route.ts` l.143–148).
- R4 Status machine (`schema.prisma` l.1133; routes): `DRAFT` → `SUBMITTED` (submit, creator only, needs ≥ 1 line: `'Expense claim must have at least one line item'`) → `APPROVED` (approve, permission `approve ExpenseClaim`; `'Only SUBMITTED expense claims can be approved'`) | `REJECTED` (reject, permission `reject ExpenseClaim`; description overwritten with `REJECTED: {reason}` or `REJECTED`) → `REIMBURSED` (set by the reimburse flow when fully paid). Edit only in `DRAFT` (`'Only DRAFT expense claims can be edited'`); delete only `DRAFT` or `REJECTED`, hard delete (`'Only DRAFT or REJECTED expense claims can be deleted'`).
- R5 Approval posted a double-entry journal: Dr expense account per category (lines grouped by `category.expenseAccountNumber`, error `'No expense account configured for category: {name}'`), Cr `2440` labelled "Accounts Payable – Staff" for the total; entry date = `claimDate` (`posting-service.ts` 187–271). Inside one DB transaction with the status change; a posting failure rolled the approval back (approve test "should rollback on posting failure").
- R6 SEK base at create/update: if `currency ≠ baseCurrency` the **latest** `exchangeRate` row from currency → base (`orderBy date desc`, not the rate of the expense date) is stored as `exchangeRate` and `totalAmountBaseCurrency = total × rate`; same currency → rate 1 (`route.ts` l.112–142). If no rate row exists both stay `null`. The line-level `amountSEK` / `exchangeRate` columns are **never written** (dead columns). `PUT` recomputes the base amount with today's latest rate on every edit — the rate was not immutable.
- R7 Role scoping: `USER` sees only claims where `createdById = user.id` (`getScopingFilter`); ADMIN/ACCOUNTANT see the tenant (`route.ts` l.26).
- R8 Receipt upload (`/api/expenses/upload`): PDF/JPG/JPEG/PNG/TIFF/BMP, max 10 MB (`'File size exceeds 10MB limit'`), stored under tenant/`expenses`, OCR run synchronously via a 10-minute SAS URL, document type `EXPENSE_RECEIPT`, linked to the claim with `linkType: 'RECEIPT'` when `claimId` is given, else left unlinked for later; response returns the document id, never the blob URL (SEC-03).
- R9 OCR → entity (`documents/[id]/create-entity`, EXPENSE_CLAIM branch): creates a `DRAFT` claim with one line, `title` from `vendorName`/`merchantName`/file name, `claimDate` from `transactionDate`, `vatAmount` from `totalTax`, `totalAmount` from `invoiceTotal`/`total`; the OCR review UI shows a confidence badge per field: ≥ 0.8 High (green), ≥ 0.5 Medium (yellow), else Low (red), and a banner `'Low Confidence Detected — Some fields have low confidence scores. Please review carefully.'` when any field < 0.7 (`OCRReview.tsx` 57–70, 244–258).
- R10 Optional header `vatCodeId`: when set and the VAT code is Swiss, the Swiss VAT report counts the claim as input VAT with `VAT = total × rate / (100 + rate)` (gross-inclusive), statuses APPROVED or REIMBURSED, by `claimDate` (`reports/swiss-vat/route.ts` 250–310).

### 2.2 What v1 did — company purchases (card)
- R11 `CompanyPurchase` = one purchase: date, optional partner or free-text `merchantName`, title, `subtotal` + `vatAmount` + `totalAmount` (must reconcile within 0.02: `'Total amount must equal subtotal plus VAT amount'`), currency default `SEK`, `countryCode` default `SE`, optional category / VAT code / tags (`lib/validation/company-purchases.ts`).
- R12 Status typed by hand through PATCH: `PENDING` → `DOCUMENTED` → `RECONCILED` (terminal; `'Cannot transition from X to Y'`), no skipping, no reversal; `RECONCILED` is set by the bank reconcile route and reverted to `DOCUMENTED` by unreconcile; only `DOCUMENTED` purchases are offered as match candidates (`matching.ts` l.992). Hard delete allowed only in `PENDING`.
- R13 No SEK base is computed for a company purchase at create (`totalAmountBaseCurrency`, `exchangeRate` stay null) — the bank row already carries the truth; v1 never joined the two.

### 2.3 What v1 did — reimbursement (the flow, step by step)
Page `/dashboard/expenses/reimburse` ("Batch Reimbursement — Select approved items to reimburse and link to a bank transaction"):
- R14 **Candidates** = `ExpenseClaim` with `status = 'APPROVED'`, `deletedAt null`, **and no payment row at all** (`payments: { none: {} }`), plus `TravelAllowance` under the same conditions; max 100 each; sorted by `approvedDate` desc (`reimburse/page.tsx` 27–83, 134–139). Consequence: an item that received a partial payment disappears from the page and can never be completed there — a bug.
- R15 Filters: employee (partners with role EMPLOYEE), date from/to (on claim date / departure date), type (All / Expense Claims / Travel Allowances); "Select all" selects the filtered set; a running total per currency is shown for the selection.
- R16 **Allocation per item** defaults to the full amount and is editable in the row (`<input type=number step=0.01 min=0 max=item.amount>`); the server also rejects over-allocation per item: `'Total payments for {claimNumber} ({paid}) would exceed amount ({total})'`.
- R17 **Transaction picker**: outgoing (`amount < 0`), `remainingAmount < 0`, `reconciledStatus ∈ {UNRECONCILED, SUGGESTED}`; search on sender / name / message / booking date; sorted by currency match with the selection's majority currency, then date desc; each row shows one of `Exact match` / `Covers all items ({x} remaining)` / `Does not cover total ({x} short)` / `Currency does not match selected items`, and `Available: {|remaining|}` (`TransactionPickerModal.tsx` 82–154).
- R18 **Confirm dialog**: shows the transaction, the items (allocated "of" full when partial), total per currency, a note (≤ 500 chars), and one of: `Amounts match exactly` · `Partial reconciliation — Transaction amount is {diff} more than selected items. You can add more items later.` (remainder stays on the transaction) · `Allocated amount exceeds transaction — Total allocated (…) exceeds transaction amount by …` (confirm disabled). Exactness threshold 0.01 (`BatchConfirmDialog.tsx` 59–65).
- R19 **Server** (`reconcile-batch`, permission `reconcile BankTransaction`, Serializable transaction, 30 s timeout, 1–50 items, `allocatedAmount > 0`): verifies tenant and `APPROVED` status of each item (`'Expense claim {no} must be APPROVED to reimburse (current: {status})'`); verifies Σ existing allocations + Σ new ≤ |transaction amount| (`'Total allocation (…) exceeds transaction amount (…)'`); creates one `ExpensePayment` per item with `allocatedAmount`, `currency = expense.currency`, `notes = 'Batch: {notes}'` or `'Batch reimbursement'`, `reconciledById`; sets the item `REIMBURSED` + `reimbursedDate` when `determinePaymentStatus` says PAID; sets the transaction `reconciledStatus = 'RECONCILED'` when fully allocated else `'SUGGESTED'`, `remainingAmount` normalised to 0 within tolerance; audit event `EXPENSE_CLAIM_REIMBURSED` per item.
- R20 The comparison in R19 is done **on raw numbers across currencies** — a CHF allocation is added to a SEK transaction total without conversion (`reconcile-batch/route.ts` 94–115; `_transactionCurrency` unused in `processExpenseClaimReimbursement`). Cross-currency settlement was therefore not actually supported; only the picker's `Currency does not match` hint warned.
- R21 Rounding tolerance for "fully paid" (underpayment only): SEK 0.50, CHF 0.05, EUR 0.05, USD 0.05, default CHF (`lib/utils/rounding.ts`); when within tolerance the item is marked paid and the payment note gets `Rounding adjustment: {symbol} {diff} ({name} rounding tolerance)` with names `Swedish 50-öre`, `Swiss 5-cent`, `Euro 5-cent`, `US 5-cent`.
- R22 Single-item reconcile (`reconcile/route.ts` l.641) sets the claim status to `'PAID'`, a value that exists nowhere else (schema comment, list badges, unreconcile map all say `REIMBURSED`) — inconsistency/bug.
- R23 Unreconcile deletes the payment row and reverts `REIMBURSED → APPROVED` only when **no** payment rows remain (`unreconcile/route.ts` 47–51, 272–279).
- R24 Payment-side journal posting (`postPaymentJournal`, Dr 2440 / Cr 1920) was **dead**: when called with a `tx` it logs `'Skipping journal posting in transaction context - needs refactoring'` and returns `null` (`posting-service.ts` 577–583) — every reconcile path passes `tx`.
- R25 Matching suggestions for a refund transaction: expense claims `APPROVED`, no payments, `claimDate` within ±5 days of booking date, amount within 1 % (+5 % extra cross-currency), scored: claim number in message +40 / amount exact +40, < 1 % +30, < 5 % +20 / date same +30, ≤ 2 d +25, ≤ 5 d +15 (`matching.ts` 494–620, 853+). Detail in H3.

### 2.4 What v3 must do (per D8, D9, D13, the Excel and the owner's flow)
- R26 One `expense` entity; `paid_by` is a `payment_source` that is either a company bank account (AF SEK, AF CHF) or a private instrument of the owner (private SE, private CH). No claim header, no lines: one expense = one receipt = one amount (R1's multi-line claim is replaced by the group).
- R27 Every expense belongs to exactly one `expense_group` (`kind ∈ {trip, batch}`, running number, description). Late receipts may be added to any existing group at any time (D9); a trip group carries the travel details used by H9.
- R28 Business key `Ex{group}-{alias}-{seq}` with `seq` = 2-digit sequence per (group, BAS alias), assigned at creation and never reused; the document's business key is `{key}_{expense date}_` (`Ex213-Tr-01_2026-03-11_`) — one fixed function, no prefix setting (D6). Group number = tenant-level running integer from `number_series('expense_group')`.
- R29 Amounts written once: `amount` + `currency` + `amount_base` (SEK) + `rate` + `rate_source`. Private payment → ECB rate of the expense date (`rate_source = ecb`); company account → the bank transaction is truth, base from the account currency (SEK → 1.0, CHF account → ECB of booking date, bank implicit shown when a transfer pair exists). Replaces R6's "latest rate, recomputed on edit".
- R30 Derived status, never stored: **paid** = `paid_by` company account AND a `justifies` link to a bank transaction with full allocation; **awaiting link** = company account, no link yet; **to refund** = private, open balance > 0 on the ledger; **refunded** = private, fully allocated by settlements; **partially refunded** = private, 0 < allocated < base. `document_missing` is an explicit flag (Excel "Ticket is missing…"), orthogonal to status.
- R31 **Owner liability ledger** = Σ `amount_base` of private expenses − Σ settlement allocations, per private instrument and in total, always in SEK base. It is a read model over expenses and settlements; nothing is typed.
- R32 A **settlement** links one refund bank transaction (outgoing, from a company account, counterparty the owner) to a set of private expenses with `allocated_base` per expense; Σ allocations ≤ `|tx amount_base|`; each expense's Σ allocations ≤ its `amount_base`. Partial allocations and an unallocated remainder on the transaction are allowed — the residual stays open on the ledger ("leave some in the company"). Allocation default: FIFO by expense date, editable (open point §9.1).
- R33 Cross-currency settlement nets in SEK base: a SEK refund of 9 700 settles CHF expenses whose bases sum to 9 700 ± the exchange difference; the difference (bases − refund) is a separate `exchange_difference` line of the settlement with its own BAS category (open point §9.2). Replaces R20.
- R34 The settlement generates a **reimbursement statement PDF** (document type `reimbursement_statement`, business key `Reimb_{settlement no}_{date}_`), stored and linked `settles` to the transaction and to each expense — included in the monthly package under `expenses/` (D13).
- R35 No approval, no submit, no reject (R4 dropped, D15: one owner): the only gates are "has a document (or `document_missing` flagged)" and "is linked / settled". The audit trail replaces the workflow.
- R36 Rounding tolerance (R21) stays as the link-allocation tolerance rule of the linking module (SEK 0.50, CHF 0.05, EUR 0.05): a short refund within tolerance closes the expense; the difference is reported, not hidden.
- R37 Unlinking a settlement reopens the balances (R23) and withdraws the statement document (kept in retention, flagged superseded); a new settlement produces a new statement.

## 3. Data — the fields that matter

### 3.1 v1 `ExpenseClaim` (for traceability; v3 shape in 3.3)
| field | type | meaning | constraints / derived | v3 note |
|---|---|---|---|---|
| claimNumber | string | `EC25-001` | unique per tenant, yearly sequence | → business key `Ex{group}-{alias}-{seq}` |
| claimDate, title, description | date, string | header | title required | → `date`, `description`, `note` on the expense |
| currency, totalAmount | string, Decimal(18,2) | header total | Σ lines | → one amount per expense |
| totalAmountBaseCurrency, exchangeRate | Decimal(18,2), Decimal(18,6) | SEK base | latest rate, recomputed on edit (R6) | → `amount_base`, `rate`, `rate_source`, immutable |
| status | string | DRAFT/SUBMITTED/APPROVED/REIMBURSED/REJECTED (+ stray PAID) | typed by workflow | → derived (R30) |
| submittedDate, approvedDate, reimbursedDate, approvedById | | workflow stamps | | dropped; audit log |
| partnerId | string? | employee the claim is for | | → `paid_by` private instrument (owner) |
| vatCodeId | string? | header VAT for Swiss input VAT | | → `vat_amount` + VAT registration ref when the receipt shows VAT |
| deletedAt | datetime? | soft delete | | kernel retention rules |
| lines[] | | expenseDate, categoryId, description, justification, amount, currency, amountSEK (never set), exchangeRate (never set), isAllowance, location | ≥ 1 | dropped; group replaces lines |
| payments[] (`ExpensePayment`) | | bankTransactionId, allocatedAmount Decimal(19,4), currency (= claim currency), notes, reconciledAt/By | | → `link` rows of the settlement |

### 3.2 v1 `ExpenseCategory` (app-level, not tenant-scoped) → seed in `fixtures/v1-expense-categories.json`
| code | name | v1 BAS account (seed comment) | remark |
|---|---|---|---|
| TRAVEL | Travel Expenses | 7510 ("Bilersättningar") | wrong: BAS 7510 = lagstadgade sociala avgifter; travel is 58xx (5800 group, 5831/5832 kost och logi) |
| MEALS | Meals & Entertainment | 6071 Representation | plausible (6071 avdragsgill / 6072 ej avdragsgill) |
| ACCOMMODATION | Accommodation | 7533 ("Traktamenten") | not a hotel account; hotels → 5831/5832 |
| SOFTWARE | Software & Subscriptions | 6540 IT-tjänster | plausible |
| EQUIPMENT | Equipment & Hardware | 5460 (Förbrukningsmaterial) | 5410 förbrukningsinventarier is the usual one |
| TRAINING | Training & Education | 6981 ("Utbildning") | 7610 Utbildning is the standard account |
| OTHER | Other Expenses | 6570 Bankkostnader | wrong default (bank fees) |
v3 does not reuse this table: the category is a BAS category from the tenant's kontoplan with the owner's aliases `Tr`, `Rep`, `Off`, `Ut`, `Acc`, `Evnt`, `Vat` (Excel "Account Name"); the accountant confirms the account numbers once.

### 3.3 v3 entities (what the module owns)
| entity / field | type | meaning | constraints / derived | note |
|---|---|---|---|---|
| expense_group.number | int | `213` | tenant running integer, never reused | from `number_series` |
| expense_group.description | text | `Travel to CH in March 2026` | required | |
| expense_group.kind | enum trip / batch | | | trip → has `trip` row (H9) |
| expense.group_id | uuid | | required; may be changed (late receipt joins another group) only while unsettled | |
| expense.key | text | `Ex213-Tr-01` | unique per tenant; `seq` per (group, alias) | fixed function |
| expense.date | date | document/record date | required | |
| expense.description | text | `Flight`, `Uber`, `Meal Allowance` | required | |
| expense.bas_category_id, alias | ref, text | | required; alias snapshot at creation (key stability) | |
| expense.kind | enum receipt / per_diem / vat_payment | | per_diem created by H9 only | |
| expense.amount, currency | Decimal, text | | > 0, ISO-3 | |
| expense.amount_base, rate, rate_source, rate_date | Decimal, Decimal(18,6), enum, date | SEK base | written once | ecb / bank_implicit / manual |
| expense.vat_amount, vat_registration_id | Decimal?, ref? | VAT shown on the receipt | optional; needed for Swiss input VAT (R10) | |
| expense.paid_by | ref payment_source | AF SEK / AF CHF / private SE / private CH | required | |
| expense.document_missing | bool | | default false | Excel comment flag |
| expense.note | text? | `lunch(s) = 18` | | |
| payment_source | | id, label, kind ∈ {bank_account, private}, bank_account_id?, currency, owner_user_id? | seeded with the four of the Excel; no settings UI | |
| settlement.number | text | `ST26-003` | yearly series | |
| settlement.bank_transaction_id | uuid | the refund transfer | must be outgoing from a company account | |
| settlement.allocations[] | expense_id, allocated_base (SEK) | | Σ ≤ expense open base; Σ ≤ \|tx base\| | one `link` row each (D18, kind `settles`) |
| settlement.exchange_difference_base | Decimal | bases − refund base | may be 0, ±; categorised (§9.2) | |
| settlement.statement_document_id | uuid | the PDF | generated at confirm | |
| status (expense) | derived | paid / awaiting link / to refund / partially refunded / refunded | see R30 | never a column |
| ledger (read model) | | per private instrument: open base, allocated base, count of open expenses | | dashboard action item "open liability to owner" |

## 4. Algorithms / formulas

### 4.1 Business key (R28)
`alias` = BAS alias of the category at creation. `seq` = 1 + max(seq of expenses in the same group with the same alias), formatted `%02d`. Key = `Ex{group.number}-{alias}-{seq}`. Document business key = `{key}_{expense.date ISO}_` + original extension. Changing the category after creation does **not** change the key (snapshot); the UI warns.

### 4.2 SEK base (R29)
- `paid_by` private: `rate = ECB(currency → SEK, expense.date)` with weekend/holiday fallback to the last available rate; `amount_base = round(amount × rate, 2)`; `rate_source = ecb`; `rate_date` = the ECB date actually used. SEK expenses: rate 1, source `ecb` (or `none`).
- `paid_by` company account: `amount_base` is taken from the linked bank transaction's journal entry when the link is made (same `rate`/`rate_source`); until linked the expense shows a provisional ECB base, flagged provisional in the UI. If the account currency equals the expense currency and the amounts differ (card FX, fees), the link's tolerance rule applies and the difference is reported.
v1 did `total × latestRate` with no date (R6) — do not port.

### 4.3 Settlement allocation (R32), default FIFO
Input: refund transaction `T` (amount `T.amount` in `T.currency`, base `T.base`), chosen private instrument(s), optional pre-selected expenses.
1. Candidates = private expenses with open base > 0 for the chosen instrument(s), ordered by `expense.date` asc, then key.
2. `remaining = |T.base|`. For each candidate: `alloc = min(open_base, remaining)`; `remaining -= alloc`; stop when `remaining = 0`.
3. Show the proposal with per-row editable allocations (v1 UX R16), running totals, and the residual `remaining` ("stays open on the ledger" vs "left on the transaction" — see §9.1).
4. Validate: each `alloc ≤ open_base`, Σ `alloc ≤ |T.base| + tolerance`, all expenses private and of the same owner.
5. Exchange difference: `diff = Σ alloc − |T.base|`. With a SEK refund the FIFO proposal makes `diff = 0` by construction (the last expense is cut) and the residual stays open — the owner's "leave some in the company". When the owner instead ticks "fully refunded" on an expense whose base exceeds what the refund covers, or when the refund is in CHF and its base (ECB of the booking date) differs from Σ expense bases (ECB of each expense date), `diff ≠ 0`: if `|diff| ≤ tolerance(SEK) = 0.50` it is booked as rounding on the settlement; otherwise the owner must confirm it explicitly as an exchange difference line (§9.2) — never silently. Numbers in `fixtures/owner-flow-settlement.json`: bases 6 450 + 1 620 + 2 695 = 10 765 SEK; variant A refund −9 700 SEK → allocations 6 450 / 1 620 / 1 630, 1 065 stays open, `diff = 0`; variant B refund −1 000 CHF booked at 10.70 = 10 700 SEK, all three fully allocated → `diff = +65` exchange difference; variant C `diff = 0.30` → rounding note.
6. Persist settlement + `link(kind=settles, allocated_amount=alloc)` per expense + `link(kind=justifies, tx ↔ statement document)` + audit row; derive statuses.

### 4.4 Paid / fully-refunded test with tolerance (R21, R36)
`open = amount_base − Σ alloc`. Closed when `open ≤ 0` or `0 < open ≤ tolerance(SEK) = 0.50` (base is SEK; the per-currency tolerances SEK 0.50 / CHF 0.05 / EUR 0.05 apply to company-paid links in the transaction currency). When closed by tolerance, the settlement line carries the note `Rounding adjustment: SEK 0.37 (Swedish 50-öre rounding tolerance)` — port the v1 string format.

### 4.5 Ledger (R31)
`open_total(instrument) = Σ amount_base(private, instrument) − Σ allocated_base(settlements, instrument)`; shown as the dashboard action item "open liability to owner: 300 SEK (1 expense)". A month-end snapshot goes to `notes.md` of the package (H12).

### 4.6 Reimbursement statement (R34)
One component, edit / print modes, Chromium render (invoice-pdf skill). Content: company header; "Reimbursement statement {settlement no}"; owner as payee; refund transaction (account, booking date, amount, currency, bank reference); table of expenses settled: key, date, description, BAS alias, amount + currency, rate, base SEK, allocated SEK, remaining SEK; totals; exchange difference / rounding line if any; residual open liability after this settlement; language of the tenant (en/fr; sv later). Stored at confirm; regenerated as a new version if the settlement is unlinked and redone.

## 5. UI behaviour worth keeping
- **Expense list** (DataTable, D20): columns key, group, date, description, category alias, amount + currency, base SEK, paid by, status badge, document (✓ / missing), note; typed header filters incl. status and paid-by; KPI strip like v1's (`ExpensesClient.tsx`): count per status, "to refund" total in SEK, "refunded this year".
- **New expense** (work archetype): receipt upload pane opened first ("Start with receipt upload expanded on mobile for quick camera access" — `ExpenseFormClient.tsx` l.56), OCR pre-fills date / merchant / total / VAT with confidence badges (R9 thresholds), then group (default: the most recent open group, with "new group" inline), category (favourites first, partner default), paid by (last used), amount + currency (currency defaults from paid-by instrument), note, `document_missing` checkbox when no file. Keyboard: Enter saves and offers "add another to this group".
- **Group page** (entity archetype): header `213 — Travel to CH in March 2026`, kind, trip details (H9), total per currency and in SEK, per-expense rows, "add late receipt", for trips "compute per diem".
- **Settle** (work archetype, replaces v1 reimburse page): left = open private expenses (FIFO order, checkboxes, editable allocation, per-currency and SEK totals — v1 R15/R16 UX); right = transaction picker with v1's hints (`Exact match`, `Covers all items (… remaining)`, `Does not cover total (… short)`, `Available: …`), filtered to outgoing own-account transactions whose counterparty matches the owner (learned rule, H4) and that are not fully allocated; confirm dialog with v1's three states (exact / partial / over-allocated → disabled) plus the exchange-difference line; on confirm the statement PDF opens in a new tab.
- **Expense detail**: amounts (object + SEK + rate + source), links (transaction / settlement / document) with navigation, audit timeline. v1 confirm prompts to port verbatim: `'Delete this expense claim? This action cannot be undone.'` → `'Delete this expense? This action cannot be undone.'`; deletion blocked while linked or in retention.
- Strings worth keeping (en; fr to add): `Batch Reimbursement` → `Settle private expenses`; `Select Bank Transaction — Choose an outgoing transaction to link with selected reimbursements`; `No matching outgoing transactions found — Import bank transactions or adjust your search`; `Partial reconciliation`; `Amounts match exactly`; `Remaining after reconciliation: …`; `Notes (optional) — Add any notes about this batch reimbursement…`; `Confirm Reimbursement`; `Processing…`.

## 6. Tests to port — one line each
Validation (`lib/validation/__tests__/expenses.test.ts`, 35 cases) → the v3 Zod schema at the action boundary:
- `should validate a complete valid expense claim` / `with multiple lines` / `without optional currency` → a valid expense input passes; currency optional defaults from `paid_by`. Fixture `v1-claim-scenarios.json`.
- `should reject expense claim without title` / `with empty title` / `without claimDate` → description and date required.
- `should reject … without lines` / `empty lines array` → n/a (no lines); replace by "group required".
- `should accept valid 3-letter currency codes` / `reject too short` / `too long` → ISO-3 check.
- `should reject line with negative amount` / `zero amount` / `without categoryId` / `empty categoryId` / `empty description` → amount > 0, category and description required.
- `should reject duplicate line numbers` → n/a; replace by "key unique per tenant".
- `Real-World Expense Scenarios`: Swiss business trip (4 CHF receipts), Swedish mileage (quantity × unit), office supplies → three group fixtures; mileage becomes a `receipt` expense with note (v3 has no quantity × unit on expenses — see §9.5).
Routes:
- `approve: should reject users without approve permission with 403` → n/a (no approval); port as "editor cannot settle, accountant cannot create" via `can()`.
- `approve: should return 400 if expense claim is not SUBMITTED` → n/a.
- `approve: should rollback on posting failure` → "settlement is atomic: if the statement PDF job cannot be enqueued, no link rows are written".
- `reject: …` → n/a.
- `base-currency: should use EUR as base when configured` / `convert USD to EUR` / `CHF base` → v3: base is always SEK; port as "SEK expense → rate 1; CHF expense dated 2026-03-11 paid privately → ECB rate of 2026-03-11 (fixture rate), base = amount × rate to 2 dp; weekend date → previous business day's rate, `rate_date` recorded".
- `upload: should require authentication` / `reject request with no file` / `reject invalid file types` / `reject files exceeding 10MB` / `accept valid file types` / `use 10 minute SAS URL expiry` / `should NOT expose SAS URL in response` → documents module (H7) already covers; expenses test only "upload with group pre-fills the business key".
Company purchases (`company-purchases.test.ts`, 37 cases): the amount rule `total = subtotal + VAT within 0.02` → `amount = net + vat_amount within 0.02` when VAT is entered; the status-transition matrix tests → n/a (status derived); `strict mode rejects unknown fields` → keep.
New v3 tests (property-based where money is involved, test-conventions skill):
- Allocation invariants: Σ alloc ≤ |tx base|, each alloc ≤ open base, no negative, FIFO proposal fills in date order, residual = |tx base| − Σ alloc. Fixture `owner-flow-settlement.json`.
- Tolerance: open 0.37 SEK → refunded with rounding note; open 0.51 → partially refunded.
- Cross-currency: 3 CHF expenses, SEK refund; exchange difference computed and categorised; ledger after settlement = 300 SEK.
- Status derivation table (R30) — one case per status; unlink reopens.
- Key generation: two `Tr` expenses in group 213 → `Ex213-Tr-01`, `Ex213-Tr-02`; an `Off` in the same group → `Ex213-Off-01`; category change does not alter the key.
- Tenant isolation: settlement cannot reference another tenant's expense (RLS).

## 7. Fixtures copied → `specs/expenses/fixtures/`
- `v1-expense-categories.json` — the 7 seeded v1 categories with their BAS numbers and the v1 remark, from `prisma/seed.ts` l.178–249. Use: migration mapping and the §3.2 review with the accountant.
- `v1-claim-scenarios.json` — the three "Real-World Expense Scenarios" inputs and the mileage claim from `lib/validation/__tests__/expenses.test.ts` (Swiss business trip CHF, Swedish mileage SEK, office supplies), verbatim data.
- `v1-rounding-tolerances.json` — per-currency tolerances and note strings from `lib/utils/rounding.ts`.
- `owner-flow-settlement.json` — the owner's example from `feature-inventory.md` §3.7 made concrete (3 CHF private expenses with ECB rates, one −9 700 SEK refund, expected FIFO allocations, ledger before/after, the "mark all refunded" variant with the +300 exchange difference). Not from v1 — derived; labelled as such in the file.

## 8. v3 mapping — what changes per the decisions
| v1 | v3 | decision |
|---|---|---|
| `ExpenseClaim` (header + lines, approval) and `CompanyPurchase` (card, typed status) | one `expense`; `paid_by` distinguishes company account vs private; no header/lines | D9, §3.7 |
| `EC25-001` per year | `Ex{group}-{alias}-{seq}` fixed function; group number running | D6 |
| categories table with BAS number | BAS category + alias from the tenant kontoplan (v2 BAS preferences) | D2 |
| latest exchange rate, recomputed on edit; line-level SEK columns never filled | ECB rate of the expense date (private) or the bank row's rate (company), written once | D3, D4 |
| DRAFT → SUBMITTED → APPROVED/REJECTED → REIMBURSED, typed `PENDING → DOCUMENTED → RECONCILED` | derived: paid / awaiting link / to refund / partially refunded / refunded; `document_missing` flag | §3.7, bas-accounting |
| approve = journal posting (Dr expense / Cr 2440) | nothing is posted; category + link; the accountant books from the package | D1 |
| reimburse page: pick APPROVED items, link one outgoing transaction, allocations per item, batch of ≤ 50, Serializable | settlement: FIFO proposal over the owner's open private expenses, allocations in SEK base, residual stays open, statement PDF | D9, D18 |
| `ExpensePayment` / `CompanyPurchasePayment` tables | `link` rows (`settles`, `justifies`) with `allocated_amount` | D18 |
| cross-currency compared on raw numbers (R20) | netting in SEK base + exchange-difference line | §3.7 |
| no document for the refund | reimbursement statement PDF, stored, in the monthly package | §3.7, D13 |
| employee dimension (partner EMPLOYEE, filter) | the owner only; `payment_source.owner_user_id` nullable keeps the door open for an editor | D15 |
| tags, `isAllowance`, `location`, `justification` on lines | dropped; `note` + group description; per diem is its own `expense.kind` (H9) | §3.17 |
| OCR sync in the upload route | v2 documents pipeline (async job, review overlay) → "create expense from document" pre-fill | §3.9, D17 |
| `vatCodeId` on the claim for Swiss input VAT | `vat_amount` + VAT registration on the expense; Swiss declaration prep reads it (H6) | D12 |
What the Excel flow does better than v1: groups and late additions; `paid by` as a first-class fact; one rate per row at the row's date; statuses that follow from links; the receipt filename as the key. What v1 did better than the Excel: per-item editable allocations against one transaction with over-allocation guards; rounding tolerance; the transaction picker hints; OCR pre-fill with confidence; audit events per item. v3 keeps both halves.

## 9. Open questions for the owner

> **Answered 2026-10-20** — the owner\'s answers and the resulting decisions are in `docs/open-questions.md` (B10, B11, D-e → D26). The questions below are kept as the record of what was asked.
1. **FIFO default** (feature-inventory §7.1). v1 evidence: none for FIFO — the reimburse page listed candidates newest-first (`approvedDate desc`) and let the user tick items; allocation defaulted to the full amount per ticked item; partial amounts were editable per row. The Excel has no allocation at all (one status per row). Proposal stands: FIFO by `expense.date` asc with per-row override; the proposal fills oldest first because the oldest receipts are the ones the accountant has been waiting for. Confirm, and say whether the residual should default to "stays open on the ledger" (expense partially refunded) or to "unallocated remainder on the transaction" (expense fully refunded, company overpaid) — v1 allowed both silently (R18 "You can add more items later").
2. **Exchange difference category** (§7.2). v1 evidence: none — no FX difference anywhere; the only tolerance was per-currency rounding (SEK 0.50 / CHF 0.05) on underpayments, and cross-currency comparisons were simply wrong (R20). Proposal: dedicated BAS category pair for the settlement's `exchange_difference_base` (standard BAS uses 3960 valutakursvinster / 7960 valutakursförluster — confirm with the accountant), alias `Fx`, shown as its own line on the statement; below 0.50 SEK treat as rounding.
3. **Company-paid CHF expense on the SEK card** (card FX): the receipt says 45.00 CHF, Nordea SEK row says −523.17 SEK. Which is the expense's `amount`? Proposal: `amount` = receipt amount/currency, `amount_base` = the bank row's SEK amount (bank implicit rate, `rate_source = bank_implicit`), so the link is exact and the receipt is still the document. Confirm.
4. **Swiss VAT payments** (Excel "Swiss VAT" / alias `Vat`): expense of kind `vat_payment` with no VAT recovery, paid from AF CHF — fine as an expense, or should it be a journal manual entry with the proof document only? Expense keeps it in the package's `expenses/` folder as today.
5. **Mileage** (v1 test "Swedish mileage allowance claim", quantity × unit 3.50 SEK/km): do you ever claim private-car kilometres? If yes, v3 adds an expense kind `mileage` with distance × Skatteverket's tax-free rate (25 SEK per mil = 10 km in 2025; v1's 3.50 SEK/km in the test is a made-up value) next to `per_diem`; if no, it is dropped.
6. **Retention of statements**: when a settlement is unlinked, the generated statement is a document in retention (7 years). Keep it with a "superseded" flag (proposed) or allow hard delete of generated documents only?
