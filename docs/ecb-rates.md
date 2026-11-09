# ECB Exchange Rate Fetching Service

Extends [clock-and-rates.md](clock-and-rates.md) — which covers the Clock interface and `ecb_rates` table schema.

## ECB SDMX API

- **URL format:** `https://data-api.ecb.europa.eu/service/data/EXR/D.{currencies}.EUR.SP00.A`
- **Response format:** XML (SDMX Generic Data)
- **Rate update schedule:** ~16:00 CET on weekdays
- **No authentication required**

### Verified Currency Pairs

| Pair | Description |
|------|-------------|
| EUR/SEK | Primary — Swedish krona (business currency) |
| EUR/CHF | Swiss franc |
| EUR/USD | US dollar |

All three are published daily by ECB.

### XML Parsing

Uses `fast-xml-parser` (lightweight, zero deps). Key structure:

```
message:GenericData → message:DataSet → generic:Series[]
  → generic:SeriesKey → generic:Value[@id="CURRENCY"]
  → generic:Obs[] → generic:ObsDimension[@value=date] + generic:ObsValue[@value=rate]
```

## Loading rates

- **By schedule** — `rates.ecb-sync` (pg-boss, `modules/rates/jobs/ecb-sync.ts`) runs weekdays at 16:30 Stockholm time while the app is up; the first run takes the last 30 observations, later runs size the window from the pair furthest behind, missed days catch up once on the next start.
- **From Settings → Exchange rates** (`/settings/rates`, owner and accountant): per pair the newest stored day, its rate and the coverage of the last 30 ECB weekdays (`rateStatus`; the last two weekdays are not counted — the ECB publishes around 16:00 CET and the rate lands later). *Fetch now* (owner) queues the same sync job with the catch-up window (`fetchRatesNowAction`, one manual fetch in flight at a time) and the table refreshes itself until the new day shows. The dashboard's *rate gap* item links here (*Gap detection* below).
- **By hand** — `DATABASE_URL=… npx tsx scripts/fetch-rates.ts 2023-04-01` backfills every ECB day from that date to today — the Stockholm day, `clock.today()` (`fetchDailyRates({ startDate })`, one request); `… fetch-rates.ts [lastN]` takes the last N observations instead (default 400 ≈ 18 months of weekdays). A future or impossible day is refused. The same fetch, outside the queue; duplicates are skipped, so it is safe to repeat. Useful on a fresh database before the first scheduled run, and before entering the books from 2023-04.

## Rate Storage

- **Table:** `ecb_rates` — immutable (PostgreSQL RULEs prevent UPDATE/DELETE)
- **INSERT only:** try/catch on unique constraint for idempotent inserts (`ON CONFLICT` cannot be used with tables that have PostgreSQL RULEs)
- **Schema:** `(date DATE, currency_pair TEXT, rate DECIMAL(18,6), fetched_at TIMESTAMPTZ)`
- **Primary key:** `(date, currency_pair)` — one rate per day per pair

## Fallback Strategy (F60)

The rate a document uses is written once (D3), so a wrong fallback is permanent. `getRate(db, date, pair)`:

```
exact day stored?  ── yes ──► ecb_daily
        │ no
earlier day within 4? ── yes ──► the closest earlier one ──► ecb_nearest   (Sun → Fri, holiday → the day before)
        │ no
later day within 4?   ── yes ──► the closest later one   ──► ecb_nearest   (only when nothing earlier: a backfill's first day)
        │ no
      null ──► the caller refuses: "No exchange rate for <day> — run the ECB sync"
```

- **Cap** `NEAREST_RATE_MAX_DAYS = 4` calendar days: the widest ECB/TARGET closure is Easter Monday → Maundy Thursday (Good Friday closed). Anything wider is a sync gap, not a market holiday — refuse rather than lock a weeks-old rate.
- **Earlier wins**, even when a later day is closer (Sunday takes Friday, not Monday) — the previous published day, as the accountant books it. A mid-week tie (Tue / Thu around a holiday) is therefore always the earlier day; one row per day and pair makes the choice deterministic.
- `rateToBase` passes the refusal on: a null leg → null, source `ecb_nearest` when a leg borrowed a day, `rateDate` = that day — when both legs borrowed different days, the earlier of the two. `getRate` and `rateToBase` say `ecb_nearest` alike, the word a money fact stores in `rate_source`.
- A transaction entered before the ECB's ~16:00 publication takes the previous day's rate (within the cap) — the same rule.

## Gap detection (F81)

`rateGaps(db, today, { windowDays = 30 })` — per pair (EUR/SEK, EUR/CHF, EUR/USD), because `getRate` refuses per leg: a CHF gap shows while SEK is current.

```
stored:   … Mon  Tue  ·    ·    ·   Mon ……… Thu  Fri  ·    ·    ·  [today]
               └─ inner: ≥ 3 weekdays ─┘          └─ trailing: no rate since Fri ─┘
```

- **Inner** — 3 or more ECB weekdays without a rate between two stored days. Fri → Mon is no gap; nor is a TARGET closure, two weekdays at most (Good Friday + Easter Monday; 25–26 Dec).
- **Trailing** — no rate since the pair's newest day, once that day is `NEAREST_RATE_MAX_DAYS` (4) calendar days old: the last day a fact dated today still borrows it, so the warning shows **the day before** `getRate` refuses. A normal Monday morning (Friday's rate, 3 days) shows nothing. A pair never stored is one trailing gap over the window.
- Each gap names its missing weekdays inside the window (a gap begun earlier is clipped). Before a pair's first stored day nothing is flagged — that is *not fetched yet*, the backfill's job.
- Known noise: the morning after a TARGET closure next to a weekend (Easter Monday, Tuesday until 16:30) the trailing gap shows — and on Easter Tuesday morning a fact *is* refused until the day's run.
- Read by the dashboard's *rate gap* item (the distinct days missing in any pair, [[dashboard]]). Settings → Exchange rates shows the same coverage per pair through `rateStatus` (missing weekdays of the window, settled two days back).

## Scheduled sync (`rates.ecb-sync`)

`src/modules/rates/jobs/ecb-sync.ts` — a pg-boss schedule, weekdays 16:30 Europe/Stockholm (ECB publishes ~16:00 CET), `missed: "once"`. Each run sizes its request from the **pair furthest behind** (`catchUpObservations`, T001): per pair `observationsToFetch(newest, today)` = weekdays since that pair's newest stored day + 2, between 5 and 400 (30 for a pair never stored), and the largest wins — a pair that missed a run while another was stored (a partial ECB answer, a pair added later) is refilled too. *Fetch now* sizes its job the same way (`catchUpWindow`). So after weeks scaled to zero, the single catch-up run on start refills the gap in one ECB request. Duplicates are skipped by the immutability rule. See [[async-jobs]].

## Service Interface

```typescript
// Outside tenant boundary — no CallerIdentity, no RLS, base Prisma client
fetchDailyRates(prisma, options?)       // Fetch from ECB API, store in DB; a stored day is skipped, unchanged
getRate(prisma, date, currencyPair)      // Exact day, else earlier-first within 4 days, else null (F60)
rateToBase(prisma, date, from, to)       // from → to through EUR; null when a leg is refused
rateGaps(prisma, today, options?)        // Per pair: inner + trailing gaps of the window (F81)
rateStatus(prisma, today, options?)      // Per pair: newest day, its rate, window coverage (Settings)
```

DTOs in `modules/rates/types.ts` as plain strings (`RateLookupResult`, `EcbRateFetchResult`, `RateGap`, `RatePairStatus`); `BaseRateResult.rate` is still a Decimal — six modules compute with it (`specs/rates/tasks.md` T007).

## Related

- [[clock-and-rates]] — Clock interface, `ecb_rates` table schema
- [[decimal-currency]] — Decimal boundary rules

## The page — *Exchange rates* in the menu (F136, D76 phase 3)

`/rates`, under *Records* in the rail (owner and accountant; `/settings/rates` sends here). Built from the board *Exchange rates* (D77). The base is the tenant's (`tenants.currency` through the kernel's `tenantProfile`, D39) — never a constant.

```
┌ Exchange rates · "SEK for one unit of each currency …"                    [Fetch now] ┐
│ [CHF/SEK 11.02 ▲▼ 30 d · 1 y · year range] [EUR/SEK …] [USD/SEK …]                   │
│ ┌ SEK exchange rate  ● CHF ● EUR ● USD              30 days · 90 days · 1 year · All ┐ │
│ │  one line per currency (hand-drawn SVG, a crosshair with the day's rates)          │ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Do I have every day? ── years × months ──┐ ┌ The rate on a given day ─────────────┐ │
│ │ complete · N missing · before the first  │ │ day → CHF / EUR / USD, and the day   │ │
│ │ "N ECB days are missing, from …"         │ │ each rate comes from (nearest rule)  │ │
│ └──────────────────────────────────────────┘ └──────────────────────────────────────┘ │
│ ┌ The ECB pairs (the old settings table: newest day, rate, the last 30 days) ──────┐  │
```

- **Series** — `rateHistory(db, from, to)` (the stored rows, at most five years back) → `crossSeries(rows, base, CURRENCIES)`: `X/base = EUR/base ÷ EUR/X` on each day both legs are stored, 6 dp — the cross `rateToBase` uses. The cards compute now / 30 days / 1 year / the year's range from it, in the browser.
- **Coverage** — `rateCoverage(db, today)`: `rateGaps` over the whole span from the first stored day (inner gaps ≥ 3 weekdays and the trailing gap — a TARGET closure is not missing), counted per month by `monthCoverage`; the grid starts in January of the first year.
- **A day** — `ratesOnDayAction({ date })` → `ratesOnDay`: `rateToBase` per currency, with `ecb_nearest` and the day borrowed, or nothing within the 4-day cap.
- **The rail's count** — the distinct missing days of the last 30 (the dashboard's *rate gap* count, which now links here).


## My transfers on the chart (F161, the owner's gap audit 2026-11-09)

The chart's **⇄ My CHF → SEK transfers** chip (shown when there is one) draws each transfer out of a foreign account into the base as a dashed line on its day, labelled with the bank's rate and the ECB's of that day — `2026-03-16 · CHF 10.7400 · ECB 10.7500`. The transfers are banking's `foreignTransfers` (`implicit-rate.ts`): every outgoing foreign-currency row paired as a `transfer` with a base-currency row, the pair's implied rate (D44) — derived on read, nothing stored; the page reads it in the tenant's transaction (the rates themselves are global). The primary names the gap: **Fetch the N missing day(s)** when weekdays are missing since the first stored day, else *Fetch now*.
