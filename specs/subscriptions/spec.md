# Feature Specification: Subscriptions — recurring costs described once (F94)

**Feature Branch**: `feat/subscriptions-spec` (this docs PR: spec → after the owner's read, plan → tasks) · the build: `feat/subscriptions-*` PRs in a new module `modules/subscriptions` (schema first and alone)

**Created**: 2026-10-26

**Status**: Ready for build — read by the owner 2026-10-26: Q1 A · Q2 B · Q3 A · Q4 A (D57); [plan.md](plan.md), [tasks.md](tasks.md).

**Input**: the owner, 2026-10-26: "Most company-card charges are monthly or yearly online subscriptions (SaaS, hosting, tools), in SEK, CHF or EUR. Every period I repeat the same steps: the receipt PDF arrives, I upload it, *Make it…* expense or supplier invoice with the same vendor, BAS, group and currency, then link the bank row. I want to describe a subscription once and have the app do the repetitive part." — and on Q4: "I have some recurring costs that are monthly supplier invoices (my accounting company charges me every month) and I pay this invoice via e-banking (not with the card, but transfer); the shared office invoices are monthly too; Skatteverket and the salary are also recurring monthly things I pay."

**Replaces / defers to** (lessons: *a spec that overrides another module's rule cites it*):
- **Extends** `specs/expenses/spec.md` US1-4 / FR-003: an existing expense can receive its receipt **after** creation (today only `createExpense({documentId})` writes the `created_from` link) — FR-012 here. Nothing else in expenses changes.
- **Extends** `modules/linking` `kinds.ts`: a new link kind `occurrence_of` (expense / supplier invoice → subscription) — FR-005. The scorer, the suggestions and the inbox are **not** changed in P1.
- **Defers to** D37 (an expense / supplier invoice is a draft until its first payment, then locked), D26 / D-g (a card-FX charge: the receipt's amount in its currency, the bank row's base, `rate_source = bank`), D28 (`SI` keys share the per-group counter), D35 (a supplier's invoice number is unique), D49 / D50 (the expense's optional vendor partner; nothing picked without a click), D54 (reverse charge is the document's flag, untouched), `specs/supplier-invoices` FR-001 (an invoice number is required) and FR-004 (*Copy last* stays as it is).
- **Defers to** `specs/banking` FR-007 / FR-008: categorisation rules stay the **only** thing that writes a bank row's journal entry (category, partner, *no document needed*). A subscription never writes the journal — FR-010. Salary and Skatteverket stay **rules** (`specs/banking` *Assumptions*: recurring journal templates are rules with *no document needed*) — they have no document and become no entity, so they are not subscriptions.
- **Defers to** `specs/supplier-invoices` US2 / FR-004 and `specs/linking` FR-003: a supplier invoice's **payment** (by transfer or card) is linked through its own flow — *Link payment*, the linking inbox's suggestions (the scorer weighs the invoice number in the transfer message). The subscriptions module matches bank rows for **expense** subscriptions only.
- **Corrects a premise**: the linking scorer does **not** weigh "subscription" — it is in `GENERIC_WORDS` (too common to tell receipts apart, `linking/scoring.ts`); description words weigh 15. The subscription's matcher (FR-007) is its own, because it answers another question (which expected period does this row fill, before any entity exists); once the entity exists, the scorer is untouched.

```
                 ┌ Subscription "Tabula Pro" ───────────────────────────────┐
 described once  │ vendor Tabula · becomes expense · 6540 (IT) · group 220  │
                 │ paid from AF SEK (card) · monthly from 2026-01-14        │
                 │ price 20.00 EUR from 2026-01-14 · 22.00 EUR from 2026-09 │  expectations only,
                 └───────────────┬──────────────────────────────────────────┘  never a money fact
                                 │ derived on read (nothing stored)
              ┌──────────────────┼───────────────────┐
              ▼                  ▼                   ▼
        period 2026-09      period 2026-10      period 2026-11
        ✓ done              ◐ charged           ○ upcoming
                            │
     bank row 2026-10-15 ───┤ match: text + amount ± tolerance + date window
     −253.40 SEK            │      → suggestion  [Confirm]  (one click, never automatic)
     receipt TAB-10-2026 ───┘      → Make it… pre-filled from the subscription + the OCR
                                   → expense Ex220-IT-10 ─created_from→ receipt
                                     bank row ─justifies→ expense   (attach, D26)
                                     expense ─occurrence_of→ subscription

 a bill (supplier invoice) — paid later by transfer, through the supplier-invoice flow:
   bill "Siffra Redovisning" Oct ──► [Confirm] ──► SI221-Acc-10 ─created_from→ bill
                                                   SI ─occurrence_of→ subscription
   transfer −1 500.00 SEK "Faktura 4711" ──► Link payment / linking inbox (as today) ──► paid
```

## Where it lives — a new module, not expenses

`modules/subscriptions` (module-slice). Justified against putting it in expenses: (1) a subscription becomes **either** an expense or a supplier invoice — `supplier-invoices` already imports `expenses` (groups, the group picker), so expenses creating supplier invoices would make the two modules import each other; (2) it owns three tables of its own (the subscription, its dated prices, its pauses) and a page; (3) it only *calls* the owners' services (`createExpense`, `attachBankTransaction`, `attachDocument`, `createSupplierInvoice`, `createGroup`) through their `index.ts`, so no rule of expenses or supplier invoices is written twice.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Describe a subscription once (Priority: P1)

The owner opens **Subscriptions → New**. He picks the vendor *Tabula* (a partner of type vendor); its default category *6540 IT-tjänster (IT)* and currency EUR are proposed (never overwriting what he typed, D49's rule). He sets: becomes **expense**, group **+ New group** — pre-named *Tabula Pro*, created as group *220* on save (Q2 → B: one group per subscription) —, paid from **AF SEK** (the company card on the SEK account), **monthly** from 2026-01-14, price 20.00 EUR, tolerance 5 %, match text `TABULA`. Saved: the list shows *Tabula Pro · monthly · next 2026-11-14 · 22.00 EUR expected*. A second one, *Siffra Redovisning* (the accounting firm), becomes a **supplier invoice**: a monthly bill from 2023-04-30, 1 500.00 SEK, paid by transfer from AF SEK, its own group *221 — Siffra Redovisning*. A third, *Hostberg* hosting, a yearly CHF supplier invoice from 2025-03-02, paid from AF CHF.

**Why this priority**: everything else is derived from this description.

**Independent Test**: create both through the service; read them back with their prices; the next expected dates are computed from the start date and cadence; the partner's defaults were proposed, not forced.

**Acceptance Scenarios**:

1. **Given** the form with no category **When** a vendor with a default category is picked **Then** the category is proposed (*from partner*); a category the owner chose is never replaced; the same for the currency.
2. **Given** becomes *supplier invoice* **Then** the payer must be a company account (AF SEK / AF CHF); a private source is refused (*A supplier invoice is paid from a company account*). **Given** becomes *expense* **Then** any of the four payment sources is allowed. **Given** *+ New group* **Then** a *batch* group named after the subscription is created with it (`expenses.createGroup`); an existing group can be picked instead (two subscriptions may share one — the default is not a rule).
3. **Given** a partner that is not an active vendor, an unknown or inactive BAS code, an unknown group, an end date before the start date, a price ≤ 0, a tolerance outside 0–50 % **Then** refused with the matching message.
4. **Given** no match text **Then** saved; matching then relies on the bank row's journal partner (US3-3) and the receipt's vendor (US4-1). The form pre-fills the match text with the vendor's name.
5. **Given** an existing expense or supplier invoice **When** the owner chooses *Make it recurring* in its panel **Then** the form opens pre-filled from it (vendor, becomes, category, group, payer, cadence monthly, start = its date, price = its amount and currency) and, on save, that entity becomes the subscription's first period (`occurrence_of`).
6. **Given** the accountant **Then** he sees the list and the periods, and cannot create or change anything.

---

### User Story 2 - The periods and their state, derived (Priority: P1)

The subscription's page shows its periods as a timeline (newest first): *2026-11 ○ upcoming · 2026-10 ◐ charged — receipt missing · 2026-09 ✓ done · …*. Nothing about a period is stored; each state is recomputed from what exists — the expected date, the entity attributed to the period, its payment link and its document. Deleting the October expense puts October back to *due*.

**Why this priority**: "statuses are derived, never typed" — the period's state is the one thing the owner reads every month.

**Independent Test**: for a fixture subscription, create / link / delete the facts in every combination and read the state of each period — a pure state function over the facts, plus one DB test per state.

**Acceptance Scenarios**:

1. **Given** a monthly subscription from 2026-01-14 **Then** its expected dates are the 14th of each month from January; anchored on the 31st, a shorter month uses its last day (2026-02-28); yearly from 2025-03-02 → every 2 March.
2. **Given** a period **Then** its state is the first that applies:
   - *skipped* — its expected date falls in a pause (US5-3);
   - *upcoming* — today is before its window (expected date − 3 days);
   - *done* — the attributed entity has its document **and** is paid (an expense: its payment link when paid from a company account; a supplier invoice: its own derived status `paid`);
   - *charged* — the entity is paid, no document (*receipt missing*; an expense made from its row);
   - *documented* — the entity has its document and is not paid yet (an expense: *charge missing*; a supplier invoice: *to pay*, or *overdue* when its own status says so);
   - *due* — no entity yet.
   A private-paid period has no bank row to wait for: document = *done*. The period never re-derives *paid* or *overdue*: it reads the owning module's status (`specs/supplier-invoices` FR-003, `specs/expenses` FR-005).
3. **Given** a *due* period with a matching bank row or receipt not yet confirmed (US3, US4) **Then** it carries a **match waiting** mark with what was found — a mark, not another state.
4. **Given** a *due* or *documented* period whose window has closed (expected date + 7 days) with no matching row **Then** it reads *charge missing*; a *charged* period whose window has closed reads *receipt missing*, and so does a private-paid *due* one; a supplier-invoice *due* period whose receipt window has closed (expected date + 10 days) reads *bill missing* — these are the to-dos (US6). A supplier-invoice period never reads *charge missing*: its payment is the supplier invoice's (*overdue*, already a dashboard item).
5. **Given** an entity attributed to the subscription **Then** it belongs to the period whose expected date is nearest to its date (expense date / invoice date; a tie goes to the earlier period). Two entities in one period → both shown, the period flagged *two charges*.
6. **Given** the subscription list **Then** each row shows the current period's state, the next expected date and the expected amount.

---

### User Story 3 - A card row fills an expense period — one confirm (Priority: P1)

The October SEK CSV is imported. For the SEK subscription *Byteform* (paid from AF SEK, 199.00 SEK expected on the 15th) the row *2026-10-16 −199.00 SEK BYTEFORM AB* matches its October period. On the subscriptions page the period shows *match waiting* with the row; **Confirm** creates the expense pre-filled from the subscription (vendor, category, group, payer, description = the subscription's name) with the row's amount, currency and booking date, attaches the row (D26: `justifies`, the row's base, `rate_source = bank`) and links the expense `occurrence_of` the subscription — one click, one transaction. October reads *charged — receipt missing* until the receipt comes (US4-4).

**Why this priority**: it is the repetitive step the owner named.

**Independent Test**: import a fixture CSV with one matching row per kind of case; the suggestions; confirm; read the expense (facts, base, key), its links and the period's state; nothing was created before the confirm.

**Acceptance Scenarios**:

1. **Given** an outgoing main-account row on the subscription's account, not justified by anything, **whose text matches** and **whose amount is within the tolerance** and **whose booking date is in the window** (expected date − 3 … + 7 days) **Then** it is the period's match. The amount is compared in the subscription's currency when the row's currency is the same; otherwise the expected price is converted at the ECB rate of the booking date and compared with the row's base.
2. **Given** the text test **Then** the match text is searched (contains, case-insensitive) in every text field of the row (name, message, details, sender, recipient).
3. **Given** a row whose journal entry already names the subscription's vendor as its partner (set by a banking rule or by hand) **Then** the text test passes without the match text — the rules the owner already has help, they are not duplicated.
4. **Given** an **expense** subscription and a row **in the subscription's currency** **When** confirmed **Then** the expense is created with the row's amount, currency and booking date (bank facts, not the expectation), attached to the row, linked `occurrence_of`; the duplicate check of expenses runs as for any new expense (a high match blocks, as there).
5. **Given** a row in **another currency** than the subscription's (a EUR subscription on the SEK card) **Then** the receipt's amount is the expense's amount (D26), so the confirm needs the receipt: the period shows *charged on the bank — waiting for the receipt* and **Confirm** is offered once the receipt is matched too (US4-3) — Q1 → A: nothing is created from an expected amount.
6. **Given** a **supplier-invoice** subscription **Then** its periods are not matched against bank rows here: the invoice number comes from the bill (required and unique, `specs/supplier-invoices` FR-001, D35), so a row alone never creates one, and once the supplier invoice exists its payment — a transfer with the invoice number in the message, or a card — is linked through the supplier-invoice flow (*Link payment*, the linking inbox's scored suggestions), unchanged.
7. **Given** two rows match one period, or one row matches two subscriptions **Then** nothing is preselected: the period lists the candidates and the owner picks one; a row taken by one period is no longer offered to another.
8. **Given** **Confirm all exact (n)** on the page **Then** every period whose only candidate is an exact match (same currency, amount within 0.5 %, the text matched) is confirmed in one action, reporting confirmed / skipped with the reason; the others stay for one-by-one confirmation.
9. **Given** a row outside the tolerance (the price changed) **Then** it is not a match; the period offers **Assign a row…** (the outgoing rows of the window, any amount); assigning confirms like a match and then offers **New price from {date}** (US5-1).

---

### User Story 4 - A receipt fills its period (Priority: P1)

The October receipt of *Tabula* is uploaded (a bill for a supplier-invoice subscription works the same way); OCR reads the vendor *Tabula GmbH*, its VAT number, 22.00 EUR, 2026-10-14. The subscription's October period shows the receipt as found. **Confirm** opens the expense dialog pre-filled from the subscription **and** the receipt (the receipt's facts win: amount, currency, date, VAT), with the document selected; one click creates the expense `created_from` the receipt, attaches the October row when it was found too, and links `occurrence_of`. For *Siffra Redovisning* the October bill does the same with the supplier-invoice dialog: number, dates, net / VAT / total from the OCR, the due date from the partner's terms, the rest from the subscription; the transfer that pays it later is linked as any supplier invoice's (US3-6).

**Acceptance Scenarios**:

1. **Given** an uploaded financial document that became nothing **Then** it is a candidate for a subscription when its OCR vendor matches the subscription's vendor (the partners' match from 60 %, a VAT number equal → certain) **and** its date is within the period's receipt window (expected date − 10 … + 10 days) **and**, when OCR read a currency, its total is within the tolerance (in its own currency against the price of that currency, else converted as in US3-1).
2. **Given** a period with a receipt candidate and no entity **When** confirmed **Then** a confirm dialog opens with the owning module's fields pre-filled (one dialog, one transaction — plan *Decisions*) — the OCR facts as corrected on review win over the subscription's expectations; the subscription fills what the document does not carry (category, group, payer, partner, VAT registration) — and saving creates the entity from the document (`created_from`, D27) and `occurrence_of`.
3. **Given** an **expense** period whose row was matched too (US3-5) **Then** the same save attaches it (attach, D26) — receipt and charge in one confirm. A supplier invoice is created unpaid; its payment follows later (US3-6).
4. **Given** a period already *charged* (its expense made from the row, US3-4) **When** the receipt is confirmed **Then** the receipt is attached to that expense (FR-012): `created_from`, the document renamed with the expense's key; the expense's money facts are not touched (the bank's are the facts); the period becomes *done*.
5. **Given** a receipt whose OCR amount differs from the attached expense beyond the tolerance (the row was not this subscription's) **Then** confirm warns and the owner can still attach or reassign.
6. **Given** the document is deleted, or the entity deleted (D36 returns the document to the inbox) **Then** the period's state follows on the next read.

---

### User Story 5 - Price changes, pauses, the end (Priority: P2)

*Tabula* raised its price to 22.00 EUR from September: a **new price from 2026-09-14** — like a contract rate, the previous price closes the day before, overlaps refused. The owner pauses *Byteform* for July–August (no charge expected, not a to-do), and ends *Hostberg* on 2027-03-01 (no period after).

**Acceptance Scenarios**:

1. **Given** prices 20.00 EUR from 2026-01-14 and 22.00 EUR from 2026-09-14 **Then** each period expects the price valid on its expected date; a new price closes the previous on `valid_from − 1`; a second price on the same day or overlapping is refused (the contract-rate rule, `specs/contracts`, D24's shape).
2. **Given** a price change **Then** periods already confirmed keep their entities untouched — prices are expectations, the entity's facts are the bank's or the receipt's.
3. **Given** a pause from 2026-07-01 to 2026-08-31 **Then** the periods expected in it are *skipped* (shown, not to-dos); a pause of one period is how a single month is skipped; a pause needs a note. A period with an entity cannot be paused (*This period already has an expense*).
4. **Given** an end date **Then** no period is expected after it; an ended subscription is listed under *Ended*, its periods still readable. Reopening = clearing the end date.
5. **Given** the category, group, payer or match text changed **Then** only future confirms use the new values; existing entities keep theirs.
6. **Given** a subscription with attributed entities **When** deleted **Then** refused (*End it instead*); one with none is deleted (audited).
7. **Given** a different cadence (monthly → yearly) **Then** the owner ends the subscription and starts a new one from the date — no cadence history.

---

### User Story 6 - The dashboard to-do (Priority: P2)

The dashboard's to-do list gains one item, **Subscriptions — n periods need attention** (*to confirm · charge missing · receipt or bill missing*), opening the subscriptions page filtered on them.

**Acceptance Scenarios**:

1. **Given** periods with *match waiting*, *charge missing*, *receipt missing* or *bill missing* **Then** the item shows their count with the three counts in its hint (receipt and bill counted together); medium priority; none → no item. An *overdue* supplier-invoice period is not counted here — the dashboard's *supplier invoices overdue* item already is (no double count).
2. **Given** a *skipped* or *upcoming* period **Then** it is not counted.
3. **Given** the accountant **Then** the item is not in his subset (the owner confirms; the package already flags what is missing).

---

### User Story 7 - The match where the row or the receipt already is (Priority: P3)

The owner works in the linking inbox or on a document's review page rather than on the subscriptions page. On a bank row matched to a period, the panel shows *Subscription Byteform · 2026-10 — Create & link*; on a receipt's review page, *Make it… → From subscription Tabula (2026-10)*. Both run the same confirm as US3 / US4.

**Acceptance Scenarios**:

1. **Given** a row with a subscription match **Then** the banking panel and the linking inbox show it above the scored suggestions; the same confirm; `Enter` does not apply it (a creation is never one key in the inbox).
2. **Given** a receipt with a subscription match **Then** the review page and the documents inbox offer *From subscription …* first among *Make it…*.

---

### Edge Cases

- **Nothing happens without a click** (the owner's question): no entity is created, no row linked, no receipt attached by the app on its own — not at import, not by a job. Why: (1) the first payment link locks the money facts (D37), so a wrong automatic confirm is only undone by deleting, and an automatic one could lock a charge that belonged to another subscription; (2) D50 Q1 set the house rule "nothing picked without a click", and *Apply HIGH* is a click too; (3) a double charge, a refund or a price change looks like a match to a machine and like a question to the owner. What happens without a click is **reading**: the matches, the states and the to-dos are computed when a page asks — no job, no stored state, nothing that assumes the box is up. *Confirm all exact* (US3-8) keeps the routine at one click a month.
- **Rules and subscriptions — which wins**: they never write the same thing. A banking rule writes the bank row's **journal entry** (category, partner, *no document needed*); a subscription creates the **business entity** (expense / supplier invoice) with its own category. A subscription never categorises a journal entry; a rule never creates an entity — there is one categorisation path per object. When they disagree (the row's journal category ≠ the subscription's), the period shows both as a hint and changes nothing; when a rule marked a subscription's row *no document needed*, the period warns (*Rule R says no receipt is needed — this subscription expects one*): the receipt is what the accountant files, so the rule is the thing to fix.
- **Salary, Skatteverket**: recurring, but no document and no entity — banking rules with *no document needed*, as today, not subscriptions. A month whose salary or tax row is missing is not detected (a later row if wanted).
- **A supplier-invoice subscription paid by card** (some bills are): the same — the supplier invoice is created from the bill, its card row attached through the supplier-invoice flow (*attach payment*, D26 / D-g).
- **A refund from the vendor** (incoming row) is never a match (outgoing rows only); it is linked by hand like today.
- **A charge already justified** (linked by hand to an expense before the subscription existed) is not a candidate; *Make it recurring* (US1-5) on that expense attributes it.
- **A private-paid subscription** (a private card): no bank row is expected; the period is *due* until the receipt, *done* after; the expense joins the owner's liability as any private expense.
- **A yearly subscription charged in another month than its start** — the anchor is the first charge's date, not a calendar month: started 2025-03-02, it is expected every 2 March. A vendor that moves the renewal day for good is ended and started again from the new day (rare); the windows (−3 … +7 days, receipts ±10) absorb booking lags.
- **The first period's charge is prorated** (a different amount): outside the tolerance → *Assign a row…* (US3-9), no new price offered when the next period is back to normal.
- **A price in another currency than before** (the vendor switches billing to SEK): a new price row carries its own currency.
- **A cross-currency row with no ECB rate on its day**: compared as *unknown*, never a match; *Assign a row…* stays available.
- **The `Ex` / `SI` key**: the subscription changes nothing — the key comes from the group × category alias at creation (`specs/expenses` FR-003, D28).
- **Reverse charge** (D54): the flag comes from the document, as for any entity made from it; the subscription carries no VAT treatment.
- **The duplicate checks** of expenses (fuzzy ±1 % / ±7 days) and supplier invoices (the number, D35) run on every confirm; monthly periods are ~30 days apart, so they do not collide.
- **The package**: unchanged — the entities are ordinary expenses and supplier invoices; the subscription is not exported.
- **The linking graph**: `occurrence_of` edges show the subscription in the centre with its entities one hop away.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** A **subscription**: `name`, `partner` (an active vendor, validated through partners — a UUID, not a cross-table FK), `becomes ∈ expense | supplier_invoice`, `bas_code` (validated through settings), `expense group` (the shared reference `expense_groups`, D38; by default its own *batch* group named after the subscription, created with it — Q2 → B), `payment source` (expenses' four; a supplier-invoice subscription only the company-account ones), `vat_registration?` (supplier invoices), `cadence ∈ monthly | yearly`, `start_date` (the anchor), `end_date?`, `match_text?`, `tolerance_pct` (0–50, default 5), `note?`. It holds **no money fact of record**: no base, no rate.
- **FR-002** **Prices**, dated: `valid_from`, `amount` (> 0, 2 dp), `currency` — an expectation. At least one, the first valid from the start date; the contract-rate rule: a new price closes the previous on `valid_from − 1`, overlaps refused, the price of a period = the one valid on its expected date.
- **FR-003** **Pauses**: `from`, `to`, `note` (required); a period whose expected date falls in a pause is *skipped*; a pause over a period that has an entity is refused.
- **FR-004** **Periods are computed, never stored**: from the start date and the cadence (day-of-month clamped to the month's last day), up to the end date or today + one period; each with its expected date, its expected price, its row window (−3 … +7 days) and receipt window (±10 days); the state of US2-2 and the marks of US2-3 / US2-4, from the facts only.
- **FR-005** **Attribution is a link**: kind `occurrence_of`, from `expense` / `supplier_invoice` to `subscription`, exclusive on the `from` side (an entity is the period of at most one subscription); written only through the linking service, by the subscriptions module's confirm and *Make it recurring*; removed with the entity (deleting an expense / supplier invoice removes its links as today) or by *Detach from subscription* in the period. The period of an attributed entity = the nearest expected date (US2-5).
- **FR-006** `subscription` is a **linkable** (label `Tabula Pro · monthly · 22.00 EUR`, no amount — it allocates nothing), so the graph and the entity panels can show it.
- **FR-007** The **matcher** (pure): for an **expense** subscription a row matches a period by US3-1…3 (text or journal partner · amount within the tolerance in the subscription's currency, or via the ECB base · booking date in the window · outgoing, main account of the payer, not justified); a document (receipt or bill) matches a period of either kind by US4-1. Supplier-invoice periods are never matched against rows (US3-6). Candidates already taken by another period are excluded; ambiguity is shown, never resolved by the app (US3-7).
- **FR-008** The **confirm** (one owner action, one transaction): creates the entity through its module's service with the facts in this order — the receipt's (as corrected on review), else the row's (expense, same currency only), else none (refused: *waiting for the receipt*); fills the rest from the subscription; for an expense, attaches the row when one is matched (`expenses.attachBankTransaction`, D26, D37 / F58's `OWN_PAYMENT_FLOW`); a supplier invoice is created unpaid (its payment is its module's, US3-6); writes `occurrence_of`; audits. Any refusal of the owning module (duplicate, no rate, …) refuses the whole confirm. *Confirm all exact* (US3-8) runs it per period and reports.
- **FR-009** **Assign a row…** (expense periods) **/ Assign a receipt…** (both kinds) for a period: the window's outgoing rows / the unlinked documents, whatever the amount; then the confirm; after a row outside the tolerance, *New price from {date}* pre-filled with its amount.
- **FR-010** **No journal writes**: the subscriptions module never categorises a journal entry and never creates or changes a banking rule. It reads the journal partner of a row (FR-007) and shows a disagreement or a *no document needed* conflict as a hint (Edge Cases).
- **FR-011** **Make it recurring** in the expense and supplier-invoice panels: opens the new-subscription form pre-filled from the entity; on save, the entity is attributed (FR-005).
- **FR-012** **expenses — attach a receipt later**: `attachDocument(expenseId, documentId)` on an expense that has no `created_from` document: writes `created_from` through linking (one origin per document), renames the document with the expense's key (`documents.assignBusinessKey`), clears `document_missing`; allowed in every state (the document is not a money fact); audited; `detachDocument` reverses it (the document back in the inbox, D36's rule). Usable from the expense panel too, not only from subscriptions.
- **FR-013** **Pages**: `/subscriptions` — the list (name, vendor, becomes, cadence, next expected date, expected amount, current period's state; filters *Active / Ended*, state) with the side panel (facts, prices, pauses, the period timeline with each period's matches and actions *Confirm*, *Assign a row…*, *Assign a receipt…*, *Detach*), *New subscription*, *Confirm all exact*; the nav entry in the costs group; **+ New → Subscription**.
- **FR-014** **Dashboard**: one to-do item (US6) read through `subscriptions.attentionCounts(tx, today)`.
- **FR-015** (P3) The match shown in the banking panel, the linking inbox, the document review page and the documents inbox (US7), calling the same confirm.
- **FR-016** Owner writes, accountant reads (`can(read, subscription)`); every write audited; strings en / fr / sv (`subscriptions.*`).

### Key Entities

- **Subscription** — the description of a recurring charge (FR-001); expectations only.
- **Subscription price** — a dated expected amount + currency (FR-002).
- **Subscription pause** — a dated range with a note (FR-003).
- **Period** — read model: expected date, expected price, windows, state, marks, matches (FR-004). Never stored.
- **`occurrence_of` link** — attributes an expense / supplier invoice to a subscription (FR-005).
- **Expense / supplier invoice** — unchanged, except an expense can receive its receipt after creation (FR-012).

## Success Criteria *(mandatory)*

- **SC-001** A month of the fixture (six subscriptions: SEK / CHF / EUR, expense / supplier invoice, monthly / yearly, one private-paid): from the CSV import and the receipts uploaded to every expense period *done* in **at most one confirm per period** — and one click for the exact ones (*Confirm all exact*); every supplier-invoice period *documented* in one confirm, *done* after its usual payment link.
- **SC-002** No entity, link or document change is written by import, OCR or any read — a test runs import + OCR + every read and counts zero new expenses, supplier invoices and links.
- **SC-003** The state of a period is a pure function of its facts: a 200-run property test over generated facts (entity or not, payment link or not, document or not, pause or not, today) gives the state table of US2-2; deleting the entity returns the period to *due*.
- **SC-004** Periods: a property test — every expected date lies between start and end, consecutive monthly dates are one calendar month apart (clamped to the month's end), a pause removes exactly its periods, the price of a period is the one valid on its date (the contract-rate fixture's cases).
- **SC-005** An entity made by a confirm has the same key, base, rate source and duplicate matches as the same entity made by hand today (expenses' and supplier invoices' own tests, run on a confirm-made entity).
- **SC-006** A subscription never changes a journal entry: the journal of the fixture is byte-identical before and after every confirm.

## Assumptions

- The windows (rows −3 … +7 days, receipts ±10 days) and the 5 % default tolerance are fixed in code, not settings; the tolerance is per subscription because FX markup and price rounding differ by vendor.
- Cadences are monthly and yearly only (the owner's); quarterly would be one enum value later.
- One price per date; a period expects one charge. Usage-based bills (a variable amount every month) fit with a wide tolerance (up to 50 %), or as a supplier-invoice subscription where the invoice decides.
- Matching is computed on request, like linking's suggestions (≤ the open rows of the windows); no cache, no job.
- No email reading, no vendor API: receipts still arrive by upload.
- Past periods count from the start date (Q3 → A): during B1 the backlog from 2023-04 is the to-do list.

## Decisions (the owner, 2026-10-26 — D57)

- **Q1 → A** A foreign-currency card charge seen before its receipt waits for the receipt; one confirm then creates the expense from the receipt and attaches the row (US3-5, FR-008).
- **Q2 → B** One expense group per subscription by default: the form offers *+ New group* named after it (US1, FR-001). The owner's practice: a new group per line, one shared group only for a topic (a trip; a purchase of several items that belong together).
- **Q3 → A** Periods count from the subscription's start date (Assumptions).
- **Q4 → A** Both kinds: card receipts become expenses; monthly bills (the accounting firm, the shared office) become supplier invoices, paid by transfer through the supplier-invoice flow (US3-6, US4). Salary and Skatteverket stay banking rules (Edge Cases).

What was asked is in the PR's history (#279).
