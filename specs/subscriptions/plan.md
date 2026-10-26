# Plan: Subscriptions — recurring costs described once (F94)

Spec: [spec.md](spec.md) (owner's read 2026-10-26: Q1 A · Q2 B · Q3 A · Q4 A, D57). FULL lane, schema change. Five code PRs, in order, each `feat/subscriptions-<topic>` from `main`; the shared files (`prisma/schema`, `kernel/nav/constants.ts`, the dictionaries) are serialised — before each PR that touches them, list the open PRs and their files (CLAUDE.md, roadmap *How we work*). Dictionary keys go in each PR's last commit.

```
PR1 schema        prisma/schema/subscriptions.prisma · migration · link kind     schema          (alone)
PR2 expenses      attachDocument / detachDocument (FR-012) · delete drops         i18n
                  occurrence_of (both modules)
PR3 core          modules/subscriptions: service, periods, state, matcher,         —
                  confirm, linkable · banking + documents read APIs
PR4 pages         /subscriptions list · panel · form · timeline · confirm         nav, i18n
                  dialogs · Confirm all exact · + New · Make it recurring
PR5 dashboard     the to-do item · search hits                                    i18n
(PR6, P3, later)  US7 — the match in the banking panel, linking inbox, review page  i18n
```

## Shape

```
prisma/schema/subscriptions.prisma
  enum subscription_becomes   { expense, supplier_invoice }
  enum subscription_cadence   { monthly, yearly }
  subscriptions        id · tenant_id · name (unique per tenant, ≤ 120) · partner_id uuid (validated, no FK)
                       · becomes · bas_code varchar(4) · group_id uuid FK → expense_groups (D38, Restrict)
                       · payment_source_id uuid (validated through expenses — not a FK, see Decisions)
                       · vat_registration_id uuid? (validated) · cadence · start_date date · end_date date?
                       · match_text varchar(100)? · tolerance_pct numeric(5,2) default 5 CHECK 0–50
                       · note? · created_at / updated_at / created_by / source
                       CHECK (end_date IS NULL OR end_date >= start_date)
  subscription_prices  id · tenant_id · subscription_id FK (Cascade) · valid_from date · valid_to date?
                       · amount numeric(15,2) CHECK > 0 · currency char(3)
                       EXCLUDE USING gist (subscription_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
                       — the contract-rates constraint, btree_gist already installed
  subscription_pauses  id · tenant_id · subscription_id FK (Cascade) · from_date · to_date · note (required)
                       CHECK (to_date >= from_date)
  RLS on all three (the tenant policy every table has)
migration 2026102…_add_subscriptions
  + links_kind_check gains 'occurrence_of'
  + CREATE UNIQUE INDEX links_occurrence_of_entity_key ON links(tenant_id, from_type, from_id)
      WHERE kind = 'occurrence_of'        — an entity is the period of at most one subscription
  additive only

src/modules/linking/
  types.ts           LinkKind + "occurrence_of"; LinkableType + "subscription"
  kinds.ts           MATRIX.occurrence_of = { from: [expense, supplier_invoice], to: [subscription] };
                     EXCLUSIVE_KINDS + "occurrence_of" (from side)
  linkables.ts       + subscriptions.subscriptionLinkable

src/modules/expenses/                                          (PR2)
  expenses.ts        attachDocument(expenseId, documentId) / detachDocument(expenseId)  — FR-012
                     deleteExpense: occurrence_of removed with created_from (through linking) before the row
  index.ts           + attachDocument, detachDocument (getGroup, getPaymentSource, findExpenseDuplicates
                     are already on it)
  components/expense-panel-*.tsx   *Attach receipt…* (the candidate-documents picker) when no document
src/modules/supplier-invoices/lifecycle.ts                     (PR2)
                     deleteSupplierInvoice: occurrence_of removed like created_from

src/modules/banking/queries.ts                                 (PR3, read API only)
  outgoingRowsInWindow(tx, { bankAccountIds, from, to }) → { id, bookingDate, amount, currency, amountBase,
                     texts[] (name, message, details, sender, recipient), journalPartnerId, noDocumentNeeded,
                     remaining }  — remaining through transactionStates; rows with nothing left are dropped
src/modules/documents/queries.ts                               (PR3, read API only)
  inboxFinancialFacts(tx, caller, { from, to }) → { id, key, vendorName, vendorVatNumber, total, currency, date,
                     prefixType } — inbox documents only (candidateDocuments' rule), OCR as corrected

src/modules/subscriptions/                                     (PR3 → PR5)
  types.ts           SubscriptionDto · PriceDto · PauseDto · Period · PeriodState · PeriodMark · RowMatch ·
                     DocumentMatch · ConfirmInput · ConfirmResult
  subscriptions.ts   create / update / delete / end · addPrice (closes the previous on valid_from − 1) ·
                     removePrice (not the first) · addPause / removePause · makeRecurring(entity)
                     — validation through partners (active vendor), settings (BAS active), expenses (group,
                     payment source; SI → company account only), settings (VAT registration)
  periods.ts (pure)  expectedDates(start, cadence, until) — month-end clamp; periodsOf(sub, prices, pauses,
                     today) → Period[] with expected date, price (pickRate's rule), windows, skipped
  state.ts (pure)    periodState(period, facts, today) → { state, marks }  — the US2-2 table, the one rule
  attribution.ts (pure) nearest-expected-date assignment of attributed entities (US2-5)
  matcher.ts (pure)  matchRow(period, sub, row, rateOnDay) · matchDocument(period, sub, doc, rateOnDay) ·
                     assignCandidates(periods, matches) — exclusivity, ambiguity flagged, never resolved
  facts.ts           the read side, one pass per page: the subscription(s), prices, pauses; the occurrence_of
                     links (linking.linksTouching); the entities' facts (expenses.getExpenses /
                     supplierInvoices statuses by id, documents via created_from); the window's rows and
                     documents; ECB rates (rates.rateToBase) for the cross-currency compares
  queries.ts         SUBSCRIPTION_COLUMNS + list / distinct (the DataTable contract); getSubscriptionDetail
                     (with periods); attentionCounts(tx, today)
  confirm.ts         confirm(tx, caller, { subscriptionId, periodDate, bankTransactionId?, documentId?,
                     overrides?, duplicateAck? }) — FR-008 in one transaction; confirmAllExact(…) → report
  linkable.ts        subscriptionLinkable { type, exists, summary (no amount) }
  subscriptions.actions.ts   reads on authedAction + can(read, subscription); writes on ownerAction
  search.ts          searchSubscriptionHits (F93's pattern, D56)                               (PR5)
  components/        subscription-table · subscription-panel (facts, prices, pauses, timeline) ·
                     subscription-form (new / edit / make recurring) · period-row · confirm-dialog ·
                     assign-row-dialog · assign-document-dialog                                 (PR4)
  index.ts / ui.ts
src/kernel/auth/can.ts     subject "subscription": owner ALL, accountant READ
src/kernel/nav/constants.ts *Subscriptions* in the costs group after Supplier invoices; + New → Subscription
src/app/(app)/subscriptions/page.tsx
src/modules/dashboard/overview.ts   + subscriptions item (FR-014)                          (PR5)
src/kernel/i18n/dictionaries/{en,fr,sv}.ts   subscriptions.* · expenses.attachDocument* · nav.* · dashboard.*
```

## Decisions (the agent's, written down)

- **A new module** (spec *Where it lives*): it calls expenses and supplier invoices, never the other way round. Import graph: `subscriptions → expenses, supplier-invoices, partners, settings, banking, documents, rates, linking`; nothing imports `subscriptions` except linking's registry (lazy) and the dashboard.
- **Only the group is a real FK.** `expense_groups` is the named shared reference (D38); `payment_sources` is not, so `payment_source_id` is a **validated UUID** (constitution §2, through `expenses.getPaymentSource`). Sources are deactivated, never deleted, so no dangling id.
- **The confirm is the subscriptions module's own dialog**, not the expense / supplier-invoice dialogs. The spec says "the owning module's dialog opens pre-filled"; the plan keeps the *content* (the merged facts — the receipt's / bill's first, the row's next, the subscription's for the rest — editable: date, amount, currency, VAT, description; for a bill also number, dates, net / VAT / total) but in one dialog and **one server action**, so creating the entity, attaching the row and writing `occurrence_of` are one transaction (FR-008). Opening the module's dialog would need a second action after its save — two transactions, a half-confirmed period on failure. The dialog shows the expense's duplicate matches (`findExpenseDuplicates`, exported) and the supplier-invoice number refusal like the modules' dialogs; *Create anyway* sends the same `duplicateAck`.
- **Deleting an entity drops its `occurrence_of`** (PR2, both modules): today any link but `created_from` blocks a delete; `occurrence_of` is an attribution, not proof, so it goes through `linking.removeLink` with `created_from` (amends D36's "only link" wording — the PR updates both specs' FR lines and D36's row with a note). The period returns to *due* (US2, US4-6).
- **No new link kind for "row matched to period"**: a match is computed; only the confirm writes (`justifies` by expenses' attach, `occurrence_of` by linking).
- **Two read APIs in their owner modules** (banking's `outgoingRowsInWindow`, documents' `inboxFinancialFacts`), the lessons' audit-22 pattern — the subscriptions module never reads another module's tables. `outgoingMainRows` is not reused: it has no text fields, no journal partner and no remaining.
- **One read pass per page** (`facts.ts`): the page loads all subscriptions, their links, the entities, and the rows / documents of the union of their windows once, then the pure functions do the rest — not a query per period. Windows are bounded by *today* and Q3's start dates, so the B1 backlog (≈ 3.5 years × a dozen subscriptions ≈ 500 periods) is one batch of reads; measured in PR3's test like F55.
- **Rates**: the cross-currency compare uses `rates.rateToBase(date, currency)`; no rate → the pair is *unknown*, never a match (spec Edge Cases).
- **The windows and the exact-match threshold are constants** in `periods.ts` / `matcher.ts` (`ROW_WINDOW = [-3, 7]`, `RECEIPT_WINDOW = [-10, 10]`, `EXACT_PCT = 0.5`) — not settings (CLAUDE.md *Don't add a setting*).
- **Search** (PR5): `searchSubscriptionHits` like F93's modules, so `Ctrl K` finds a subscription by name or vendor — small, and it keeps D56 true for a new module.

## Tests (test-conventions)

- `periods.pure.test.ts` — SC-004: fast-check over start date / cadence / end / pauses / prices: dates inside start…end, monthly one calendar month apart with the clamp (31 Jan → 28 Feb → 31 Mar), yearly on the anchor (29 Feb → 28 Feb), a pause removes exactly its periods, the price is the one valid on the date (the contract-rate fixture cases through the same `pickRate`).
- `state.pure.test.ts` — SC-003: the US2-2 table written out row by row (expense company-paid / private, supplier invoice unpaid / overdue / paid, with and without document, inside and after the windows, paused); a 200-run property: exactly one state, marks only on *due* / *documented*, deleting the entity's facts → *due*.
- `matcher.pure.test.ts` — US3-1…3, 7, 9 and US4-1: text in each field, the journal partner instead of the text, tolerance boundary (5 % in, 5.01 % out), cross-currency via the base, no rate → no match, window edges (−3 / +7, ±10), incoming rows never, a taken row never offered twice, two rows → ambiguous, a VAT number equal → certain.
- `subscriptions.test.ts` (DB, RLS) — US1 refusals (inactive vendor, private source for SI, BAS, group, dates, price, tolerance), prices close the previous / overlap refused by service **and** by the exclusion constraint (SQL), pauses over an attributed period refused, delete refused with entities, *Make it recurring* attributes the entity, another tenant sees nothing.
- `confirm.test.ts` (DB) — US3-4 (SEK row → expense with the row's facts, attached, `rate_source = bank`, `occurrence_of`), US3-5 (EUR on SEK card: refused without the receipt, then receipt + row in one confirm), US4-2 (bill → SI unpaid, `created_from`, due date from the partner's terms), US4-4 (receipt attached later to a charged expense, money facts unchanged), a duplicate refused / acknowledged, any module refusal rolls everything back (no link, no entity), *Confirm all exact* report. SC-005: the confirm-made expense / SI has the same key, base, rate source and duplicate matches as a hand-made one. SC-006: journal rows identical before / after.
- `no-writes.test.ts` (DB) — SC-002: import a fixture CSV + process documents with the mock OCR + every read (list, detail, attention counts, search) → zero new expenses, supplier invoices, links.
- `expenses.test.ts` + `supplier-invoices.test.ts` (PR2) — `attachDocument` (renamed, `created_from`, `document_missing` cleared, every state accepted, a document that already became something refused), `detachDocument` (back in the inbox), delete with `occurrence_of` accepted and the link gone.
- `banking/queries.test.ts`, `documents/queries.test.ts` — the two read APIs (window bounds, remaining, the inbox rule).
- `dashboard/overview.test.ts` — the item's counts; overdue SI periods not counted; the accountant's subset without it.
- e2e `e2e/subscriptions.spec.ts` (owns its data, deep links, `test.setTimeout(240_000)`): a vendor → a SEK expense subscription with *+ New group* → a CSV with the matching row imported → the period *match waiting* → *Confirm* → *charged — receipt missing* → upload the receipt → *Confirm* → *done*; a supplier-invoice subscription → a bill uploaded → *Confirm* → *documented* (unpaid); the accountant reads only. Screenshots in `e2e/screenshots.spec.ts` only for states the shot creates itself (lessons); the rest from the build into `specs/subscriptions/screenshots/` — list, panel with timeline, form, confirm dialog, the dashboard item; light + dark.

## Constitution check

New tables with RLS · cross-module references validated UUIDs, the only FK the D38 shared reference · no money fact stored (prices are expectations; every amount, base and rate is written by expenses / supplier invoices, once, as today) · no status stored (periods and states are read models) · `links` written only through linking · writes through `ownerAction` → service → `tx` with audit · no job, nothing assumes uptime · strings in en / fr / sv · `docs/subscriptions.md` (new, indexed), `docs/expenses.md`, `docs/supplier-invoices.md`, `docs/linking.md`, `docs/dashboard.md` updated in the PRs that change them · screenshots of the new page, its dialogs and the dashboard item.
