# Feature Specification: Exports — the Swiss VAT return and its declaration record

**Feature Branch**: `feat/exports-swiss-vat`

**Created**: 2026-10-20

**Status**: Built (harvest `specs/invoices/harvest.md` H6; decisions D23, D28; the owner's answers B4, D-c, D-e)

**Input**: "Every quarter I fill the FTA's Décompte TVA for the Swiss registration from my invoices. The app should give me the form's figures ref by ref from what it already knows, let me copy them into the FTA portal, keep what I typed, record that the quarter is declared and paid, and show on each invoice whether it has been declared."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The return of a quarter (Priority: P1)

`/exports` shows, for the CH registration and a quarter (`CH 2026/Q2`), the FTA form row by row — section I turnover (200, 221 abroad, 235 reductions, 289, 299), section II tax by rate row (303 / 313 / 343, the old-rate rows 302 / 312 / 342, 379 plausibility, 383, 399), section II-bis input tax (400 from the stored VAT of supplier invoices and receipts under the registration, 405–420 manual, 479), section III (500 to pay / 510 credit). Every value has *Copy*. The owner types the manual refs (220, 225, 280, 383, 405, 410, 415, 420); they are kept per quarter. Below: the invoices of the quarter and the input-VAT sources. *Download CSV* gives v1's `swiss-vat-{year}-Q{q}.csv` (`ref;label;amount`).

**Acceptance Scenarios**:

1. **Given** a Swiss client's CHF invoice of 10 000 at 8.1 %, a German client's 5 000 (export), a 1 000 credit note on the first, a CH supplier invoice with 97.20 VAT and a receipt with 3.80 **Then** 200 = 15 000, 221 = 5 000, 235 = 1 000, 299 = 9 000, 303 = base 9 000 / tax 729, 379 = 9 000, 400 = 101.00, 500 = 628.00, no warning.
2. **Given** a EUR invoice under the CH registration **Then** it is converted at the ECB rate of its date with a `converted` warning (D23 names the FTA monthly rate; the app has ECB) — never dropped.
3. **Given** a 7.7 % line **Then** row 302, never 303; an unknown rate is a warning and lands nowhere (R33).
4. **Given** 379 ≠ 299 **Then** the `plausibility_mismatch` warning; a quarter not ended / not started → `incomplete_period` / `future_period`.

### User Story 2 - Declared, paid (Priority: P1)

*Declare* (with the date) stores the figures as declared (the snapshot) and freezes the quarter: the manual refs can no longer change, the page shows the declared figures. Every issued invoice of that period now shows *declared {date}* on its page — derived, never typed (D-e). *Mark paid* takes the date and, optionally, the `vat_payment` expense that paid it. Both can be undone (paid first, then declared).

### User Story 3 - The accountant (Priority: P2)

The accountant sees `/exports` read-only: the figures, the drill-down, the CSV; no manual inputs, no *Declare*, no *Mark paid*.

## Requirements *(mandatory)*

- **FR-001** Membership by the **stored** `declaration_period` of issued invoices and credit notes (D23): a correction of a past quarter is a visible override. Input VAT by document date within the quarter, under the registration, the stored amounts (never recomputed from a code).
- **FR-002** Pure `computeSwissVatReturn({period, invoices, inputSources, manual, today})` → lines + warnings, Decimal, 2 dp half-up: the rules of harvest §4 H6 with the v3 corrections (credit notes reduce the taxed base; a foreign client's credit note nets 200 and 221).
- **FR-003** `swiss_vat_declarations` (registration, period, manual, snapshot, declared_at, paid_at, payment_expense_id, note), unique per registration and period, RLS. Owner writes (`create accountant_package`), owner and accountant read.
- **FR-004** New reads in the owning modules: `invoices.invoicesForDeclaration(period)`, `invoices.declarationPeriods()`, `supplierInvoices.inputVatSources`, `expenses.inputVatSources`.
- **FR-005** `/exports` page, nav item *Declarations* (owner + accountant), strings `exports.*` en + fr; the invoice page's *declared* chip.

## Success Criteria *(mandatory)*

- **SC-001** Every case of `specs/invoices/fixtures/swiss-vat-cases.json` passes on the pure function (the v3 deviations listed in the test: V4 credit note, V9 issued-counts and conversion).
- **SC-002** The DB test's quarter gives the figures of US1-1; declare freezes them; `declaredOn(period)` derives.
- **SC-003** Roles: the accountant reads, cannot write.
- **SC-004** The e2e: a CH registration → the form → a manual ref → Declare → Undo; the accountant's read-only page.

## Assumptions

- One CH registration in practice; several are supported (a select).
- The Swedish moms return stays with the accountant (the package carries what he needs); a moms prep page can reuse the same read models later.
- Acquisition tax (383) stays a manual ref (D-c).
