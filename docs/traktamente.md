# Traktamente — the normalbelopp table, the trip, the per-diem expense

Module `src/modules/traktamente` · schema `prisma/schema/traktamente.prisma` · migration `20261021120000_add_expenses_and_traktamente` · spec `specs/traktamente/` (harvest, spec) · decision D29. Part 1: the rate table, the pure calculator, the trip, the per-diem expense. Part 2: the trip panel on the group page, the rate table under settings, the breakdown PDF.

> A business trip is an [[expenses]] group of kind `trip` with one `trip` row: departure and return, country, the meals paid separately as counts. The app counts the days with Skatteverket's half-day rule, prices each day at its own year's normalbelopp, deducts the meals, and writes one `per_diem` expense in the group (SEK, paid by *Private SE*) — refunded like any other private expense. Recompute replaces it while it is open; once settled, a correction is a new expense by hand.

## Model

```
normalbelopp   year · country_code (ISO-2) · country_name_sv · country_name_en? · day_amount (> 0) · night_amount? (null = half)
               meal_breakfast? / meal_lunch? / meal_dinner? / meal_all? (Sweden's fixed krona amounts) · rate_source
               UNIQUE (tenant, year, country)
trips          group_id (FK CASCADE, one per group) · departure_at · return_at (timestamptz, return > departure) · country_code · agency?
               breakfasts · lunches · dinners · nights_without_paid_lodging (≥ 0) · long_stay_factor? (0–1]
               computed (the last PerDiemResult) · per_diem_expense_id? (validated UUID into expenses)
```

Constants in code (`calculator.ts`): the tenant zone `Europe/Stockholm`, half day 0.5, departure half from 12:00, return half until 19:00, abroad meals 15 / 35 / 35 %, long stay 0.7 / 0.5. No settings.

## The calculator — `calculator.ts` (pure)

- `toLocal(instant | "YYYY-MM-DDTHH:mm", zone)`: a local string is taken as is, an instant is read in the zone (Intl, `hourCycle: h23`). `countDays(departure, return)`: a same-day trip is nothing (`reason: no overnight stay`); else every calendar day from departure to return — departure at or after 12:00 → half, return at or before 19:00 → half, everything between full; `nights = days − 1`; `days = full + 0.5 × half`. Calendar arithmetic on date strings (`nextDate`), never milliseconds — DST weekends count right.
- `computePerDiem(trip, rates)`: each day × its year's `day_amount` (half 50 %) × the long-stay factor; a missing year throws `No travel allowance rate for CH in 2026` (`PerDiemError` with `{countryCode, year}`); a trip over New Year is flagged *trip spans two rate years*. Meals are counts for the whole trip: abroad `breakfast 15 % + lunch 35 % + dinner 35 %` of the (factored) full day amount per count; in Sweden `min(b, l, d)` triples at `meal_all` (261 — Skatteverket's rounding, not 262) and the remaining singles at their own amounts, from the departure year's row (`mealRateYear`). Counts above the trip's days are refused. Nights without paid lodging × `night_amount` (default half the day amount). Total never below 0.
- `perDiemDescription` → `Traktamente CH 19.5 days`; `perDiemNote` → the breakdown lines the expense carries.

The owner's trip: 2026-03-02 09:00 → 03-21 17:00 to CH at 1 402 with 18 lunches = 19 full + 1 half = 19.5 days, 27 339.00 − 8 832.60 = **18 506.40 SEK** — the Excel's *Meal Allowance* row (`specs/traktamente/fixtures/day-count-cases.json`, `meal-reductions.json`).

## Services

- `rates.ts`: `upsertRate` (create or update the (year, country) row, audited), `deleteRate` (refused while a trip to that country touches the year), `copyRatesFromYear({fromYear, toYear})` (only the countries the target year lacks, `rate_source = copied from 2025`), `parseSkatteverketCsv(text, defaultYear?)` (pure: `År;Land eller område;Landskod;Normalbelopp`, tab or `;`, decimal comma, header optional, the year column optional; `Se Danmark` rows and rows without a country code are reported as skipped), `pasteSkatteverketCsv({text, year?, dryRun?})` (preview or upsert; an existing row keeps its meal / night amounts). Reads: `listRates(year?)`, `rateYears`, `ratesForYears(country, years)`, `countryOptions(year, locale)`.
- `trip.ts`: `upsertTrip` (the group becomes a trip group; local times are stored as Stockholm instants — `toInstant`; the snapshot is stored when the rates allow it, else the trip is saved and `computeError` returned alongside), `previewPerDiem(groupId)` (live, nothing written), `createOrReplacePerDiemExpense({groupId, basCode})` → `expenses.createPerDiemExpense` (key `Ex213-Tr-nn`, date = the return day, amount = the total, the note = the breakdown) or `replacePerDiemExpense` while the existing one is open; refused once settled, for a day trip, for a 0 total. `getTrip(groupId)`.

## Surface

- `index.ts`: calculator (+ constants), rates, trip, queries, actions, DTOs. `ui.ts`: actions + types.
- Actions: reads on `authedAction` + `can(read, expense)`; `upsertRateAction`, `deleteRateAction`, `copyRatesFromYearAction`, `pasteSkatteverketCsvAction`, `upsertTripAction`, `createPerDiemExpenseAction` on `ownerAction`.
- Nothing imports traktamente except the pages (part 2); traktamente imports expenses' `index.ts` only.

## Tests

`calculator.pure.test.ts` (every `day-count-cases.json` case on the v3 column, the boundaries, the zone, the worked examples, Sweden's triples and nights, refusals, two rate years, long stay, a 200-run property) · `trip.test.ts` (DB: the trip + snapshot + group kind, the per-diem expense and its recompute / replace / refusal once settled, missing years, day trips, `toInstant`, the CSV parser on the fixture, paste dry / real, copy a year, the delete guard).

Seed: the 2025 subset v1 carried (10 countries, `rate_source = v1-seed` — the owner verifies and pastes the current year).

Related: [[expenses]], [[numbering]], [[feature-inventory]] §3.8, the `bas-accounting` skill (traktamente rules).
