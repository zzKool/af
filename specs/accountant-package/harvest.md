# Harvest — accountant-package (H12: monthly zip + generated summary)
Sources: the owner's Excel (three sheets, described in `docs/excel-to-v3-mapping.md`), decisions D1, D13, D17, D19 in `docs/feature-inventory.md`, the owner's answers Q3–Q5 (accountant gets PDFs + the Excel; only CSVs monthly, savings yearly; nothing particular monthly). There is no v1 source: `af_core` had statutory reports and SIE export, which v3 drops (module verdict "exports": statements and SIE → dropped; package = zip built from a read model).

## 1. What the feature is for
Once a month the owner sends the accountant everything needed to book the month: the bank lines of the two main accounts, every justification document of the period, and a sheet that says which document explains which bank line. Today that sheet is the Excel maintained by hand. v3 generates the whole package from what is already linked, flags what is missing, and the Excel disappears (D13). The accountant books; AF proves (constitution §1.1).

## 2. Behaviour — rules
- R1 A package is built per **calendar month** and per tenant; the period is the booking-date month of the bank transactions.
- R2 The package is a **zip** with this fixed layout (no settings, D6 spirit):
  ```
  2026-06/
    bank-statements/      SEK.csv  CHF.csv            (savings.csv only in the December package, i.e. yearly)
    client-invoices/      InvoiceAF_VA26-00x.pdf       every invoice issued in the period (+ credit notes)
    supplier-invoices/    <business key>.pdf           supplier invoices dated in the period
    expenses/             <business key>.pdf           receipts of expenses dated in the period, reimbursement statements of settlements in the period, Swiss VAT payment proofs
    summary.xlsx          generated — see §4
    notes.md              generated — flags, missing documents, transfer pairs, open owner liability
  ```
- R3 `bank-statements/*.csv` are the raw Nordea rows of the period for that account, as imported (same columns, same order, booking date within the month), one file per main account (SEK, CHF). The savings account's CSV is included once a year (the owner imports it yearly; it only carries capital and interest).
- R4 Every document is placed under its **business key** as filename (the key already encodes what it is: `InvoiceAF_…`, `Ex213-Tr-01_2026-03-11_…`), with the original extension. A document is included when the entity it justifies (invoice, supplier invoice, expense, settlement) falls in the period, or — for a plain document linked directly to a bank transaction — when that transaction is in the period.
- R5 `summary.xlsx` is a **read model** over `bank_transaction`, `journal_entry`, `invoice`, `supplier_invoice`, `expense`, `settlement`, `document`, `link`: one sheet per Excel sheet of today (Bank statement, Income, Expenses) with the same columns the accountant is used to, plus a sheet "Links". Nothing in it is typed by hand; every status is derived.
- R6 A package is **reproducible**: building the same month twice from the same data gives the same files (deterministic ordering: bank lines by booking date then row order; documents by business key). It is **stored** as a document of type `accountant_package` with business key `Package_2026-06.zip` (and `Package_2026-06_v2.zip` when rebuilt after changes), linked to nothing, downloadable any time; the previous version stays.
- R7 Building never blocks on missing pieces: a bank line without a link, an expense flagged `document_missing`, an invoice not yet paid, an open owner liability — all go to `notes.md` and to the "Flags" column of the summary. The owner decides whether to send.
- R8 The package build runs as a **job** (D17, pg-boss `package.build`): it renders PDFs it lacks (reimbursement statements, the summary PDF if wanted later), zips, uploads to blob, creates the document. Progress and the result are visible on the package page; a failed build leaves no partial document.
- R9 Role: owner builds and downloads; accountant (role `accountant`) may download packages and read the summary (constitution §6 role table); editor neither.
- R10 Only the two main accounts and the savings account exist today; a future account is just another CSV in `bank-statements/` named after the account's currency/label — no setting.

## 3. Data — the read model, by sheet
Bank statement sheet (one row per bank transaction of the period):
| column | source | derived? |
|---|---|---|
| Account, Booking date, Amount, Currency, Sender/Recipient/Name/Message/Own notes, Balance | `bank_transaction` raw | no |
| Counterparty key | `bank_transaction.counterparty_key` | yes |
| BAS category, Rate, Rate source, Amount SEK | `journal_entry` | written once at categorisation |
| Related document(s) | `link` rows from the transaction: business keys of linked document / invoice / supplier invoice / expense; `transfer ↔ <other account line>` for a transfer pair | yes |
| Allocated / Delta | sum of link allocations vs amount; delta flagged beyond the tolerance rule | yes |
| Status | linked · awaiting document · no document needed (bank fees, transfer pairs, salary/tax categories) | yes |
| Note | `journal_entry.note` | no |

Income sheet (one row per invoice issued in the period, or paid in the period if issued earlier — both appear, with the reason): number, client, short code, dates, period label, currency, qty × unit × rate, net, VAT %, VAT, total, paid amount (sum of allocations), delta, status (issued / sent / paid / credited), VAT declaration period (CH yyyy/Qn), PDF business key.

Expenses sheet (one row per expense dated in the period + one per settlement): group no + description, ref `Ex…`, description, BAS category + alias, date, amount + currency, rate + SEK base, paid by (AF SEK / AF CHF / private SE / private CH), status (paid / to refund / refunded), refund booking date (from the settlement's bank transaction), document business key or `MISSING`, note. Supplier invoices are a separate sheet with the same shape as Income but inverted (supplier, their invoice no, our ref, due date, paid via which line).

Links sheet: from (type, key) → to (type, key), kind, allocated amount + currency, created at — the audit of every arrow in the picture.

notes.md sections: Missing documents · Unlinked bank lines · Transfer pairs of the month (with implicit rates) · Open owner liability at month end (SEK, per instrument) · Invoices issued but unpaid · Deltas beyond tolerance · Swiss VAT declaration period totals of the month.

## 4. Algorithms
1. **Period selection**: transactions `booking_date ∈ [first, last]` of the month per account; invoices `issued_at ∈ period` ∪ invoices with an allocation from a transaction in the period; expenses `date ∈ period`; settlements whose bank transaction is in the period; supplier invoices `invoice_date ∈ period` ∪ paid in the period.
2. **Document set** = business keys of every document linked (directly or through its entity) to something selected in step 1, deduplicated; each copied once under its own folder by entity type.
3. **Derived statuses**: exactly the derivation rules of the owning modules (linking read models) — the package never recomputes business rules, it calls the modules' queries.
4. **CSV export**: the raw rows as stored (provenance columns: account, source file, row hash) — the accountant sees what the bank said.
5. **Ordering** as in R6; **money** formatted with the SEK/CHF/EUR conventions of `kernel/money`, dates ISO.
6. **Zip** streamed to blob; document created in the same transaction as the job's final step; audit row "package built" with the counts.

## 5. UI behaviour worth keeping
Page `/package` (list archetype, D19): one row per month with built packages (version, built at, counts: bank lines / invoices / expenses / documents / flags), a "Build June 2026" action for the current and previous months, and a preview pane showing `notes.md` before download. A flag count of zero is the goal the owner works toward during the month — the page doubles as the month-end checklist.

## 6. Tests to port
None from v1. v3 tests: (a) fixture month with 2 accounts, a transfer pair, a bank fee, one invoice paid with a short payment, one private expense settled, one expense `document_missing` → the zip contains exactly the expected files (names listed) and `notes.md` lists exactly the expected flags; (b) determinism: build twice → identical file list and summary rows; (c) role: accountant can download, editor cannot; (d) savings CSV only in December.

## 7. Fixtures
None (the fixture month is built from the modules' factories in the test).

## 8. v3 mapping
New feature; nothing from v1 survives. Depends on: banking (imports, transfer pairs), journal (categories, rates), invoices (issue, PDFs), supplier-invoices, expenses + settlements (reimbursement statements), linking (read models, allocations), documents (blob, business keys), kernel/pdf (statements), kernel/jobs (`package.build`), an xlsx writer (exceljs or the xlsx skill's approach — no templating engine). Build order: last of phase 1, after linking exports.

## 9. Open questions for the owner
1. Does the accountant want the summary as `.xlsx` only, or also a PDF print of it? (Spec assumes xlsx only; PDF is one more print route if wanted.)
2. Invoices issued in June but paid in July: appear in June (issued) and again in July (paid) — is the double appearance fine for the accountant, or only the issue month?
3. Should the package include the OCR-extracted line items of receipts (as a sheet) — useful for VAT per receipt — or is the receipt PDF enough?
