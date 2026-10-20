# Open questions for the owner

Collected from the harvest specs (`specs/<module>/harvest.md` §9) on 2026-10-20. Answer the **blocking** ones before a module's `/speckit-specify`; the rest can be decided during the build. Each answer becomes a D-number in [[feature-inventory]] when settled.

## Blocking (a module cannot be specified without it)

| # | Module | Question | Proposal |
|---|---|---|---|
| B1 | numbering / invoices | Credit-note number: `VA26-001b` (what v1 printed) or `CN-VA26-001` (keeps the invoice series gap-free)? | `CN-VA26-001` |
| B2 | invoices | Quotes never existed in v1. Same table with `type = quote`, series `QUO26-001`, title `Quote`/`Devis`, "valid until" default 30 days, convert = copy into an invoice draft, PDF stored at issue? | yes to all |
| B3 | invoices | Money format on the PDF: v1 printed `CHF 25'944.00` in every language; the preview printed Intl per language (`25 944,00 CHF`). One style for all languages? Unit prices with 0 decimals? | apostrophe style everywhere; 2 decimals |
| B4 | invoices / Swiss VAT | Reverse-charge sentence for EU B2B invoices under the SE registration; what a CH-registration invoice to a non-Swiss client prints; can the declaration period be overridden by hand; do issued-but-not-sent and non-CHF invoices count? | sentence per Art. 196; period derived, overridable; issued counts |
| B5 | contracts | Which rate applies to an invoice period: the rate valid on `period_start` (split lines when a change falls inside the period) or on the invoice date? Close the previous rate on `valid_from − 1` and reject overlaps? | period start; yes |
| B6 | contracts | Day is the only unit (D11)? If hours exist anywhere, one `unit` enum column. | day only |
| B7 | banking | The transfer-pair example in `excel-to-v3-mapping.md` is arithmetically inconsistent (−9 093.63 CHF ↔ +131 271.18 SEK ≠ 11.98). Which figure is right, and what text does Nordea put on a CHF↔SEK exchange between your two accounts? | — |
| B8 | banking | Short-payment / bank-fee tolerance: v1 forgave 0.05 CHF / 0.50 SEK only; foreign bank fees on CHF receipts are 10–30 CHF. Accept with one click when `delta ≤ max(0.05, 0.5 %)`, written to *bank fees*? | yes |
| B9 | banking / linking | Is a CHF invoice ever paid into the SEK account (or EUR into either)? `links` enforce allocation currency = target currency; if cross-currency receipts happen, the allocation is entered in the invoice currency at the bank implicit rate. | never → keep the constraint |
| B10 | expenses | Settlements: FIFO by expense date with per-row override (no v1 evidence either way); residual stays open? Exchange difference on cross-currency settlements → BAS 3960/7960 pair (confirm with the accountant)? | yes; yes |
| B11 | expenses | Card-FX expense (receipt 45.00 CHF, Nordea row −523.17 SEK): `amount` = receipt CHF, `amount_base` = the bank row's SEK (bank implicit rate)? | yes |
| B12 | documents | "What a document became" (expense, supplier invoice): `became_type/became_id` on the document (+ `document_id` on the entity), or a new `created_from` link kind in the linking matrix? | link kind `created_from` (one table for every relationship) |
| B13 | supplier invoices | Keep the `Ex{group}-Acc-{seq}` business key (continuity with the accountant) or a new `Si{yy}-{nnn}` series? Reclaim CH input VAT (form ref. 400)? | keep `Ex…-Acc-…`; yes if CH-registered purchases |
| B14 | traktamente | Skatteverket's 2026 normalbelopp (the live dataset fetch was blocked) and the starter country list (CH SE DE FR NL BE AT IT ES DK FI NO …). Rate year for a trip over New Year: per day or departure year? Day trips: nothing tax-free (v3) or a taxable option? Meals as counts (`lunches = 18`, the Excel way) or a per-day grid? | per day; nothing; counts |
| B15 | numbering | Drop `document_type_prefixes` and `document_key_counters` (nothing reads or writes them any more; counters carried over). Migration ready; needs your OK (data-dropping). | drop |

## Decide during the build

| # | Module | Question | Proposal |
|---|---|---|---|
| D-a | banking | Dedup key for Nordea rows (is `Balance` always present on the two main accounts? does the export offer a transaction id?); rules applied automatically on import and allowed to set `no_document_needed`; keep `REGEX` rules behind "advanced"; transfer-pair thresholds (≤ 2 days, implied rate within 5 % of ECB) | as proposed |
| D-b | banking / package | Savings CSV in the December package or a separate year package; yearly interest categorised automatically | December package; yes |
| D-c | invoices / Swiss VAT | Acquisition tax (ref 383) on foreign SaaS paid from the CHF account; record "quarter declared/paid" (period, date, link to the FTA payment, CSV as a document) | ask the accountant; minimal record |
| D-d | documents | Identical upload: `Use existing` primary, `Upload anyway` owner-only; fuzzy duplicate ±1 % / ±7 days / same partner + currency; OCR quality two levels; archive only inbox rows; keyboard map `j k x a o i e l d r z u ? Enter 1-3`; "Create anyway" on a HIGH duplicate requires a note | as proposed |
| D-e | expenses | Swiss VAT payments as expenses of kind `vat_payment` (no VAT recovery); mileage claims (yes/no); superseded statements kept with a flag | expense; no; keep |
| D-f | traktamente | Night allowance ever relevant (lodging the company did not pay)? Per-diem breakdown PDF as its own document or inside the reimbursement statement only | drop from UI; own document |
| D-g | supplier invoices | Pay CHF payables from the CHF account only; cancel-not-delete when a document is in retention; "copy last month" for the accountant's fee | yes; cancel; yes |
| D-h | DataTable | Apply-on-OK (built) vs live; date presets set; CSV export `,`/`.` with BOM; distinct cap 500 + search; column order/width persistence deferred | as built |
| D-i | accountant package | Summary as `.xlsx` only or also a PDF print; an invoice issued in June and paid in July appears in both months?; OCR line items as a sheet | xlsx only; both months; no |
| D-j | contracts | Keep `contract.billing_rate` as a cached current rate or derive it; two currencies for one client at once (→ two contracts) | derive; two contracts |

Related: [[feature-inventory]] §7, [[phase-0]].
