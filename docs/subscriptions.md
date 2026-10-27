# Subscriptions — recurring costs described once (F94)

Module `src/modules/subscriptions` · schema `prisma/schema/subscriptions.prisma` · migration `20261026200000_add_subscriptions` · spec `specs/subscriptions/` (spec, plan, tasks) · decision D57. Built: PR1 schema, PR2 the receipt after the expense + `occurrence_of`, PR3 the core (service, periods, state, matcher, confirm, actions), PR4 the page, PR5 the dashboard item and the search hits — P1–P2 complete. Left: PR6 (P3, US7) the match where the row or the receipt already is — after the owner has used the page on B1.

> A subscription describes a recurring cost once — vendor, what it becomes (expense or supplier invoice), BAS, group, payer, cadence, dated expected prices with a tolerance, pauses, end. It holds **expectations only**: every amount, base and rate is written by the expense / supplier invoice a confirm creates, through its own module. Periods and their state are computed on read, never stored. Nothing is created, linked or attached without the owner's click.

```
subscriptions          name (unique) · partner_id (validated: active vendor) · becomes ∈ expense | supplier_invoice
                       · bas_code (active, with a short code) · group_id (FK → expense_groups, D38; by default the
                       subscription's own batch group, Q2 B) · payment_source_id (validated; a bill: a company account)
                       · vat_registration_id? · cadence ∈ monthly | yearly · start_date (the anchor) · end_date?
                       · match_text? · tolerance_pct (0–50, default 5) · note?
subscription_prices    valid_from · valid_to? · amount · currency — non-overlapping (EXCLUDE, the contract-rate rule)
subscription_pauses    from_date · to_date · note (required)
links.occurrence_of    expense / supplier_invoice → subscription — one subscription per entity (partial unique index)
```

## Periods and their state — `periods.ts`, `state.ts`, `attribution.ts` (pure)

- **Expected dates**: monthly keeps the start date's day, clamped to a shorter month's last day (31 Jan → 28 Feb → 31 Mar, the clamp never sticks); yearly keeps day and month (29 Feb → 28 Feb). From the start date (Q3 A) up to the end date, and one beyond today (the next, *upcoming*).
- **Windows**: a bank row from −3 to +7 days of the expected date (`ROW_WINDOW`), a receipt / bill ±10 days (`RECEIPT_WINDOW`). The price is the one valid on the expected date (`kernel/clock/intervals` `pickInterval`, shared with contract rates).
- **Attribution**: an entity linked `occurrence_of` fills the period whose expected date is nearest to its date (a tie → the earlier period); two in one period → mark *two charges*.
- **State** (the first that applies): *skipped* (in a pause, nothing attributed) · *upcoming* (more than 3 days ahead and nothing arrived early) · with an entity: *done* (document and paid — paid as the owning module says; a private expense needs no payment) · *charged* (paid, no document) · *documented* (document, not paid — for a supplier invoice *to pay*, or *overdue* by its own status) · *due* (no entity, or one with neither). Never re-derived: *paid* / *overdue* are the owning module's words.
- **Marks**: *match waiting* (a row or document is offered) · *charge missing* (a company-paid expense period whose row window closed) · *receipt missing* (a charged period, or a private one, whose receipt window closed) · *bill missing* (a supplier-invoice period whose receipt window closed) · *overdue* · *two charges*. The first four are the to-dos.

## Matching — `matcher.ts` (pure), `facts.ts` (the one read pass)

- **A bank row** (expense subscriptions only, the payer's bank account): booked in the row window, the match text in any text field **or** the row's journal partner = the vendor (a banking rule already naming the vendor counts), the amount within the tolerance — in the subscription's currency, or the price converted into the row's currency at the ECB rate of the booking date (no rate → no match; never a base, F85). *Exact* = same currency, ≤ 0.5 %, found by the text. Hints, never blocking: the row's rule said *no document needed*; the journal's category differs.
- **A receipt / bill** (both kinds, an inbox document): dated in the receipt window, the vendor's VAT number equal (→ *certain*), else the match text or the vendor's name (partners' score ≥ 60) in the OCR vendor; the total within the tolerance when a currency was read (else kept, *amount unknown*).
- **Ambiguity**: an offer seen by two periods, or a period with two offers, is marked ambiguous on each — the owner picks; the app never resolves it.
- `loadSubscriptions(tx, caller, today, ids?)` reads everything once: the subscriptions with prices and pauses; references through their owners (`expenses.listPaymentSources` / `listGroups`, `partners.getPartner`); the attributed entities through `linking.linksTouching` and `expenses.expenseRowsByIds` / `supplierInvoices.supplierInvoiceRowsByIds` (new); the rows of the union of the row windows through `banking.outgoingRowsInWindow` (new) and the documents through `documents.inboxFinancialFacts` (new); the ECB rates the cross-currency compares need (`rates.rateToBase`, once each). Then the pure functions. No job, no cache, nothing stored.

## Rules vs subscriptions

They never write the same thing: a banking rule writes the bank row's facts (category, partner, *no document needed* — on the row since F113); a subscription creates the **expense / supplier invoice** through its module. The subscriptions module never writes the journal (SC-006, tested byte for byte). Salary and Skatteverket stay rules — no document, no entity.

**A subscription as a rule** (F116 PR C2, D67 — the rule shape now, the module's fate at F104 on 2026-11-30): *Make it a rule* on the panel (`subscriptionToRuleAction` → `toRule`, `to-rule.ts`) writes one banking rule from the subscription — its match text (contains, every text field), partner, category, paying account, *money out*, today's price ± its tolerance (capped at 50 %; no amount condition when the price is in another currency than the account's) and its cadence (a flag, never a condition). Refused without a match text or for a privately paid one (a private instrument has no rows). The subscription stays and keeps its periods; the rule categorises its rows on every import, and the rules page's *Needs a look* shows the off-price ones. One tolerance: the matcher's *exact* (`EXACT_PCT`) and a rule's default are the kernel's `MATCH_TOLERANCE_PCT` (0.5 %); the matcher keeps its own period windows and cross-currency comparison — the part a rule does not do.

## The confirm — `confirm.ts`

`confirmPrefill(…)` (read): the merged facts — the receipt's / bill's (OCR as corrected) first, else the row's (an expense in the row's currency), the subscription's for the rest — the expense duplicates, *waiting for* (receipt / bill). `confirm(…)` (owner, one transaction): a period with its entity is **completed** (`expenses.attachDocument` for a charged expense — US4-4; `expenses.attachBankTransaction` for a documented one); otherwise the entity is **created** — an expense through `createExpense` (+ `attachBankTransaction` when a row is given; a high duplicate refuses unless acknowledged), a supplier invoice through `createSupplierInvoice` from its bill (the number required, D35's refusal passes through; created unpaid — its payment is the supplier invoice's own flow, US3-6) — and `occurrence_of` is written through linking. **Q1 A**: a row in another currency than the subscription's never creates an expense on its own, not even with typed facts — the receipt's amount is the expense's (D26). Any refusal after the first write rolls the whole confirm back. `confirmAllExact` confirms every expense period whose only offer is one exact, unambiguous row (with its receipt when one is offered and certain) and reports the rest.

## Service — `subscriptions.ts`

`createSubscription` (refs validated; `newGroup` creates the batch group in the same transaction; the first price from the start date) · `updateSubscription` (facts for future confirms; `becomes`, cadence and start are the subscription itself) · `deleteSubscription` (refused once anything is attributed — *end it instead*) · `addPrice` (closes the previous on `valid_from − 1`; never before the start or on / before an existing start) · `removePrice` (the latest only, never the last) · `addPause` (refused over a period that has an entity) · `removePause` · `makeRecurring` (create + attribute the entity) · `detachOccurrence`. Everything audited. Actions: reads on `authedAction` + `can(read, subscription)` (the accountant reads), writes on `ownerAction`.

## Owner-module changes it made

- linking: kind `occurrence_of`, type `subscription`; `EXCLUSIVE_SIDES` — `occurrence_of` is exclusive on the entity only (a subscription has many periods).
- expenses: `attachDocument` / `detachDocument` (FR-012) and the panel's *Attach receipt* / *Remove receipt*; `expenseRowsByIds`; a delete drops `occurrence_of` like `created_from`.
- supplier invoices: `supplierInvoiceRowsByIds`; a delete drops `occurrence_of`.
- banking: `outgoingRowsInWindow`. documents: `inboxFinancialFacts`. contracts: `pickRate` over the kernel's `pickInterval`.

## The page — `/subscriptions` (PR4, the D40 kit)

- **List** (`SubscriptionTable`, DataTable on `SUBSCRIPTION_COLUMNS`): name, vendor, becomes (a tag), cadence, next expected date, expected amount (`formatMoney`), the current period's state (`PeriodStateLabel` — icon + word through `state-family.ts`, marks after: *Due · to confirm*), *To do* (a count badge), payer; hidden by default: category, group, start, end, active, currency. `?open=<id>` opens a panel, `?new=1` the form (the sidebar's **+ New → Subscription**), `?new=1&from=expense:<id>` / `supplier_invoice:<id>` the form pre-filled from that entity (*Make it recurring*, in the expense and supplier-invoice panels).
- **Title row**: *Confirm all exact* (secondary; a toast says confirmed / left) and *New subscription* (the one primary).
- **Form** (`SubscriptionFormDialog`): vendor first — it proposes the category, the currency, the name and the match text, never over the owner's choice (D49's rule, a component test walks it); becomes; paid by (a supplier invoice: company accounts only); category; group (*New group: {name}* by default, Q2 B, or an existing one); cadence; first charge / end; expected amount + currency; tolerance; match text; VAT registration (bills); note.
- **Panel** (`SubscriptionPanel`, docked): title = name + the current state, the next expected amount; **Periods** (`PeriodRow`, newest first): date, expected price, state + marks, the entity as a key chip (→ its panel), the rows and receipts / bills found (how far off, *converted at ECB*, *also offered elsewhere*, the two hints, *VAT number matches*) with a radio when there are several, **Confirm** (→ `ConfirmPeriodDialog`), *Assign a row…* / *Assign a receipt…* (→ `AssignDialog`, then the confirm), *Detach*; **About**; **Prices** (a new price from a date, the latest removable); **Pauses** (from / to / why); **For the next confirms** (match text, tolerance, note, saved on blur); *End subscription* / *Reopen*, *Delete* (`ConfirmDialog`; refused once a period has an entity).
- **Confirm dialog**: the prefill (`confirmPrefillAction`) as editable fields — date, amount (currency shown), description, VAT; a bill also net, number, due date; *waiting for the receipt / bill* as a banner (the button stays disabled, Q1 A); a high duplicate needs a note; a period with its entity shows *Complete {key}* and what will be attached.
- Nav: *Subscriptions* in the costs group after Expenses (owner + accountant); `can(read, subscription)` for the accountant, every write `ownerAction`. Strings `subscriptions.*` (en / fr / sv).

Screenshots: `specs/subscriptions/screenshots/{list,panel,confirm,form}-{light,dark}.png` (seed data, from the build); `e2e/screenshots.spec.ts` shoots `/subscriptions` and `/subscriptions?new=1` on `main`.

## The dashboard and the search (PR5)

- Dashboard to-do: one item *n subscription period(s) need you — x to confirm · y charge(s) missing · z receipt(s) / bill(s) missing* (`subscriptions_attention`, medium), the owner's only; it opens the list filtered on *To do* ≥ 1.
- `Ctrl K`: `searchSubscriptionHits` — by name, match text, the vendor's name, or any expected price (any amount format); the hit opens the panel (`?open=`).

## Tests

`periods.pure.test.ts` (SC-004: month ends, leap years, the clamp, properties — dates inside start…end, one calendar month apart, a pause skips exactly its periods) · `state.pure.test.ts` (SC-003: the state table written out row by row, a 200-run property, attribution) · `matcher.pure.test.ts` (each text field, the journal partner, the tolerance and exact boundaries, the windows, cross-currency, VAT certain, ambiguity) · `schema.test.ts` (DB: CHECKs, the exclusion, one `occurrence_of` per entity, the group FK, RLS) · `subscriptions.test.ts` (DB: US1 refusals, + New group, prices, pauses, delete / end, states from real entities, *Make it recurring*, RLS) · `confirm.test.ts` (DB: a SEK row → expense attached; Q1 A on a EUR subscription; the receipt after the charge; *Confirm all exact*; a bill → supplier invoice unpaid; a row never makes a supplier invoice; D35 refusal writes nothing; SC-002 no writes from import, receipts or reads; SC-005 the key; SC-006 the journal untouched) · `banking/window-rows.test.ts`, `documents/inbox-financial-facts.test.ts`, `expenses/attach-document.test.ts` · `state-family.pure.test.ts` · `components/subscription-form-dialog.test.tsx` (the vendor's proposal never over the owner's choice; a bill offers company accounts only) · `search.test.ts` (name, vendor, match text, amount formats; tenant wall; the accountant reads) · `dashboard/subscriptions-item.test.ts` (none / one item with its counts / not the accountant's) · `e2e/subscriptions.spec.ts` (a vendor → a subscription with + New group → the card row imported → *to confirm* → one *Confirm* → the expense `Ex…-IT-01`, *Charged*; the accountant reads only).
