# Tasks: Quotes, invoices and credit notes

**Input**: `specs/invoices/spec.md`, `plan.md` · two PRs

## Part 1 — `feat/invoices-core` (model, totals, service, derived read model, list queries, linkable)

### Phase 1: Foundational
- [x] T001 `prisma/schema/invoices.prisma`: enums `invoice_type`, `invoice_status`; `Invoice`, `InvoiceLine` (plan §Data model); tenant relations
- [x] T002 Migration `add_invoices`: tables, CHECKs, partial unique on `(tenant_id, number)`, RLS + grants, lock triggers (`invoices_lock_when_issued`, `invoice_lines_lock_when_issued`), `block_delete_when_linked('invoice')` trigger, indexes (tenant+partner, tenant+status, tenant+issue_date, tenant+declaration_period)
- [x] T003 `types.ts`: DTOs (`InvoiceDto` with lines, `InvoiceLineDto`, `InvoiceState`, `InvoiceDerived {state, remaining, allocated, credited, convertedTo}`, `VatByRate`, `PrintedReference`, `PrintedParties`)

### Phase 2: US1 — totals and the draft → issue lifecycle (P1)
- [x] T004 `totals.ts` pure Decimal + `totals.pure.test.ts` (fixtures A–J pass, K/L refused, property 200 runs)
- [x] T005 `invoices.ts` schemas (header, line, create/update/issue inputs) and `createDraft`: partner must be a client with a short code (warn, not refuse, until issue); contract optional → defaults chain (currency, payment terms → due date, VAT registration, language, references, line pre-fill with `contracts.rateFor` and `rate_source_id`)
- [x] T006 `updateDraft` (header + lines wholesale, totals recomputed and stored), `deleteDraft`; refused on non-drafts (service + trigger)
- [x] T007 `issue`: validations (≥ 1 line, description, short code, due ≥ issue), `nextInSeries` by type, ECB rate of the issue date via `rates.getRate` (`same_currency` for SEK; refuse when none), base amounts, `declaration_period` for CH registrations (invoice + credit note), `printed_parties` snapshot (tenant profile, partner, VAT number, bank account of the currency), `issued_at`, status; audit; `onCommit` hook for the PDF job (part 2 wires it)
- [x] T008 `markSent`, `setDeclarationPeriod` (override, audited), `copyToDraft`
- [x] T009 `invoices.test.ts` part A: US1 scenarios 1–7, 15 concurrent issues → consecutive numbers, rollback hands the number back, lock trigger hit by direct SQL, RLS

### Phase 3: US3 / US4 — credit notes and quotes (P2)
- [x] T010 `createCreditNote(originalId, {lines?: [{lineId, quantity}]})` → draft with `Credit: ` lines, `Σ credited ≤ original` checked at issue across the original's credit notes; `decideQuote(accept|decline)`, `convertQuote` → invoice draft with `related_invoice_id = quote`
- [x] T011 Tests: US3 1–3, US4 1–3

### Phase 4: US5 — derived read model and list queries (P2)
- [x] T012 `derive.ts`: `deriveState({type, status, total, dueDate, validUntil, allocated, credited, convertedTo}, today)` with D25 tolerance; pure tests incl. `fixtures/payment-tolerance.json` cases re-expressed on allocations
- [x] T013 `queries.ts`: `INVOICE_COLUMNS`, `listInvoices(tx, q, today)` (one pass: rows + allocation sums from `links` + credited sums + converted), `distinctInvoiceValues`, `invoiceDateHierarchy`, `getInvoice(tx, id, today)`, `nextNumberHint(tx, partnerShort, type, issueDate)`; `queries.test.ts` on the ListQuery contract
- [x] T014 `linkable.ts` + registration in `modules/linking/linkables.ts`; `contracts.setRateUsage(invoices.rateUsageFromInvoiceLines)` wired by the composition root `src/instrumentation.ts`
- [x] T015 `invoices.actions.ts` (owner writes, accountant reads), `index.ts`, `ui.ts` (actions + types only in part 1)
- [x] T016 `docs/invoices.md` (model, lifecycle, derived states, how part 2 plugs in), index; PR

## Part 2 — `feat/invoices-sheet` (the document, print, PDF, pages)

- [x] T017 Migration `add_print_identity`: `tenants.email/website/phone`, `bank_accounts.iban/bic/bank_name/account_holder`; settings company-profile form + bank-accounts tab fields
- [x] T018 Dictionary keys `invoice.*` en + fr from `fixtures/invoice-strings.{en,fr}.json` (+ `_uiOnly` French written)
- [x] T019 `components/invoice-sheet.tsx` (`mode: edit | print`): header (logo, title+number, parties, meta), references, line table (edit: inline inputs, add/duplicate/delete, `Ctrl+Enter`), totals (VAT per rate, discount row when > 0), notes, payment box (terms sentence, bank details), reverse-charge / export sentence, footer; print CSS (`@page A4 20mm 15mm 25mm`, thead repeat, `tr break-inside: avoid`, fixed footer)
- [x] T020 `src/app/print/invoice/[id]/page.tsx` + `requirePrintCaller`; `jobs/render-pdf.ts` (`invoices.render-pdf`, exclusive by invoice id) → `renderPathToPdf` → `documents.storeGeneratedDocument(bytes, businessKey InvoiceAF_{n}.pdf, kind invoice_pdf)` → `pdf_document_id`; `issue` enqueues in `onCommit`; `instrumentation.ts` lists `invoiceJobs`
- [x] T021 Pages: `/invoices` (ListPage + `InvoiceTable`), `/invoices/new` (draft creation form: partner, contract, type, period), `/invoices/[id]` (EntityPage: sheet in edit mode for drafts with autosave, print mode for issued + actions: Issue / Mark as sent / Credit note / Convert / Copy / Download PDF / Delete draft); nav entry; `can()` subject `invoice` already exists
- [x] T022 Tests: `print.test.ts` (render print mode for `fixtures/sample-invoice.json` in fr + en → expected strings; VAT column rules; credit note / quote titles), PDF test through `kernel/pdf` (40 lines → 2 pages), `e2e/invoices.spec.ts` (new draft → line → issue → PDF link → mark sent)
- [x] T023 Screenshots of list, draft sheet, issued sheet, PDF page 1 → `specs/invoices/screenshots/`; `docs/invoices.md` part 2; PR

## F57 — `feat/invoices-credit-notes` (lessons audit 3 · 8)

- [x] T024 `derive.ts`: a credit note is never overdue (overdue for `type = invoice` only); `receivableAmount` — `remaining` is 0 for drafts, quotes and credit notes; `queries.ts` uses it
- [x] T025 `totals.ts` `baseTotals`: subtotal base after the header discount, total base = the sum of the parts; `issue()` uses it
- [x] T026 Dashboard receivables / overdue loop: `type = invoice` only (one line in `modules/dashboard/overview.ts`)
- [x] T027 Tests: derive cases, base totals example + property (300 runs, a discount on every document), DB: discounted issue, credit note a year on; docs (F57 row, [[invoices]], lessons 3 · 8)
- [x] Left outside F57's scope: the receivables hint counts quotes (`dashboard/overview.ts:118`) — *done in F55 (2026-10-23): the hint counts `type = invoice` only, `overview.test.ts` › *the receivables hint counts the open invoices only**

## F76 — `feat/invoices-contract-race` (lessons Process (2), V12, F56's leftover)

- [x] T028 `new-invoice-form.tsx`: the contract list is stored with the client it was loaded for; a client change clears the pick in the same render; the Contract select and *Create draft* are disabled until the new client's list is there; only a contract of that list is sent
- [x] T029 `invoice-actions.tsx` (V12): after the 30th poll *PDF is being generated… Try again* (`errors.tryAgain`, no new key); the click resets the count and refreshes
- [x] T030 `app/(app)/invoices/[id]/page.tsx`: `declaredOn(tx, period, invoice.vatRegistrationId)`
- [x] T031 Tests: `new-invoice-form.test.tsx` (the actions are fakes with the service's rule; B's list held back; fails on the old form with *ca* refused), `invoice-actions.test.tsx` (fake timers: 29 polls no hint, 30th hint, quiet after, click → polling again); docs (F76 row, F56 row, [[invoices]], lessons)

## F71 — `feat/invoices-kit` (the D40 kit, LIGHT)

- [x] T032 States → `<StateLabel>` through one map (`state-family.ts`, `InvoiceStateLabel`); on-screen money → `formatMoney` (list, title meta, side panel, related; the sheet keeps `formatCurrency`); keys → `<CodeChip>`; type / currency / VAT period → `<Tag>`; ⋮ `rowActions`; the page's aside → `InvoiceDetails` (`DetailsSection`s); one primary per title row (`NewDocumentButton` *New invoice ▾ New quote*; on the page *Issue* or the `<SplitButton>` *Create credit note / Convert to invoice ▾ Copy*); `quickFilter` Date (the Month tree) and Client (`partnerName` → enum); footer Σ never across currencies (`list-sums.ts`); lesson 19 (b) — `vat-treatment.ts` takes `RateSchedule | null`, no cast. Tests: `state-family.pure.test.ts`, `list-sums.pure.test.ts`, `print-identity.pure.test.tsx` (baseline committed before the change); `e2e/linking.spec.ts` reads `data-amount`. Left: a copy button on a key title and *History* in the panel (no kit piece / no key — F74), the English column headers *Issued at · Sent at · Created · Updated* (F74, i18n)

## Lane 5 — cleanup round (lessons audit 22 · 27 · 29–31, contracts T024) · DIRECT, behaviour-neutral, one PR each

- [x] T033 `feat/invoices-exports` — exports other modules asked for: `signedTotal` / `creditSign` (`signed.ts`), `DEFAULT_PAYMENT_TERMS_DAYS` + `QUOTE_VALIDITY_DAYS` (`defaults.ts`; the three literal 30s), `creditedSum(ids)` (`credited.ts`; `queries.ts` and `issue.ts`'s credit limit use it), `ratePricingFromInvoiceLines` → `{ lines, lastPeriodStart }` (`rate-usage.ts`, for contracts T024 — contracts wires it). Tests: `signed.pure.test.ts` (property: an invoice and its full credit note net to 0), DB: `creditedSum` (drafts left out), `ratePricing` (line period → document period → issue date)
- [x] T034 `feat/invoices-linking-reads` — `queries.ts` allocations → `linking.allocatedSums(tx, "invoice", ids)`: no `tx.link` left in the module. Behaviour-neutral: linking sums `justifies` + `settles`, and `settles` only ever targets a settlement (`kinds.ts`). The US5 DB tests (paid / partially paid / tolerance, list sums) carry it unchanged
- [x] T035 `feat/invoices-kernel-helpers` — audit 27 adoption: `derive.ts` `remainingAmount` is the kernel's `openAmount(total, allocated, credited).toFixed(2)`; `components/sheet-document.ts`'s own signed `daysBetween` → `kernel/clock` `daysUntil` (the payment-terms days on the sheet), its `ui.ts` re-export dropped (no caller). Tests unchanged: `derive.pure.test.ts`, `print.pure.test.tsx`, the `print-identity` snapshots
- [x] T036 `feat/invoices-json-columns` — audit 29: `json-columns.ts`, a read mapper (Zod type guard, `JsonValue` → DTO) and a write mapper (DTO → `InputJsonValue`) per column: `printedReferences`, `printedParties`, `vatByRate`. `dto.ts` reads through them; `issue.ts`, `defaults.ts`, `drafts.ts`, `copies.ts` write through them — no `as unknown as` left on a JSON column. A valid value reads back as the very object stored; an older snapshot missing a later field (bank, e-mail, website, logo) still reads; a malformed one reads as null / is left out. Tests: `json-columns.pure.test.ts` (round trip, identity, old snapshot, reject paths)
- [x] T037 `feat/invoices-currencies` — audit 30: `defaults.ts` `toCurrency` (Zod enum on `CURRENCIES`); `drafts.ts`'s defaults chain parses the contract's and the partner's currency instead of casting (both are already enums upstream, so nothing changes for stored data; an unknown code now falls through to the next source instead of reaching the row). Test: `defaults.pure.test.ts`. Left: the UI casts on the DTO's `currency: string` (`invoice-table.tsx` row / sum currency, `invoice-sheet.tsx` `sheetMoney`) — they go when the DTO types `currency` as `Currency`; the sheet left as is (the printed PDF)
- [x] T038 `feat/invoices-real-bank-linkable` — audit 31: `invoices.test.ts` registers banking's real `bankTransactionLinkable`; US5's payments are incoming CHF rows through `banking.importCsv` (a one-line Nordea export each), so the link carries the row's amount and currency like in the app — the fake "before the banking module exists" (amount null, nothing checked on the source side) is gone

## Dependencies
Part 1: T001–T003 → T004 → T005–T009 → T010–T011 → T012–T015 → T016. Part 2 starts after part 1 is on `main`; T017/T018 first (shared files), then T019 → T020 → T021 → T022 → T023.
