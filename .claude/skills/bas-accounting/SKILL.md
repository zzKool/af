---
name: bas-accounting
description: Domain rules AF applies — BAS categories as categorisation (not a ledger), dual-currency amounts and rate sources, Swedish and Swiss VAT, retention, traktamente, owner reimbursements. Use when modelling or computing anything financial.
---

# Accounting domain rules

Source of truth: `docs/feature-inventory.md` §1 (D1–D18) and `docs/excel-to-v3-mapping.md`. v2 reference: `docs/bas-categories.md`, `docs/decimal-currency.md`, `docs/clock-and-rates.md`, `docs/vat-registrations.md`.

## The model in one line
The accountant books. AF records facts, categorises them with BAS, links them to justification, and exports. No debit/credit, no fiscal periods, no P&L engine.

## Amounts (every financial entry)
`amount` + `currency` + `amount_base` (SEK) + `rate` + `rate_source ∈ {ecb, bank_implicit, manual}` — written once, never updated. Corrections are new entries.
- Bank-sourced entry: the bank amount is truth; SEK base from the account currency (SEK → 1.0; CHF account → ECB of booking date, bank implicit shown when a transfer pair exists).
- Manual / private entry: ECB rate of the document date.
- Transfer pair (`CHANGE CHFSEK`): two own-account transactions linked `transfer`; implicit rate = SEK/CHF of the pair; no document needed.
- ECB rates: daily, weekend/holiday → last available; gap > 3 days flagged.

## BAS
Categories from the standard kontoplan; tenant marks active + favourites; **alias** = short code used in business keys (`Tr`, `Ut`, `Rep`, `Off`, `Acc`, `Evnt`, `Vat`, …). Partner defaults suggest a category; learned rules from corrections suggest next time. Bank fees → category *bank fees* with `no_document_needed`.

## VAT
- Registrations per tenant: SE (moms 25/12/6 %) and CH (MWST 8.1 %, quarterly). Each invoice carries the registration and the declaration period (`CH 2026/Q2`).
- Swiss client invoices: CHF, 8.1 %. EU B2B services: reverse charge text. Swedish: moms per rate.
- Declaration prep = filtered exports per registration + period (H6 field mapping for the Swiss form).

## Documents and retention
Bokföringslagen: 7 years after the end of the calendar year of the financial year. Linked documents are never hard-deleted inside that window (DB trigger + service). Business keys are filenames.

## Expenses, liability, traktamente
- `paid_by` company account → link to the bank transaction → *paid*. Private → **owner liability ledger** (SEK base) → *to refund* → settlement (refund tx ↔ allocations, FIFO default, partial OK, residual stays open) → *refunded*; settlement emits a reimbursement statement PDF.
- Traktamente: Skatteverket normalbelopp per country/year (tenant-maintained table). Days from trip timestamps: departure after 12:00 counts half, return before 19:00 counts half. Deduct meals paid separately (entered per trip). Result = one `per_diem` expense in the trip group.
- Exchange difference on cross-currency settlements → dedicated category (confirm with accountant).

## Never
- store money as float · update an amount or rate in place · type a status a link can derive · add a VAT rate as a magic number (rates live on the registration's schedule)
