# Invoices — quotes, invoices, credit notes

Module `src/modules/invoices` · schema `prisma/schema/invoices.prisma` · migration `20261020230000_add_invoices` · spec `specs/invoices/` · decisions D7, D21, D22, D23, D25. **Part 1** (this page): model, totals, service, derived read model, list queries, linkable. **Part 2** (next PR): the sheet (edit / print), the print route, the PDF job, the pages.

> One table for the three documents the owner sends a client. Typed states are facts someone set by hand (`draft → issued → sent`; a quote's `accepted` / `declined`). Paid, partially paid, overdue, credited, expired and converted are **derived** at read time — from the links' allocations, the issued credit notes, the dates. Issued documents are immutable; corrections are credit notes.

## Model

```
invoices        type ∈ quote | invoice | credit_note · status ∈ draft | issued | sent | accepted | declined
                number (null while draft; unique per tenant when set) · partner_id · contract_id? · vat_registration_id?
                related_invoice_id?  (credit note → original; invoice → source quote; intra-module FK RESTRICT)
                issue_date · due_date? (quotes: valid until) · period_label/start/end · currency · language
                printed_references [{label, value}] · printed_parties {tenant, partner, vatNumber, bank} (snapshot at issue)
                notes · internal_note · payment_terms_text · discount_percent?
                subtotal · discount_amount · net_amount · vat_amount · total_amount · vat_by_rate [{rate, base, vat}]
                base_currency (SEK) · rate_to_base · rate_source · rate_date · subtotal_base · vat_base · total_base   (written once at issue)
                declaration_period ('CH 2026/Q1', CH registrations, overridable) · pdf_document_id (set once by the render job)
                issued_at · sent_at · decided_at · template columns
invoice_lines   line_no · description · quantity (10,4) · unit (rate_unit) · unit_price · discount_percent? · discount_amount
                net_amount · vat_rate · vat_amount · period_start/end? · rate_source_id? (the contract_rate used, provenance)
```

CHECKs: `due_date ≥ issue_date`, percents 0–100, a credit note has an original, a non-draft has a number, amounts ≥ 0. Partial unique index on `(tenant_id, number)`. RLS on both tables.

**Immutability in the database.** `invoices_lock_when_issued` (BEFORE UPDATE/DELETE) refuses any change to a non-draft except `status`, `sent_at`, `decided_at`, `declaration_period`, `pdf_document_id` (set once); refuses going back to draft and deleting. `invoice_lines_lock_when_issued` refuses every line change under a non-draft. `invoices_block_delete_when_linked` keeps a justified invoice. SQLSTATE P0001 `invoice_locked`.

Cross-module references (`partner_id`, `contract_id`, `vat_registration_id`, `pdf_document_id`, `rate_source_id`) are validated UUIDs through the owning module's `index.ts`, never FKs (constitution §2).

## Arithmetic — `totals.ts` (pure, Decimal, client-safe)

Per line `gross = quantity × unit price`; discount = percent of gross **or** a fixed amount (never more than gross — fixture K is refused); `net = gross − discount`; line VAT informational. Per document `subtotal = Σ net`; header discount = percent only (fixture L: never silently ignored); `net = subtotal − discount`; **VAT once per rate on the summed base** scaled by the header discount (`vat_by_rate`, rows with 0 VAT dropped, ascending); `total = net + Σ vat`. Half-up to 2 decimals when stored. Fixture cases A–J of `specs/invoices/fixtures/invoice-totals-cases.json` + a 200-run property hold (`totals.pure.test.ts`).

## Lifecycle — `invoices.ts`

| Step | What happens | Audit |
|---|---|---|
| `createDraft(type, partner, contract?)` | defaults chain: currency (contract → partner → SEK), language (partner), VAT registration (contract), due date (`NET_n` → +n days; quotes +30), printed references (partner identifiers + contract references), one pre-filled line (`rateFor(contract, period_start ?? issue_date)` with `rate_source_id`, VAT from `vatTreatmentFor`) | create |
| `updateDraft` | header and/or lines wholesale; totals recomputed and stored | update |
| `issue(now)` | ≥ 1 line, descriptions, due ≥ issue, partner short code, credit limit (Σ credit notes ≤ original); ECB rate of the issue date (`rates.rateToBase`, `same_currency` for SEK, **refused when none**); base amounts (`total_base = subtotal_base + vat_base`); `declaration_period` for CH registrations (invoice + credit note); `printed_parties` snapshot; then — last — the number (`nextInSeries`, row-locked, same transaction); lock | update (`event: issue`) |
| `markSent` · `decideQuote` · `setDeclarationPeriod` | the hand-set facts | update |
| `createCreditNote(original, lines?)` | draft credit note from an issued invoice, full or by quantity (percent discount follows, fixed discount scaled); issued like an invoice (`VA26-CN-001`) | create |
| `convertQuote` · `copyToDraft` | a new draft from a quote (remembers its source) / from anything | create |
| `deleteDraft` | drafts only | delete |

VAT treatment (`vatTreatmentFor`, D23): CH registration → Swiss client at the standard rate, foreign client 0 % (*export*); SE registration → Swedish client standard, EU business with a VAT number 0 % (*reverse charge*), elsewhere 0 % (*export*). The treatment decides the default line rate and, in part 2, the printed sentence.

## Derived read model — `derive.ts`, `queries.ts`

`deriveState({type, status, total, dueDate, allocated, credited, convertedTo}, today)`:
quote → converted | accepted | declined | expired (valid until < today) | issued/sent; invoice / credit note → draft | credited (Σ issued credit notes ≥ total) | paid (`isSettled(total − credited, allocations)`, tolerance `max(0.05, 0.5 %)` from `kernel/money/settlement`, D25) | partially_paid | overdue (due < today) | sent | issued. `remaining = total − credited − allocated`.

The list runs in two steps: Prisma filters the stored columns, then the derived ones (`state`, `partnerName`, `remaining`, `credited`) are computed over that set — three grouped queries (`links` allocations, issued credit notes, converted quotes) + partner names — and the derived filters, the free-text search, the sort and the page are applied in memory (cap 20 000 rows; a solo company has hundreds). `INVOICE_COLUMNS` is the DataTable contract: `distinctInvoiceValues` / `invoiceDateHierarchy` keep Excel semantics (every other filter applied).

## Surface

- `index.ts`: services + schemas, `getInvoice`, `listInvoices`, `distinctInvoiceValues`, `invoiceDateHierarchy`, `nextNumberHint`, `relatedDocuments`, `invoiceLinkable`, `rateUsageFromInvoiceLines`, totals, derive helpers, DTOs.
- `ui.ts`: actions + types (components come with part 2; they import `./totals` internally).
- Actions: reads on `authedAction` + `can(read, invoice)` (the accountant reads), writes on `ownerAction`.
- Wiring (composition root `src/instrumentation.ts`): `contracts.setRateUsage(invoices.rateUsageFromInvoiceLines)` — a contract rate used by a line cannot be deleted (D24). `modules/linking/linkables.ts` registers `invoiceLinkable` (issued invoices and credit notes carry their total; quotes are never paid).

## Part 2 plugs in here

- `issueInvoiceAction` → `ctx.onCommit(enqueue(renderPdfJob, {invoiceId}, {singletonKey}))`; the job renders `/print/invoice/[id]` through `kernel/pdf`, stores the PDF via the documents module (`InvoiceAF_{number}.pdf`) and sets `pdf_document_id` (the one column the lock still lets through, once).
- `printed_parties.tenant.email/website/logoUrl` and `bank.iban/bic/bankName/accountHolder` are null until the identity fields exist (`tenants.email/website`, `bank_accounts.iban/bic/bank_name/account_holder`).
- The sheet renders `vat_by_rate`, the treatment sentence, `printed_references`, `printed_parties`; strings `invoice.*` from the dictionary.

## Tests

`totals.pure.test.ts` (15) · `derive.pure.test.ts` (5) · `invoices.test.ts` (13, DB): US1 scenarios incl. lock by direct SQL and 15 concurrent issues / rollback; US3 credit notes; US4 quotes; US5 derived states from links, list contract, RLS · `rates/ecb-rates.test.ts` `rateToBase` · `linking/allocation.pure.test.ts` tolerance.

Related: [[contracts]] (`rateFor`), [[numbering]], [[linking]], [[pdf]], the `invoice-pdf` and `bas-accounting` skills, [[feature-inventory]] §3.5.
