# Exports — the Swiss VAT return

The FTA's *Décompte TVA* (méthode effective, contre-prestations convenues, net mode, quarterly, CHF) prepared from the read models, and the minimal declaration record (D23; `specs/exports/`). The owner copies the figures into the FTA portal; the app keeps what he typed, records *declared* / *paid*, and every invoice derives whether its quarter is declared (D-e).

## The return — `swiss-vat.ts` (pure)

Per invoice of the period (membership by the **stored** `declaration_period`, so a correction of a past quarter is a visible override), by its **stored rates** — never re-derived from the lines nor from the printed country (F56, [[lessons]] audit 1 · 21):

```
invoice ──► vatByRate (header discount applied, VAT rounded per rate = the printed invoice)
              ├─ rate ≠ 0 ──► 303 / 313 / 343 (302 / 312 / 342 pre-2024): base, tax      ──► 200 (invoice) or 235 (credit note)
              └─ 0 % lines ─► zero-rated = net − Σ taxed bases ──► 221 (place of supply abroad) and 200
all × the ECB CHF rate of the issue date, once per invoice
```

| document | taxed part (per stored rate) | 0 % part |
|---|---|---|
| invoice | 200 += base; the rate row base += base, tax += vat | 200 += part; 221 += part |
| credit note | 235 += base; the rate row −= base / vat (379 == 299 holds — the v1 bug of R34) | 200 −= part; 221 −= part |

A client abroad who was billed 8.1 % is taxed (303, 399) — the VAT was charged, so it is owed; a 0 % part for a client whose printed country reads Swiss is the warning `zero_rate_swiss_client` (exempt? → 220 / 230 by hand). The country is information on the drill-down only.

Then `289 = 220 + 221 + 225 + 230 + 235 + 280`, `299 = 200 − 289`, `379 = Σ bases`, `399 = Σ tax + 383`, `400 = Σ input VAT`, `479 = 400 + 405 + 410 − 415 − 420`, `500 / 510`. Warnings: `future_period`, `incomplete_period`, `snapshot_unreadable` (a declared quarter whose stored figures do not parse — the live ones are shown), `zero_rate_swiss_client`, `plausibility_mismatch` (|379 − 299| > 0.01), `unknown_rate` (a non-zero rate without a row — never "defaulted to standard", R33), `converted` (a non-CHF document converted at the ECB rate of its date; D23 names the FTA monthly rate, the app has ECB). `FORM_FIELDS` carries the refs, sections and labels (fr + en); `swissVatCsv` is v1's export (`ref;label;amount`, `swiss-vat-{year}-Q{q}.csv`).

## The declaration record — `declarations.ts` (writes), `declaration-read.ts` (reads)

`swiss_vat_declarations`: one row per CH registration and quarter, created on the first save. `saveManual` keeps the manual refs (220, 225, 280, 383, 405, 410, 415, 420) — refused once declared.

- `declare(declaredAt)` — the server computes the return now (`swissVatReturn`) and stores **its** lines as the snapshot; the page sends no figures, and a request that carries some is stripped (F56, lesson 2). The quarter is frozen: re-reading it returns the snapshot even after the live figures moved.
- `markPaid(paymentExpenseId | paidAt)` — with the `vat_payment` expense (validated), **paid on is derived from the expense's date** and no date is stored; a typed date is stored only when no expense paid it. `unmarkPaid` then `undeclare` undo (undeclare also drops a payment expense that no longer exists).
- Read side: the JSON columns are parsed (`parseSnapshot` with the ref enum, `parseManual`), never cast — and the snapshot is written through `snapshotToJson`, its mirror (T015); `paidAt` on the DTO is the derived one.

Owner only (`create accountant_package`); audited.

## Reads — `queries.ts`

- `swissVatReturn(tx, caller, {registrationId, period, today})`: the invoices through `invoices.invoicesForDeclaration`, the input VAT through `supplierInvoices.inputVatSources` and `expenses.inputVatSources` (stored amounts, never recomputed from a code), conversion through `rates.rateToBase`, the compute, the declaration — the lines are the snapshot once declared.
- `returnInvoice(inv, rate)` — one invoice as the return counts it (its `vatByRate` and 0 % part, in CHF).
- `swissVatPeriods` (from the first stored quarter to today's, plus any later override), `chRegistrations`, `vatPaymentOptions`, `declaredOn(period, vatRegistrationId?)` (the invoice page's chip; pass the invoice's registration so another CH registration's declaration never counts — the invoice page and the dashboard still call it without, fine while there is one CH registration).
- `period.ts` — `periodOfDate` / `isSwissVatPeriod` are the invoices module's `declarationPeriodFor` / `isDeclarationPeriod`: one rule for which quarter a date is in. `swiss-vat.ts` keeps only the inverse (`quarterBounds`), since it also runs in the browser.

## Page

`/exports` (nav *Declarations*, owner + accountant): registration (when several) and quarter, the status chip, *Download CSV*, *Declare* with its date, *Undo declaration*, *Mark paid* with the payment expense (its date shown, not editable) or a typed date, *Undo paid*; the warnings; the form by section with *Copy* per value and inputs on the manual refs (owner, while not declared); the invoices and the input sources. The invoice page links its period to the return and shows *declared {date}[, paid {date}]*.

**The D40 kit (F71, 2026-10-23).** The quarter's state is derived from the record's dates and goes through **one** map, `state-family.ts`: `draft` (no declaration date) → neutral *Not declared*, `declared` → progress, `paid` → done — a `<StateLabel>`, no coloured pill. Amounts on screen are `formatMoney` (`100.00 CHF`; bare under a header that names the currency — *VAT (CHF)* — and for the muted base next to a rate row), the plain decimal on `data-amount` for the e2e; an input source's net in its own currency. Invoice numbers and input-source keys are `<CodeChip>`s, the client's country and *CN* `<Tag>`s, a warning is the attention icon + its type as a code chip on a `--tag` block (no amber palette). *Copy* is an icon button with an `aria-label` per ref — it stays in the row, not a ⋮ menu: copying a figure into the FTA portal is the form's one gesture. One primary at a time (*Declare*, then *Mark paid*). No DataTable on this page, so no `rowActions` / `quickFilter`; no side panel, so no `DetailsSection`. **The CSV does not move**: `swissVatCsv` writes the stored decimals; `swiss-vat.pure.test.ts` compares every harvest case in fr and en with `specs/exports/fixtures/swiss-vat-csv-golden.json`, captured before F71.

## Tests

- `swiss-vat.pure.test.ts` — the harvest's scenarios (`specs/invoices/fixtures/swiss-vat-cases.json`, with the v3 deviations listed — a v1 foreign line is a 0 % line in v3), the old-rate rows, the unknown rate, the foreign credit note, a client abroad at 8.1 %, a mixed invoice, the manual refs, the warnings, the CSV; since F71 the CSV byte for byte against the pre-F71 golden (`specs/exports/fixtures/swiss-vat-csv-golden.json`, CRLF kept inside a JSON string — the repo normalises text files to LF).
- `declaration-read.pure.test.ts` — the snapshot written by `snapshotToJson` reads back the same through `parseSnapshot` (T015).
- `state-family.pure.test.ts` — every declaration state mapped; the state from the dates (no record = draft).
- `exports.test.ts` — a quarter on the real modules (figures, drill-down), a EUR invoice converted, the periods, the declaration record and its undo paths, roles; F56: a 10 %-discounted invoice gives the printed per-rate figures, a forged `lines` payload is ignored and a declared quarter re-reads its snapshot after a new invoice moved the live figures, paid on follows the expense's date, declared on per registration, the period rule.
- `e2e/exports.spec.ts` — a CH registration → the form → a manual ref → Declare → Undo; the accountant's read-only page. Screenshots in `specs/exports/screenshots/` (since F71 also `vat-return-light.png` / `-dark.png`, from `e2e/screenshots.spec.ts` › *declarations*).

## Not built here

The Swedish moms return (the accountant books it from the [[accountant-package]]); acquisition tax beyond the manual ref 383 (D-c); the FTA monthly rates.
