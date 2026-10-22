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

- **By schedule** — `rates.ecb-sync` (pg-boss, `modules/rates/jobs/ecb-sync.ts`) runs weekdays at 16:30 Stockholm time while the app is up; the first run takes the last 30 observations, later runs size the window from the gap since the last stored date, missed days catch up once on the next start.
- **From Settings → Exchange rates** (`/settings/rates`, owner and accountant): per pair the newest stored day, its rate and the coverage of the last 30 ECB weekdays (`rateStatus`; the last two weekdays are not counted — the ECB publishes around 16:00 CET and the rate lands later). *Fetch now* (owner) queues the same sync job with the catch-up window (`fetchRatesNowAction`, one manual fetch in flight at a time) and the table refreshes itself until the new day shows. The dashboard's *rate gap* item links here.
- **By hand** — `DATABASE_URL=… npx tsx scripts/fetch-rates.ts 2023-04-01` backfills every ECB day from that date to today (`fetchDailyRates({ startDate })`, one request); `… fetch-rates.ts [lastN]` takes the last N observations instead (default 400 ≈ 18 months of weekdays). A future or impossible day is refused. The same fetch, outside the queue; duplicates are skipped, so it is safe to repeat. Useful on a fresh database before the first scheduled run, and before entering the books from 2023-04.

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
earlier day within 4? ── yes ──► the closest earlier one ──► cached   (Sun → Fri, holiday → the day before)
        │ no
later day within 4?   ── yes ──► the closest later one   ──► cached   (only when nothing earlier: a backfill's first day)
        │ no
      null ──► the caller refuses: "No exchange rate for <day> — run the ECB sync"
```

- **Cap** `NEAREST_RATE_MAX_DAYS = 4` calendar days: the widest ECB/TARGET closure is Easter Monday → Maundy Thursday (Good Friday closed). Anything wider is a sync gap, not a market holiday — refuse rather than lock a weeks-old rate.
- **Earlier wins**, even when a later day is closer (Sunday takes Friday, not Monday) — the previous published day, as the accountant books it. A mid-week tie (Tue / Thu around a holiday) is therefore always the earlier day; one row per day and pair makes the choice deterministic.
- `rateToBase` passes the refusal on: a null leg → null, source `ecb_nearest` when a leg borrowed a day, `rateDate` = that day.
- A transaction entered before the ECB's ~16:00 publication takes the previous day's rate (within the cap) — the same rule.

## Gap Detection

Scans `ecb_rates` for gaps exceeding 3 **weekdays** between consecutive rates.
- Friday → Monday is NOT a gap (normal weekend)
- Friday → Thursday IS a gap (3 weekdays missing: Mon, Tue, Wed)
- Holiday refinement deferred to Story 6.1

## Scheduled sync (`rates.ecb-sync`)

`src/modules/rates/jobs/ecb-sync.ts` — a pg-boss schedule, weekdays 16:30 Europe/Stockholm (ECB publishes ~16:00 CET), `missed: "once"`. Each run sizes its request from the gap: `observationsToFetch(latestStoredDate, today)` = weekdays since the last stored rate + 2, between 5 and 400 (30 on an empty table). So after weeks scaled to zero, the single catch-up run on start refills the gap in one ECB request. Duplicates are skipped by the immutability rule. See [[async-jobs]].

## Service Interface

```typescript
// Outside tenant boundary — no CallerIdentity, no RLS, base Prisma client
fetchDailyRates(prisma, options?)  // Fetch from ECB API, store in DB
getRate(prisma, date, currencyPair)  // Exact day, else earlier-first within 4 days, else null (F60)
detectGaps(prisma, currencyPair, from, to)  // Find missing weekday rates
```

## Related

- [[clock-and-rates]] — Clock interface, `ecb_rates` table schema
- [[decimal-currency]] — Decimal boundary rules
