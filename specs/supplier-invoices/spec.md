# Feature Specification: Supplier invoices — payables with a due date, paid by a link

**Feature Branch**: `feat/supplier-invoices` (model, keys, bases, derived status, payments, VAT read model, linkable, queries, actions, pages, e2e, screenshots — one PR)

**Created**: 2026-10-20

**Status**: Ready for planning (D8, D28, D-g; harvest `specs/supplier-invoices/harvest.md`)

**Input**: "An invoice a supplier sends to AnalyticsFab — the accountant's monthly fee (`Factura 9160`), a SaaS invoice, the Swiss fiduciary: a reviewed document, the partner, the supplier's number, the dates and a due date, the amount with VAT, and the bank row that paid it. It is unpaid until a bank transaction is linked; overdue when the due date passed; its VAT feeds the declarations; its PDF goes to the month's package under `supplier-invoices/`. Key `SI213-Acc-01` in the group, file `SI213-Acc-01_2026-07-24_Skattepunkten_Office_Services_AB.pdf`."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record a payable (Priority: P1)

The accountant's July invoice arrives as a PDF: the owner picks it from the inbox (or starts blank), the supplier *Skattepunkten* (partner of type vendor), number `9160`, invoice date 2026-07-24, due date pre-filled from the partner's terms (30 days when unset), CHF 1 200.00 net + 97.20 VAT = 1 297.20, category *Accounting (Acc)*, the group *2026-07 — July* (or a new one inline), the CH registration (input VAT reclaimed, D28). The app assigns `SI7-Acc-01`, renames the document `SI7-Acc-01_2026-07-24_Skattepunkten.pdf`, computes the SEK base at the ECB rate of the invoice date and shows *unpaid · due 2026-08-23*.

**Acceptance Scenarios**:

1. **Given** group 7 **When** two `Acc` invoices and one `Ut` invoice are recorded **Then** their keys are `SI7-Acc-01`, `SI7-Acc-02`, `SI7-Ut-01` (the per-group × alias counter shared with expenses: an `Ex7-Acc-01` already there makes the first `SI7-Acc-02`); the alias is a snapshot.
2. **Given** net 1 200.00 and VAT 97.20 **Then** total 1 297.20 is accepted (± 0.01), 1 297.30 refused (*Total must equal net + VAT*); `vat ≥ 0`, `total > 0`.
3. **Given** a CHF invoice dated on a Saturday **Then** the base uses Friday's ECB rate (`ecb_nearest`, `rate_date` recorded), written once; SEK → rate 1; no rate → refused.
4. **Given** the partner's terms 20 days **When** no due date is given **Then** `due_date = invoice_date + 20` and the invoice is flagged `due_date_defaulted`; a due date before the invoice date is refused.
5. **Given** invoice `9160` of Skattepunkten exists **When** `9160` is recorded again for Skattepunkten **Then** refused naming the existing key; the same number for another supplier is fine.
6. **Given** a document **When** the invoice is created from it **Then** the document's key becomes `SI7-Acc-01_2026-07-24_Skattepunkten` (file name keeps the extension), the invoice links `created_from`, one origin per document.
7. **Given** a VAT split **When** lines are given **Then** Σ line net = net and Σ line VAT = VAT (± 0.01) else refused; each line has its own category; no lines by default.
8. **Given** an invoice **When** the money facts (amounts, currency, dates, partner) change **Then** allowed only while unpaid and unlinked (the base is recomputed); note, category (alias kept), VAT registration, `document_missing` change freely.

---

### User Story 2 - Paid by a link (Priority: P1)

The −1 297.20 CHF row on the CHF account pays it: *Link payment* on the invoice page (or from the banking workbench) creates the `justifies` link with the allocation; the invoice derives `paid`. Instalments and batch payments are plain allocations in the invoice currency. A CHF invoice paid by the SEK card (the Nordea row is SEK) is attached like a company-paid expense (D-g = D26): the row's amount becomes what the company paid, the row's SEK base the invoice's base (`rate_source = bank`), one link allocating the paid amount in the paid currency — paid.

**Acceptance Scenarios**:

1. **Given** the CHF invoice and a −1 297.20 CHF row **When** `recordPayment(invoiceId, txId)` **Then** a `justifies` link allocates 1 297.20 CHF, status `paid`, `paid_amount 1297.20`, `open 0.00`.
2. **Given** a −600.00 CHF row then a −697.20 CHF row **When** both are recorded **Then** after the first `partially_paid` (open 697.20), after the second `paid`; a third refused (*nothing open*).
3. **Given** a −1 297.15 CHF row **When** recorded as the full payment **Then** `paid` (open 0.05 within the tolerance) and the link carries the rounding note.
4. **Given** a −14 000.00 SEK row for the CHF invoice **When** attached (`attachPayment`) **Then** `paid_amount 14000.00 SEK`, `amount_base 14000.00`, `rate_source = bank`, one link of 14 000.00 SEK, status `paid`; a second attach refused; `detachPayment` restores the ECB base and `unpaid`.
5. **Given** a paid invoice **When** its link is removed (banking side or `removePayment`) **Then** `unpaid` again (or `partially_paid`).
6. **Given** an unpaid invoice with `due_date < today` **Then** `overdue` with `days_overdue`; paid invoices are never overdue.
7. **Given** an unpaid, unlinked invoice **When** cancelled with a reason **Then** `cancelled` (typed flag, the only one), excluded from the open totals; cancel refused once a payment exists; uncancel allowed.
8. **Given** an invoice with a link or a document **When** deleted **Then** refused (cancel instead) — except an invoice whose only link is its `created_from`: deleted, its document back in the inbox (D36, 2026-10-22); an unlinked, documentless one is deleted (audited), the key never reused.

---

### User Story 3 - The list, the page, the partner's defaults (Priority: P2)

`/supplier-invoices` on the DataTable with a KPI strip (*Open*, *Overdue*, *Due in 14 days*, *Paid this month* — SEK); a row opens the side panel (facts, payments with *Link payment* from the outgoing rows of the invoice currency first, cancel, document). *New supplier invoice* pre-fills from the partner (currency, terms, default category, VAT registration) and, with *Copy last*, from the partner's latest invoice (amounts, category, registration — a new number and dates). The group page lists supplier invoices with the expenses.

**Acceptance Scenarios**:

1. **Given** three invoices (paid, unpaid due next week, unpaid overdue) **Then** the KPIs read the open total (two), the overdue total (one), due-in-14-days (one), paid this month (one).
2. **Given** the accountant **Then** reads everything, writes nothing.

---

### User Story 4 - VAT for the declarations (Priority: P2)

`inputVatForPeriod(tx, {registrationId, from, to})` sums the **stored** `vat_amount` (and base) of non-cancelled invoices under that registration by invoice date — the Swiss form ref. 400 and the Swedish moms prep read it (exports feature); nothing is recomputed from rates.

## Requirements *(mandatory)*

- **FR-001** `supplier_invoices`: `group_id` (FK → expense_groups), `key` (`SI{group}-{alias}-{seq}`, series `exg-{group}-{alias}`), `seq`, `alias`, `partner_id` (validated UUID, type vendor), `invoice_number` (unique per tenant + partner, case-insensitive trimmed), `invoice_date`, `due_date`, `due_date_defaulted`, `currency`, `amount_net`, `vat_amount`, `amount_total` (= net + VAT ± 0.01, > 0), `amount_base`, `rate`, `rate_source ∈ same_currency|ecb_daily|ecb_nearest|bank|manual`, `rate_date?`, `paid_amount? / paid_currency?` (cross-currency attach), `bas_code`, `vat_registration_id?`, `document_missing`, `note?`, `cancelled`, `cancelled_reason?`, `cancelled_at?`. `supplier_invoice_lines`: `line_no`, `description`, `amount_net`, `vat_rate` (percent, 2 dp), `vat_amount`, `bas_code`; unique (invoice, line_no). Trigger `supplier_invoices_lock_when_paid`: money columns, key, seq, alias immutable once a `justifies` link exists (service rule; the key always); `block_delete_when_linked('supplier_invoice')`. RLS.
- **FR-002** `partners.payment_terms_days?` (default 30 when unset) — the due-date default; editable on the partner form (owner).
- **FR-003** Derived status (`status.ts`): `cancelled` when flagged; else `paid_amount ?? amount_total` vs Σ `justifies` allocations in the linkable's currency with the kernel tolerance → `paid`; `0 < Σ < total` → `partially_paid`; else `unpaid`; `overdue` = unpaid / partially paid with `due_date < today` (`days_overdue`).
- **FR-004** Services: `createSupplierInvoice` (from a document or blank), `updateSupplierInvoice`, `deleteSupplierInvoice`, `cancelSupplierInvoice` / `uncancel`, `recordPayment(invoiceId, txId, amount?)` (same currency; allocation ≤ open; default = min(|row|, open)), `removePayment(linkId)`, `attachPayment` / `detachPayment` (cross-currency, D26), `copyLastPrefill(partnerId)`.
- **FR-005** Reads: `SUPPLIER_INVOICE_COLUMNS` (two-step list), `getSupplierInvoiceDetail` (links with labels, lines, document), `kpis(today)`, `payableTransactions(currency?)` (outgoing rows with remaining allocation), `inputVatForPeriod`, `listForGroup`.
- **FR-006** Linkable `supplier_invoice` (amount = `paid_amount ?? amount_total`, currency likewise; label `SI7-Acc-01 · Skattepunkten · 9160 · 1 297.20 CHF`).
- **FR-007** Pages: `/supplier-invoices` (list, KPIs, side panel, new dialog with document picker and *Copy last*), the group page section; nav *Supplier invoices* (owner + accountant); strings `supplierInvoices.*` en + fr; the partner form gains *Payment terms (days)*.

## Success Criteria *(mandatory)*

- **SC-001** US1-1…8 and US2-1…8 hold in the DB tests on real Nordea rows; the status table incl. the tolerance boundary.
- **SC-002** A property: Σ allocations in the invoice currency never exceed the total + tolerance; removing links reopens exactly.
- **SC-003** The e2e records an invoice, links its payment, sees *paid*, cancels another, and the accountant reads only.

## Assumptions

- Suggestions (which row pays which invoice, due-date anchored) belong to the linking UI feature; this ships the invoice page's picker (outgoing rows of the invoice currency first).
- The dashboard's *supplier invoices due* item reads `kpis` / the list filtered on `overdue` (dashboard feature).
- Swiss acquisition tax (D23) stays off; no flag yet.
