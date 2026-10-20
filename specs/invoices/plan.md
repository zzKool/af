# Implementation Plan: Quotes, invoices and credit notes

**Branches**: `feat/invoices-core` (part 1) → `feat/invoices-sheet` (part 2) | **Date**: 2026-10-20 | **Spec**: `specs/invoices/spec.md`

## Summary

One `invoices` table (+ `invoice_lines`) for quotes, invoices and credit notes; a service that computes totals in Decimal, pre-fills lines from the contract rate history, issues inside one transaction (number, base amounts, declaration period, snapshot, lock) and derives paid / overdue / credited from the linking module. Part 2 adds the one-component sheet (edit + print), the print route and the PDF job, the list and entity pages, and the tenant identity fields the PDF needs.

## Technical Context

**Language/Version**: TypeScript, Next.js 16 / React 19 (unchanged)
**Primary Dependencies**: Prisma 7, Zod 4, next-safe-action, pg-boss (`kernel/jobs`), playwright-core (`kernel/pdf`), fast-check
**Storage**: PostgreSQL 17 — `invoice_type`, `invoice_status` enums; `invoices`, `invoice_lines`; trigger `invoices_lock_when_issued`; `tenants.email/website`; `bank_accounts.iban/bic/bank_name/account_holder` (part 2)
**Testing**: `totals.pure.test.ts` (fixtures + property), `invoices.test.ts` (DB), `queries.test.ts` (ListQuery contract), print snapshot test, `pdf` test through `kernel/pdf`, `e2e/invoices.spec.ts`
**Constraints**: no other open PR on `prisma/schema`, nav constants, i18n dictionaries; part 2 waits for part 1 on `main`

## Constitution Check

- §1 *derived never typed*: `paid / partially paid / overdue / credited / expired / converted` computed in `queries.ts` from links, credit notes and dates; the only typed states are hand-set facts. ✔
- §1 *immutable money facts*: amounts, rate, base and the printed snapshot are written once at issue; the DB trigger refuses later changes; corrections are credit notes. ✔
- §1 *linking is the product*: payments are `justifies` links with allocations (D18); the invoice registers as `linkable` with amount + currency. ✔
- §2 *cross-module references are validated UUIDs*: `partner_id`, `contract_id`, `vat_registration_id`, `pdf_document_id`, `rate_source_id` — validated through the owning module's `index.ts` at write time, no FK. `invoice_lines.invoice_id` is intra-module (FK, cascade). ✔
- §2 *money*: Decimal in the service, strings on the surface, formatting at the display boundary (`formatCurrency`). ✔
- §2 *numbering*: `nextInSeries` in the issuing transaction; `peekSeries` for the hint. ✔
- §3 PDF: `kernel/pdf` renders `/print/invoice/[id]`; the job stores the bytes through the documents module (`storeGeneratedDocument`, new) — Azure SDK stays in `kernel/storage`. ✔
- §3b UI: list = `ListPage` + `DataTable`; the sheet = `EntityPage` with the document as its body (full width, A4-proportioned sheet centred inside a full-width page is a document, not a form — allowed by D19's "entity" archetype). ✔
- i18n: `invoice.*` keys en + fr from the harvest fixtures; the sheet has no literal strings. ✔

## Data model (part 1)

```
invoice_type   ENUM ('quote', 'invoice', 'credit_note')
invoice_status ENUM ('draft', 'issued', 'sent', 'accepted', 'declined')     -- hand-set facts only

invoices
  id, tenant_id, type, status
  number VARCHAR(30)?            unique (tenant_id, number) WHERE number IS NOT NULL; null while draft
  partner_id, contract_id?, vat_registration_id?          (validated UUIDs)
  related_invoice_id?            credit_note → original invoice; invoice → source quote   (intra-module FK, RESTRICT)
  issue_date DATE, due_date DATE?  (quotes: valid_until stored in due_date, printed as "Valid until")
  period_label VARCHAR(100)?, period_start DATE?, period_end DATE?
  currency CHAR(3), language VARCHAR(5)
  printed_references JSONB [{label, value}]      snapshot (partner identifiers + contract references + per-invoice)
  printed_parties JSONB?                          snapshot at issue: {tenant: {...}, partner: {...}, vatNumber, bank: {...}}
  notes TEXT?, internal_note TEXT?, payment_terms_text VARCHAR(1000)?
  discount_percent DECIMAL(5,2)?                  header discount, % only
  subtotal, discount_amount, net_amount, vat_amount, total_amount DECIMAL(15,2)   (computed, stored; 0 while draft without lines)
  vat_by_rate JSONB [{rate, base, vat}]
  base_currency CHAR(3) = 'SEK', rate_to_base DECIMAL(18,6)?, rate_source VARCHAR(20)?, rate_date DATE?,
  subtotal_base, vat_base, total_base DECIMAL(15,2)?             written once at issue
  declaration_period VARCHAR(12)?                 'CH 2026/Q1' — derived at issue for CH registrations, overridable (audited)
  pdf_document_id UUID?                           set once by the render job
  issued_at, sent_at TIMESTAMPTZ?; decided_at TIMESTAMPTZ? (quote accept/decline)
  created_at, updated_at, created_by, source
  CHECK (due_date IS NULL OR due_date >= issue_date), CHECK (discount_percent BETWEEN 0 AND 100)
  CHECK (type = 'credit_note' → related_invoice_id IS NOT NULL)
  trigger invoices_lock_when_issued: BEFORE UPDATE, when OLD.status <> 'draft' refuse any change except
    status, sent_at, decided_at, declaration_period, pdf_document_id, updated_at
  trigger invoice_lines_lock_when_issued: BEFORE INSERT/UPDATE/DELETE on invoice_lines when the invoice is not a draft
  RLS, grants S/I/U/D; delete allowed for drafts only (service) — the links delete-guard trigger reused

invoice_lines
  id, tenant_id, invoice_id (FK cascade), line_no INT, description VARCHAR(5000), quantity DECIMAL(10,4) >= 0,
  unit rate_unit, unit_price DECIMAL(15,2) >= 0, discount_percent DECIMAL(5,2)?, net_amount DECIMAL(15,2),
  vat_rate DECIMAL(5,2), vat_amount DECIMAL(15,2), period_start DATE?, period_end DATE?, rate_source_id UUID?,
  created_at, updated_at
  unique (invoice_id, line_no)
```

## Project Structure

```
specs/invoices/            harvest.md · spec.md · plan.md · tasks.md · fixtures/ · screenshots/
prisma/schema/invoices.prisma
prisma/migrations/2026102023xxxx_add_invoices/                      (part 1)
prisma/migrations/2026102100xxxx_add_print_identity/               (part 2: tenants.email/website, bank_accounts.iban/bic/bank_name/account_holder)
src/modules/invoices/
  types.ts               InvoiceDto, InvoiceLineDto, InvoiceState, DerivedInvoice, VatByRate, PrintedReference, PrintedParties
  totals.ts              pure Decimal: lineNet, invoiceTotals(lines, discountPercent) → {subtotal, discount, net, vatByRate, vat, total}
  totals.pure.test.ts    fixtures A–L + fast-check property
  invoices.ts            service: schemas; createDraft (defaults chain, line pre-fill via contracts.rateFor), updateDraft (header + lines wholesale),
                         deleteDraft, issue (numbering, ECB rate via rates.getRate, declaration period, snapshot, lock, enqueue render),
                         markSent, decideQuote, convertQuote, createCreditNote (full/partial), copyToDraft, setDeclarationPeriod
  derive.ts              pure: state(invoice, allocations, credited, today), tolerance = linking's rule (D25)
  queries.ts             COLUMNS, listInvoices (with derived state + remaining in one pass), distinct, dateHierarchy, getInvoice (+derived), nextNumberHint
  invoices.actions.ts
  linkable.ts            invoiceLinkable (amount = total, currency) → registered in modules/linking/linkables.ts
  jobs/render-pdf.ts     (part 2) renderPathToPdf("/print/invoice/"+id) → documents.storeGeneratedDocument → pdf_document_id
  components/            (part 2) invoice-sheet.tsx (edit | print), invoice-table.tsx, invoice-actions.tsx, line-editor.tsx
  invoices.test.ts · queries.test.ts · print.test.ts (part 2)
  index.ts · ui.ts
src/app/(app)/invoices/page.tsx · [id]/page.tsx · new/page.tsx     (part 2)
src/app/print/invoice/[id]/page.tsx                                (part 2)
src/kernel/i18n/dictionaries/{en,fr}.ts                            + invoice.* keys (part 2)
src/modules/documents/documents.ts                                  + storeGeneratedDocument (part 2)
src/modules/linking/linkables.ts · types.ts                         "invoice" already a LinkableType
docs/invoices.md · docs/index.md · src/kernel/nav/constants.ts (Invoices entry, part 2)
```

## Complexity Tracking

| Item | Why | Simpler alternative rejected because |
|---|---|---|
| lock triggers on `invoices` / `invoice_lines` | immutability of money facts enforced in the DB (constitution §1/§2) | service-only lock leaves direct SQL and future code paths able to rewrite an issued amount |
| `printed_parties` snapshot JSON | the PDF must show what was printed even after the partner or tenant profile changes; re-rendering is never needed | re-reading partner/tenant at print time would change an issued document's content |
| `vat_by_rate` stored | VAT once per rate on the summed base is what the FTA form and the accountant need; storing it keeps the PDF and the return identical | recomputing from lines reproduces v1's rounding drift (harvest §4) |
| two PRs | part 1 (model + service, ~2 500 lines with tests) is reviewable and unblocks banking matching; part 2 is UI + PDF | one PR would be the largest in the repo and hard to bisect |
