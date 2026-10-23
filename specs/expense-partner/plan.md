# Plan: An optional partner on expenses (F87)

Spec: [spec.md](spec.md) (owner's read 2026-10-23: Q1 A · Q2 A · Q3 A, D50). Branch `feat/expenses-partner-build`, **one PR**. Touches `prisma/schema` and the i18n dictionaries → serialised: no other open branch may touch them (check `origin` first).

## Shape

```
prisma/schema/expenses.prisma          Expense + partnerId String? @map("partner_id") @db.Uuid · @@index([tenantId, partnerId])
prisma/migrations/2026102…_expense_partner
                                       ALTER TABLE expenses ADD COLUMN partner_id uuid NULL;
                                       CHECK (kind <> 'per_diem' OR partner_id IS NULL)   -- FR-001
                                       CREATE INDEX (tenant_id, partner_id)
                                       additive only — no FK (constitution §2), lock trigger untouched
src/modules/expenses/
  schemas / expenses.ts                create + update take partnerId (nullable); validated through
                                       partners.getPartner: exists · active · types ∋ vendor; per_diem → refused
  types.ts                             ExpenseDto / ExpenseDetail + partnerId, partnerName, partnerActive;
                                       ExpenseInitial + vendor? { name, address } (the OCR facts)
  category-proposal.ts (pure)          proposeCategory({ current, source: owner|partner|null, partnerDefault })
                                       → { code, source }  — FR-003, the one rule the dialog runs
  queries.ts                           EXPENSE_COLUMNS + partnerId (enum, stored, SQL) + partnerName (enum,
                                       searchable, derived: partners.partnerNames over the page set — the
                                       supplier-invoices way); expensesForPartner(tx, partnerId) → newest 25 rows
                                       + { count, totalBase, anyProvisional } over all
  page-data.ts                         expensePageOptions + vendors (partners.getPartners types vendor, active:
                                       id, name, defaultBasCategoryCode)
  history.ts                           the Partner field, ids → names (partnerNames)
  components/partner-picker.tsx        searchable select of vendors + *none* (dialog and panel)
  components/new-expense-dialog.tsx    picker under Description; category via proposeCategory (*from partner*
                                       hint); PartnerMatchCard when initial.vendor is present
  components/expense-panel-*.tsx       About: partner (name, greyed when inactive) · Facts: picker, saved on change
  components/expense-table.tsx         Partner column after Description (shown by default)
src/modules/partners/
  components/partner-match-card.tsx    MOVED from supplier-invoices/components/supplier-match-card.tsx (+ its test),
                                       renamed PartnerMatchCard; exported from partners/ui (it only ever used
                                       partners' actions and partners.match.* strings)
  components/partner-detail-tabs.tsx   + Expenses tab (CountBadge): rows as plain props, total, *Open in Expenses*
src/modules/supplier-invoices/components/new-supplier-invoice-dialog.tsx
                                       import the card from @/modules/partners/ui — one line, no behaviour change
src/modules/documents/components/make-it-section.tsx
                                       initialFromFacts: expense.vendor = { name, address } — one line + its test
src/app/(app)/partners/[id]/page.tsx   composes expenses.expensesForPartner in the tenant transaction
src/kernel/i18n/dictionaries/{en,fr,sv}.ts
                                       expenses.partner, expenses.partnerNone, expenses.categoryFromPartner,
                                       expenses.errors.partner*, partners.tab.expenses, partners.expenses.*
```

## Decisions (the agent's, written down)

- **A nullable column, no FK** — the constitution's cross-module rule; partners are never hard-deleted (deactivate only), so no dangling id to guard. The DB CHECK keeps a per-diem partner-less even if a service path forgets.
- **Not a link** (`belongs_to` exists): a link would make the partner part of the graph and the allocation rules; D49 asks for a fact on the row, and the owner chose "one nullable column".
- **Defaults live in the dialog only** (FR-003): the service saves what it is sent; the pure `proposeCategory` is the one rule and is what SC-004 tests.
- **The match card moves to partners** rather than being imported from `supplier-invoices/ui` (a cross-module UI dependency for a component that is about partners) or copied. Strings are already `partners.match.*`.
- **Partner tab without a cycle**: `expenses/ui` imports `partners/ui` (the card), so `partners/ui` never imports `expenses/ui`. The page passes plain rows; the state comes as `status` and is drawn with the kernel `StateLabel` from a family computed server-side through expenses' `state-family` (exported on `index.ts`).
- **partnerName derived, partnerId stored**: filtering the deep link (`/expenses?f.partnerId=in:<id>`, the journal tab's way) runs in SQL; the column the owner reads and filters by name is joined over the page set like `supplierOptions` / `partnerNames`.
- **Spend = Σ `amount_base`** of every expense of the partner, provisional bases included and marked (`*`) — the same base the list's footer sums.

## Tests

- `expenses.test.ts` (DB): create with a vendor / without / with an inactive partner / a client-only partner / another tenant's id → refused as FR-001; per-diem with a partner refused (service and CHECK by SQL); update partner on open, paid, partially refunded, refunded expenses (SC-003) — money facts, key, category unchanged; the lock trigger accepts a partner change on a settled row; same key and same duplicate matches with and without a partner (SC-001); audit row names the field.
- `queries.test.ts` / list: the US3 fixture — filter on P (3 rows, Σ base), distinct values P / Q / (blank) 3 / 1 / 1, search by partner name, `expensesForPartner` count and total = the filtered list's (SC-002), provisional flag.
- `category-proposal.pure.test.ts`: US1-1…4 and a fast-check walk over random pick / choose / clear sequences — an owner-chosen code is never replaced (SC-004).
- `new-expense-dialog.test.tsx`: picker sets the category with *from partner*; the card appears with `initial.vendor`, *Use match* picks, nothing picked without a click.
- `partner-match-card.test.tsx` moved as is; `make-it-section.test.tsx` + the vendor facts.
- e2e `e2e/expenses.spec.ts` (owns its data): create a vendor with a default category → new expense picks it (category proposed) → the list's Partner filter → the vendor's page, Expenses tab with count and total → *Open in Expenses*. Screenshots via `e2e/screenshots.spec.ts`: dialog with the card, list with the column, partner Expenses tab — light + dark, `specs/expense-partner/screenshots/`.

## Constitution check

Additive migration · RLS unchanged (column on a tenant table) · validated UUID, no cross-module FK · no status stored (spend is a read) · money facts and the lock untouched · writes through `ownerAction` → service → `tx` with audit · strings in en / fr / sv · screenshots of the new tab and the changed dialog / list · `docs/expenses.md`, `docs/partners.md`, `docs/document-review.md` updated.
