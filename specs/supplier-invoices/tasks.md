# Tasks: Supplier invoices

- [x] T001 Schema + migration `20261021160000_add_supplier_invoices` (tables, lines, partner terms, triggers, RLS), generate, linkable type exists, kinds unchanged.
- [x] T002 `types.ts`, `status.ts` (+ pure test), `supplier-invoices.ts` (create from document / blank, keys through `expenseSeries`, bases, due-date default, duplicate number, lines sum rules, update rules, delete / cancel / uncancel, copyLastPrefill).
- [x] T003 `payments.ts` (recordPayment, removePayment, attachPayment, detachPayment), `linkable.ts` + registration.
- [x] T004 `queries.ts` (columns, list, detail, kpis, payableTransactions, inputVatForPeriod, listForGroup), actions, `index.ts`, `ui.ts`.
- [x] T005 `supplier-invoices.test.ts` (DB: US1, US2, US4, RLS) on the expenses harness.
- [x] T006 Pages: `/supplier-invoices` (table, KPIs, panel, new dialog with document picker + Copy last), the group page section, partner form terms, nav, strings en + fr.
- [x] T007 `e2e/supplier-invoices.spec.ts`, screenshots `specs/supplier-invoices/screenshots/`, docs (`docs/supplier-invoices.md`, index, feature-folders, inventory §3.6, numbering, linking), PR.

## F59 — edit and allocated (2026-10-22)

- [x] T008 `updateSupplierInvoice` rebases only when the rate, the currency or (on an ECB rate) the date changed — a manual rate is kept, the base follows the total; a defaulted due date follows the date / supplier terms, a typed one stays (lessons audit 5, D37).
- [x] T009 `allocated.ts`: one allocated sum (every `justifies` allocation onto the invoice) for the list, the detail, the KPIs and `recordPayment`'s open; the panel lists every allocation, a journal-entry payer by its label (lessons audit 6).
- [ ] T010 (with audit 22) `allocatedSums` → linking's batch read API.
