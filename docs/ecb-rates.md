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

## Rate Storage

- **Table:** `ecb_rates` — immutable (PostgreSQL RULEs prevent UPDATE/DELETE)
- **INSERT only:** try/catch on unique constraint for idempotent inserts (`ON CONFLICT` cannot be used with tables that have PostgreSQL RULEs)
- **Schema:** `(date DATE, currency_pair TEXT, rate DECIMAL(18,6), fetched_at TIMESTAMPTZ)`
- **Primary key:** `(date, currency_pair)` — one rate per day per pair

## Fallback Strategy

When exact date rate is missing (weekends, holidays):
1. Try exact date match → `rate_source: 'ecb_daily'`
2. Fall back to nearest cached rate (by date distance) → `rate_source: 'cached'`

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
getRate(prisma, date, currencyPair)  // Lookup with fallback
detectGaps(prisma, currencyPair, from, to)  // Find missing weekday rates
```

## Related

- [[clock-and-rates]] — Clock interface, `ecb_rates` table schema
- [[decimal-currency]] — Decimal boundary rules
