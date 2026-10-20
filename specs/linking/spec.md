# Feature Specification: Linking — scored suggestions, link / unlink from the panels, the inbox

**Feature Branch**: `feat/linking-suggestions` (part 1: the scorer, candidates through the linkable registry, suggestions both ways, apply / link / unlink in the banking panel and the entity panels) · `feat/linking-inbox` (part 2: the inbox work page with the keyboard, bulk *Apply HIGH*, unlinked documents)

**Created**: 2026-10-20

**Status**: Ready for planning (harvest `specs/banking/harvest.md` H3 + §8.1, `specs/documents/harvest.md` H7; decisions D18, D25, D27; B8, B9)

**Input**: "Linking is the product. Every bank row must end up justified (linked to the invoice, supplier invoice, expense or document it pays — with the amount), transferred, or flagged *no document needed*. The app proposes the justification with a confidence and reasons, I accept with one key, the rest I link by hand; nothing is typed as a status — paid, linked, open are derived from the links."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Suggestions for a bank row (Priority: P1)

The owner opens a bank row in the banking workbench. Under *Suggestions* the app lists up to five candidates — issued client invoices for an incoming row; open supplier invoices, company-paid expenses awaiting their row and unlinked financial documents for an outgoing row — each with a confidence chip (HIGH / MEDIUM / LOW), its reasons (*Invoice number in message · Exact amount match · Same date*), the amount it would allocate, and *Link*. The candidate window is the entity date ± 5 days (± 10 for expenses, whose refund lags), amounts compared in the row's currency, or in SEK base when the currencies differ (within 6 %, never HIGH-applied automatically).

**Why this priority**: the monthly routine is "import, then justify every row"; the suggestions are what make it minutes instead of an hour.

**Independent Test**: every case of `specs/banking/fixtures/matching-cases.json` against the pure scorer (v3 result; the v1 result documented where the one-scorer rule changes it); the finder on seeded rows.

**Acceptance Scenarios**:

1. **Given** `-1000.00 CHF 2025-01-15 "Payment for invoice INV-2025-042" to Acme Corp` and the issued invoice `INV-2025-042` 1 000.00 CHF of 2025-01-15 **Then** HIGH, 110, reasons *Invoice number in message · Exact amount match · Same date*; an invoice 1 005.00 CHF of the same day → MEDIUM 60 (*Very close amount match · Same date*); an invoice 1 500.00 → LOW 40 (*Approximate amount match · Same date*).
2. **Given** the message `Payment for INV-042` **Then** *Partial invoice number match* (+20) and HIGH 90 with the exact amount and date.
3. **Given** the supplier *Acme Corp* in the recipient and its open supplier invoice **Then** *Supplier name match* (+25) counts as a reference → HIGH 95 with the exact amount and date. (v3: the name is searched in every text field — name, message, details, sender, recipient — v1 skipped `sender`; the partner name also scores for client invoices, which v1 never checked.)
4. **Given** a CHF invoice and an SEK row with the same SEK base within 6 % **Then** the candidate is kept with *Cross-currency match (CHF→SEK at ECB)* and the currency penalty (−10) unless a reference matched; it is never applied by *Apply HIGH*. **Given** no base on either side **Then** only a full reference keeps it.
5. **Given** candidates **Then** ranked HIGH > MEDIUM > LOW, then score; the top five returned; a candidate already fully allocated (remaining ≤ tolerance) is not a candidate; a row already fully allocated has no suggestions.
6. **Given** an entity panel (invoice, supplier invoice, expense) **Then** the same scorer proposes bank rows the other way round (outgoing for payables, incoming for receivables), rows with something left to allocate, ± 5 / 10 days.

---

### User Story 2 - Link, allocate, unlink (Priority: P1)

*Link* on a suggestion creates the `justifies` link with the allocation `min(remaining on the row, remaining on the entity)` in the target's currency (editable before linking); a cross-currency supplier invoice or expense goes through its module's *attach* (the bank row's amount becomes its paid amount, D-g / D26) and a cross-currency client invoice is refused (B9). *Link to…* searches any linkable by number, key, name or file name when nothing was suggested. Every link in the panel has *Unlink*. A short payment within the D25 tolerance makes the invoice *paid*; the residual stays visible on the row (*partially linked*) until the owner books it (bank fees) — nothing is written silently.

**Acceptance Scenarios**:

1. **Given** an incoming 25 000.00 CHF row and the invoice `VA26-INV-001` 25 000.00 CHF **When** linked **Then** one `justifies` link with 25 000.00 CHF, the row derives *linked*, the invoice *paid*; **When** unlinked **Then** both reopen (audited both ways).
2. **Given** a 24 980.00 CHF row for that invoice **When** linked **Then** the allocation is 24 980.00 (what the row has), the invoice is *paid* (20.00 within 0.5 %), the row is *linked*.
3. **Given** a row with 500.00 left and an invoice with 1 200.00 open **When** linked **Then** 500.00 is allocated, the invoice *partially paid*, the row *linked*; a second row completes it.
4. **Given** an allocation above either remaining, a zero amount, a wrong currency **Then** refused with the service's message (the DB checks hold behind it).
5. **Given** the accountant **Then** the suggestions show, nothing links.

---

### User Story 3 - The inbox (Priority: P2, part 2)

`/banking/inbox` is the work page: every main-account row that is neither linked, transferred nor *no document needed*, sorted by the top candidate's confidence then date, the detail on the right. `j` / `k` move, `Enter` applies the top candidate when HIGH, `1`–`9` the n-th, `l` opens *Link to…*, `c` focuses the category, `u` undoes the last link, `?` the help. *Apply HIGH* on the selection reports applied / skipped with the reason (*no candidates · best is MEDIUM · ambiguous (95 vs 90) · cross-currency · nothing left to allocate*). *Unlinked documents* lists financial documents that became nothing and justify nothing.

## Requirements *(mandatory)*

- **FR-001** `Linkable` gains two optional members: `facts(tx, id)` → `EntityFacts` (type, id, label, amount, currency, SEK base, date, reference, partner name, search texts, remaining) and `candidates(tx, query)` → `EntityFacts[]` for a direction and date window (cap 50). The linking module stays generic: it never imports a module's tables.
- **FR-002** Pure `scoreMatch(row, entity)` → `{ score, confidence, reasons, reference }` with the weights of harvest §8.1: full reference 40, partial invoice number 20, partner name 25, amount 40 / 30 / 20 / 10 (< 0.1 % / 1 % / 5 % / else, relative to the entity, compared in the same currency or in SEK base), date 30 / 25 / 15 / 5 (0 / ≤ 2 / ≤ 5 / else days), currency −10 unless a reference matched; HIGH = (reference ∧ score ≥ 60) ∨ score ≥ 80, MEDIUM ≥ 50, else LOW.
- **FR-003** `suggestionsFor(tx, endpoint)` for a bank row (incoming → invoices; outgoing → supplier invoices, expenses, documents) and for an entity (→ bank rows): candidates in the window, scored, cross-currency kept only within 6 % of the SEK bases (or on a full reference), ranked, top five; excluded: fully allocated targets, rows with nothing left, quotes, drafts, cancelled supplier invoices, documents that became something or justify something.
- **FR-004** `applySuggestion({ from, to, allocatedAmount? })`: same currency → `createLink(justifies)` with `min(remaining both sides)` (or the amount given); cross-currency expense / supplier invoice → the module's attach; cross-currency invoice → refused. `bulkApplyHigh(ids)` with the skip reasons of US3 and the score gap of 10. Owner only; everything audited by the link service.
- **FR-005** `searchLinkables(q, types?)` → the candidates of every registered type whose label or texts contain `q` (cap 20 per type) — the *Link to…* picker.
- **FR-006** UI part 1: the banking panel's *Suggestions* section and *Link to…*, *Unlink* on the panel's links, the reverse suggestions on the invoice page and the supplier-invoice / expense panels (*Bank rows* section). Strings `linking.*` en + fr. Part 2: `/banking/inbox`, bulk apply, unlinked documents.

## Success Criteria *(mandatory)*

- **SC-001** Every scorable case of `matching-cases.json` passes on the v3 scorer (expected confidence; the reasons and scores where the one-scorer rule leaves them; the deviations listed in the test).
- **SC-002** A 200-run property: ranking is stable and total, HIGH ⇒ score ≥ 60, score is the sum of its reasons.
- **SC-003** The e2e links an issued invoice from an imported row through the suggestion and unlinks it; the invoice's derived state follows.

## Assumptions

- Suggestions are computed on request (≤ 50 candidates per type, one query each) — no cache table; a cache job can come if the inbox gets slow.
- The bank-fee residual of a short payment stays on the row for the owner to categorise; the automatic *bank fees* booking proposed in B8 is left until the first real CHF receipts show the pattern.
