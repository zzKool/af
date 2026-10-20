# Exports — the Swiss VAT return

The FTA's *Décompte TVA* (méthode effective, contre-prestations convenues, net mode, quarterly, CHF) prepared from the read models, and the minimal declaration record (D23; `specs/exports/`). The owner copies the figures into the FTA portal; the app keeps what he typed, records *declared* / *paid*, and every invoice derives whether its quarter is declared (D-e).

## The return — `swiss-vat.ts` (pure)

Per invoice of the period (membership by the **stored** `declaration_period`, so a correction of a past quarter is a visible override):

| document | Swiss client | foreign client |
|---|---|---|
| invoice | 200 += net; the line's rate row (303 / 313 / 343; 302 / 312 / 342 for the pre-2024 rates) base += net, tax += vat | 200 += net; 221 += net (place of supply abroad) |
| credit note | 235 += net; the rate rows −= its lines (379 == 299 holds — the v1 bug of R34) | 200 −= net; 221 −= net |

Then `289 = 220 + 221 + 225 + 230 + 235 + 280`, `299 = 200 − 289`, `379 = Σ bases`, `399 = Σ tax + 383`, `400 = Σ input VAT`, `479 = 400 + 405 + 410 − 415 − 420`, `500 / 510`. Warnings: `future_period`, `incomplete_period`, `plausibility_mismatch` (|379 − 299| > 0.01), `unknown_rate` (a non-zero rate without a row — never "defaulted to standard", R33), `converted` (a non-CHF document converted at the ECB rate of its date; D23 names the FTA monthly rate, the app has ECB). `FORM_FIELDS` carries the refs, sections and labels (fr + en); `swissVatCsv` is v1's export (`ref;label;amount`, `swiss-vat-{year}-Q{q}.csv`).

## The declaration record — `declarations.ts`

`swiss_vat_declarations`: one row per CH registration and quarter, created on the first save. `saveManual` keeps the manual refs (220, 225, 280, 383, 405, 410, 415, 420) — refused once declared. `declare(declaredAt, lines)` stores the lines as shown as the **snapshot** and freezes the quarter; `markPaid(paidAt, paymentExpenseId?)` records the payment (the expense must be a `vat_payment`); `unmarkPaid` then `undeclare` undo. Owner only (`create accountant_package`); audited.

## Reads — `queries.ts`

- `swissVatReturn(tx, caller, {registrationId, period, today})`: the invoices through `invoices.invoicesForDeclaration`, the input VAT through `supplierInvoices.inputVatSources` and `expenses.inputVatSources` (stored amounts, never recomputed from a code), conversion through `rates.rateToBase`, the compute, the declaration — the lines are the snapshot once declared.
- `swissVatPeriods` (from the first stored quarter to today's, plus any later override), `chRegistrations`, `vatPaymentOptions`, `declaredOn(period)` (the invoice page's chip).

## Page

`/exports` (nav *Declarations*, owner + accountant): registration (when several) and quarter, the status chip, *Download CSV*, *Declare* with its date, *Undo declaration*, *Mark paid* with its date and the payment expense, *Undo paid*; the warnings; the form by section with *Copy* per value and inputs on the manual refs (owner, while not declared); the invoices and the input sources. The invoice page links its period to the return and shows *declared {date}[, paid {date}]*.

## Tests

- `swiss-vat.pure.test.ts` — the harvest's scenarios (`specs/invoices/fixtures/swiss-vat-cases.json`, with the v3 deviations listed), the old-rate rows, the unknown rate, the foreign credit note, the manual refs, the warnings, the CSV.
- `exports.test.ts` — a quarter on the real modules (figures, drill-down), a EUR invoice converted, the periods, the declaration record and its undo paths, roles.
- `e2e/exports.spec.ts` — a CH registration → the form → a manual ref → Declare → Undo; the accountant's read-only page. Screenshots in `specs/exports/screenshots/`.

## Not built here

The Swedish moms return (the accountant books it from the [[accountant-package]]); acquisition tax beyond the manual ref 383 (D-c); the FTA monthly rates.
