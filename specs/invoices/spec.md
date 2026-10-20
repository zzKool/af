# Feature Specification: Quotes, invoices and credit notes

**Feature Branch**: `feat/invoices-core` (part 1: model, service, numbering, totals) · `feat/invoices-sheet` (part 2: the sheet, print route, PDF, pages)

**Created**: 2026-10-20

**Status**: Ready for planning (B1–B4 answered → D21, D22, D23; harvest `specs/invoices/harvest.md`)

**Input**: "Once a month the owner bills his client for the days worked: one invoice per client and month, days × the contract rate of the period, in the client's currency, with the client's references printed, Swiss VAT when the Swiss registration applies, a PDF for the client and the accountant (`InvoiceAF_VA26-001.pdf`), a number the client's AP can read (`VA26-001`). Quotes before a contract; credit notes instead of edits; 'paid' from the bank, never typed; the quarter each invoice is declared in."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Draft and issue a monthly invoice (Priority: P1)

The owner opens *Invoices → New*, picks the client and the contract; currency, payment terms, VAT registration, language and the printed references fill themselves. He types the period (`2026 January`) and the days (20): the line reads *Consulting Services · 20 days × 1 200.00 = 24 000.00*, VAT 8.1 % 1 944.00, total 25 944.00 CHF, because the contract's rate valid on 2026-01-01 is 1 200. The draft shows *will be VA26-004*. He clicks **Issue**: the number is assigned, the SEK base amounts are written with the ECB rate of the issue date, the declaration period `CH 2026/Q1` is set, the invoice is locked, and the PDF appears for download a second later.

**Why this priority**: it is the company's revenue document; everything else (quotes, credit notes, payment matching) hangs off it.

**Independent Test**: create a draft from a contract with a rate history, issue it, read it back: number, locked fields, base amounts, declaration period, stored PDF.

**Acceptance Scenarios**:

1. **Given** client VA with a CHF contract (CH registration, 30 days, rate 1 200 from 2026-01-01) **When** the owner creates a draft for period 2026 January **Then** the draft carries currency CHF, language `fr` (partner default), due date = issue date + 30 days, VAT registration CH, references from partner + contract, and one line pre-filled with the contract's description, unit `day`, unit price 1 200.00, VAT 8.1 %.
2. **Given** that draft with 20 days **When** totals are computed **Then** subtotal 24 000.00, VAT (8.1 %) 1 944.00, total 25 944.00; every amount has 2 decimals.
3. **Given** the draft **When** issued on 2026-01-31 **Then** number `VA26-001` (first of the series), `issued_at` set, status `issued`, SEK base = amounts × the ECB CHF/SEK rate of 2026-01-31 with `rate_source` recorded, `declaration_period = CH 2026/Q1`; a second invoice issued the same day gets `VA26-002`; 15 concurrent issues get 15 consecutive numbers.
4. **Given** an issued invoice **When** any field or line is edited, or the invoice deleted **Then** refused — corrections are credit notes.
5. **Given** an issued invoice **When** the owner clicks *Mark as sent* **Then** `sent_at` is stamped; nothing else changes.
6. **Given** a draft whose contract has no rate for the period **When** the line is pre-filled **Then** the unit price is empty with *No contract rate for this period — enter manually*; issuing is still allowed once a price is typed.
7. **Given** a draft with no line, a line without description, a negative quantity, or a due date before the issue date **When** saved or issued **Then** refused with the matching message.

---

### User Story 2 - The printed document (Priority: P1)

The invoice page *is* the invoice: in edit mode the inputs sit where the values print; after issue the same layout is read-only, and the PDF the client receives is that page printed. French for the Swiss client, English otherwise; `CHF 25'944.00` everywhere; the registration's VAT number, the reverse-charge or export sentence when applicable, the bank account of the invoice's currency.

**Why this priority**: the document is what the client and the accountant see; one layout means no second template to drift.

**Independent Test**: render the print route for the fixture invoice in `fr` and `en` and check the expected strings; render the PDF through `kernel/pdf` and count pages.

**Acceptance Scenarios**:

1. **Given** the fixture invoice (`fixtures/sample-invoice.json`) **When** printed in `fr` **Then** the page shows `Facture VA26-001`, `20 Jours`, `CHF 1'200`, `CHF 24'000.00`, `TVA (8.1%)`, `CHF 25'944.00`, the CHE VAT number, the CHF IBAN, *Veuillez indiquer le numéro de facture VA26-001*, and no VAT column (every line at the registration rate).
2. **Given** an invoice under the SE registration to an EU business with a VAT number at 0 % **When** printed **Then** the reverse-charge sentence (Art. 196) and the client's VAT number appear; **Given** a CH-registration invoice to a non-Swiss client **Then** the export line appears.
3. **Given** a 40-line invoice **When** rendered to PDF **Then** 2 pages, the table header repeated, the footer `{company} • {email} • {website}` on both.
4. **Given** a credit note **When** printed **Then** title `Note de crédit` / `Credit Note`, every amount prefixed `−`, the original number referenced.
5. **Given** a quote **When** printed **Then** title `Devis` / `Quote` and *Valid until* instead of *Due date*.
6. **Given** an issued invoice **When** the owner downloads the PDF twice **Then** the same stored document (`InvoiceAF_VA26-001.pdf`) is served; nothing re-renders.

---

### User Story 3 - Credit note (Priority: P2)

A wrong issued invoice is corrected by a credit note: *Create credit note* opens a draft with the original's lines (`Credit: …`), full by default or partial by quantity, that is issued like an invoice (`VA26-CN-001`, own PDF). The original shows *credited 25 944.00* and its derived state becomes *credited*; Σ credited never exceeds the original.

**Acceptance Scenarios**:

1. **Given** issued `VA26-001` **When** a full credit note is created and issued **Then** it is `VA26-CN-001`, totals equal the original's, the original reads `credited` with 25 944.00 credited.
2. **Given** the same original **When** a second credit note of 10 days is attempted **Then** refused (Σ credited would exceed the original).
3. **Given** a draft invoice **When** a credit note is requested **Then** refused (only issued invoices).

---

### User Story 4 - Quote → invoice (Priority: P2)

Before a contract, the owner sends a quote: same sheet, type `quote`, number `VA26-QT-001`, *valid until* 30 days by default, title *Devis*. The client accepts (hand-set) or declines; *expired* is derived. *Convert* copies the lines into a new invoice draft that remembers its source quote.

**Acceptance Scenarios**:

1. **Given** a quote draft **When** issued **Then** `VA26-QT-001`, PDF `InvoiceAF_VA26-QT-001.pdf`; no declaration period, no due date.
2. **Given** an issued quote **When** marked accepted and converted **Then** a new invoice draft with the same lines, currency, references and `source_quote_id`; the quote shows *converted → VA26-003* once that draft is issued.
3. **Given** an issued quote with `valid_until` in the past and no decision **When** listed **Then** state `expired` (derived).

---

### User Story 5 - What is open, paid, overdue (Priority: P2)

The list shows every invoice with its derived state — *Draft, Issued, Sent, Partially paid, Paid, Overdue, Credited* — the remaining amount, and the Excel-style filters (client, state, period, declaration period, currency, amounts, dates). Paid comes from the bank links (allocations), never typed; overdue = due date passed and not paid.

**Acceptance Scenarios**:

1. **Given** an issued CHF invoice of 25 944.00 with a bank transaction link allocating 25 944.00 **When** listed **Then** `paid`, remaining 0.00; with 20 000.00 allocated → `partially paid`, remaining 5 944.00; with 25 934.00 (short by 10.00 ≤ 0.5 %) → `paid` by tolerance (D25).
2. **Given** an issued invoice due 2026-03-02, unpaid, today 2026-03-10 **When** listed **Then** `overdue`.
3. **Given** the list **When** filtered by *Declaration period = CH 2026/Q1* **Then** only CH-registration invoices issued in Q1 2026 (or overridden into it).

---

### Edge Cases

- Issue date before the period: allowed (advance invoice); the rate is still the one of `period_start`.
- A rate change inside the period: the sheet proposes two lines (one per rate) with the day count to adjust; the owner may merge them by hand.
- Issuing a non-SEK invoice when no ECB rate exists for the issue date (or the nearest weekday): refused with *No exchange rate for 2026-01-31 — run the ECB sync*; never a silent null base.
- The partner has no short code: issuing is refused with *Client needs a short code (invoice series)* and a link to the partner.
- Declaration period override: the owner may move a CH invoice to another quarter on the issued invoice (the one mutable business field, audited).
- Deleting a draft that was converted from a quote: allowed; the quote's *converted* state disappears (derived).
- An invoice whose contract is later deactivated: unchanged (every printed fact was snapshotted at issue).
- A SEK invoice: base = amounts, rate 1, `rate_source = same_currency`.
- Language without a dictionary (sv until it exists): printed in English, flagged in the sheet.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** One table for quotes, invoices and credit notes (`type`), with lines; typed states only for hand-set facts: `draft`, `issued`, `sent` (invoices), `accepted`, `declined` (quotes). `paid`, `partially paid`, `overdue`, `credited`, `expired`, `converted` are derived at read time.
- **FR-002** Drafts have no number. At issue, inside one transaction: number from `number_series` (`{short}{yy}` / `-QT` / `-CN`, D21), `issued_at`, lock, SEK base amounts with the ECB rate of the issue date (`rate_source` recorded; SEK → 1), `declaration_period` for CH-registration invoices and credit notes (`CH {yyyy}/Q{n}` of the issue date), snapshot of every printed fact (partner name/address, references, tenant identity, VAT number, bank details).
- **FR-003** Totals, in Decimal: per line `net = quantity × unit_price − line discount`; per invoice `subtotal = Σ net`, optional header discount %, `net = subtotal − discount`, VAT computed **once per rate on the summed base** (`vat_by_rate`), `total = net + Σ vat`. Every stored amount has 2 decimals; negative lines refused; fixture cases A–J of `fixtures/invoice-totals-cases.json` hold (K, L refused).
- **FR-004** Line pre-fill from the contract: description, unit `day`, unit price = `rateFor(contract, period_start ?? issue_date)` with the rate's id kept on the line as provenance; the contract's rate history is never re-read after that.
- **FR-005** VAT per line is chosen from the registration's rates + 0 %; the registration (from the contract, overridable on the draft) decides the printed VAT number, the reverse-charge sentence (SE registration, EU business client with VAT number, 0 %), the export line (CH registration, non-Swiss client) and whether a declaration period exists.
- **FR-006** Issued documents are immutable except: `sent_at` (mark as sent), quote decision, `declaration_period` override, `pdf_document_id` (set once by the renderer). Enforced in the database (trigger) and the service. Drafts can be edited and deleted.
- **FR-007** Credit notes are drafts created from an issued invoice (full, or partial by quantity per line), issued with their own series and PDF; `Σ credited ≤ original total` across all its credit notes.
- **FR-008** Quotes: `valid_until` (default issue date + 30 days) instead of `due_date`; accept / decline by hand; `expired` derived; *convert* creates an invoice draft with `source_quote_id`.
- **FR-009** The sheet is one component with `edit` and `print` modes; `/print/invoice/[id]` renders print mode for the PDF; the PDF is generated once at issue by a job, stored as a document `InvoiceAF_{number}.pdf` and referenced by the invoice; downloads serve the stored document.
- **FR-010** Money prints `CHF 25'944.00` in every language; unit prices without decimals when whole; quantities up to 1 decimal with singular/plural unit labels; dates `dd MMMM yyyy` in the document language; VAT % integer or one decimal. Strings from the kernel dictionary (`invoice.*`, en + fr, seeded from `fixtures/invoice-strings.*.json`).
- **FR-011** Derived states from the linking module: `paid` when Σ allocations ≥ total − tolerance (`max(0.05, 0.5 %)`, D25), `partially paid` when 0 < Σ, `overdue` when `due_date < today` and not paid, `credited` when credit notes exist (amount shown).
- **FR-012** List page on the kernel DataTable: number, type, client, contract, issue date, due date, period, currency, total, remaining, state, declaration period, language; distinct values and date hierarchy server-side; search on number, client, period, notes.
- **FR-013** The invoice is `linkable` (amount + currency) so bank transactions can justify it; a stored PDF document is referenced by `pdf_document_id` (validated UUID).
- **FR-014** Every write is audited; the owner writes, the accountant reads.
- **FR-015** Printing needs tenant identity that does not exist yet: `email`, `website` on the tenant profile; `iban`, `bic`, `bank_name`, `account_holder` on bank accounts (settings/banking forms gain the fields).

### Key Entities

- **Invoice** (`type` quote | invoice | credit_note): partner, contract, VAT registration, dates (issue, due / valid until), period label and optional dates, currency, language, printed references, lines, discount, totals, `vat_by_rate`, base-currency figures, declaration period, numbers and stamps, `related_invoice_id` (credit note → original; invoice → source quote), `pdf_document_id`, printed snapshot (`printed_parties` JSON: tenant and partner identity, VAT number, bank details as printed).
- **Invoice line**: order, description, quantity, unit (`rate_unit`), unit price, line discount %, net, VAT rate, VAT amount, period dates, `rate_source_id`.
- **Derived read model**: state, remaining, credited, converted — computed in queries from links and related documents.

## Success Criteria *(mandatory)*

- **SC-001** The owner produces January's invoice in under two minutes: client, contract, period, days, issue.
- **SC-002** Numbers are gap-free per series under concurrency (15 parallel issues → 15 consecutive numbers; a rolled-back issue hands its number back).
- **SC-003** Every totals fixture case passes and a 200-run property test holds `subtotal = Σ net`, `total = net + Σ vat_by_rate`, 2-decimal amounts, breakdown sorted.
- **SC-004** The French print of the fixture invoice contains every expected string of `fixtures/sample-invoice.json#expectedPrintFr`; the PDF of a 40-line invoice has 2 pages with the repeated header and footer.
- **SC-005** No issued document can be changed by any route — a direct SQL update of an amount is refused by the database.
- **SC-006** Paid / partially paid / overdue never come from a typed column; the payment-tolerance fixture cases hold against link allocations.

## Assumptions

- One VAT registration per invoice (the contract's), rates from its current list; the dated schedule (7.7 % before 2024) is not needed — no historic invoice is imported (the accountant has them).
- `sv` is printed in English until its dictionary lands (constitution: a data file, no code change).
- The Swiss VAT return page and the `swiss_vat_declaration` record (D23) belong to the exports module; invoices only carry `declaration_period`.
- Acquisition tax, input VAT: not on client invoices.
- The bank account printed is the tenant's account in the invoice currency (CHF → CHF account, SEK/EUR → the SEK account unless an EUR account exists).
- Logo: `tenants.logo_url` (exists) inlined at render; absent → text header.
- No e-mail sending; *Mark as sent* is a stamp.
