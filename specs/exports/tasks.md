# Tasks — exports, Swiss VAT return (`feat/exports-swiss-vat`)

- [x] T001 Schema `swiss_vat_declarations` + migration (RLS) — `prisma/schema/exports.prisma`
- [x] T002 Reads in the owning modules: `invoices.invoicesForDeclaration` / `declarationPeriods`, `supplierInvoices.inputVatSources`, `expenses.inputVatSources`
- [x] T003 Pure `swiss-vat.ts` (form fields, quarter bounds, compute, CSV) + test on `swiss-vat-cases.json`
- [x] T004 `declarations.ts` (saveManual, declare, undeclare, markPaid, unmarkPaid) + `queries.ts` (return, periods, registrations, declaredOn, payment options) + actions
- [x] T005 DB test: the quarter's figures, conversion, periods, the declaration record, roles
- [x] T006 Page `/exports` + `SwissVatReturnPage`, nav item, strings, the invoice page's declared chip, nav tests, `e2e/auth.spec.ts`
- [x] T007 E2E `e2e/exports.spec.ts` + screenshots; docs
