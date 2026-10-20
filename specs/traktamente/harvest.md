# Harvest — traktamente (H9: normalbelopp table, half-day rule, meal deductions)
Sources read (af_core, commit a2fe220): `lib/travel-allowance/calculator.ts` (`calculateTravelAllowance`, `calculateDays` l.199–250, `calculateMealReduction` l.263–336, constants l.71–87) · `lib/travel-allowance/rate-import.ts` (`importRatesFromCsv`, `importRatesFromApi`, `SWEDEN_DOMESTIC_RATES` l.52–59, `COUNTRY_NAME_TO_CODE` l.400–478) · `app/dashboard/travel-allowances/TravelAllowanceFormClient.tsx` (`calculateAllowance` l.126–212 — the calculation that actually ran) · `prisma/schema.prisma` models `TravelAllowance` (l.2163), `TravelAllowancePayment` (2237), `TravelAllowanceRate` (2347) · `app/api/travel-allowances/route.ts` (GET, POST l.153–289), `[id]/route.ts` (status transitions l.208–290, delete l.418–441) · `app/api/travel-allowance-rates/route.ts`, `lookup/route.ts`, `[id]/route.ts` · `lib/validation/travel-allowances.ts` + `__tests__/travel-allowances.test.ts` (54 cases) · `prisma/seed.ts` l.581–721 (rates 2025 subset) · `scripts/import-travel-rates.ts` · `app/api/banking/transactions/[id]/reconcile-batch/route.ts` `processTravelAllowanceReimbursement` (l.435–537) · `lib/posting/posting-service.ts` case `TRAVEL_ALLOWANCE_PAYMENT` (l.469–487).

v3 context applied: D10 (own module; normalbelopp per country/year; half-day rule from trip timestamps; meals entered per trip; countries CH, SE, EU), §3.8 (rate importer → one-screen yearly table), `excel-to-v3-mapping.md` Sheet 3 rows "Travel Details" (Date/Time From, Date/Time To, Quantity 19.5, Agency) and "Meal Allowance" (days × normalbelopp − meals paid separately, comment `lunch(s) = 18`), bas-accounting skill ("Traktamente" paragraph), H8 (`per_diem` expense in the trip group, refunded through the settlement flow).

Live fetch of Skatteverket's dataset for 2026 was attempted and blocked (`https://skatteverket.entryscape.net/rowstore/dataset/70ccea31-b64c-4bf5-84c7-673f04f32505?år=2026&_limit=500&_offset=0`, the URL v1 documents in `rate-import.ts` l.224); the fixture therefore holds v1's own data only (2025 subset + SE 2020–2025). The owner fills 2026 from Skatteverket's list (§8).

## 1. What the feature is for
Swedish tax-free per diem (traktamente) for the owner's business trips, mostly to Switzerland: a trip has departure and return timestamps and a country; the app counts full and half days with Skatteverket's half-day rule, multiplies by the year's normalbelopp for the country, deducts the meals that were paid separately (client lunches), and writes the result as one `per_diem` expense in the trip group — paid "privately" by construction, so it lands on the owner liability ledger and is refunded through a settlement (H8). The rate table (country × year) is maintained by the owner on one screen from Skatteverket's yearly list. In the Excel this is the "Travel Details" block (quantity 19.5 days) and the "Meal Allowance" row of a trip group.

## 2. Behaviour — rules as numbered statements

### 2.1 What v1 did — calculation
- R1 Rate lookup key = (`ratesPublisher` = tenant country, default `SE`; `rateType = 'TRAVEL_ALLOWANCE'`; `year`; destination `countryCode`). Year = **year of the departure date for the whole trip** ("A trip Dec 28, 2024 → Jan 5, 2025 uses 2024 rates", `calculator.ts` l.103–105). Missing rate → `RateNotFoundError` / API `404 RATE_NOT_FOUND` with message `No travel allowance rate found for {CC} in {year}` and suggestions `Contact an administrator to import the latest rates` · `Select a different destination country` · `If this is a new year, rates may not be published yet`.
- R2 Times are `HH:MM` strings next to date-only dates; only the **hour** is used (`split(':')[0]`); defaults `00:00` for departure and `23:59` for return when absent (`calculator.ts` l.207–209, form l.138–139).
- R3 Calendar days `totalDays = ceil((returnDate − departureDate) / 86 400 000) + 1` on the date parts (l.212–214).
- R4 **Same-day trip** (`totalDays = 1`): full day if `depHour < 12` **or** `retHour ≥ 19`, else half day; overnights 0 (l.216–226).
- R5 **Multi-day trip**: middle days (`totalDays − 2`) are always full; departure day full if `depHour < 12` else half; return day full if `retHour ≥ 19` else half; `overnights = totalDays − 1` (l.228–249). Boundary as coded: departure exactly 12:00 → half; return exactly 19:00 → full.
- R6 Long stay: factor 1 by default; `longStayMonths ≥ 3` → 0.7; `≥ 24` → 0.5, applied to the daily rate (l.129–137). In the form that actually ran, the factor was a flag `isLongStay` → 0.7 only (form l.176–180).
- R7 `dayRate = dailyRate × factor`; `nightRate = rate.nightRate ?? 0` (only SE has one); `dayAllowance = dayRate × fullDays + dayRate × 0.5 × halfDays − mealReduction`, floored at 0; `nightAllowance = nightRate × overnights`; `total = dayAllowance + nightAllowance`; currency = rate currency (SEK) (l.149–184).
- R8 Meal reduction, server calculator (never called in production — see R14): **domestic (SE)** fixed SEK per occurrence `breakfast 58`, `lunch 102`, `dinner 102`, `allMeals 261` (comment: "58 + 102 + 102 = 262, but Skatteverket rounds to 261"); **international** percentages of the (unreduced) daily rate: `breakfast 15 %`, one main meal `35 %`, lunch **and** dinner the same day `70 %` (paired by `min(lunch, dinner)`, extra singles at 35 %), `allMeals 85 %` (l.71–87, 263–336). `allMeals` short-circuits the other counts.
- R9 Meal reduction, **form client (what ran)**: `mealReduction = mealsProvided × dayRate × 0.15` — one integer "meals provided", 15 % each, no breakfast/lunch/dinner distinction, same for SE and abroad (form l.186–187).
- R10 Validation (`TravelAllowanceCreateSchema`): `returnDate ≥ departureDate` (`Return date must be on or after departure date`); same-day `returnTime ≥ departureTime` when both given (`Return time must be after departure time for same-day travel`); time regex `^\d{2}:\d{2}$` (`Time must be in HH:MM format`); meal counts (`breakfast/lunch/dinner/allMeals`, int 0–365) each `≤ fullDays + halfDays` (`Meal counts cannot exceed total travel days`); `longStayFactor` 0–1; `countryCode` exactly 2 chars; `purpose` ≤ 500, `destination` ≤ 200; strict object.
- R11 The API **trusts the client's** `fullDays`, `halfDays`, `overnights`, `dayRate`, `nightRate`, `mealReduction` and only recomputes the amounts (`route.ts` l.167–173) — and it recomputes with the **unreduced** `dayRate` the form sends, so the long-stay factor is lost on the server while `longStayFactor` is stored for display. Bug.
- R12 Stored per allowance (snapshot): country code + Swedish country name, departure/return date + time, fullDays, halfDays, overnights, dayRate, nightRate, `mealsProvided` JSON, mealReduction, dayAllowanceAmount, nightAllowanceAmount, totalAmount, currency `SEK`, isLongStay, longStayFactor (schema l.2163–2234). Number `TA{yy}-{nnn}`.
- R13 Status machine (`lib/validation/travel-allowances.ts`): `DRAFT → SUBMITTED → APPROVED | REJECTED | DRAFT`; `APPROVED → REIMBURSED`; `REJECTED → DRAFT`; `REIMBURSED` terminal. Status changes to APPROVED/REJECTED/REIMBURSED need ADMIN/ACCOUNTANT (`'Unauthorized to change status'`); fields editable only in `DRAFT`; hard delete only in `DRAFT`, soft delete otherwise. Reimbursement = same batch flow as expense claims (H8 R19), journal `Dr 5800 / Cr 1920` (dead, H8 R24).
- R14 `calculateTravelAllowance` in `lib/travel-allowance/calculator.ts` has **no caller** in `app/`, `lib/` or `components/` and no test file: the server calculator (with the full meal logic of R8) is dead code; the form's simplified copy (R4, R5, R9) is what produced every stored allowance.

### 2.2 What v1 did — rate table
- R15 `TravelAllowanceRate` is app-level (no tenant): unique (`ratesPublisher`, `rateType`, `year`, `countryCode`); `countryName` in Swedish as Skatteverket prints it (`Tyskland`, `Schweiz`); `dailyRate`; `nightRate` only for SE; `currency` default SEK; `source` OFFICIAL | MANUAL; `referenceCountryCode` for "Se Danmark" rows (schema l.2347–2385).
- R16 CSV import, Skatteverket format, semicolon-delimited, header `År;Land eller område;Landskod;Normalbelopp`; rows with empty fields skipped; `Normalbelopp` starting with `Se ` / `se ` (reference to another country) skipped; decimal comma accepted; `Landskod` upper-cased; upsert; the **Swedish domestic** row is not in the file and is added from a hard-coded table `{2025: 290/145, 2024: 280/140, 2023: 270/135, 2022: 260/130, 2021: 250/125, 2020: 240/120}` (day/night) (`rate-import.ts`).
- R17 API import: Skatteverket's open dataset (rowstore) paged 100 at a time, fields `år`, `land eller område`, `landskod`, `normalbelopp`; empty `landskod` resolved through a 77-entry Swedish-name → ISO map (copied to `fixtures/v1-country-name-map.json`).
- R18 Rate admin: `GET /api/travel-allowance-rates?year&countryCode&ratesPublisher` (default year = current, publisher SE); `POST` (permission `manage Settings`) with 409 `Rate already exists for {CC} in {year}`; `GET /lookup?countryCode&year` for the form (R1 message).

### 2.3 What v3 must do (D10, Excel, bas-accounting)
- R19 A **trip** belongs to an expense group of kind `trip`: `departure_at`, `return_at` (TIMESTAMPTZ, minute precision), `country_code`, optional `agency` text (Excel "Agency"). One trip per group.
- R20 Day count per Skatteverket, computed **on the server** from the two timestamps, never trusted from the client (fixes R11): see §4.1. Half-day rule: departure **at or after 12:00** → departure day is a half day; return **at or before 19:00** → return day is a half day (return at exactly 19:00 is a half day — v1 said full, R5). Minutes count (12:00 is "at", 11:59 is "before").
- R21 **Overnight required**: Skatteverket's tax-free traktamente presupposes a trip with at least one overnight stay (and a destination > 50 km from home and workplace). A same-day trip yields **0** tax-free per diem; v3 computes 0 and shows the reason, instead of v1's 1 full/half day (R4). Ask the owner whether to still allow a taxable per diem for day trips (§9.3).
- R22 Rate per (country, year); the year rule for trips spanning New Year is an open point (§9.1); until decided, each day uses the rate of its own calendar year (what Skatteverket's "per day" wording implies), with a flag on the per-diem row when two years are involved.
- R23 Half day = 50 % of the day's normalbelopp (v1 R7, kept). Night allowance (`nattraktamente`, SE: half the normalbelopp — 145 SEK in 2025; abroad: half the country's normalbelopp) is due **only for nights where the company did not pay the lodging**; the trip carries `nights_without_paid_lodging` (default 0, since the hotel is normally an expense in the same group). v1 always paid `nightRate × overnights` for SE and 0 abroad (R7) — not ported.
- R24 Meals paid separately (client lunches, hotel breakfasts, dinners on the company card) are entered **per trip as counts** `breakfasts`, `lunches`, `dinners` (Excel comment `lunch(s) = 18`). Deduction **abroad** = Skatteverket's percentages of the **day's amount** (full or half): breakfast 15 %, lunch 35 %, dinner 35 %, all three 85 % (15 + 35 + 35 ≠ 85 — the all-three figure is Skatteverket's own; v1 R8 had the same four numbers). Deduction **in Sweden** = the fixed krona amounts Skatteverket publishes per year (2025 full day: 58 / 102 / 102 / 261; half day = halved: 29 / 51 / 51 / 131). These are **not** the foreign percentages (58 / 290 = 20 %, 261 / 290 = 90 %), so the SE row of the rate table carries the four full-day meal amounts of the year; half-day amounts are derived by halving and rounding. v1's 70 % "lunch + dinner" pairing (R8) is just 35 + 35 and needs no special case. Counts may not exceed the number of days (R10 kept).
- R25 Long stay: factor 0.7 from the first day after 3 months at the same place, 0.5 after 2 years (R6 kept as the rule; the input is the trip's `long_stay_since` date or a simple factor override — the owner's trips are weeks, not months; keep the field, no UI prominence).
- R26 The result is written as **one expense** of kind `per_diem` in the trip group: `amount` = total in SEK, currency SEK, `paid_by` = the owner's private instrument (private SE by default), BAS category traktamente (alias from the kontoplan, e.g. `Tr`), description `Meal Allowance` / `Traktamente CH 19.5 days`, `note` with the breakdown (`19 full + 1 half days × 1 402; − 18 lunches`), `document_missing = false` (the computation sheet is the document: generated PDF or the trip page export, §5). Recomputing the trip replaces the per-diem expense only while it is unsettled; once allocated in a settlement it is frozen and a correction is a new expense (bas-accounting "corrections are new entries").
- R27 The rate table is **tenant-maintained on one screen**, one row per (country, year): country code, Swedish and English name, normalbelopp (SEK), optional night amount, source note (`Skatteverket 2026`), with "copy last year" and "paste Skatteverket CSV" (the R16 parser, cheap to keep as a paste box — no file import, no API job). Countries the owner needs: CH, SE and the EU countries he travels to; the table is not pre-filled by the app.
- R28 No statuses, no approval (R13 dropped): the per-diem expense follows H8's derived statuses (to refund → refunded).

## 3. Data — the fields that matter
| field | type | meaning | constraints / derived | v3 note |
|---|---|---|---|---|
| trip.group_id | uuid | the trip group | 1:1 with `expense_group(kind=trip)` | |
| trip.departure_at, return_at | TIMESTAMPTZ | Excel "Date/Time From / To" | `return_at > departure_at`; stored in the tenant's zone | v1 had date + `HH:MM` string |
| trip.country_code | ISO-2 | destination for the rate | must exist in the rate table for the trip's year(s) | |
| trip.agency | text? | Excel "Agency" (who the trip was for) | | |
| trip.breakfasts, lunches, dinners | int ≥ 0 | meals paid separately | each ≤ day count | v1 JSON `mealsProvided` |
| trip.nights_without_paid_lodging | int ≥ 0 | nights eligible for nattraktamente | ≤ overnights | new (R23) |
| trip.long_stay_factor | Decimal? | 0.7 / 0.5 override | 0–1 | v1 `isLongStay` + factor |
| trip.computed (snapshot on the per-diem expense) | json | full_days, half_days, overnights, day_amounts per year, meal_deduction, night_amount, total, rate rows used | written at compute; shown on the statement | v1 columns on `TravelAllowance` |
| normalbelopp.year, country_code | int, ISO-2 | | unique per tenant | v1 app-level + publisher |
| normalbelopp.country_name_sv, country_name_en | text | `Schweiz` / `Switzerland` | | v1 Swedish only |
| normalbelopp.day_amount | Decimal (SEK) | normalbelopp | > 0 | v1 `dailyRate` |
| normalbelopp.night_amount | Decimal? | nattraktamente if different from day/2 | default `day_amount / 2` | v1 `nightRate` SE only |
| normalbelopp.source | text | `Skatteverket 2026`, `manual` | | v1 OFFICIAL / MANUAL |
| normalbelopp.meal_breakfast, meal_lunch, meal_dinner, meal_all (SE row only) | Decimal? | the year's fixed krona deductions, full day | required when `country_code = SE`; null abroad | new (R24); v1 constants l.73–78 |
| meal_deduction_pct (abroad) | constants | breakfast 0.15, lunch 0.35, dinner 0.35, all_three 0.85 | code constants, not settings (one tenant) | v1 R8 |
| half_day_factor | constant | 0.5 | | |
| long_stay | constants | ≥ 3 months 0.7, ≥ 24 months 0.5 | | v1 R6 |
Statuses: none on the trip; the `per_diem` expense has H8's derived status.

## 4. Algorithms / formulas (v3; v1 differences noted)

### 4.1 Day count
```
d0 = date(departure_at), d1 = date(return_at)            -- calendar dates in the tenant zone
if d0 == d1: full = 0, half = 0, nights = 0, reason = "no overnight stay"   (R21; v1 gave 1 day)
else:
  n = (d1 − d0) in calendar days (date arithmetic, not ms/86 400 000 — DST-safe)  -- v1 R3 used ceil(ms) on date-only values, OK only because the dates were midnight UTC
  nights = n
  middle = n − 1                                          -- v1: totalDays − 2 with totalDays = n + 1, same thing
  dep_day  = time(departure_at) <  12:00 ? full : half    -- "at or after 12:00 → half"
  ret_day  = time(return_at)    >  19:00 ? full : half    -- "at or before 19:00 → half" (v1: ≥ 19:00 full)
  full = middle + (dep_day == full) + (ret_day == full)
  half = (dep_day == half) + (ret_day == half)
days = full + 0.5 × half                                   -- the Excel's "Quantity 19.5"
```
Worked: 2026-03-02 09:00 → 2026-03-21 17:00: n = 19, middle 18, dep full, ret half → full 19, half 1, nights 19, days 19.5. 2026-03-09 14:00 → 2026-03-11 16:00: n = 2, middle 1, dep half, ret half → full 1, half 2, days 2.0. All cases in `fixtures/day-count-cases.json` with both the v1 result and the v3 result where they differ.

### 4.2 Amount
```
for each trip day k with its kind (full/half) and calendar year y:
  base_k = normalbelopp(country, y).day_amount × (kind == full ? 1 : 0.5) × long_stay_factor
day_total = Σ base_k
meal_deduction (abroad) = Σ over meals: count × pct × (amount of the day the meal belongs to)
   -- v3 assigns meals to days in order (lunches to the first `lunches` days, etc.); when counts are entered without days,
   -- apply pct to the full-day amount for full days first, then half-day amount (conservative: deduct more)
   -- a day with all three meals uses all_three (85 %) instead of 15 + 35 + 35
meal_deduction (SE)     = Σ over meals: count × fixed krona amount of the year (full day; halved and rounded for a half day)
night_total = nights_without_paid_lodging × normalbelopp(country, y).night_amount (default day_amount / 2) × long_stay_factor?  (night factor: §9.2)
total = max(0, day_total − meal_deduction) + night_total
```
v1 (R7–R9): `dayRate × full + dayRate × 0.5 × half − meals × dayRate × 0.15` (form) with `nightRate × overnights` for SE only — port the structure, not the constants.

Worked with v1's 2025 values (fixture): CH 1 402, SE 290/145.
- CH, 2026-03-09 07:00 → 03-11 21:00, no meals: full 3 → 4 206.00 SEK; nights 2 but lodging paid → 0; total 4 206.00.
- CH, same trip, 2 lunches: deduction 2 × 0.35 × 1 402 = 981.40 → 3 224.60.
- CH, 19.5 days (above), 18 lunches: 19 × 1 402 + 0.5 × 1 402 = 27 339.00; − 18 × 0.35 × 1 402 = 8 832.60 → 18 506.40 SEK (the Excel's Meal Allowance row for such a trip; verify against the owner's sheet).
- SE, 2 nights 3 full days, all meals 1 day, lodging not paid 2 nights: 3 × 290 = 870 − 261 = 609; + 2 × 145 = 290 → 899.00.

### 4.3 Rate year for trips over New Year (§9.1)
v1: departure year for all days. v3 default: per-day year, flagged. Both are implementable from the same table; the choice is the owner's/accountant's.

### 4.4 Rounding
Amounts are Decimal; SEK totals rounded half-up to 2 dp at the end; SE meal deductions rounded to whole SEK per meal before summing (Skatteverket publishes integers). Percent values are exact constants.

## 5. UI behaviour worth keeping
- **Trip panel on the group page** (entity archetype): departure / return date-time pickers (minute precision; v1 used date + HH:MM — keep the two-field feel), country select showing `name (normalbelopp SEK/day, year)`, agency, meal counters (breakfast / lunch / dinner steppers; v1 had one "meals provided" number — too coarse), nights without paid lodging (default 0, collapsed), long-stay override (collapsed). Live result card as in v1's form (l.500–560): full days, half days, overnights, day rate, meal reduction (`− 981.40`), night allowance, **total**, plus the help line v1 printed: `Skatteverket rules: Full day if departs before 12:00 OR returns after 19:00` → v3 wording: `Departure at or after 12:00 counts half a day; return at or before 19:00 counts half a day; a trip without an overnight stay gives no tax-free per diem.`
- Button `Create per-diem expense` → writes the `per_diem` expense (R26) and opens it; if one exists and is unsettled, `Recompute` replaces it; if settled, `New correction` creates a delta expense.
- Missing rate → inline error with v1's three suggestions (R1), link to the rate table screen pre-filtered on (country, year).
- **Rate table screen** (list archetype, under settings): year tabs, rows country / name / normalbelopp / night / source, and on the SE row the four meal amounts (breakfast / lunch / dinner / all three); `Copy from {year − 1}`; `Paste Skatteverket CSV` text area (R16 parser; preview, then upsert); per-row inline edit; no delete when a trip references the row.
- Strings to port (en; fr new): `Full days`, `Half days`, `Overnights`, `Day rate`, `Meal reduction`, `Night allowance`, `Total`, `Select country...`, `Describe the purpose of this business trip...` (becomes the group description), `No travel allowance rate found for {CC} in {year}`.

## 6. Tests to port — one line each
Validation (`lib/validation/__tests__/travel-allowances.test.ts`):
- `date validation: pass when return date equals departure date` → v3: allowed but computes 0 days with reason (R21). `fail when return date is before departure date` → keep (`return_at > departure_at`).
- `time validation: accept valid HH:MM` / `reject invalid time format` / `reject time with seconds` → n/a (timestamp picker); keep "return after departure same day" as the timestamp ordering check.
- `meals validation: accept valid meal counts` / `fail when breakfast exceeds total days` / `fail when lunch exceeds total days` / `accept all meals for matching days` / `allow null mealsProvided` → port against `full + half` days.
- `long stay rules: accept 50 % factor` / `reject factor > 1` / `reject negative` → keep.
- `country code validation: 2 letters only` → keep.
- `Status Transitions` (18 cases) → n/a (no statuses).
Calculator — v1 had **no tests**; v3 property/unit tests from `fixtures/day-count-cases.json` and `fixtures/meal-reductions.json`:
- day-count table: every case in the fixture, asserting v3 result (and documenting the v1 result where it differs: 19:00 return, same-day trips).
- boundaries: 11:59 vs 12:00 departure; 19:00 vs 19:01 return; DST change weekend (2026-03-28 → 03-30) gives the calendar count, not an ms artefact.
- New Year trip: per-day year rule picks two rate rows; missing next-year row → error names the year.
- meals: 2 lunches on CH 1 402 → 981.40; all three on a half day = 85 % of 701; counts > days rejected; SE whole-krona rounding.
- nights: lodging paid → 0; 2 unpaid SE nights → 290.
- idempotence: recompute with unchanged inputs produces an identical snapshot and does not create a second per-diem expense; settled per diem is frozen.
- RLS: a tenant cannot read another tenant's rate rows.

## 7. Fixtures copied → `specs/traktamente/fixtures/`
- `normalbelopp.csv` — every rate row v1 shipped: the 2025 dev subset from `prisma/seed.ts` (SE 290/145, DE 774, GB 958, FR 774, NL 774, NO 1 043, DK 774, FI 542, US 889, CH 1 402; `source=v1-seed`) and the Swedish domestic series 2020–2025 from `rate-import.ts` (`source=v1-rate-import`). Columns `publisher,year,country_code,country_name_sv,day_amount_sek,night_amount_sek,currency,source`. **Verify against Skatteverket before use; 2026 is not included** (fetch blocked, see header).
- `skatteverket-csv-sample.csv` — the official file format as documented in `rate-import.ts` l.7–11 (header + 2 rows), for the paste parser test.
- `meal-reductions.json` — v1 constants (domestic SEK amounts, international percentages, long-stay factors) and the half-day SE amounts for 2025 derived from Skatteverket's rounding, with worked examples.
- `day-count-cases.json` — 16 input cases with v1's expected output (computed from `calculateDays`) and v3's expected output where it differs.
- `v1-country-name-map.json` — the 77 Swedish country names → ISO codes from `rate-import.ts` l.400–478 (for the rate screen's name column and the paste parser).

## 8. v3 mapping — what changes per the decisions
| v1 | v3 | decision |
|---|---|---|
| `TravelAllowance` entity with its own number `TA25-001`, employee partner, statuses DRAFT…REIMBURSED, own payments table | trip details on the expense group + one `per_diem` expense; refunded by H8's settlement; no statuses | D10, §3.8, D18 |
| calculation in the form; server trusts counts and rates (R11), dead server calculator (R14) | one server service `computePerDiem(trip, rates)`; the UI only displays | hexagonal rule (constitution) |
| rate importer (478 lines: CSV + Skatteverket API + name map) + admin API | one-screen yearly table per tenant with copy-last-year and a paste box using the same CSV parsing rules | §3.8 "importer → one-screen table" |
| app-level rates with `ratesPublisher` | tenant rows; publisher implicit (Swedish AB → Skatteverket) | D16 (RLS), one tenant |
| one "meals provided" count × 15 % | breakfast / lunch / dinner counts; abroad × 15 / 35 / 35 % (85 % all three) of the day's amount, in Sweden the year's fixed krona amounts from the table | D10 "you enter meals paid separately", Excel `lunch(s) = 18` |
| night allowance = nights × 145 (SE), 0 abroad | nights **without paid lodging** × night amount, any country | Skatteverket rule; hotel is a receipt in the group |
| same-day trip = 1 day | 0 (no overnight) with reason | Skatteverket rule |
| return at 19:00 → full day | half day | Skatteverket wording |
| departure year for the whole trip | per-day year, flagged (open §9.1) | |
| `isLongStay` flag → 0.7 only | factor 0.7 / 0.5 from a date or override | R6 kept |
| journal posting Dr 5800 / Cr 1920 on reimbursement (dead) | nothing posted; BAS category on the per-diem expense; accountant books from the package | D1 |
What the Excel does better than v1: meals as a count of lunches per trip; 19.5 days as one quantity; the allowance as a row of the trip group next to the receipts, so the accountant sees it with the flight and the hotel. What v1 did better than the Excel: the day count from timestamps (no hand counting), the rate table per year, the breakdown stored as a snapshot, the "rate missing" guidance. v3 keeps both.

## 9. Open questions for the owner
1. **Rate year for a trip over New Year** (R22, §4.3): per-day year (v3 proposal) or the departure year for the whole trip (v1's reading of Skatteverket)? Ask the accountant; it only matters for the Christmas–January trip.
2. **Night allowance**: do you ever sleep in lodging the company did not pay (friends, own flat)? If never, drop `nights_without_paid_lodging` from the UI (keep the column at 0). Also confirm with the accountant whether the long-stay factor applies to the night amount (v3 proposal: no).
3. **Day trips**: v1 paid a full/half day for a same-day trip; Skatteverket's tax-free rule needs an overnight. v3 computes 0. Do you want an explicit "taxable per diem" option for day trips (it would be salary, not a tax-free expense) or simply nothing?
4. **Meals and days**: counts only (`lunches = 18`, deducted at the full-day amount first) or meals per calendar day (a checkbox grid)? Counts match the Excel and are proposed; the grid is more exact when half days carry a meal.
5. **Countries**: the table starts empty; confirm the starter list (CH, SE, DE, FR, NL, BE, AT, IT, ES, DK, FI, NO, BA?) so the rate screen can show empty rows for 2026 to fill in, and provide Skatteverket's 2026 figures (the live dataset fetch was blocked for this harvest).
6. **Per-diem document**: is the trip page's computed breakdown (rendered to PDF with the business key `Ex{group}-Tr-{seq}_{return date}_`) enough as the justification document for the accountant, or do you want the breakdown printed inside the reimbursement statement only?
