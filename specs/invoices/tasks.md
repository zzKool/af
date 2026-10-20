# Tasks: Quotes, invoices and credit notes

**Input**: `specs/invoices/spec.md`, `plan.md` · two PRs

## Part 1 — `feat/invoices-core` (model, totals, service, derived read model, list queries, linkable)

### Phase 1: Foundational
- [ ] T001 `prisma/schema/invoices.prisma`: enums `invoice_type`, `invoice_status`; `Invoice`, `InvoiceLine` (plan §Data model); tenant relations
- [ ] T002 Migration `add_invoices`: tables, CHECKs, partial unique on `(tenant_id, number)`, RLS + grants, lock triggers (`invoices_lock_when_issued`, `invoice_lines_lock_when_issued`), `block_delete_when_linked('invoice')` trigger, indexes (tenant+partner, tenant+status, tenant+issue_date, tenant+declaration_period)
- [ ] T003 `types.ts`: DTOs (`InvoiceDto` with lines, `InvoiceLineDto`, `InvoiceState`, `InvoiceDerived {state, remaining, allocated, credited, convertedTo}`, `VatByRate`, `PrintedReference`, `PrintedParties`)

### Phase 2: US1 — totals and the draft → issue lifecycle (P1)
- [ ] T004 `totals.ts` pure Decimal + `totals.pure.test.ts` (fixtures A–J pass, K/L refused, property 200 runs)
- [ ] T005 `invoices.ts` schemas (header, line, create/update/issue inputs) and `createDraft`: partner must be a client with a short code (warn, not refuse, until issue); contract optional → defaults chain (currency, payment terms → due date, VAT registration, language, references, line pre-fill with `contracts.rateFor` and `rate_source_id`)
- [ ] T006 `updateDraft` (header + lines wholesale, totals recomputed and stored), `deleteDraft`; refused on non-drafts (service + trigger)
- [ ] T007 `issue`: validations (≥ 1 line, description, short code, due ≥ issue), `nextInSeries` by type, ECB rate of the issue date via `rates.getRate` (`same_currency` for SEK; refuse when none), base amounts, `declaration_period` for CH registrations (invoice + credit note), `printed_parties` snapshot (tenant profile, partner, VAT number, bank account of the currency), `issued_at`, status; audit; `onCommit` hook for the PDF job (part 2 wires it)
- [ ] T008 `markSent`, `setDeclarationPeriod` (override, audited), `copyToDraft`
- [ ] T009 `invoices.test.ts` part A: US1 scenarios 1–7, 15 concurrent issues → consecutive numbers, rollback hands the number back, lock trigger hit by direct SQL, RLS

### Phase 3: US3 / US4 — credit notes and quotes (P2)
- [ ] T010 `createCreditNote(originalId, {lines?: [{lineId, quantity}]})` → draft with `Credit: ` lines, `Σ credited ≤ original` checked at issue across the original's credit notes; `decideQuote(accept|decline)`, `convertQuote` → invoice draft with `related_invoice_id = quote`
- [ ] T011 Tests: US3 1–3, US4 1–3

### Phase 4: US5 — derived read model and list queries (P2)
- [ ] T012 `derive.ts`: `deriveState({type, status, total, dueDate, validUntil, allocated, credited, convertedTo}, today)` with D25 tolerance; pure tests incl. `fixtures/payment-tolerance.json` cases re-expressed on allocations
- [ ] T013 `queries.ts`: `INVOICE_COLUMNS`, `listInvoices(tx, q, today)` (one pass: rows + allocation sums from `links` + credited sums + converted), `distinctInvoiceValues`, `invoiceDateHierarchy`, `getInvoice(tx, id, today)`, `nextNumberHint(tx, partnerShort, type, issueDate)`; `queries.test.ts` on the ListQuery contract
- [ ] T014 `linkable.ts` + registration in `modules/linking/linkables.ts`; `setRateUsage` wired in `src/instrumentation.ts`? No — in `modules/invoices/index.ts` side-effect-free: contracts' `setRateUsage` called from `invoices` module init (`register()` exported and called by the composition root `src/instrumentation.ts`)
- [ ] T015 `invoices.actions.ts` (owner writes, accountant reads), `index.ts`, `ui.ts` (actions + types only in part 1)
- [ ] T016 `docs/invoices.md` (model, lifecycle, derived states, how part 2 plugs in), index; PR

## Part 2 — `feat/invoices-sheet` (the document, print, PDF, pages)

- [ ] T017 Migration `add_print_identity`: `tenants.email/website/phone`, `bank_accounts.iban/bic/bank_name/account_holder`; settings company-profile form + bank-accounts tab fields
- [ ] T018 Dictionary keys `invoice.*` en + fr from `fixtures/invoice-strings.{en,fr}.json` (+ `_uiOnly` French written)
- [ ] T019 `components/invoice-sheet.tsx` (`mode: edit | print`): header (logo, title+number, parties, meta), references, line table (edit: inline inputs, add/duplicate/delete, `Ctrl+Enter`), totals (VAT per rate, discount row when > 0), notes, payment box (terms sentence, bank details), reverse-charge / export sentence, footer; print CSS (`@page A4 20mm 15mm 25mm`, thead repeat, `tr break-inside: avoid`, fixed footer)
- [ ] T020 `src/app/print/invoice/[id]/page.tsx` + `requirePrintCaller`; `jobs/render-pdf.ts` (`invoices.render-pdf`, exclusive by invoice id) → `renderPathToPdf` → `documents.storeGeneratedDocument(bytes, businessKey InvoiceAF_{n}.pdf, kind invoice_pdf)` → `pdf_document_id`; `issue` enqueues in `onCommit`; `instrumentation.ts` lists `invoiceJobs`
- [ ] T021 Pages: `/invoices` (ListPage + `InvoiceTable`), `/invoices/new` (draft creation form: partner, contract, type, period), `/invoices/[id]` (EntityPage: sheet in edit mode for drafts with autosave, print mode for issued + actions: Issue / Mark as sent / Credit note / Convert / Copy / Download PDF / Delete draft); nav entry; `can()` subject `invoice` already exists
- [ ] T022 Tests: `print.test.ts` (render print mode for `fixtures/sample-invoice.json` in fr + en → expected strings; VAT column rules; credit note / quote titles), PDF test through `kernel/pdf` (40 lines → 2 pages), `e2e/invoices.spec.ts` (new draft → line → issue → PDF link → mark sent)
- [ ] T023 Screenshots of list, draft sheet, issued sheet, PDF page 1 → `specs/invoices/screenshots/`; `docs/invoices.md` part 2; PR

## Dependencies
Part 1: T001–T003 → T004 → T005–T009 → T010–T011 → T012–T015 → T016. Part 2 starts after part 1 is on `main`; T017/T018 first (shared files), then T019 → T020 → T021 → T022 → T023.
