# Clock Abstraction & Exchange Rate Storage

Testable time abstraction and immutable ECB rate cache for DefterFab.

## Clock Interface

`src/kernel/clock/clock.ts` exports a `Clock` interface used by all time-dependent service code.

```typescript
interface Clock {
  now(): Date;              // UTC instant — timestamps, audit logs
  today(): string;          // 'YYYY-MM-DD' in Europe/Stockholm
  currentPeriod(): string;  // 'YYYY-MM' in Europe/Stockholm
}
```

### Timezone Rules

- `now()` returns a UTC `Date` object (matches `@db.Timestamptz` in Prisma)
- `today()` and `currentPeriod()` use `Europe/Stockholm` — the legal timezone for Swedish AB operations
- DST transitions: CET (UTC+1) in winter, CEST (UTC+2) in summer

### Usage

Clock is **injected as a function parameter**, not imported as a singleton:

```typescript
function processTransaction(clock: Clock, data: TransactionData) {
  const timestamp = clock.now();
  const period = clock.currentPeriod();
  // ...
}
```

Production uses `createClock()`, tests use `createTestClock(fixedDate)`.

### Test Clock

`createTestClock(fixedTime)` returns a clock with two control methods:

- `setTime(date)` — replace the fixed time
- `advance(ms)` — move time forward by milliseconds

## ECB Rate Storage

The `ecb_rates` table caches ECB reference exchange rates. It is a **global table** — no `tenantId`, no RLS. ECB rates are public data shared across all tenants.

### Schema

| Column | Type | Description |
|--------|------|-------------|
| `date` | DATE | Rate date (composite PK) |
| `currency_pair` | TEXT | e.g. `"EUR/SEK"` (composite PK) |
| `rate` | DECIMAL(18,6) | Exchange rate at ECB precision |
| `fetched_at` | TIMESTAMPTZ | When the rate was cached |

### Immutability

PostgreSQL RULEs prevent UPDATE and DELETE — same pattern as [[audit-trail]]:

```sql
CREATE RULE ecb_rates_no_update AS ON UPDATE TO ecb_rates DO INSTEAD NOTHING;
CREATE RULE ecb_rates_no_delete AS ON DELETE TO ecb_rates DO INSTEAD NOTHING;
```

Operations are silently dropped (rowCount = 0), not thrown as errors.

### Currency Pair Format

Always quote against SEK: `"EUR/SEK"`, `"USD/SEK"`, `"CHF/SEK"`. See [[constants]] for `EXCHANGE_RATE_DECIMAL_PLACES` (6) and `ECB_RATE_STALE_DAYS` (3).

## Related

- [[decimal-currency]] — Decimal arithmetic and boundary rules
- [[audit-trail]] — Immutability pattern reference
- [[constants]] — Business constants (rate precision, stale days)
