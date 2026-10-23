# Feature Specification: Rates — the ECB reference rates every base amount is written with

**Feature Branch**: written after the fact (F78, D45: *converge documents what exists*) — built in v2's rates story, `feat/banking-import` (`rateToBase`), F28 (sync job, Settings → Exchange rates), F29 (#57, backfill by date), F60 (nearest rate, 2026-10-23)

**Created**: 2026-10-23

**Status**: Rules as built — no new behaviour (D3, D4, F60; [[ecb-rates]], [[clock-and-rates]])

**Input**: "A non-base amount gets its base once, with the ECB rate of its date, and keeps it (D3). The rates come from the ECB on their own; when they are missing the app says *run the ECB sync* instead of guessing."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The rates arrive by themselves (Priority: P1)

`rates.ecb-sync` (pg-boss) runs weekdays 16:30 Europe/Stockholm — the ECB publishes ~16:00 CET. A run asks the ECB for enough observations to close the gap of the pair furthest behind (T001); a schedule missed while the app was down runs once on the next start (`missed: "once"`), so one run catches up after days or weeks off.

**Acceptance Scenarios**:

1. **Given** an empty table **When** the job runs **Then** it asks for the last 30 observations.
2. **Given** the newest stored day is yesterday **When** the job runs **Then** it asks for 5 (the floor: the gap in weekdays + 2 for the publication lag).
3. **Given** the app was off for three weeks **When** it starts **Then** one run asks for the missing weekdays + 2 and stores them; never more than 400 in one run.
5. **Given** EUR/SEK current and EUR/CHF two weeks behind (a partial ECB answer) **When** the job runs **Then** it asks for CHF's missing weekdays + 2 and CHF is refilled (T001).
4. **Given** a day already stored **When** it comes back from the ECB **Then** it is skipped, the stored value unchanged.

---

### User Story 2 - See the coverage, fetch now (Priority: P2)

Settings → Exchange rates (`/settings/rates`, owner and accountant): per pair (EUR/SEK, EUR/CHF, EUR/USD) the newest stored day, its rate, and the ECB weekdays of the last 30 days with no stored rate — the last two weekdays not counted (published late). *Fetch now* (owner) queues the same job with the catch-up window; one manual fetch in flight at a time; the table refreshes until the new day shows. The dashboard's *rate gap* item links here; it reads the gaps per pair, the trailing one included (FR-009, F81).

**Acceptance Scenarios**:

1. **Given** the owner **When** she clicks *Fetch now* twice quickly **Then** one job is queued, the second click is told a fetch is running.
2. **Given** the accountant **When** she opens the page **Then** she reads the table, no *Fetch now*.

---

### User Story 3 - Backfill from a date (Priority: P2)

`npx tsx scripts/fetch-rates.ts 2023-04-01` stores every ECB day from that date to today in one request; `fetch-rates.ts [lastN]` the last N observations (default 400, clamped 1..2000). The same fetch as the job, outside the queue; safe to repeat. Used once before entering the books from 2023-04 (roadmap A3).

**Acceptance Scenarios**:

1. **Given** `2023-04-01` **Then** `startPeriod=2023-04-01`, no end, no `lastNObservations`.
2. **Given** a future day, an impossible day (`2023-02-30`) or text **Then** refused with the usage line, nothing fetched.

---

### User Story 4 - The rate a money fact is written with (Priority: P1)

`rateToBase(db, date, from, to)` gives `1 from = rate × to`, crossed through EUR (`EUR/to ÷ EUR/from`, 6 dp half-up), from the stored rates of the date. It is called once, when a fact is written (journal entries, invoices at issue, supplier invoices, expenses, payments, transfer proposals, the VAT return), and the result is stored with the fact.

**Acceptance Scenarios**:

1. **Given** the same currency **Then** rate 1, `same_currency`.
2. **Given** both legs stored on the date **Then** `ecb_daily`, `rateDate` = the date.
3. **Given** a Sunday **Then** Friday's rate, not Monday's, even though Monday is as close — `ecb_nearest`, `rateDate` = Friday.
4. **Given** a mid-week holiday with Tuesday and Thursday stored **Then** Tuesday (earlier wins a tie).
5. **Given** Easter Monday **Then** Maundy Thursday (4 days back — the widest TARGET closure).
6. **Given** the first day of a backfill with nothing earlier **Then** the next later day within 4.
7. **Given** no stored day within 4 calendar days on either side **Then** null — every caller refuses with *No exchange rate for <day> — run the ECB sync*.

### Edge Cases

- `ecb_rates` is global (no tenant, no RLS) and immutable: PostgreSQL RULEs turn UPDATE / DELETE into nothing; duplicates are caught on the primary key `(date, currency_pair)` (RULEs forbid `ON CONFLICT`).
- A fact entered before the ~16:00 publication takes the previous day's rate — the same nearest-day rule.
- EUR itself is a leg of rate 1 on the date.
- The rate is never re-asked for a stored fact; a later sync does not change a written base (D3).

## Requirements *(mandatory)*

- **FR-001** `ecb_rates (date, currency_pair, rate DECIMAL(18,6), fetched_at)`, PK `(date, currency_pair)`, insert-only by RULEs; pairs EUR/SEK, EUR/CHF, EUR/USD (`1 EUR = rate X`).
- **FR-002** `fetchDailyRates(db, { date? | startDate? | lastN? })`: one ECB SDMX request (`EXR/D.{ccy}.EUR.SP00.A`, XML, 30 s timeout), parse, insert each observation, count inserted / skipped; a non-OK response throws.
- **FR-003** `rates.ecb-sync`: schedule *weekdays 16:30 Europe/Stockholm*, `missed: "once"`, retries 3 with backoff; `observationsToFetch(latest, today)` = 30 on an empty table, else weekdays since the newest stored day + 2, clamped 5..400 — taken **per pair**, the largest wins (`catchUpObservations`; a pair never stored = 30). *Fetch now* sizes its job the same way.
- **FR-004** `getRate(db, date, pair)`: exact day → `ecb_daily`; else the closest earlier stored day within `NEAREST_RATE_MAX_DAYS = 4`, else the closest later one within 4 → `ecb_nearest` with `actualDate`; else null. The rate is a decimal string.
- **FR-005** `rateToBase(db, date, from, to)`: as US4; `ecb_nearest` when a leg borrowed a day, `rateDate` = the day the rate comes from — both legs borrowed, the earlier of their days (T004); null when a leg is null.
- **FR-006** `rateStatus(db, today, { windowDays = 30 })`: per pair newest day, its rate, stored weekdays and missing weekdays of the window settled two days back. `today` is the Stockholm day (`clock.today()`).
- **FR-007** `fetchRatesNowAction` (owner) queues `rates.ecb-sync` with the catch-up window under one singleton key; `ratesStatusAction` for anyone signed in.
- **FR-008** `scripts/fetch-rates.ts [yyyy-mm-dd | lastN]` through `fetchRatesArgToOptions(arg, today)`; a day after today (the Stockholm day) is refused.
- **FR-009** `rateGaps(db, today, { windowDays = 30 })` (F81, replaced `detectGaps` on EUR/SEK): per fetched pair, **inner** gaps (≥ 3 missing weekdays between two stored days — Fri → Mon and a TARGET closure are not gaps) and the **trailing** gap (no rate since the pair's newest day, once it is `NEAREST_RATE_MAX_DAYS` old — the day before `getRate` refuses; a pair never stored = the whole window), each with its missing weekdays inside the window. The dashboard's *rate gap* item counts the distinct days missing in any pair.
- **FR-010** Module contract: services take a db handle and return plain results; the rates module never reads a tenant table; Azure-free; the job and the script run the same `fetchDailyRates`.

## Success Criteria *(mandatory)*

- **SC-001** No stored fact borrows a rate from more than 4 calendar days away (DB tests: Sunday, tie, Easter Monday, gap over the cap, backfill's first day; `rateToBase` null on a stale leg); the dashboard warns the day before a leg is refused (F81: a CHF trailing gap with SEK current).
- **SC-002** UPDATE and DELETE on `ecb_rates` change nothing; a duplicate insert is skipped, the stored value unchanged.
- **SC-003** One sync run after N weekdays down stores the N missing days (N ≤ 398).

## Assumptions

- The ECB stays the only source; no bank or manual rate is stored here (a typed rate lives on the fact, `rate_source = manual`).
- The base currency is SEK today; per-tenant base currency is F70 (D39) — `rateToBase` already takes `to`.
- The fetched pairs are a constant, separate from `CURRENCIES` (audit 30, F67).
