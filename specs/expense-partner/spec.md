# Feature Specification: An optional partner on expenses (F87)

**Feature Branch**: `feat/expenses-partner` (this docs PR: spec → plan → tasks) · the build: one PR in `modules/expenses` (+ the partner page composing a read of expenses)

**Created**: 2026-10-23

**Status**: Draft — awaiting the owner's read (questions Q1–Q3 at the end)

**Input**: D49 (owner, 2026-10-23): "Expenses stay merchant-level, with an optional partner: a restaurant, an airline, a hotel chain can be picked as the expense's partner, so spend per partner can be seen, and the partner's default BAS pre-fills the category when the expense has none. Optional: an expense without a partner stays valid." F87: picker in the dialog and the panel, default BAS proposed never overwriting, spend per partner on the partner's 360° page and as a Partner column + filter on the expenses list; the OCR merchant vs the partner; duplicate check and `Ex` keys unchanged.

**Replaces / defers to** (lessons: *a spec that overrides another module's rule cites it*):
- **Replaces** the lessons item *Expense dialog: no partner* (decided D49) and the note that "the partner default applies to supplier invoices only" — expenses get it too, as a proposal.
- **Extends** `specs/expenses/spec.md` FR-003 (one column), FR-011 (one list column), US5 (the dialog, the panel, the list).
- **Defers to** `specs/expenses/spec.md` FR-003 / the `Ex` key rule (unchanged: the key comes from group × category alias, never from the partner), `docs/expenses.md` *The duplicate check* (unchanged: hash + same currency ±1 % ±7 days + same folded description), D37 (the lock: the partner is not a money fact).
- **Defers to** the constitution §2: the partner is a **validated UUID**, not a cross-table FK; the partners module never reads expenses — the partner page composes the read (as it does for documents and journal entries, `docs/partners.md` *The entity page's relationships*).

```
 receipt (OCR merchant "Restaurant Le Cerf")
        │  Make it… → NewExpenseDialog
        ▼
 ┌ Expense ─────────────────────────────┐        ┌ Partner (vendor) ────────────┐
 │ key Ex213-Rep-01  (group × alias)    │ partner│ Restaurant Le Cerf           │
 │ description "Restaurant Le Cerf"     │ ──────►│ default BAS 5831 (Rep)       │
 │ category ◄── proposed if empty ──────┼────────┤                              │
 │ amount / base / payer  (unchanged)   │  id    │ 360° page: Expenses tab      │
 └──────────────────────────────────────┘ (UUID) │   n expenses · Σ base SEK    │
                                                  └──────────────────────────────┘
```

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pick a partner on a new expense (Priority: P1)

The owner creates an expense for a dinner. In the dialog he picks the partner *Restaurant Le Cerf* (a vendor whose default category is *5831 Representation (Rep)*). The category was empty, so it becomes *5831* — marked as coming from the partner. He saves: the expense carries the partner, its key is `Ex213-Rep-01` exactly as it would have been had he chosen *5831* by hand. Another day he records a taxi receipt and leaves the partner empty — the expense is saved as before.

**Why this priority**: the partner on the row is what every view of spend per partner reads.

**Independent Test**: create two expenses through the service, one with a partner and one without; read both back: the partner is stored on the first, empty on the second; keys and bases are those of the same expense created before this feature.

**Acceptance Scenarios**:

1. **Given** the dialog with no category chosen **When** a partner with a default category is picked **Then** the category is set to the partner's default and labelled *from partner*.
2. **Given** the dialog where the owner has chosen a category **When** a partner with another default is picked **Then** the category stays the owner's (never overwritten); nothing else changes.
3. **Given** a category that came from partner A's default **When** the owner switches to partner B **Then** the category becomes B's default (it was a proposal, not a choice); **When** he clears the partner **Then** the proposed category stays (he can change it).
4. **Given** a partner without a default category **When** picked **Then** the category is untouched.
5. **Given** no partner **When** the expense is saved **Then** it is valid; nothing in the dialog requires one.
6. **Given** a partner is picked **Then** the amount, currency, payer, date and description are untouched (the currency stays the payer's, not the partner's default currency).
7. **Given** a deactivated partner, or an id that is not a partner of this tenant **When** an expense is saved with it **Then** refused (*Unknown or inactive partner*); the picker never offers inactive partners.
8. **Given** an expense of kind *per diem* (written by the trip panel) **Then** it has no partner and the service refuses one.

---

### User Story 2 - Set, change or remove the partner later (Priority: P1)

Months later the owner opens an older expense in the side panel and picks *SAS* as its partner; on another he removes a wrong partner. This works on any expense — open, paid, settled — because the partner is a fact about the merchant, not a money fact.

**Independent Test**: on a settled expense (a settlement line exists) change the partner through the service: accepted, audited, money facts and key unchanged; the database lock does not refuse it.

**Acceptance Scenarios**:

1. **Given** an expense in any state **When** the partner is set, changed or cleared in the panel's facts **Then** it is saved on change (like description and category) and appears in the panel's History as *Partner: — → SAS*.
2. **Given** an expense whose category is set (always, on an existing expense) **When** a partner is picked in the panel **Then** the category is never changed — the default is proposed only in the dialog, where a category can be empty.
3. **Given** the accountant **Then** he sees the partner in the list and the panel and cannot change it.

---

### User Story 3 - See spend per partner (Priority: P1)

The owner wants to know how much went to *SAS* and to *Restaurant Le Cerf*. On the expenses list he adds the **Partner** column and filters it to *SAS*: the footer shows Σ base SEK for those rows, and the Date filter narrows it to a year. On the partner page of *SAS* an **Expenses** tab (with its count badge) lists its expenses, newest first, with the total in base, and a link *Open in Expenses* that lands on the list filtered on that partner.

**Independent Test**: three expenses for partner P (one CHF private, one SEK company-paid not yet attached, one SEK), one for partner Q, one without: the list filtered on P returns three rows and Σ base = the sum of their bases; the partner page's tab for P shows 3 and the same total, with the provisional mark; the filter's values are P, Q and *(blank)* with counts 3 / 1 / 1.

**Acceptance Scenarios**:

1. **Given** the expenses list **When** the Partner header filter opens **Then** it lists the partners present in the rows the other filters leave, plus *(blank)* for expenses without a partner (Excel semantics, counts included).
2. **Given** a filter on one partner **Then** the footer sums (base, open) are those of its rows only; the amount column is not summed when currencies mix (unchanged rule).
3. **Given** the partner page **When** the partner has expenses **Then** the Expenses tab shows key, date, group, description, category, amount in its currency, base SEK, state — newest first — and above them *n expenses · Σ base SEK*; a total that includes a provisional base carries the provisional mark (`*`).
4. **Given** a partner with no expenses **Then** the tab shows *0* and an empty state.
5. **Given** *Open in Expenses* **Then** `/expenses` opens with the Partner filter set to that partner.
6. **Given** the group page **Then** its expense table shows the same Partner column (it is the same table).

---

### User Story 4 - The OCR merchant and the partner (Priority: P2)

A receipt goes through *Make it… → Expense*: the OCR merchant name pre-fills the description (as today). The dialog shows the best matching partner and lets the owner use it, or create a new vendor from the merchant name. *(The exact behaviour is Q1.)*

**Acceptance Scenarios** (written for the recommended answer to Q1; adjusted after the owner's read):

1. **Given** a merchant *RESTAURANT LE CERF SA* and an active vendor *Restaurant Le Cerf* **When** the dialog opens from the review page **Then** a match card shows *Restaurant Le Cerf* (from 60 %, the supplier-invoice dialog's rule) with *Use match*; using it picks the partner and proposes its default category (US1-1).
2. **Given** no match from 60 % **Then** the card offers *New vendor* with the merchant name (and the OCR address when there is one) pre-filled; creating it picks the new partner at once.
3. **Given** the owner ignores the card **Then** the expense is saved without a partner — nothing is picked automatically.
4. **Given** a partner is picked **Then** the description (the merchant name) is not replaced by the partner's name.

---

### Edge Cases

- **The duplicate check is unchanged**: it still compares the description (the merchant name), not the partner — two expenses at the same restaurant with different description spellings behave exactly as today.
- **The key is unchanged**: the alias is the category's short code at creation; a partner-proposed category gives the same key as the same category chosen by hand. Changing the partner later never changes the key, the category or the alias.
- **The lock is unchanged**: `expenses_lock_when_settled` keeps its column list; the partner is not in it (US2).
- **A deactivated partner** stays shown on the expenses that carry it (name greyed with its state); it is not offered for new picks; the expense can keep it or clear it.
- **A partner that is also a supplier**: its supplier invoices are not in the Expenses tab (Q3).
- **A Swiss VAT payment** (kind `vat_payment`) may carry a partner (the tax administration as a vendor), like a receipt.
- **The accountant package and exports**: unchanged — no new column in the package's files (a later row if the accountant wants it).
- **The linking graph**: the partner is a column, not a link — the partner's graph page does not show expenses; the Expenses tab does.
- **The journal's partner** (on bank rows) and the expense's partner are independent: attaching a bank row never copies one into the other (D33 spirit).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** An expense has an optional **partner** (a partner of the tenant, validated through the partners module when written: exists, active, of a type the picker allows — Q2). No FK across modules (constitution §2); expenses without one are valid. A per-diem expense never has one.
- **FR-002** `createExpense` / `updateExpense` accept the partner (set or clear). On update it is a **fact**, not a money fact: allowed in every state, audited with the field name the History shows.
- **FR-003** The **default category is proposed, never overwriting**: in the new-expense dialog, picking a partner sets the category to the partner's default only when the category is empty or was itself set by a previous partner's default; a category the owner chose is never replaced. The service does not apply defaults — what the dialog sends is what is saved.
- **FR-004** The **panel** shows the partner in *About* and lets the owner set / change / clear it in *Facts* (saved on change); it never changes the category.
- **FR-005** The **expenses list** (`EXPENSE_COLUMNS`) gains `partnerId` (enum filter) and `partnerName` (enum, searchable, sortable), shown by default after *Description*. Distinct values follow the Excel semantics with *(blank)*. The list search matches the partner name.
- **FR-006** A **read for the partner page**: `expensesForPartner(partnerId)` → the rows (as US3-3) and the totals (count, Σ base, any provisional) — the page composes it; the partners module does not import expenses.
- **FR-007** The partner page gets an **Expenses** tab with a count badge (US3), owner-only like the page; *Open in Expenses* deep-links the list with the Partner filter.
- **FR-008** The **picker** offers active partners of the allowed type(s) (Q2), searchable by name, with *none*; used by the dialog and the panel.
- **FR-009** The OCR merchant ↔ partner behaviour of the dialog (Q1).
- **FR-010** Unchanged, by test: the `Ex` key of an expense with a partner equals the key without one for the same group × category; the duplicate check's matches are the same with and without a partner; the lock trigger refuses the same changes as before and accepts a partner change on a settled expense.
- **FR-011** Strings in en / fr / sv (`expenses.partner*`, `partners.tab.expenses`).

### Key Entities

- **Expense** — gains *partner* (optional reference to a partner, by id). Nothing else changes.
- **Partner** — unchanged; read for its name, state, type and default category.
- **Spend per partner** — a read model (Σ base of the partner's expenses), never stored.

## Success Criteria *(mandatory)*

- **SC-001** An expense with a partner and the same expense without one get the same key, base, status and duplicate matches (one test per rule).
- **SC-002** On the fixture of US3, the list filtered on P and the partner page of P show the same count and the same Σ base, to the öre.
- **SC-003** The partner can be changed on an expense in each state (open, paid, partially refunded, refunded) and nothing else on the row changes.
- **SC-004** In the dialog, the category is never replaced once the owner has chosen it — across any sequence of partner picks (a component test walks the sequences of US1-1…4).
- **SC-005** Every existing expense test passes untouched (the column is optional).

## Assumptions

- The partner is picked from existing partners; a partner is created on the partners page or from the dialog's match card (Q1) — no free-text partner.
- Spend is shown in the base (SEK); per-currency subtotals are not shown on the partner tab (the list's footer rule covers currencies).
- No backfill: existing expenses start without a partner; the owner sets them in the panel when he wants (there is little data yet — B1).
- No partner on the trip / per-diem side, no partner default for the payer or the currency.
- Supplier invoices keep their own required supplier (`specs/supplier-invoices` FR-001) — not touched.

## Questions for the owner (one batch)

### Q1 — The OCR merchant vs the partner

When an expense is made from a receipt, the OCR gives a merchant name. What should the dialog do with it?

| Option | Answer | Implications |
|--------|--------|--------------|
| **A (recommended)** | The supplier dialog's match card: best partner from 60 % with *Use match*, else *New vendor* pre-filled from the merchant (and its address) | Same behaviour as supplier invoices, reuses `matchPartners` and the card; one click to attach or create; nothing is picked without a click |
| B | Match suggestion only (*Use match*), no *New vendor* | Partners are created only on the partners page; fewer one-off partners (a café you visit once never becomes one) |
| C | Nothing automatic: the plain picker, the merchant stays only in the description | Smallest build; spend per partner depends on the owner remembering to pick |

### Q2 — Which partners can be picked

| Option | Answer | Implications |
|--------|--------|--------------|
| **A (recommended)** | Vendors only (type `vendor`); a partner created from the dialog is a vendor | The picker stays short (no clients, no employees); matches supplier invoices' rule; a restaurant / airline / hotel is a vendor |
| B | Any active partner | Covers the odd case (lunch paid to a client's canteen), but the picker mixes clients and employees with merchants |
| C | Any active partner; picking a non-vendor adds the type `vendor` to it | Flexible, but a pick silently changes a partner's types |

### Q3 — What the partner page counts as spend

| Option | Answer | Implications |
|--------|--------|--------------|
| **A (recommended)** | Expenses only (the Expenses tab with its total) | What D49 asks; supplier invoices stay on their own list, filtered by supplier |
| B | A *Spend* tab: the partner's expenses **and** supplier invoices, one total in base plus a subtotal each | One number per merchant whatever the paper (an airline that sometimes invoices); reads a second module, a bit more to build and test |
