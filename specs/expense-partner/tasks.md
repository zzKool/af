# Tasks: An optional partner on expenses (F87)

Spec: [spec.md](spec.md) · plan: [plan.md](plan.md) · decisions D49, D50. One build PR, branch `feat/expenses-partner-build` — touches `prisma/schema` and i18n: check `origin` for another open branch touching them first. State is left here so any session can continue: tick as you go.

## Phase 1 — model (FR-001)

- [ ] T001 `prisma/schema/expenses.prisma`: `partnerId` (nullable uuid, `partner_id`) + `@@index([tenantId, partnerId])`; migration `expense_partner`: the column, `CHECK (kind <> 'per_diem' OR partner_id IS NULL)`, the index — additive, no FK, `expenses_lock_when_settled` untouched; `prisma generate`; drift check green.

## Phase 2 — US1 + US2: write the partner (P1)

- [ ] T002 `types.ts` (`partnerId`, `partnerName`, `partnerActive` on the DTO / detail; `ExpenseInitial.vendor`); create / update schemas + `expenses.ts`: validate through `partners.getPartner` (exists, active, type `vendor` → else refused with a field-tagged error), per-diem refused; update allowed in every state, audited.
- [ ] T003 `category-proposal.ts` (pure `proposeCategory`) + `category-proposal.pure.test.ts` (US1-1…4, fast-check sequences — SC-004).
- [ ] T004 `expenses.test.ts`: the FR-001 refusals, per-diem by service and by SQL (the CHECK), partner change on open / paid / partially refunded / refunded with nothing else moving (SC-003), the lock trigger accepting it, same key and same duplicate matches with / without a partner (SC-001), the audit field.

## Phase 3 — US3: spend per partner (P1)

- [ ] T005 `queries.ts`: `partnerId` (stored, enum) and `partnerName` (derived through `partners.partnerNames`, enum, searchable) in `EXPENSE_COLUMNS`; `expensesForPartner(tx, partnerId)` (newest 25 + count, Σ base, any provisional); `history.ts` names the partner; list / distinct / search / `expensesForPartner` tests on the US3 fixture (SC-002).
- [ ] T006 `page-data.ts`: vendors in `expensePageOptions`; `components/expense-table.tsx`: the Partner column after Description.
- [ ] T007 Partner page: `partner-detail-tabs.tsx` + **Expenses** tab (count badge, `n expenses · Σ base SEK` with `*` when provisional, rows key / date / group / description / category / amount / base / state, empty state, *Open in Expenses* → `/expenses?f.partnerId=in:<id>`); `src/app/(app)/partners/[id]/page.tsx` composes `expensesForPartner` and the state family (no `partners/ui` → `expenses/ui` import).

## Phase 4 — the dialog, the panel, the match card (US1, US2, US4)

- [ ] T008 Move `supplier-invoices/components/supplier-match-card.tsx` (+ test) → `partners/components/partner-match-card.tsx` (`PartnerMatchCard`), export from `partners/ui`; the supplier dialog imports it from there — no behaviour change, its tests green.
- [ ] T009 `components/partner-picker.tsx`; `new-expense-dialog.tsx`: picker under Description, category through `proposeCategory` with the *from partner* hint, `PartnerMatchCard` when `initial.vendor` is set (*Use match* / *New vendor* as type vendor, picked at once); the panel: partner in About (greyed when inactive), picker in Facts saved on change; `new-expense-dialog.test.tsx`.
- [ ] T010 `documents/components/make-it-section.tsx`: `initialFromFacts` passes `expense.vendor = { name, address }`; `make-it-section.test.tsx`.
- [ ] T011 i18n en / fr / sv: `expenses.partner*`, `expenses.categoryFromPartner`, `expenses.errors.partner*`, `partners.tab.expenses`, `partners.expenses.*`.

## Phase 5 — proof and docs

- [ ] T012 e2e `e2e/expenses.spec.ts` (owns its data): vendor with a default category → new expense, category proposed → list Partner filter → the vendor's Expenses tab (count, total) → *Open in Expenses*; `e2e/screenshots.spec.ts` shoots the dialog with the card, the list with the column, the partner tab — light + dark → `specs/expense-partner/screenshots/`.
- [ ] T013 Docs: `docs/expenses.md` (model line, the partner, the list column, `expensesForPartner`), `docs/partners.md` (Expenses tab, the match card's new home), `docs/document-review.md` (the expense dialog's card); F87 row in `docs/features.md` → built; feature-inventory §3.7 status.
- [ ] T014 `npx vitest run src/kernel/guards` + the expenses / partners / supplier-invoices / documents tests, lint, typecheck, build; PR (screenshots linked); `scripts/merge-when-green.sh`; watch `main`'s build-and-e2e.
