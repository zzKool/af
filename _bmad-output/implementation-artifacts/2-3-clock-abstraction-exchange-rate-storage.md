# Story 2.3: Clock Abstraction & Exchange Rate Storage

Status: done

## Story

As an owner,
I want exchange rates preserved immutably for every transaction and time-dependent logic to be testable,
so that historical financial records remain accurate and the system behaves predictably in tests.

## Acceptance Criteria

1. **Given** the Prisma schema and decimal arithmetic are in place from previous stories
   **When** time-dependent logic or exchange rates are used
   **Then** `src/server/services/clock.ts` exports a `Clock` interface with `now()` (UTC instant), `today()` (YYYY-MM-DD in Europe/Stockholm), and `currentPeriod()` (YYYY-MM in Europe/Stockholm)

2. **And** production uses a real clock implementation; tests use an injectable mock with a fixed, controllable time

3. **And** an `ecb_rates` table is created with fields: date (DATE), currency_pair (TEXT), rate (DECIMAL), fetched_at (TIMESTAMPTZ) — immutable, no UPDATE allowed

4. **And** rates in the ecb_rates table cannot be modified once written — PostgreSQL constraints prevent UPDATE and DELETE (FR49)

5. **And** unit tests verify Clock mock produces deterministic dates across timezone boundaries

6. **And** integration tests verify that attempting to UPDATE an ecb_rates row fails

7. **And** `docs/` is updated with Obsidian-style `[[wiki-links]]` documenting any new concepts, patterns, or configurations introduced in this story

## Tasks / Subtasks

- [x] Task 1: Create Clock interface and implementations (AC: #1, #2)
  - [x] 1.1 Define `Clock` interface in `src/server/services/clock.ts` with `now()`, `today()`, `currentPeriod()`
  - [x] 1.2 Implement `RealClock` class using system time with Europe/Stockholm timezone for date ops
  - [x] 1.3 Implement `TestClock` class with injectable fixed time + `advance()` / `setTime()` methods
  - [x] 1.4 Export factory: `createClock()` for production, `createTestClock(fixedTime)` for tests
- [x] Task 2: Create `ecb_rates` Prisma model and migration (AC: #3, #4)
  - [x] 2.1 Add `EcbRate` model to `prisma/schema/app.prisma` — NOT following mandatory template (no tenantId, no updatedAt, no createdBy, no source — this is a cache of external public data, see Dev Notes)
  - [x] 2.2 Run `prisma migrate dev --name add-ecb-rates-table`
  - [x] 2.3 Add PostgreSQL RULE in migration to prevent UPDATE and DELETE on `ecb_rates`
  - [x] 2.4 Verify no RLS needed — ecb_rates is a global table with public data shared across all tenants
- [x] Task 3: Write Clock unit tests (AC: #5)
  - [x] 3.1 Test `RealClock.now()` returns Date within 100ms of `Date.now()` (proves real system time, not stale)
  - [x] 3.2 Test `TestClock` with fixed time returns deterministic values
  - [x] 3.3 Test `today()` timezone boundary: UTC 23:00 on March 10 = Stockholm March 11 (CET+1)
  - [x] 3.4 Test `today()` DST transition: Europe/Stockholm switches CET→CEST last Sunday of March
  - [x] 3.5 Test `today()` at exact DST transition moment: UTC 2026-03-29T01:00:00Z (Stockholm jumps 02:00→03:00)
  - [x] 3.6 Test `currentPeriod()` returns YYYY-MM matching `today()` month
  - [x] 3.7 Test `TestClock.advance()` moves time forward correctly
  - [x] 3.8 Test `createTestClock()` throws on Invalid Date input
- [x] Task 4: Write ecb_rates immutability integration tests in `src/server/services/ecb-rates.test.ts` (AC: #6)
  - [x] 4.1 Insert a rate row, attempt UPDATE via raw SQL, assert `rowCount === 0` and verify original data unchanged (RULE does `DO INSTEAD NOTHING` — silent, not throwing)
  - [x] 4.2 Insert a rate row, attempt DELETE via raw SQL, assert `rowCount === 0` and verify data still exists
  - [x] 4.3 Verify INSERT succeeds for new rate (happy path)
  - [x] 4.4 Verify second INSERT with same `(date, currency_pair)` throws unique constraint error (composite PK validation)
- [x] Task 5: Update documentation (AC: #7)
  - [x] 5.1 Create `docs/clock-and-rates.md` with wiki-links — keep brief: interface definition, timezone rules, immutability rationale, one usage example. Match `docs/decimal-currency.md` in length/style
  - [x] 5.2 Update `docs/index.md` with link to new doc
- [x] Task 6: Run full test suite and lint
  - [x] 6.1 `npm run test` — all tests pass (123/123, 12 files)
  - [x] 6.2 `npx biome check --write` — lint clean

## Dev Notes

### Clock Service Architecture

**File:** `src/server/services/clock.ts`

The Clock interface provides a testable time abstraction. All time-dependent service code MUST use Clock — never `new Date()` directly.

```typescript
// Interface
export interface Clock {
  now(): Date;              // UTC instant — for timestamps, audit logs
  today(): string;          // 'YYYY-MM-DD' in Europe/Stockholm — for date fields, rate lookups
  currentPeriod(): string;  // 'YYYY-MM' in Europe/Stockholm — for period filtering, business keys
}
```

**Timezone rules:**
- `now()` → UTC `Date` object (matches `@db.Timestamptz` in Prisma)
- `today()` → Europe/Stockholm timezone (Swedish AB legal timezone). Use `Intl.DateTimeFormat` with `timeZone: 'Europe/Stockholm'` or manual UTC offset calculation
- `currentPeriod()` → Derived from `today()`, just `YYYY-MM` prefix
- **DST awareness:** CET (UTC+1) in winter, CEST (UTC+2) in summer. Last Sunday of March → last Sunday of October

**Production clock:** Simply wraps system time through timezone conversion. Must return a fresh `new Date()` on every `now()` call — never cache or reuse a Date instance.
**Test clock:** Accepts a fixed `Date`, provides `setTime(date)` and `advance(ms)` for test manipulation. Must return defensive copies: `new Date(this.fixedTime.getTime())` — never expose the internal mutable reference. Must validate input Date is not Invalid Date (throw on `NaN` timestamp). **Constrain scope: `setTime()` + `advance()` only — no `freeze()`, `unfreeze()`, `tickTo()` or other time-travel extras.**

**Injection mechanism:** Clock is passed as a function parameter to services that need it, NOT imported as a module-level singleton. This matches the existing pattern where `AuditLogger` is injected via middleware context. **This story only creates the interface and implementations — no consumers or middleware wiring yet.** That happens in stories 6.1+.

**Downstream consumers (future stories):**
- Story 6.1: ECB rate fetching cron job uses `clock.today()` to determine which date to fetch
- Story 6.2: Bank CSV import uses `clock.now()` for audit timestamps
- Story 6.3: Journal entry creation uses `clock.currentPeriod()` for business key generation

### ECB Rates Table Design

**CRITICAL DECISION — Global vs Tenant-Scoped:**
The `ecb_rates` table stores ECB reference rates. These are **public data** (same for all tenants). However, following the project's strict RLS pattern, there are two approaches:

**Recommended approach (matches architecture doc):** Make `ecb_rates` a global table without `tenantId` — ECB rates are identical for all tenants. This matches the architecture doc's schema: `ecb_rates(date DATE, currency_pair TEXT, rate DECIMAL, fetched_at TIMESTAMPTZ)` with no tenantId field. RLS can be disabled for this table since the data is public.

**Implementation:**
- No `tenantId` column — rates are shared across tenants
- No RLS policy needed — data is public (ECB publishes openly)
- Skip mandatory `createdBy`, `source`, `updatedAt` template fields — this is a cache of external data, not a user-created entity
- Keep `fetched_at` as the creation timestamp instead of `createdAt` (architecture spec names it `fetched_at`)
- Primary key: composite `(date, currency_pair)` — one rate per pair per day

**Prisma model:**
```prisma
model EcbRate {
  date         DateTime @db.Date
  currencyPair String   @map("currency_pair")
  rate         Decimal  @db.Decimal(18, 6)
  fetchedAt    DateTime @default(now()) @map("fetched_at") @db.Timestamptz

  @@id([date, currencyPair])
  @@map("ecb_rates")
}
```

**Immutability enforcement (same pattern as audit_logs in Story 2.1):**
```sql
CREATE RULE ecb_rates_no_update AS ON UPDATE TO ecb_rates DO INSTEAD NOTHING;
CREATE RULE ecb_rates_no_delete AS ON DELETE TO ecb_rates DO INSTEAD NOTHING;
```

**Rate precision:** Use `DECIMAL(18,6)` — ECB publishes 4-6 decimal places, `EXCHANGE_RATE_DECIMAL_PLACES = 6` is already defined in `src/lib/constants.ts`

**Currency pair format:** Use `"EUR/SEK"`, `"CHF/SEK"`, `"USD/SEK"` format. Always quote against SEK (base currency). Store the pair as TEXT, not two separate columns — simpler queries. No CHECK constraint on `currency_pair` — the set of pairs will grow when tenants configure new currencies (story 3.x). Validation belongs in the service layer, not the schema.

**Duplicate INSERT behavior:** The composite PK `(date, currency_pair)` means a second INSERT with the same key throws a unique constraint error. Story 6.1's rate fetching cron should use `ON CONFLICT DO NOTHING` (upsert-ignore) to handle retry scenarios gracefully.

**Prisma `@db.Date` behavior:** Prisma returns `@db.Date` fields as full `Date` objects at midnight UTC. For lookups, pass `new Date('YYYY-MM-DD')` — Prisma handles the DATE cast.

**Expected end state:** This story creates the schema only. Rate population happens in story 6.1. An empty `ecb_rates` table is the correct and expected end state after this story.

### Testing Approach

**Clock tests** (`src/server/services/clock.test.ts`):
- Unit tests only — no database needed
- Test in "server" Vitest project (not "lib" — Clock is server-side)
- Key timezone test cases:
  - UTC 2026-03-10T23:30:00Z → Stockholm 2026-03-11 (CET, UTC+1)
  - UTC 2026-03-29T00:30:00Z → Stockholm 2026-03-29 (DST transition day, CET→CEST)
  - UTC 2026-10-25T00:30:00Z → Stockholm 2026-10-25 (DST transition day, CEST→CET)

**ECB rates immutability tests** (`src/server/services/ecb-rates.test.ts` — separate file, never mixed with clock.test.ts):
- Integration tests — require test database (port 5433)
- Follow story 2.1 audit_logs pattern: raw SQL to attempt UPDATE/DELETE, assert `rowCount === 0` and verify data unchanged (RULE does `DO INSTEAD NOTHING` — silent drop, not throw)
- Since `ecb_rates` has no RLS, tests can use admin pool or app pool without `SET LOCAL` — be explicit about which pool and why
- Test fixture: insert a known rate, then verify immutability
- Add duplicate INSERT test: same `(date, currency_pair)` should throw unique constraint error

**Vitest config:** Clock tests go in "server" project (`src/server/**/*.test.ts`), already configured

### Dependencies from Story 2.2

- Import `EXCHANGE_RATE_DECIMAL_PLACES` from `src/lib/constants.ts` for rate precision validation
- Import `ECB_RATE_STALE_DAYS` from `src/lib/constants.ts` for gap detection (future use in story 6.1)
- Use `Prisma.Decimal` with **string constructors only**: `new Prisma.Decimal('1.234567')`
- Banker's rounding for rates: `rate.toDecimalPlaces(EXCHANGE_RATE_DECIMAL_PLACES, Prisma.Decimal.ROUND_HALF_EVEN)`

### Anti-Patterns to Avoid

1. **Never use `new Date()` in services** — always use `clock.now()`, `clock.today()`, or `clock.currentPeriod()`
2. **Never use `Date.now()` or `performance.now()`** in service logic — use Clock
3. **Never cache or mutate the Date returned by `clock.now()`** — it's a mutable object. Always treat as read-only or request a fresh one
4. **Never create a module-level `const clock = createClock()` singleton** — Clock is injected as a function parameter to services (matches AuditLogger pattern)
5. **Never install `decimal.js`** — use `Prisma.Decimal` from `@prisma/client`
6. **Never use number constructors for Decimal** — always string: `new Prisma.Decimal('6.123456')`
7. **Never use `Intl.NumberFormat`** for currency formatting — hardcoded per-currency rules in `format-currency.ts`
8. **Never add `updatedAt` to immutable tables** — `ecb_rates` and `audit_logs` are append-only
9. **Never create RLS policy for `ecb_rates`** — it's global public data, not tenant-scoped
10. **Never use `moment.js` or `date-fns`** for timezone — use native `Intl.DateTimeFormat` with `timeZone: 'Europe/Stockholm'`
11. **Never add extra TestClock methods** beyond `setTime()` and `advance()` — no `freeze()`, `unfreeze()`, `tickTo()`, or time-travel frameworks
12. **Never expect immutability RULEs to throw** — PostgreSQL `DO INSTEAD NOTHING` silently drops with `rowCount === 0`, it does not raise an error

### Project Structure Notes

- Clock service: `src/server/services/clock.ts` (matches architecture doc file tree)
- Clock tests: `src/server/services/clock.test.ts` (co-located per convention)
- ECB rate model: `prisma/schema/app.prisma` (add to existing file)
- Migration: `prisma/migrations/<timestamp>_add_ecb_rates_table/migration.sql`
- Documentation: `docs/clock-and-rates.md`
- No changes to `src/lib/` needed (constants already defined in story 2.2)
- No changes to `src/components/` (no UI in this story)
- No changes to `src/server/actions/` (no Server Actions needed yet)
- **Test cleanup:** `ecb_rates` has no `tenantId`, so existing `cleanupTestData()` won't cover it. Add `ecb_rates` to the TRUNCATE list separately in test setup/teardown
- **Clock interface is a stable contract** — no method additions without backward compatibility (stories 6.1+ depend on it)

### Git Intelligence (from story 2.2)

**Commit pattern:** Small, focused commits per task with conventional prefix
- Story 2.2 commits: `feat:` for new files, `fix:` for corrections, `test:` for test additions, `docs:` for documentation, `chore:` for config/status
- Always run `npx biome check --write` before committing
- Story 2.1 pattern for immutability: PostgreSQL RULE (not TRIGGER) — same pattern for ecb_rates

**Files from story 2.2 to be aware of:**
- `src/lib/constants.ts` — contains `EXCHANGE_RATE_DECIMAL_PLACES = 6`, `ECB_RATE_STALE_DAYS = 3`
- `vitest.config.ts` — has "lib", "server", "client" test projects
- `docs/decimal-currency.md` — rounding patterns and Decimal boundary rules

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3] — AC and user story
- [Source: _bmad-output/planning-artifacts/architecture.md#Clock Abstraction] — Clock interface spec
- [Source: _bmad-output/planning-artifacts/architecture.md#ECB Rate Cache] — ecb_rates schema
- [Source: _bmad-output/planning-artifacts/architecture.md#Prisma Model Template] — mandatory model fields
- [Source: _bmad-output/planning-artifacts/architecture.md#Testing Standards] — Vitest workspace config
- [Source: _bmad-output/planning-artifacts/prd.md#FR49] — immutable exchange rates
- [Source: _bmad-output/planning-artifacts/prd.md#FR16] — local ECB rate storage
- [Source: _bmad-output/planning-artifacts/prd.md#FR17] — 3-day gap flagging
- [Source: _bmad-output/implementation-artifacts/2-2-decimal-arithmetic-currency-foundation.md] — Decimal patterns, testing approach, file conventions
- [Source: docs/decimal-currency.md] — Decimal boundary rules and rounding patterns

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Dev database required `prisma migrate reset` due to checksum mismatch from prior session's migration modification
- Test database auto-migrates via `test-setup.ts` `prisma migrate deploy`

### Completion Notes List

- **Task 1:** Created `Clock` interface with `now()` (UTC Date), `today()` (YYYY-MM-DD Europe/Stockholm), `currentPeriod()` (YYYY-MM). `RealClock` uses `Intl.DateTimeFormat` with sv-SE locale for timezone. `TestClock` with defensive copies, `setTime()`, `advance()`, and Invalid Date validation.
- **Task 2:** Added `EcbRate` Prisma model as global table (no tenantId, no RLS). Composite PK `(date, currency_pair)`. Migration includes `GRANT SELECT, INSERT` for app role and PostgreSQL RULEs for immutability.
- **Task 3:** 13 unit tests covering RealClock system time, TestClock determinism, timezone boundaries (CET+1 offset), DST transitions (CET→CEST), currentPeriod derivation, advance accumulation, defensive copies, and Invalid Date throws.
- **Task 4:** 4 integration tests verifying UPDATE silently dropped (rowCount 0), DELETE silently dropped (rowCount 0), INSERT happy path with fetched_at timestamp, and duplicate key constraint error.
- **Task 5:** Created `docs/clock-and-rates.md` with wiki-links to audit-trail, decimal-currency, and constants. Updated `docs/index.md`.
- **Task 6:** Full suite 126/126 tests pass across 12 files. Biome lint clean.
- **Code Review Fixes:** Cached Intl.DateTimeFormatter at module scope, RealClock.today() derives from this.now(), negative advance() guard, added RealClock format tests, imported MIGRATION_URL in ecb-rates tests, removed redundant afterAll truncate, added JSDoc to TestClock constructor.

### Change Log

- 2026-03-11: Story 2.3 implemented — Clock abstraction + ecb_rates schema + tests + docs
- 2026-03-11: Code review fixes — perf, consistency, test coverage, cleanup (8 issues fixed)

### File List

- `src/server/services/clock.ts` (new) — Clock interface, RealClock, TestClock, factory functions
- `src/server/services/clock.test.ts` (new) — 16 unit tests for Clock
- `src/server/services/ecb-rates.test.ts` (new) — 4 integration tests for ecb_rates immutability
- `prisma/schema/app.prisma` (modified) — Added EcbRate model
- `prisma/migrations/20260311095132_add_ecb_rates_table/migration.sql` (new) — ecb_rates table + GRANT + immutability RULEs
- `src/server/db/test-fixtures.ts` (modified) — Added ecb_rates to TRUNCATE cleanup
- `docs/clock-and-rates.md` (new) — Clock and rate storage documentation
- `docs/index.md` (modified) — Added clock-and-rates link
