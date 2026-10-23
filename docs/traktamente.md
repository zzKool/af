# Traktamente — the normalbelopp table, the trip, the per-diem expense

Module `src/modules/traktamente` · schema `prisma/schema/traktamente.prisma` · migrations `20261021120000_add_expenses_and_traktamente`, `20261021140000_add_trip_per_diem_document` · spec `specs/traktamente/` (harvest, spec, tasks) · decision D29. Part 1: the rate table, the pure calculator, the trip, the per-diem expense. Part 2: the trip panel on the group page, the rate table under settings, the breakdown PDF.

> A business trip is an [[expenses]] group of kind `trip` with one `trip` row: departure and return, country, the meals paid separately as counts. The app counts the days with Skatteverket's half-day rule, prices each day at its own year's normalbelopp, deducts the meals, and writes one `per_diem` expense in the group (SEK, paid by *Private SE*) — refunded like any other private expense. Recompute replaces it while it is open; once settled, a correction is a new expense by hand.

## Model

```
normalbelopp   year · country_code (ISO-2) · country_name_sv · country_name_en? · day_amount (> 0) · night_amount? (null = half)
               meal_breakfast? / meal_lunch? / meal_dinner? / meal_all? (Sweden's fixed krona amounts) · rate_source
               UNIQUE (tenant, year, country)
trips          group_id (FK CASCADE, one per group) · departure_at · return_at (timestamptz, return > departure) · country_code · agency?
               breakfasts · lunches · dinners · nights_without_paid_lodging (≥ 0) · long_stay_factor? (0–1]
               computed (the last PerDiemResult; NULL when the last computation failed — F62) · per_diem_expense_id? (validated UUID into expenses) · per_diem_document_id? (the breakdown PDF, set by the job, cleared on recompute)
```

Constants in code (`calculator.ts`): the tenant zone `Europe/Stockholm`, half day 0.5, departure half from 12:00, return half until 19:00, abroad meals 15 / 35 / 35 %, long stay 0.7 / 0.5. No settings.

## The calculator — `calculator.ts` (pure)

- `toLocal(instant | "YYYY-MM-DDTHH:mm", zone)`: a local string is taken as is, an instant is read in the zone (Intl, `hourCycle: h23`). `countDays(departure, return)`: a same-day trip is nothing (`reason: no overnight stay`); else every calendar day from departure to return — departure at or after 12:00 → half, return at or before 19:00 → half, everything between full; `nights = days − 1`; `days = full + 0.5 × half`. Calendar arithmetic on date strings (`nextDate`), never milliseconds — DST weekends count right.
- `computePerDiem(trip, rates)`: each day × its year's `day_amount` (half 50 %) × the long-stay factor; a missing year throws `No travel allowance rate for CH in 2026` (`PerDiemError` with `{countryCode, year}`); a trip over New Year is flagged *trip spans two rate years*. Meals are counts for the whole trip: abroad `breakfast 15 % + lunch 35 % + dinner 35 %` of the (factored) full day amount per count; in Sweden `min(b, l, d)` triples at `meal_all` (261 — Skatteverket's rounding, not 262) and the remaining singles at their own amounts, from the departure year's row (`mealRateYear`). Counts above the trip's days are refused. Every refusal carries `details.rule` and its facts; every warning is `{ type, message, …facts }` — the screens translate them (T003). Nights without paid lodging × `night_amount` (default half the day amount). Total never below 0.
- `perDiemDescription` → `Traktamente CH 19.5 days`; `perDiemNote` → the breakdown lines the expense carries.

The owner's trip: 2026-03-02 09:00 → 03-21 17:00 to CH at 1 402 with 18 lunches = 19 full + 1 half = 19.5 days, 27 339.00 − 8 832.60 = **18 506.40 SEK** — the Excel's *Meal Allowance* row (`specs/traktamente/fixtures/day-count-cases.json`, `meal-reductions.json`).

## Services

- `rates.ts`: `upsertRate` (create or update the (year, country) row, audited), `deleteRate` (refused while a trip to that country touches the year), `copyRatesFromYear({fromYear, toYear})` (only the countries the target year lacks, `rate_source = copied from 2025`), `parseSkatteverketCsv(text, defaultYear?)` (pure: `År;Land eller område;Landskod;Normalbelopp`, tab or `;`, decimal comma, header optional, the year column optional; `Se Danmark` rows and rows without a country code are reported as skipped), `pasteSkatteverketCsv({text, year?, dryRun?})` (preview or upsert; an existing row keeps its meal / night amounts). Reads: `listRates(year?)`, `rateYears`, `ratesForYears(country, years)`, `countryOptions(year, locale)`.
- `trip.ts`: `upsertTrip` (the group becomes a trip group; local times are stored as Stockholm instants — `toInstant`; the snapshot is stored when the rates allow it, else the trip is saved, the snapshot **cleared** and `computeError` returned alongside — the panel and the breakdown PDF never show a result of other inputs, F62). The snapshot is read through `parsePerDiemResult` (Zod, `perDiemResultSchema`): one that does not read as a breakdown is none, never a cast — `toTripDto` and `resolvePerDiemStatement` alike. `previewPerDiem(groupId)` (live, nothing written), `createOrReplacePerDiemExpense({groupId, basCode})` — a no-op when the stored breakdown and the expense already say it (T001) — → `expenses.createPerDiemExpense` (key `Ex213-Tr-nn`, date = the return day, amount = the total, the note = the breakdown) or `replacePerDiemExpense` while the existing one is open; refused once settled, for a day trip, for a 0 total. `getTrip(groupId)`.

## The breakdown PDF — `statement.ts`, `jobs/render-per-diem.ts` (D29)

`resolvePerDiemStatement(tx, caller, groupId)` → the company, the group, the per-diem expense, the trip (local times), the stored result. The job `traktamente.render-per-diem` (enqueued by `createPerDiemExpenseAction` on commit, `singletonKey` = the group) renders `/print/per-diem/[groupId]` (`PerDiemSheet`: every day with its year, kind and amount; the meals, the nights, the long stay, the total), stores it through `documents.storeGeneratedDocument` as the per-diem expense's receipt — `Ex213-Tr-02_2026-03-21_.pdf`, `generated`, prefix `expense` — replaces the expense's `created_from` link (one document per entity; the earlier breakdown stays, unlinked) and sets `per_diem_document_id`. A recompute clears the marker so the job renders again. Idempotent across retries.

## Pages (part 2)

- The **trip panel** on `/expenses/groups/[id]` (`TripPanel`, shown for trip groups): departure / return (`datetime-local`, local Stockholm time, stored as instants), the country select showing `Switzerland (CH) — 1 402,00 SEK/day, 2026` for the departure year (a pointer to the rate table when the year has no rows), agency, the three meal counts, *Nights without paid lodging, long stay* collapsed; *Save trip* stores the snapshot and shows the result card (days, day amounts, meals, nights, the total; the warnings) or the computation error (*No travel allowance rate for CH in 2026 → Rates*); the category select (the `Tr` category by default; read-only once the expense exists — T002) and *Create per-diem expense* / *Recompute per-diem expense*, with the expense's key and amount under it.
- **Settings → Traktamente** (`/settings/traktamente?year=`, a `ListPage`): the year as underline tabs (`RateYearTabs`) and one split primary in the title row (`RateActions`: *Add country* (`RateDialog`) ▾ *Paste Skatteverket CSV* (`PasteDialog`: textarea → *Preview* (rows / skipped) → *Apply*) · *Copy from {previous year}*); `RateTable` — the rows (country, code `<Tag>`, normalbelopp and night bare in `formatMoney` (the headers name SEK; night ½ when blank), the SE meal amounts or *15 / 35 / 35 %*, source `<Tag>`), *Edit* / *Delete* (guarded) in the row's ⋮ menu.
- `/print/per-diem/[groupId]` — the print route of the breakdown (amounts in `formatCurrency`, the printed format).
- **D40 kit (F71, 2026-10-23 — `tasks.md` T004)**: on-screen money through `formatMoney` (`18 506.40 SEK`), the per-diem key a `<CodeChip>`, hints / errors / warnings with the attention `StateIcon` (no amber palette), panel 15 / 13. Traktamente has no derived state of its own.
- Strings `traktamente.*` en + fr + sv. Screenshots: `specs/traktamente/screenshots/f71-*` (the rate table light / dark, the trip panel), `specs/expenses/screenshots/group-trip.png`, `group-per-diem.png`, `rates.png`, `rates-paste.png`; the PDF `specs/traktamente/screenshots/per-diem.pdf` (+ its first page).

## Surface

- `index.ts`: calculator (+ constants), rates, trip, the statement resolver, the job, queries, actions, DTOs. `ui.ts`: `TripPanel`, `RateTable`, `RateYearTabs`, `RateActions`, `PerDiemSheet`, actions, types.
- Actions: reads on `authedAction` + `can(read, expense)`; `upsertRateAction`, `deleteRateAction`, `copyRatesFromYearAction`, `pasteSkatteverketCsvAction`, `upsertTripAction`, `createPerDiemExpenseAction` on `ownerAction`.
- Nothing imports traktamente except the pages (part 2); traktamente imports expenses' `index.ts` only.

## Tests

`calculator.pure.test.ts` (every `day-count-cases.json` case on the v3 column, the boundaries, the zone, the worked examples, Sweden's triples and nights, refusals, two rate years, long stay, a 200-run property) · `trip.test.ts` (DB: the trip + snapshot + group kind, the per-diem expense and its recompute / replace / refusal once settled, the breakdown PDF job with a stubbed renderer (stored, linked, replaced on recompute, idempotent), missing years, day trips, a failed recomputation clears the snapshot and a malformed one reads as none (F62), `toInstant`, the CSV parser on the fixture, paste dry / real, copy a year, the delete guard) · the e2e in `e2e/expenses.spec.ts`.

Seed: the 2025 subset v1 carried (10 countries, `rate_source = v1-seed` — the owner verifies and pastes the current year).

## Convergence (F80, 2026-10-23)

`specs/traktamente/tasks.md` Phase 1, built 2026-10-23: **T001** a recompute of unchanged inputs is a no-op — same breakdown (all but `computedAt`) and the expense already carrying it → nothing written, no second PDF; **T002** once the per-diem expense exists its category is shown read-only (the replace keeps it); **T003** the reason, the warnings and the computation error in the reader's language — warnings are `PerDiemWarning` (`type`, the English `message`, the facts), errors carry `details.rule` (`PerDiemErrorRule`), `components/per-diem-text.ts` picks the key for the panel and the printed sheet; a pre-T003 snapshot's string warnings still parse. The calculator holds every fixture. Owned elsewhere: F67 (the delete guard's UTC year, the error helpers), F66 (the group read), F70 (`SEK`), F71 (on-screen money).

Related: [[expenses]], [[numbering]], [[feature-inventory]] §3.8, the `bas-accounting` skill (traktamente rules).
