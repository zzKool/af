# Feature Specification: SCB — the quarterly foreign-trade-in-services survey, prepared not filed

**Feature Branch**: `feat/exports-scb`

**Created**: 2026-10-27

**Status**: Spec — awaiting the owner's read (F96; review 2026-10-26 §7). Builds after B1 (D65); plan and tasks follow the read.

**Input**: "Every quarter SCB asks me for the survey *Foreign trade in services, non cross-border goods and current transfers* (SCB's respondent site, deadlines 15 April / July / October / January). I need the app to help me fill it — the figures per SCB code and country, in thousands of SEK, what is behind them, what is excluded and why — not to file it for me."

**Source of the rules**: SCB's survey page and its English instructions (`instruktioner-engelska-21-2026.pdf`) and country codes (`landskoder-2024.pdf`), read 2026-10-26. The rules that matter here:

- Report **services supplied or received in the quarter** (not when invoiced, not when paid), **gross**, by SCB service code × counterparty country, in **thousands of SEK**; use the SEK book value when there is one.
- **Card payments are not reported** — SCB collects those from the card companies. A SaaS subscription or a hotel paid by card is out; the same paid by bank transfer is in.
- Only **foreign** counterparties: a Swedish supplier or client is out, whatever the currency.
- The totals should reconcile with the VAT return: purchased services from abroad (boxes 21 / 22, reverse charge) and sold to abroad (39 / 40).
- Transfers (561 other current transfers, 562 VAT refunds) are reported when paid.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The worksheet of a quarter (Priority: P1)

`/exports` gets a second section, **SCB survey**, with a quarter picker (`2026/Q3`). The worksheet lists every candidate row the app knows for that quarter, in two groups — **Sold** (issued invoices and credit notes whose service period overlaps the quarter) and **Purchased** (supplier invoices by invoice date, expenses by date) — each row with: the entity key, the partner, its country, the proposed SCB code, the SEK book amount, and its **verdict**: *included*, or *excluded* with the reason. The verdicts are derived; the owner can overturn any of them with a note.

Above the rows, the **figures to type**: per direction, per SCB code × country, the sum in thousands of SEK (rounded half up), each with *Copy*. Below, the two **reconciliation hints**: the SEK sum of foreign supplier invoices and expenses under reverse charge in the quarter (VAT boxes 21 / 22) and the SEK sum of foreign client invoices (39 / 40), next to the worksheet's totals, with the difference.

**Acceptance Scenarios**:

1. **Given** a German client's invoice of 10 000 EUR for days in July–September (base 112 000 SEK), a Swiss client's for September (base 48 400 SEK), a Swedish client's for August, a Microsoft (IE) invoice of 1 200 SEK paid by bank transfer, an OpenAI (US) receipt of 230 SEK paid by card, the accountant's (SE) invoice, a hotel (FR) supplier invoice paid by transfer (base 9 800 SEK) **Then** Sold shows `433 · DE 112`, `433 · CH 48`; Purchased shows `410 · IE 1`, `222 · FR 10`; the OpenAI row is *excluded — paid by card*, the Swedish rows *excluded — domestic*; the reconciliation hint for purchased reads 11 000 SEK against the VAT read model's 21 / 22 figure.
2. **Given** an invoice whose period spans two quarters (`2026-09-15 → 2026-10-14`) **Then** it is a candidate of both quarters, *proposed by days* (the base split pro rata by days in each quarter), flagged *spans quarters* so the owner can keep the split or move the whole amount to one quarter with a note.
3. **Given** a partner without a country **Then** the row is *needs a country* (never silently included or excluded) and links to the partner; the figures above carry a warning until every included row has a country and a code.
4. **Given** a supplier invoice paid by card for 60 % and by transfer for 40 % **Then** the row is *included* with the transfer part only and flagged — the owner decides.
5. **Given** a credit note **Then** it nets the Sold figure of its code × country (never below 0 per line; a negative total is shown and warned, SCB wants the net).

### User Story 2 - Codes and countries live on the partner (Priority: P1)

A partner carries an optional **SCB code** (the default for everything with that partner) beside its country (already in the address). The partner page shows both; the worksheet's *needs a code* and *needs a country* rows link there. A row's code can be overridden in the worksheet (one supplier billing hosting under 410 and consulting under 433) — the override is stored with the quarter's decisions, not on the partner.

The code table is a constant in code (SCB's list for services; the codes a consultancy meets, in full), with the English label and SCB's short definition; it is not a setting.

**Acceptance Scenarios**:

1. **Given** Microsoft's partner has no SCB code **Then** its rows read *needs a code*; setting 410 on the partner fills every quarter's rows at once; an override on one row stays on that row.
2. **Given** the owner picks a code that exists only for goods or transfers **Then** the select never offered it: the worksheet offers service codes (and 561 / 562 for the Transfers group).

### User Story 3 - Submitted, and kept (Priority: P2)

*Mark submitted* (with the date) stores the figures as submitted (the snapshot per code × country × direction) and freezes the quarter: the decisions can no longer change, the page shows the submitted figures, a later change to an underlying row (a credit note issued after submission) shows as a *drift* against the snapshot. Undo is possible. A CSV (`scb-{year}-Q{q}.csv`: `direction;code;country;ksek;rows`) downloads the figures and the keys behind each.

### User Story 4 - The accountant (Priority: P3)

Read-only: the worksheet, the figures, the CSV — no decisions, no *Mark submitted*.

### Edge Cases

- An expense without a partner (a merchant text only) is a candidate only when its paying bank row is not a card row; it reads *needs a partner* — most such rows are card receipts and never appear.
- A supplier invoice not yet paid: the card test cannot run → *included, payment unknown* and flagged; it settles once the payment is linked.
- A cross-currency payment: the book value is the stored `amount_base` (D37 — never recomputed).
- A quarter not ended: the worksheet works, the figures warn *incomplete period* (as the Swiss return does).
- Several Swedish registrations: not in scope — one company, one survey.

## Requirements *(mandatory)*

- **FR-001** `partners.scb_code` (nullable, 3 chars, validated against the constant table); shown and edited on the partner page; exposed through `partners/index.ts` as a DTO field.
- **FR-002** A pure `computeScbWorksheet({quarter, sold, purchased, decisions, today})` → rows with verdicts, figures per direction × code × country in kSEK, the reconciliation totals, warnings. Decimal, rounding to thousands half up on the aggregated SEK sum (never per row). Verdict rules in order: domestic → excluded; paid by card (the linked bank row's description matches the Nordea card prefix — `banking.isCardRow`, the rule `stripCardPrefix` already knows) → excluded; no country / no code → needs; spans quarters → split by days; else included. A decision overrides a verdict and carries a note.
- **FR-003** Reads in the owning modules, each returning DTOs: `invoices.scbCandidates(quarter)` (issued invoices and credit notes overlapping the quarter: partner, country, period, base, declaration status), `supplierInvoices.scbCandidates(quarter)` (by invoice date: partner, country, base, the paying bank rows' card flags), `expenses.scbCandidates(quarter)` (by date: partner, country, base, paying source and card flag), `exports.swissVatReconciliation` reuses the existing VAT read models for the 21 / 22 and 39 / 40 hints (`supplierInvoices.inputVatSources`, `expenses.inputVatSources`, `invoices.invoicesForDeclaration` — the Swedish moms boxes are derived from the same reverse-charge facts, D54).
- **FR-004** `scb_declarations` (tenant, period `YYYY/Qn` unique, `decisions` JSON `[{entityType, entityId, verdict, code?, quarterShare?, note}]`, `snapshot` JSON, `submitted_at`, `note`), RLS; owner writes (`create accountant_package`), owner and accountant read. Submitted → frozen; undo clears `submitted_at` and keeps the snapshot as history.
- **FR-005** The section on `/exports` (no new nav item: *Declarations* already is the page; a tab row *Swiss VAT* · *SCB survey*), strings `scb.*` en + fr + sv, the D40 kit (`DataTable` for the rows, `StateLabel` for the verdicts, `CodeChip` for keys, `Tag` for code and country, `formatMoney`), screenshots light + dark.
- **FR-006** Nothing is sent to SCB. No credentials, no upload, no automation of the respondent site.

## Success Criteria *(mandatory)*

- **SC-001** Every case of `specs/scb/fixtures/scb-cases.json` (US1-1…5, the edge cases) passes on the pure function.
- **SC-002** The DB test: a quarter on the real modules gives the figures of US1-1; a decision overturns a verdict; submitted freezes; the accountant reads only.
- **SC-003** The partner page saves an SCB code; the worksheet's *needs a code* row disappears.
- **SC-004** The e2e: the quarter → a *needs a country* row → fixed on the partner → the figure appears → Mark submitted → Undo; a screenshot of the worksheet.
- **SC-005** The reconciliation hint equals the VAT read models' figures for the same quarter (one test on the same seed as `exports.test.ts`).

## Assumptions

- SCB's country code is ISO 3166-1 alpha-2 for every country the owner meets; the partner's address country is that code (no second country field).
- The owner's own services are consulting (433) or computer services (410) by contract — the code lives on the partner, overridable per row; no per-contract code until a client needs two.
- Goods (non cross-border) and the Transfers group (561 / 562) are in the code table but have no automatic candidates — the owner adds a manual row with a note when one occurs (the VAT refund from the Swiss FTA would be 562).
- Thousands of SEK are typed into SCB's site by the owner from the figures; the CSV is for his own file, not an SCB upload format.

## Out of scope

- Filing, a browser automation, SCB's XML / Excel upload formats.
- A per-line SCB code on invoices or supplier invoices (the worksheet override covers it).
- The Swedish moms return itself (the accountant's; the hints reuse its read models).
