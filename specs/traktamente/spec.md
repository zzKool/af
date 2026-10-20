# Feature Specification: Traktamente — normalbelopp table, trips, the per-diem expense

**Feature Branch**: built with expenses — `feat/expenses-core` (rates, trip, calculator, the per-diem expense) · `feat/expenses-pages` (the trip panel on the group page, the rate table under settings)

**Created**: 2026-10-20

**Status**: Ready for planning (B14, D-f answered → D29; D10; harvest `specs/traktamente/harvest.md`)

**Input**: "A business trip is a group with departure and return date-times, a country and the meals that were paid separately (`lunch(s) = 18`). The app counts the days with Skatteverket's half-day rule (19.5), multiplies by the year's normalbelopp for the country, deducts the meals, and writes one *Meal Allowance* row in the trip's group next to the flight and the hotel — paid by me, refunded like the rest. Per day or half-day; day trips get nothing; meals as counts; no night allowance in the UI; the breakdown is its own PDF."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Count the days (Priority: P1)

The owner enters *2026-03-02 09:00 → 2026-03-21 17:00, Switzerland*. The app says 19 full days + 1 half day = 19.5 days, 19 nights: departure before 12:00 counts full, return at or before 19:00 counts half, every day in between is full. A same-day trip yields 0 with the reason *no overnight stay*.

**Independent Test**: every case of `fixtures/day-count-cases.json` against the pure calculator (the v3 result; the v1 result documented where it differs).

**Acceptance Scenarios**:

1. **Given** departure 2026-03-02 09:00 and return 2026-03-21 17:00 **Then** full 19, half 1, nights 19, days 19.5.
2. **Given** departure 2026-03-09 14:00 and return 2026-03-11 16:00 **Then** full 1, half 2, nights 2, days 2.0.
3. **Given** departure at 12:00 **Then** the departure day is a half day (11:59 → full); **Given** return at 19:00 **Then** the return day is a half day (19:01 → full).
4. **Given** the same calendar day **Then** 0 days, reason *no overnight stay* (D29).
5. **Given** the DST weekend 2026-10-24 10:00 → 2026-10-26 18:00 **Then** 2 nights, full 2 + half 1 = 2.5 days — calendar arithmetic in the tenant zone, never milliseconds.
6. **Given** a trip over New Year **Then** each day uses the normalbelopp of its own calendar year (D29: per day) and the result is flagged *two rate years*; a missing year's row is refused naming the year.

---

### User Story 2 - The amount (Priority: P1)

Full day = normalbelopp of (country, year); half day = 50 %. Meals paid separately, as counts per trip: abroad breakfast 15 %, lunch 35 %, dinner 35 % of the day's amount (all three on one day 85 %); in Sweden the year's fixed krona amounts (full day; halved and rounded for a half day). Night allowance only for `nights_without_paid_lodging` (default 0, no prominence; D-f dropped it from the UI — the column stays). Long-stay factor 0.7 / 0.5 as an override, collapsed.

**Independent Test**: the worked examples of the harvest §4.2 and `fixtures/meal-reductions.json`.

**Acceptance Scenarios**:

1. **Given** CH 1 402, 2026-03-09 07:00 → 03-11 21:00, no meals **Then** 3 full days → 4 206.00 SEK.
2. **Given** the same trip with 2 lunches **Then** −981.40 → 3 224.60 SEK.
3. **Given** the 19.5-day trip with 18 lunches **Then** 27 339.00 − 8 832.60 = 18 506.40 SEK (the Excel's *Meal Allowance* row).
4. **Given** SE 290/145 with meal amounts 58/102/102/261, 2 nights 3 full days, all meals one day, lodging not paid 2 nights **Then** 870 − 261 + 290 = 899.00 SEK.
5. **Given** a meal count above the number of calendar days **Then** refused. Meals are counts for the whole trip, never placed on a day: abroad every meal is its percentage of the **full** day amount (18 lunches on 19.5 days → 18 × 35 % × 1 402); in Sweden `min(breakfasts, lunches, dinners)` triples use the year's *all three* amount (261, Skatteverket's rounding) and the remaining singles their own amounts.

---

### User Story 3 - The per-diem expense (Priority: P1)

*Create per-diem expense* writes one expense of kind `per_diem` in the trip's group: SEK, paid by *Private SE*, category *Travel (Tr)*, description *Traktamente CH 19.5 days*, the breakdown in the note and as a stored snapshot, `document_missing = false`. *Recompute* replaces it while it is open; once settled, a correction is a new expense.

**Acceptance Scenarios**:

1. **Given** a computed trip **When** the per-diem expense is created **Then** it has key `Ex213-Tr-nn`, amount 18 506.40 SEK, `rate 1 same_currency`, status `to_refund`, and the trip references it (`per_diem_expense_id`).
2. **Given** the same inputs **When** recomputed **Then** the snapshot is identical and no second expense is created; **Given** changed meals **Then** the expense's amount and note are replaced (open expense only).
3. **Given** a settled per-diem expense **When** recomputed **Then** the old one stays; a new `per_diem` expense carries the delta (positive or negative amount refused → a negative delta is a note for the accountant; D-e keep it simple: the service refuses and says to settle the difference by hand).

---

### User Story 4 - The rate table (Priority: P2)

Settings → *Traktamente rates*: one row per (country, year): code, Swedish and English name, normalbelopp, night amount (default half), source; for SE the four meal amounts. *Copy from {year − 1}* and *Paste Skatteverket CSV* (`År;Land eller område;Landskod;Normalbelopp`, `Se Danmark` rows skipped, decimal comma accepted). A row referenced by a trip cannot be deleted.

**Acceptance Scenarios**:

1. **Given** the sample CSV **When** pasted **Then** `AL 345` and `CH 1402` for 2025 are upserted, the `Se Danmark` row skipped, the preview shows the counts.
2. **Given** 2025 rows **When** copied to 2026 **Then** 2026 rows exist with `source = copied from 2025`, existing 2026 rows untouched.
3. **Given** a trip in 2026 to CH **When** no CH 2026 row exists **Then** the compute says *No travel allowance rate for CH in 2026* with a link to the table.

## Requirements *(mandatory)*

- **FR-001** `normalbelopp` (tenant): `year`, `country_code` (ISO-2), `country_name_sv`, `country_name_en?`, `day_amount` (> 0), `night_amount?`, `meal_breakfast? / meal_lunch? / meal_dinner? / meal_all?` (SE), `source`; unique (tenant, year, country). Constants in code: half day 0.5; abroad meal percentages 0.15 / 0.35 / 0.35 / 0.85; long stay 0.7 / 0.5.
- **FR-002** `trips` (1:1 with a `trip` group): `departure_at`, `return_at` (timestamptz; `return_at > departure_at`), `country_code`, `agency?`, `breakfasts / lunches / dinners` (≥ 0), `nights_without_paid_lodging` (≥ 0, default 0), `long_stay_factor?` (0–1), `computed` (JSON snapshot), `per_diem_expense_id?`.
- **FR-003** Pure `countDays(departure, return, zone)` and `computePerDiem(trip, rates)` in `calculator.ts` (no I/O; the server computes, the client only displays); the tenant zone is `Europe/Stockholm` (constant for one tenant; later a tenant setting).
- **FR-004** Services: rates CRUD, `pasteSkatteverketCsv({year?, text})` (preview / upsert), `copyRatesFromYear`, `upsertTrip`, `previewPerDiem(groupId)`, `createOrReplacePerDiemExpense(groupId)` (through the expenses module; refuses when the existing one is settled — US3-3).
- **FR-005** Reads: `getTrip(groupId)`, `listRates(year?)`, `ratesForYears(country, years)`.
- **FR-006** Pages (part 2): the trip panel on the group page (date-time pickers, country select showing `name (normalbelopp SEK/day, year)`, agency, meal steppers, collapsed nights / long stay, the live result card, *Create per-diem expense* / *Recompute*); the rate table under settings with year tabs, copy-last-year, the paste box. Strings `traktamente.*` en + fr.

## Success Criteria *(mandatory)*

- **SC-001** Every `day-count-cases.json` case passes on the v3 column; the boundaries (11:59/12:00, 19:00/19:01) and the DST weekend hold.
- **SC-002** The four amount scenarios of US2 hold to the öre; a 200-run property test holds `total ≥ 0`, `days = full + 0.5 × half`, `nights = calendar days − 1` for overnight trips.
- **SC-003** The CSV paste upserts the sample and skips references; copy-year never overwrites.

## Assumptions

- Skatteverket's 2026 figures are entered by the owner (the harvest's fetch was blocked); the dev seed ships the 2025 subset of `fixtures/normalbelopp.csv` as a starting point (flagged `v1-seed`, to verify).
- Night allowance and long stay exist in the model with no UI prominence (D-f).
- The per-diem breakdown PDF (D29 "its own document") is rendered in part 2 from the trip page (`Ex213-Tr-nn_{return date}_.pdf`) through the same statement mechanism; part 1 stores the breakdown snapshot.
