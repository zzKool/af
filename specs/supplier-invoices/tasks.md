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
- [x] T010 (with audit 22) `allocatedSums` → linking's batch read API.

## F71 — the D40 kit (2026-10-23, light lane)

- [x] T011 `state-family.ts` — the one status → family map (overdue attention · unpaid, partially paid progress · paid done · cancelled neutral) + `SupplierInvoiceStateLabel` (`components/state-label.tsx`, replaces the pastel `status-badge.tsx`; *Overdue · 7 d* kept) in the list, the panel and the group section; pure test against `deriveSupplierInvoiceStatus`.
- [x] T012 On-screen money through `formatMoney` (list, KPIs, panel, group section; the base bare under its *Total (SEK)* header); the footer Σ only under a true currency (`list-sums.ts`, invoices' rule: one currency → Σ total + open in it, several → only Σ base, bare) — the DB test that summed CHF + EUR as one *open* now asserts the rule.
- [x] T013 Keys as `<CodeChip>`; link kinds as `<Tag>`; the document cell on `--state-*` tokens; no Tailwind palette colour left in the module.
- [x] T014 One primary per title row: *New supplier invoice* moves from the table's toolbar to the page's title row (`NewSupplierInvoiceButton`); ⋮ `rowActions` — Open, Open the group, Reinstate (cancelled), Delete (nothing paid; the service still refuses a linked one).
- [x] T015 Quick filters Month (invoice date) and Supplier (`partnerName` now an enum column).
- [x] T016 The panel in `DetailsSection`s: title (key chip, state, total 22 / 600) · About (group, dates / net / VAT once written, base, paid, open; the facts when read-only) · Proof (document, payments + *Link payment*, links) · Money (the draft's form) · Facts · Lines · **History** (collapsed: the invoice's audit entries named by `history.ts` — created, edited, cancelled, reinstated, payment linked, bank row attached / detached; DB + pure tests).

## Cleanup round — lane 4 (2026-10-23, direct lane, behaviour-neutral)

One PR per line; the module's tests unchanged and green.

- [x] T017 (audit 22) Every `tx.link` read → linking: `allocated.ts` over `linking.allocatedSums` (T010); `facts` → `allocatedSums` + `linksTouching({ kinds })`; `removePayment` / `detachPayment` / `isOpen` → `linksTouching`; the document already taken (`create.ts`) and `candidateDocuments` → `createdFromTargets`; a bank row's used amount (`payableTransactions`) → `allocatedFrom`. `sumAllocated` / `isAllocation` gone.
- [x] T018 (audit 23 follow-up) `payableTransactions` → `banking.outgoingMainRows(limit * 2)`; *paid this month* → `banking.bookingDates`. Left: the active settlements read (`tx.settlement`) until expenses has `activeSettlementTransactionIds`.
- [x] T019 (audit 25) The detail's document → `documents.getDocument`; the create's group → `expenses.getGroup`.
- [x] T020 (audit 27) `kernel/money` `openAmount` / `isSettled`, `kernel/clock` `daysBetween` / `addDays` instead of `status.ts`'s own. Kept: the new dialog's own `addDays` (a client helper that returns `""` on a half-typed date where the kernel's throws).
- [x] T021 (audit 28) `todayIso()` (UTC) → `clock.today()` (Stockholm's day) for the list, the detail and the KPIs; the new dialog's default invoice date too.
- [x] T022 (audit 29) The panel's `as unknown as Detail` → the action returns the serialised DTO type: `detail-wire.ts` (`SupplierInvoiceDetailWire`, `toSupplierInvoiceDetailWire` — timestamps as ISO strings) + a pure test.
- [x] T023 (audit 30) Currencies parsed, not cast: the supplier's default currency in `create.ts` through `parseCurrency` (`currency.ts`, + a pure test). Kept: the two form casts (the new dialog, the panel's *Money*) — the action's `z.enum(CURRENCIES)` is their parse, and an OCR code outside the list must reach it and be refused, not turn into SEK; the table's `rowCurrency` cast (a stored row, CHECK upper-case only) — a DTO-level `Currency` is a wider change.
- [x] T024 (audit 32) One invoice-number normaliser for the SQL check and the duplicate finder ("91 60" = "91  60"): `invoice-number.ts`; `checkDuplicateNumber` compares the supplier's numbers through it instead of `lower(btrim())` in SQL (the DB test that reproduced it: created twice before, refused now).

## F73 — + New opens the dialog (2026-10-24, `feat/supplier-invoices-new-dialog`, LIGHT)
- [x] T025 `/supplier-invoices?new=1` opens the new supplier invoice dialog: `NewSupplierInvoiceButton`'s open state is the kernel's `useNewParam()` (the button renders only for a caller who may create); closing drops the param. No i18n change. Tests: the hook's own (`kernel/ui/shell/use-new-param.test.tsx`); e2e `supplier-invoices` (?new=1 → the dialog → Esc → no param; the accountant: nothing opens); screenshot `supplier-invoices-new` light + dark. The sidebar's href gains `?new=1` in F73's last PR (nav).
