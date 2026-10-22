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
- [ ] Follow-up (other modules): the invoice page and `dashboard/overview.ts` pass the invoice's registration to `declaredOn`
