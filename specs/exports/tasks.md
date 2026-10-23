# Tasks — exports, Swiss VAT return (`feat/exports-swiss-vat`)

- [x] T001 Schema `swiss_vat_declarations` + migration (RLS) — `prisma/schema/exports.prisma`
- [x] T002 Reads in the owning modules: `invoices.invoicesForDeclaration` / `declarationPeriods`, `supplierInvoices.inputVatSources`, `expenses.inputVatSources`
- [x] T003 Pure `swiss-vat.ts` (form fields, quarter bounds, compute, CSV) + test on `swiss-vat-cases.json`
- [x] T004 `declarations.ts` (saveManual, declare, undeclare, markPaid, unmarkPaid) + `queries.ts` (return, periods, registrations, declaredOn, payment options) + actions
- [x] T005 DB test: the quarter's figures, conversion, periods, the declaration record, roles
- [x] T006 Page `/exports` + `SwissVatReturnPage`, nav item, strings, the invoice page's declared chip, nav tests, `e2e/auth.spec.ts`
- [x] T007 E2E `e2e/exports.spec.ts` + screenshots; docs

## F56 — the return correct (`feat/exports-vat-correct`, audit lessons 1 · 2 · 21)

- [x] T008 Rate rows from each invoice's stored `vatByRate` (header discount included), 221 = the 0 % part by the stored rate, not the printed country; no division by the net (the `"0.00" || "1"` NaN)
- [x] T009 `declare()` computes the return and stores its lines — no `lines` input; snapshot / manual parsed on read (`declaration-read.ts`)
- [x] T010 Paid on derived from the `vat_payment` expense's date when attached; `declaredOn(period, registrationId?)`
- [x] T011 One period rule: `period.ts` over `invoices.declarationPeriodFor` / `isDeclarationPeriod`
- [x] T012 Tests: a discounted invoice on the real modules, a forged payload, a declared period re-read, paid derived, per-registration declared on; docs
- [x] Follow-up (other modules): the invoice page and `dashboard/overview.ts` pass the invoice's registration to `declaredOn` — *done: the invoice page F76, the dashboard F55 (one item per CH registration), both 2026-10-23*

## F71 — exports adopts the D40 kit (`feat/exports-d40-kit`)

- [x] T013 `state-family.ts` (`declarationState` from the record's dates: draft → neutral, declared → progress, paid → done) → `<StateLabel>` for the quarter; `formatMoney` on every on-screen amount (bare under *VAT (CHF)* and for the muted base), `data-amount` on the form's figures; invoice numbers and input-source keys `<CodeChip>`, country and *CN* `<Tag>`; warnings without the amber palette; *Copy* an icon button with an `aria-label` (kept in the row — the form's gesture, not a row action). n/a: `rowActions`, `quickFilter`, `DetailsSection` (no DataTable, no panel). The CSV unchanged — golden `specs/exports/fixtures/swiss-vat-csv-golden.json` captured before the change, compared in `swiss-vat.pure.test.ts`; `state-family.pure.test.ts`; `e2e/exports.spec.ts` reads `data-amount`

## Lessons audit (round 2 cleanup)

- [x] T014 *(2026-10-23, audit 31)* `swiss-vat.pure.test.ts` stops counting its own arrays: the fixture's `detailsInvoices` / `detailsInputSources` were checked against the arrays the test had just filtered itself (V8, V9). The selection is the query's (`invoices.invoicesForDeclaration`, status ≠ draft; input VAT by date) — now `exports.test.ts` *the drill-down is the query's selection*: a draft in the quarter never appears, an empty quarter lists no invoice, no input source, every total 0.00. The pure test's status filter is labelled as input preparation. DIRECT
- Audit 29 (`manual` / `snapshot` parsed on read) — already done by F56, T009 (`declaration-read.ts`). Nothing left.
