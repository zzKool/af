# Feature Specification: One engine with memory (F116)

**Feature Branches**: `feat/linking-engine-window` (PR A: the candidate window, honest points, token names, the *linked before* memory — scorer and finder, no schema), `feat/linking-engine-fx` (PR B, after F114: cross-currency apply, incoming proofs), `feat/banking-rules-engine` (PR C: rules with amount · account · sign · cadence; a subscription as a rule with an expected price — one migration on `categorisation_rules`)

**Created**: 2026-10-27

**Status**: Draft for the owner's read · four questions at the end · no code before his word (the suggestions change behaviour for every row he opens)

**Input**: [[audit-2026-10-27]] §2.2 and B1 · B6 · B7 · B8 · B12 · B14: "A scorer that can always be applied, with memory. Today the candidate window is ±5 days around the booking date on the *issue* date, so an invoice paid on 30-day terms — the company's only income — is never a candidate; a cross-currency receipt is scored, then refused on apply; any pair gets 15 points with a false reason; the strongest signal there is — *this counterparty key was linked to this partner before* — is not read. Rules, the scorer and the subscriptions matcher are three engines with three tolerance semantics. One engine: history first, then tokens, due-date windows, FX tolerance by instrument. This is the first 'AI' layer and needs no model."

## Why (the audit, in one picture)

```
today      candidates   entities dated within ±5 days of the row (expenses ±10)  → an invoice on 30-day terms never appears (B1)
           points       any pair: +10 "approximate amount" and +5 "N days apart" → 15 points for nothing, with a reason (B7)
           names        the partner's whole name as a substring of the row text → Nordea truncates, it rarely fires (B8)
           memory       none: the 40th OPENAI row is scored like the first (B8)
           currency     a CHF receipt against a SEK row is scored, then refused on apply (B6)
           incoming     an incoming row can justify an invoice, nothing else (B12)
           engines      rules (text only) · the scorer · the subscriptions matcher (text ∧ account ∧ date ∧ amount) — three tolerances (B14)

after      candidates   by the window the entity's own terms give — [issue date, due date + 10] — plus any entity whose number is in the row's text, whatever its date
           points       only what is true: an amount within 10 %, a date inside the window; nothing else scores, nothing else is said
           names        tokens of the partner's name (≥ 4 chars, not generic) — "ANTHROPIC* CLAU" finds Anthropic
           memory       the counterparty key's history: linked to this partner N times before → a bonus, and the partner's open entities first
           currency     a cross-currency pair applies like any other: the allocation in the entity's currency, the row's base on the link (D60)
           incoming     an incoming row can justify an invoice, a document, a credit note the vendor sent; a refund is a rule
           engine       one scorer for suggestions and the Justify panel; one rule shape for categorisation and recurring payments — text ∧ account ∧ sign ∧ amount ∧ cadence
```

### The rule, in five lines

1. **Candidates come from the entity's terms, not the row's day.** A bank row's candidates are the open entities whose payment window contains the booking date — an invoice or supplier invoice from its issue date to its due date + 10 days (at least 60 days back when the terms are shorter), an expense ±10 days of its date, a document ±10 days of its reading's date — **plus** every open entity whose number or key appears in the row's text, whatever its date. The entity's side (which rows could pay it) is the same window, mirrored.
2. **Points are claims, and every claim is true.** The amount scores only within 10 % (40 / 30 / 20 / 10 by tier as today; above 10 %: no points, no reason — and a reference alone still makes the pair a lead). The date scores only inside the window (30 / 25 / 15 / 5 as today, the ladder counted from the **due date** for invoices and supplier invoices, from the entity's date otherwise; outside: 0, and the reason says so). A pair with no true claim is not a suggestion.
3. **Names match by token.** The partner's name is split into tokens of ≥ 4 characters that are not generic (`AB`, `GmbH`, `Ltd`, `Inc`, `the`, `and` … the scorer's `GENERIC_WORDS` grown); a token found in the row's text is the name match (25 points, a reference). The whole name still counts; the token is what Nordea's truncation leaves.
4. **The engine remembers.** The *memory* of a counterparty key is derived from the links that exist: every `justifies` / `settles` link from a bank row carrying that key to an entity with a partner. "Linked to **Anthropic** 11 times before" is a reason worth 25 points on any candidate of that partner, and that partner's open entities are fetched as candidates even outside the window. The memory also carries the BAS code and the amounts of those entities — what PR C's rules read to propose a rule (*OPENAI → 6540, ~2 300 SEK monthly*). Nothing is stored: a read model over `links` × `bank_transactions.counterparty_key` × the owner's `facts`, computed per request for the keys at hand, ≤ 50 ms on the volume tenant (measure first, as search did — [[lessons]] F93).
5. **One tolerance per fact, three places read it.** Same-currency amounts: the scorer's tiers (0.1 % · 1 % · 5 % · 10 %). Cross-currency: the two bases at ECB within **6 %** stay candidates (the card's FX margin lives inside); on apply the link carries the row's base and the FX difference is derived (F114) — no refusal, no message about a panel. A rule's amount: an expected amount with a tolerance in percent (default 0.5 %, the subscriptions' *exact*). Rules, the scorer and the Justify panel's compare card read the kernel's `amountTier` and `settlementTolerance`; the subscriptions matcher's own arithmetic goes.

## Worked cases (invented)

| | the row | today | after |
|---|---|---|---|
| 1. an invoice on terms | 2026-07-30 +24 000.00 CHF `BYTEFORM AG VA26-003`, the invoice issued 2026-06-30 due 2026-07-30 | not a candidate (30 days off the issue date) | candidate by its window; number in the text (+40), client token (+25), exact amount (+40), paid on the due date (+30) → HIGH 135 |
| 2. a truncated name | 2026-07-28 −2 312.43 SEK `ANTHROPIC* CLAU 1234`, the supplier invoice 2026-07-27 2 312.43 SEK from *Anthropic PBC* | the whole name is not in the text → no name points | token `anthropic` → +25; exact amount, within 2 days → HIGH |
| 3. the 40th OpenAI row | 2026-07-28 −132.52 SEK `OPENAI *CHATGPT 1234`, a supplier invoice from OpenAI 2026-07-27 | scored like the first | + *Linked to OpenAI 39 times before* (+25); OpenAI's open invoices fetched first |
| 4. nothing true | 2026-07-24 −1 324.00 SEK `SKATTEVERKET`, a supplier invoice 2026-07-20 9 160.00 SEK from Skattepunkten | 15 points: "Approximate amount match", "4 days apart" | not a suggestion: the amount is 86 % off, no name token, no reference |
| 5. a CHF receipt on the SEK card | 2026-07-12 −123.38 SEK `TABULAR EDITOR APS`, the receipt 11.20 EUR (base 124.10) | HIGH, then *refused on apply* | HIGH; apply → one `justifies` link allocating 11.20 EUR with the row's 123.38 SEK as base; FX difference −0.72, rounding |
| 6. a vendor's credit note | 2026-07-15 +250.00 SEK `BYTEFORM AB refund`, a credit note document from the vendor | an incoming row has no candidate but invoices | the document is a candidate; the link is its proof; the row's category from the rule (*BYTEFORM → 6540 in*) |
| 7. a subscription as a rule | the monthly `OPENAI *CHATGPT` row | the subscriptions matcher: text ∧ account ∧ date ∧ amount, its own tolerance | the rule *OPENAI → 6540 · OpenAI · outgoing · main SEK · 132.52 ± 0.5 % · monthly*: categorises the row and names the expected period; off-amount or off-cadence rows are flagged, never categorised |

## User Scenarios

### US1 — The invoice paid on terms is found (PR A)
The owner opens the +24 000.00 CHF row of case 1. **Given** the invoice was issued a month ago, **when** the suggestions load, **then** it is the first candidate, HIGH, with the four true reasons, and *Link* applies it in one click.

### US2 — Nothing false is said (PR A)
The owner opens the Skatteverket row of case 4. **Given** no entity is within 10 % or carries its text, **when** the suggestions load, **then** the section says *No candidate*, and *Link to…* still searches. **And** no suggestion anywhere shows *Approximate amount match* or *N days apart* as a reason.

### US3 — The engine remembers the counterparty (PR A)
The owner has linked 39 OpenAI rows. **When** the 40th arrives, **then** its first suggestion carries *Linked to OpenAI 39 times before*; **and** on the Justify panel (F97) the compare card proposes OpenAI as the partner and 6540 as the category from the same memory (the panel reads the engine's `memoryFor(key)`, not its own guess).

### US4 — A cross-currency pair applies (PR B, after F114)
The owner opens the TABULAR EDITOR row of case 5. **When** he clicks *Link* on the EUR receipt, **then** the link is written with the allocation in EUR and the row's SEK as base, the row derives *linked*, the receipt *paid*, the FX line shows the rounding. No message about a panel; the generic path refuses only what D37 says it refuses (an expense's or a supplier invoice's own payment flow).

### US5 — An incoming row has proofs (PR B)
A vendor refund lands. **When** the owner opens the row, **then** the vendor's credit-note document (type `invoice`, direction incoming by its reading — a negative total or *credit note* in its text) is a candidate, and *No proof needed* / a rule cover the recurring repayments (Skatteverket, insurance). **Open question 2** decides whether a refund can also reduce the expense it refunds.

### US6 — One rule shape (PR C)
The owner turns the OpenAI subscription into a rule from the subscription page (*Make it a rule*): the rule carries text, partner, BAS, the paying account, the sign, the expected amount with its tolerance and the cadence. **When** a row matches text ∧ account ∧ sign ∧ amount, **then** it is categorised as today (first hit wins, never over a hand-set fact); **when** the text matches but the amount or the cadence does not, **then** the row is **not** categorised and the rules page shows it under *Needs a look* with the rule that almost fired. The subscriptions module keeps its pages until F104's date; its matcher calls the rules engine.

## Requirements

- **FR-001** `CandidateQuery` grows `references: string[]` (the row's text tokens, for the by-number fetch) and each linkable's `candidates` returns its open entities in **its** window: invoices / supplier invoices `issueDate ≤ booking ≤ dueDate + 10` ∪ `issueDate ≥ booking − 60`; expenses and documents ±10 days; plus any entity whose key / number is among the references. The entity side mirrors it: rows from the issue date to the due date + 10.
- **FR-002** `scoreMatch`: amount tier 3 only below 10 % (else no amount points, no reason); the date claim inside the payment window only — same day 30 · within 2 days 25 · on the due date 30 · within the terms 15 · up to 5 days late 15 · up to 10 days late 5 · an entity dated once within 5 / 10 days 15 / 5; outside the window nothing (as built, PR A); `confidenceOf` unchanged (HIGH ≥ 80 ∨ reference ∧ ≥ 60 ∧ amount ≤ 5 %). A pair whose only claim is its date is dropped.
- **FR-003** Partner name by token: `nameTokens(name)` — ≥ 4 chars, not in `GENERIC_WORDS` (grown with company suffixes and stop words in en / sv / fr / de); a hit = the name match. Property test: every token hit is a substring of the normalised name.
- **FR-004** `memoryFor(tx, keys[])` (linking, read model): per counterparty key `{ partners: [{partnerId, name, count, lastAt, basCodes[], amounts[]}] }` from the allocating links of rows with that key — one query over `links` joined to `bank_transactions` (through banking's `rowsByCounterpartyKey`) and the owners' `facts`. The scorer takes `memory` as an input: `+25 "Linked to {partner} {n} times before"` when the candidate's partner is in it (a reference — it unlocks the 60-point HIGH). The finder fetches the remembered partners' open entities (`candidatesForPartner`) regardless of the window. Exposed to the Justify panel (F97) for its compare card's partner and category.
- **FR-005** (PR B) `applySuggestion` and `createLinkAction` accept a cross-currency `justifies`: `allocatedAmount` in the entity's currency (`proposedAllocation` converts the row's remaining through the ECB rate of the booking date when it would otherwise be null), the base from F114's `createLink`. The *refused on apply* branch and its message go. `OWN_PAYMENT_FLOW` stays (D37).
- **FR-006** (PR B) Incoming rows: `JUSTIFIABLE.incoming = ["invoice", "document"]`; a document's direction comes from its reading (`total < 0` or a credit-note marker → incoming); the reason labels say *Credit note from the vendor*. Question 2 may add `expense` (a refund reducing it).
- **FR-007** (PR C) `categorisation_rules` + `bank_account_id?` (composite FK), `sign ∈ in | out | any` (default any), `expected_amount?` + `tolerance_pct` (default 0.5), `cadence ∈ none | monthly | quarterly | yearly` (default none); `matchRule` takes the row's account, sign and amount; a text hit with an amount or cadence miss is a **near miss** (`rules.nearMisses(tx)`, the rules page's *Needs a look*). The default rules are unchanged. `ruleInputSchema`, the dialog and the list grow the four fields; *Create rule from this* pre-fills amount and account from the row.
- **FR-008** (PR C) `subscriptions.toRule(subscriptionId)` → a rule with the subscription's text, partner, BAS, account, expected price, tolerance and cadence (`Make it a rule` on the subscription page); the subscriptions matcher calls `banking.matchRule` with the same facts — one tolerance (`tolerance_pct`), the `EXACT_PCT` constant retired. The module itself stays until F104 decides.
- **FR-009** Tests: `scoring.pure.test.ts` rewritten on the seven cases (and the property: no reason without points, no points without a true fact); `suggestions.test.ts` (the window on terms, the by-number fetch, the memory bonus and the partner fetch, RLS); `memory.test.ts` (counts and codes from links, another tenant's rows absent); PR B: apply cross-currency onto a document and an invoice (the link's base, the FX line), incoming document candidates; PR C: `rules.pure.test.ts` (account ∧ sign ∧ amount ∧ cadence, near misses), `subscriptions/matcher.test.ts` on the rules engine, e2e: the OpenAI row linked in one click after the history exists, the near miss on the rules page.
- **FR-010** Docs: `docs/linking.md` (the window, the points, the memory), `docs/banking.md` (rules), `docs/subscriptions.md`, `docs/feature-inventory.md` (the decisions the answers below become), `specs/linking/tasks.md` Part 7.

## Success Criteria

- **SC-001** On the seed, every issued invoice paid by a seeded row is that row's first suggestion (today: none on terms).
- **SC-002** No suggestion anywhere carries a reason whose fact is false: `grep "Approximate amount match\|days apart"` over the reasons of the seed's suggestions is empty.
- **SC-003** The volume tenant (lessons F93: 20 000 rows): `suggestionsForTransaction` p95 ≤ 150 ms with the memory read included.
- **SC-004** A cross-currency suggestion applied from the inbox writes one link with `allocated_base` = the row's remaining base; the bank sheet shows the row *linked*.
- **SC-005** The subscriptions matcher and the rules give the same answer on the subscriptions' fixture cases (`matching-cases.json`) once PR C lands.

## Questions for the owner (one batch)

1. **The memory's weight.** 25 points as a reference (so *linked before* + an exact amount = HIGH without any text match) — or a hint of 15 that never makes HIGH alone? The spec says 25: eleven confirmations are stronger evidence than a name in a truncated field.
2. **Vendor refunds.** Today a refund can only be a rule (categorised, *no document needed*). Should an incoming row be able to **reduce the expense it refunds** (a `justifies` link with a negative allocation — the expense derives *partly refunded by the vendor*), or is the credit-note document as proof plus the rule enough? The spec builds the document path (US5) and leaves the negative allocation out unless you want it (it touches F114's allocation trigger).
3. **Subscriptions.** PR C makes a subscription expressible as a rule and routes its matcher through the engine, but keeps the module's pages until F104's 2026-11-30 review. Fine — or fold it now, ahead of the date?
4. **The FX candidate tolerance.** 6 % between the ECB bases (the card's margin inside) stays as the cut for a cross-currency candidate; Nordea's card rate has been within 2.5 % of ECB in the fixtures. Keep 6 %, or tighten to 3 % with the owner's margin in mind?

## Assumptions

- The memory reads links that exist; nothing is written on confirmation beyond the link itself (a confirmation *is* the memory). A removed link forgets.
- `counterparty_key` (banking's `counterpartyKey`) is the identity of a counterparty on the bank side; the partner is the identity on the entity side. Two keys for one partner (card vs transfer) are two memories that point at the same partner — both score.
- The scorer stays pure: the memory is an input, fetched by the finder.

## Out of scope

The F104 decision itself; OCR changes (B9, B13); the transfer-pair window (B11, its own S item); the dashboard.
