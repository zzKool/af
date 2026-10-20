# Tasks: Supplier invoices

- [x] T001 Schema + migration `20261021160000_add_supplier_invoices` (tables, lines, partner terms, triggers, RLS), generate, linkable type exists, kinds unchanged.
- [x] T002 `types.ts`, `status.ts` (+ pure test), `supplier-invoices.ts` (create from document / blank, keys through `expenseSeries`, bases, due-date default, duplicate number, lines sum rules, update rules, delete / cancel / uncancel, copyLastPrefill).
- [x] T003 `payments.ts` (recordPayment, removePayment, attachPayment, detachPayment), `linkable.ts` + registration.
- [x] T004 `queries.ts` (columns, list, detail, kpis, payableTransactions, inputVatForPeriod, listForGroup), actions, `index.ts`, `ui.ts`.
- [x] T005 `supplier-invoices.test.ts` (DB: US1, US2, US4, RLS) on the expenses harness.
- [x] T006 Pages: `/supplier-invoices` (table, KPIs, panel, new dialog with document picker + Copy last), the group page section, partner form terms, nav, strings en + fr.
- [x] T007 `e2e/supplier-invoices.spec.ts`, screenshots `specs/supplier-invoices/screenshots/`, docs (`docs/supplier-invoices.md`, index, feature-folders, inventory §3.6, numbering, linking), PR.
