# Invoices — quotes, invoices, credit notes

Module `src/modules/invoices` · schema `prisma/schema/invoices.prisma` · migrations `20261020230000_add_invoices`, `20261021000000_add_print_identity` · spec `specs/invoices/` · decisions D7, D21, D22, D23, D25. Part 1: model, totals, service, derived read model, list queries, linkable. Part 2: the sheet (edit / print), the print route, the PDF job, the pages.

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

## Lifecycle — the services (`invoices.ts` is the barrel)

Where things live (F50-h, 2026-10-23 — a move, no behaviour change). `invoices.ts` re-exports by name exactly what it always exported, so `index.ts`, the actions and the tests import `./invoices` as before; what the parts share stays inside the module.

```
drafts.ts ──► issue.ts ──► hand-set-facts.ts            copies.ts
create · update · delete   validate · rate · snapshot     markSent · decideQuote       convertQuote · copyToDraft
(defaults chain)           · number · lock (+ credit      · setDeclarationPeriod       · createCreditNote
                           limit, series)                                              (copyInternal)
        └──────────────────────┴───────── shared ──────────────┴───────────────────────────┘
schemas.ts  the Zod boundary        dto.ts       row → DTO, `load` (with lines)
defaults.ts dueDateFor, the VAT registration, line rows + stored totals, lines back as input
errors.ts   violation · invalid · notFound · parseError
```

| Step | What happens | Audit |
|---|---|---|
| `createDraft(type, partner, contract?)` | defaults chain: currency (contract → partner → SEK), language (partner), VAT registration (contract), due date (`NET_n` → +n days; quotes +30), printed references (partner identifiers + contract references), one pre-filled line (`rateFor(contract, period_start ?? issue_date)` with `rate_source_id`, VAT from `vatTreatmentFor`) | create |
| `updateDraft` | header and/or lines wholesale; totals recomputed and stored | update |
| `issue(now)` | ≥ 1 line, descriptions, due ≥ issue, partner short code, credit limit (Σ credit notes ≤ original); ECB rate of the issue date (`rates.rateToBase`, `same_currency` for SEK, **refused when none**); base amounts via `baseTotals` (`subtotal_base = (subtotal − header discount) × rate`, `vat_base = vat × rate`, each rounded once; `total_base = subtotal_base + vat_base` exactly, F57); `declaration_period` for CH registrations (invoice + credit note); `printed_parties` snapshot; then — last — the number (`nextInSeries`, row-locked, same transaction); lock | update (`event: issue`) |
| `markSent` · `decideQuote` · `setDeclarationPeriod` | the hand-set facts | update |
| `createCreditNote(original, lines?)` | draft credit note from an issued invoice, full or by quantity (percent discount follows, fixed discount scaled); issued like an invoice (`VA26-CN-001`) | create |
| `convertQuote` · `copyToDraft` | a new draft from a quote (remembers its source) / from anything | create |
| `deleteDraft` | drafts only | delete |

VAT treatment (`vatTreatmentFor`, D23): CH registration → Swiss client at the standard rate, foreign client 0 % (*export*); SE registration → Swedish client standard, EU business with a VAT number 0 % (*reverse charge*), elsewhere 0 % (*export*). The treatment decides the default line rate and, in part 2, the printed sentence.

## Derived read model — `derive.ts`, `queries.ts`

`deriveState({type, status, total, dueDate, allocated, credited, convertedTo}, today)`:
quote → converted | accepted | declined | expired (valid until < today) | issued/sent; invoice / credit note → draft | credited (Σ issued credit notes ≥ total) | paid (`isSettled(total − credited, allocations)`, tolerance `max(0.05, 0.5 %)` from `kernel/money/settlement`, D25) | partially_paid | overdue (due < today — **invoices only**: a credit note's due date is its issue date and it is never overdue, F57) | sent | issued. `remaining` = `receivableAmount` = `total − credited − allocated` for an issued **invoice**, `0.00` for drafts, quotes and credit notes — a credit note is owed to the client, never a receivable; it already reduces its original through `credited`. The dashboard's receivables and overdue count read `type = invoice` only.

The list runs in two steps: Prisma filters the stored columns, then the derived ones (`state`, `partnerName`, `remaining`, `credited`) are computed over that set — three grouped queries (the allocations through `linking.allocatedSums` — the module never reads `link` itself, audit 22; issued credit notes via `creditedSum`; converted quotes) + partner names — and the derived filters, the free-text search, the sort and the page are applied in memory (cap 20 000 rows; a solo company has hundreds). `INVOICE_COLUMNS` is the DataTable contract: `distinctInvoiceValues` / `invoiceDateHierarchy` keep Excel semantics (every other filter applied). `invoicesForDeclaration(period)` — the issued invoices and credit notes stored under a declaration period, with lines and client name — and `declarationPeriods()` are what the Swiss VAT return reads ([[exports]], D23: membership by the stored period).

## Surface

- `index.ts`: services + schemas, `getInvoice`, `listInvoices`, `distinctInvoiceValues`, `invoiceDateHierarchy`, `nextNumberHint`, `relatedDocuments`, `invoiceLinkable`, `rateUsageFromInvoiceLines`, totals, derive helpers, DTOs.
- For other modules (lessons audit 27, 2026-10-23): `signedTotal(type, amount)` / `creditSign(type)` — a credit note's amounts count negative (dashboard pulse, package, Swiss VAT return); `DEFAULT_PAYMENT_TERMS_DAYS` (30, when a contract names no terms) and `QUOTE_VALIDITY_DAYS` (30); `creditedSum(tx, ids)` — Σ issued credit notes per original, also behind the read model and the issue-time limit; `ratePricingFromInvoiceLines(tx, rateId)` → `{ lines, lastPeriodStart }`, the richer usage hook for contracts T024 (the day priced = line period start, else the document's, else its issue date; drafts included, like the count).
- `ui.ts`: actions, types and the components (`InvoiceTable`, `InvoiceActions`, `InvoiceDetails`, `InvoiceStateLabel`, `NewDocumentButton`, the sheet, the editor, the new-draft form).
- Actions: reads on `authedAction` + `can(read, invoice)` (the accountant reads), writes on `ownerAction`.
- Wiring (composition root `src/instrumentation.ts`): `contracts.setRateUsage(invoices.rateUsageFromInvoiceLines)` — a contract rate used by a line cannot be deleted (D24). `modules/linking/linkables.ts` registers `invoiceLinkable` (issued invoices and credit notes carry their total; quotes are never paid).

## The sheet — `components/invoice-sheet.tsx` (D7: one layout, two modes)

`<InvoiceSheet mode="print" | "edit" doc={SheetDocument} slots?>` is the document: header (company / title + number), parties, meta (date, due date or *valid until*, period, references), the line table, totals (subtotal, discount when > 0, one VAT row per rate, total), the reverse-charge or export sentence when the treatment says so and VAT is 0, notes, the payment box (terms sentence, *please reference*, the bank account of the invoice currency), a footer repeated on every printed page. No hooks, no `"use client"`, no literal strings (`translator(doc.language)` — the **document's** language, not the user's). Print CSS lives in the component: `@page A4 20mm 15mm 25mm`, `thead` repeated, rows never split, the footer `position: fixed; bottom: 0` (a negative offset would add a blank page).

Formatting (FR-010): `sheetMoney` = `formatCurrency` with the code in front (`CHF 25'944.00`, `SEK 24 000,00`), whole unit prices without decimals (`CHF 1'200`); `sheetQuantity` up to one decimal with the singular/plural unit label (`20 Jours`, `1 Day`); `sheetDate` = `dd MMMM yyyy` in the document language (`31 janvier 2026`).

- **Edit mode** — `components/invoice-editor.tsx` (`"use client"`) owns the draft's state, fills the sheet's slots with inputs where the values sit (dates, period, references, lines with description / qty / unit price / line discount / VAT rate, header discount, notes, payment terms; language and VAT registration pickers under the title), shows live totals from the same `invoiceTotals` the server stores, and autosaves on blur through `updateDraftAction` (header + lines wholesale). The sheet document is built by `components/sheet-document.ts` (`toSheetDocument`).
- **Print mode** — `/print/invoice/[id]` (`src/app/print/invoice/[id]/page.tsx`, server component, `requirePrintCaller`) and the issued document's page. `resolveSheetContext(tx, caller, id)` gathers the invoice with its derived state, the parties (the stored snapshot once issued, otherwise live from partner + tenant profile + the bank account of the currency), the VAT treatment, the related number, the number hint and the registrations.

## The PDF — `jobs/render-pdf.ts`

`issueInvoiceAction` commits, then `ctx.onCommit` enqueues `invoices.render-pdf` (exclusive by invoice id). The job: (1) checks the document is issued and has no PDF yet (idempotent across retries); (2) `renderPathToPdf("/print/invoice/{id}")` through `kernel/pdf` (~1 s); (3) `documents.storeGeneratedDocument` (status `generated`, business key `InvoiceAF_{number}.pdf`, kind financial) and sets `pdf_document_id` — the one column the lock trigger lets through, once. The page polls ~2 min (every 2 s, then 5 s) until the *Download PDF* button appears; when the polls run out it says *PDF is being generated… Try again* and the click polls once more (V12); the download is the stored document's signed URL. Generated documents show read-only on the documents review page and cannot be deleted (they are the proof of an immutable record).

What the PDF needs about the company: `tenants.email / website / phone` (Company profile) and `bank_accounts.iban / bic` (Bank accounts) — migration `20261021000000_add_print_identity`; the `printed_parties` snapshot carries them from issue on.

## Pages

- `/invoices` — `ListPage` + `InvoiceTable` (DataTable on `INVOICE_COLUMNS`): the number as a `<CodeChip>`, the derived state as `<StateLabel>` (`InvoiceStateLabel`), money in `formatMoney` with the row's currency (the base total bare — its header names the currency), **Date** and **Client** filter buttons (`quickFilter`; Client is the derived `partnerName` as an enum, so the popover lists names with counts), ⋮ row actions *Open · Copy to new draft · Delete draft* (drafts, confirm). Title-row primary `NewDocumentButton`: *New invoice ▾ New quote* (a credit note is made from its invoice). Footer Σ only under a true label (`list-sums.ts`): one currency in the filtered set → Σ total and Σ remaining in it; several → Σ total in the base currency only.
- `/invoices/new?type=invoice|quote` — `NewInvoiceForm`: client → contract (loaded on change) → issue date, period label, period start → `createDraftAction` → the sheet. The contract list remembers the client it was loaded for: changing the client clears the contract at once, and the Contract select and *Create draft* wait for the new client's list — the form never sends another client's contract (F76).
- `/invoices/[id]` — `EntityPage`. Title row (D40): the number in mono (a draft: *Invoice · Draft*), the state as `<StateLabel>` (`data-testid="invoice-state"`), tags type · currency, meta client · total in `formatMoney`; `InvoiceActions` = secondaries then **one primary** — a draft: *Delete draft* (confirm) · *Copy to new draft* · **Issue** (confirm); issued: *Download PDF* (or *PDF is being generated…*), *Mark as sent*, quotes *Mark accepted / declined*, and the primary `<SplitButton>` of what is made from it — **Create credit note ▾ Copy** (invoice, not credited), **Convert to invoice ▾ Copy** (quote), else **Copy to new draft**. The sheet (editor while draft, print mode after — `formatCurrency`, unchanged). The side panel `InvoiceDetails` (380 px, `DetailsSection`s): the total 22 / 600 and its state; *Invoice / Quote / Credit note* — client, type, date, due, period, total, paid, credited, remaining (`data-amount` carries the plain figure for the e2e), the base total with its rate (`invoices.base`), the VAT period as a tag linking to the declaration and its *declared* `<StateLabel>` (`exports.declaredOn` with the invoice's own VAT registration, F56); *Bank rows* (`InvoiceLinks`: links with *Unlink*, suggested rows with *Link* — [[linking]]); *Related documents* (code chip, type tag, amount); the internal note. The family map is `state-family.ts` — the only place a state gets a colour (F71).
- Nav: *Invoices* for owner and accountant (reads only).

## Tests

`totals.pure.test.ts` (15 + 3: base totals with a discount, two examples and a property of 300 runs) · `derive.pure.test.ts` (6: + credit note never overdue / never a receivable) · `invoices.test.ts` (14, DB: + a 10 % discounted issue reconciles in SEK, a credit note a year on is not overdue): US1 scenarios incl. lock by direct SQL and 15 concurrent issues / rollback; US3 credit notes; US4 quotes; US5 derived states from links, list contract, RLS · `print.pure.test.tsx` (10): the fixture invoice in French (every `expectedPrintFr` string), English, VAT column rules, credit note, quote, treatment sentences, draft, formatting helpers · `components/new-invoice-form.test.tsx` (F76: client A → contract → client B → submit before B's list arrives — fails on the old form, which sent A's contract) · `components/invoice-actions.test.tsx` (V12: after the 30th poll the *Try again* hint, which polls again) · `state-family.pure.test.ts` (F71: every derived state mapped to a kit family, the D40 table's words, only *overdue* asks for attention, from `deriveState` to the family) · `list-sums.pure.test.ts` (F71: no Σ across currencies) · `print-identity.pure.test.tsx` (F71: the print markup of an issued invoice fr / en, a sv EUR credit note with discount and reverse charge, a quote — file snapshots written from `main` **before** the kit change; a diff is a change to every PDF) · `pdf.test.tsx` (real Chromium): one-line invoice = one page, 60 lines = several · `e2e/invoices.spec.ts`: client → contract rate → draft pre-filled → 20 days autosaved → issue → number, locked sheet, PDF stored by the job → mark as sent → list · `rates/ecb-rates.test.ts` `rateToBase` · `linking/allocation.pure.test.ts` tolerance.

Screenshots: `specs/invoices/screenshots/` (new form, draft sheet, issued sheet, list, PDF page 1).

Related: [[contracts]] (`rateFor`), [[numbering]], [[linking]], [[pdf]], the `invoice-pdf` and `bas-accounting` skills, [[feature-inventory]] §3.5.
