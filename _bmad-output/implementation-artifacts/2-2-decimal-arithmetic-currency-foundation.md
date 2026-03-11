# Story 2.2: Decimal Arithmetic & Currency Foundation

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an owner,
I want all currency amounts stored and calculated with precise decimal arithmetic,
So that my financial records have zero rounding errors and are legally accurate.

## Scope

This story establishes the **decimal arithmetic foundation and currency formatting utilities** that all future financial stories depend on. No database schema changes — no currency amount columns exist yet. The first `DECIMAL(15,2)` columns appear in Story 6.3 (journal entries). This story creates the tooling, patterns, constants, and documentation that make those future columns work correctly.

**Delivers:**
- `src/lib/constants.ts` — Business constants (currencies, VAT rates, precision rules, app config). **Client-safe: no `@prisma/client` import.**
- `src/lib/format-currency.ts` — `formatCurrency()` utility. **Client-safe: accepts `string` input only, pure JS implementation.**
- Co-located unit tests for both
- `docs/decimal-currency.md` — Pattern documentation with wiki-links

**Does NOT deliver:**
- Database migrations or schema changes
- Component changes (DualCurrencyDisplay is Story 2.5)
- Service layer changes (future stories add Decimal params as needed)
- Refactoring of existing code to use new constants

## Acceptance Criteria

1. All future currency columns will use `DECIMAL(15,2)` via Prisma's `Decimal` type — this story establishes the convention and precision constants (FR48, NFR19). **No migration in this story.**
2. `Prisma.Decimal` from `@prisma/client` is the canonical Decimal type for all currency operations — no separate `decimal.js` dependency. Service layer code uses `Decimal` objects for all currency operations — never JavaScript `number`.
3. `src/lib/format-currency.ts` exports `formatCurrency()` that formats amounts respecting currency conventions: SEK uses space thousands and comma decimal (`12 500,00`), CHF uses apostrophe thousands and period decimal (`12'500.00`), EUR/USD use comma thousands and period decimal (`12,500.00`).
4. `src/lib/constants.ts` exports `CURRENCIES`, `Currency` type, `BASE_CURRENCY`, `DEFAULT_VAT_RATE_SE`, `DEFAULT_VAT_RATE_CH`, `CURRENCY_DECIMAL_PLACES`, `EXCHANGE_RATE_DECIMAL_PLACES`, and other business constants from the architecture doc.
5. Conversion to `number` only happens at the component display boundary via `formatCurrency()`. The boundary rule is documented.
6. Unit tests verify decimal precision across addition, subtraction, multiplication, and division of currency amounts, including a teaching test demonstrating why `number` construction is dangerous.
7. Unit tests verify formatting output for SEK, CHF, EUR, and USD including zero, negative, and large amounts.
8. `docs/` is updated with Obsidian-style `[[wiki-links]]` documenting the decimal patterns, boundary rule, and currency formatting conventions.

## Tasks / Subtasks

**Tasks are sequential — each depends on the previous.**

- [ ] Task 0: Gate check — verify prerequisites (AC: all)
  - [ ] 0.1 Run `npm run test` — all existing tests pass
  - [ ] 0.2 Run `npm run lint` — no lint errors
  - [ ] 0.3 Verify `@prisma/client` exports `Prisma.Decimal` with arithmetic methods (`.plus()`, `.minus()`, `.times()`, `.dividedBy()`, `.toDecimalPlaces()`)
  - [ ] 0.4 Verify no existing `src/lib/constants.ts` or `src/lib/format-currency.ts` files

- [ ] Task 1: Create constants library (AC: 4)
  - [ ] 1.1 Create `src/lib/constants.ts` with all constants (see Constants Specification below)
  - [ ] 1.2 Create `src/lib/constants.test.ts` verifying types and values

- [ ] Task 2: Create currency formatting utilities (AC: 3, 5)
  - [ ] 2.1 Create `src/lib/format-currency.ts` with `formatCurrency()` (see Format Currency Specification below). **No `@prisma/client` import — client-safe.**
  - [ ] 2.2 Create `src/lib/format-currency.test.ts` with comprehensive test suite (see Test Specification below)

- [ ] Task 3: Documentation (AC: 8)
  - [ ] 3.1 Create `docs/decimal-currency.md` covering the boundary rule, conventions, edge cases, and known gaps
  - [ ] 3.2 Update `docs/index.md` with link to decimal-currency docs

- [ ] Task 4: Final verification (AC: all)
  - [ ] 4.1 Run `npm run test` — all tests pass (existing + new)
  - [ ] 4.2 Run `npm run lint` — no lint errors (run `npx biome check --write` first)
  - [ ] 4.3 Verify no regressions — existing tests unchanged and still passing

## Dev Notes

### Constants Specification

**Critical: `src/lib/constants.ts` MUST NOT import `@prisma/client`.** This file is imported by components (client-side). Importing Prisma would pull the query engine into the browser bundle.

```typescript
// src/lib/constants.ts
// NO Prisma import — this file must be client-safe

// Currency
export const CURRENCIES = ['SEK', 'CHF', 'EUR', 'USD'] as const
export type Currency = (typeof CURRENCIES)[number]
export const BASE_CURRENCY: Currency = 'SEK'

// Precision rules — domain-driven, not arbitrary
export const CURRENCY_DECIMAL_PLACES = 2    // öre/Rappen/cents — legal requirement
export const EXCHANGE_RATE_DECIMAL_PLACES = 6 // ECB publishes at this precision

// VAT rates as numbers — string values for safe Decimal construction in services
// IMPORTANT: Services must construct Decimal from these string values, never from numbers.
// 7.7 as IEEE 754 float is 7.69999...; new Prisma.Decimal('7.7') is exact.
export const DEFAULT_VAT_RATE_SE = 25
export const DEFAULT_VAT_RATE_CH = 7.7
// String versions for safe Decimal construction in service layer:
export const DEFAULT_VAT_RATE_SE_STR = '25'
export const DEFAULT_VAT_RATE_CH_STR = '7.7'

// App configuration constants (from architecture doc line 1595)
export const DEFAULT_PAGE_SIZE = 50
export const MAX_FILE_SIZE_MB = 10
export const SIGNED_URL_TTL_SECONDS = 300
export const OCR_MAX_RETRIES = 3
export const ECB_RATE_STALE_DAYS = 3
export const RATE_LIMIT_WINDOW_MS = 60_000
export const RATE_LIMIT_MAX_REQUESTS = 30
```

**Architecture deviation note:** The architecture doc (line 1595) defines VAT rates as plain numbers (`25`, `7.7`). This story adds `_STR` string constants alongside them because `new Prisma.Decimal(7.7)` captures IEEE 754 imprecision while `new Prisma.Decimal('7.7')` is exact. Services MUST use the string versions for Decimal construction:
```typescript
// In service layer (correct):
const vatAmount = amount.times(new Prisma.Decimal(DEFAULT_VAT_RATE_CH_STR)).dividedBy(100)
// NEVER do this:
const vatAmount = amount.times(new Prisma.Decimal(DEFAULT_VAT_RATE_CH)).dividedBy(100) // imprecise!
```

**Note:** `CURRENCY_DECIMAL_PLACES` and `EXCHANGE_RATE_DECIMAL_PLACES` are additions beyond the architecture doc's constants list — they encode domain precision rules needed by `roundCurrency` and future ECB rate storage.

### Format Currency Specification

**Critical: `src/lib/format-currency.ts` MUST NOT import `@prisma/client`.** This file is called from components at the display boundary. It must be client-safe — pure JavaScript string manipulation only.

```typescript
// src/lib/format-currency.ts
// NO Prisma import — this file must be client-safe
import { type Currency, CURRENCY_DECIMAL_PLACES } from './constants'

/**
 * Format a numeric string for display using currency-specific conventions.
 * Accepts string input (the format received from Server Action serialization).
 * Returns number-only string — no currency code prefix.
 * Currency code display is the component's responsibility.
 *
 * Conventions are CURRENCY-driven, not locale-driven:
 * - SEK: non-breaking space thousands, comma decimal → "12\u00A0500,00"
 * - CHF: apostrophe thousands, period decimal → "12'500.00"
 * - EUR: comma thousands, period decimal → "12,500.00"
 * - USD: comma thousands, period decimal → "12,500.00"
 */
export function formatCurrency(
  amount: string,
  currency: Currency
): string
```

**Implementation details:**
- `formatCurrency` accepts `string` only — components receive serialized strings from Server Actions (`Prisma.Decimal` serializes to JSON as `"12500.00"`). Parse the string internally using plain JS, split on `.`, format integer and decimal parts. No Prisma dependency needed.
- **Error handling:** If `amount` is empty string, `NaN`, or otherwise unparseable, throw a `TypeError` with a descriptive message. Do not silently return a fallback — invalid amounts are bugs that should surface immediately.
- Negative amounts: use minus sign prefix (`-12\u00A0500,00`), not accounting parentheses. Consistent with Stripe-inspired modern UX.
- Always output exactly `CURRENCY_DECIMAL_PLACES` (2) decimal digits — pad with zeros if needed.
- **Thousands separator for SEK:** Use non-breaking space (U+00A0). This prevents line-breaks splitting numbers across lines in table cells. Regular space (U+0020) would allow mid-number wrapping. Narrow non-breaking space (U+202F) has inconsistent browser/font support. U+00A0 is the safe default.
- Do NOT use `Intl.NumberFormat` — conventions are hardcoded per currency, not per locale.

### roundCurrency Pattern (Service Layer)

`roundCurrency` is a **service-layer concern** (rounding before DB storage), not a display concern. Since it requires `Prisma.Decimal`, it MUST NOT live in `src/lib/` (client-safe). Instead, document it as a **one-line inline pattern** for services:

```typescript
// In any service that needs to round before storage:
import { Prisma } from '@prisma/client'
import { CURRENCY_DECIMAL_PLACES } from '@/lib/constants'

// Banker's rounding (ROUND_HALF_EVEN) — EU financial standard
const rounded = amount.toDecimalPlaces(CURRENCY_DECIMAL_PLACES, Prisma.Decimal.ROUND_HALF_EVEN)
```

This is intentionally NOT a helper function export. It's one line. Wrapping it in a function that lives in `src/server/` would add a file and an import for no benefit. Document the pattern in `docs/decimal-currency.md` so every service uses the same rounding mode.

### Test Specification

**`src/lib/constants.test.ts` (6 tests):**
- Verify `CURRENCIES` array contains exactly `['SEK', 'CHF', 'EUR', 'USD']`
- Verify `BASE_CURRENCY` is `'SEK'`
- Verify `DEFAULT_VAT_RATE_SE` equals `25` and `DEFAULT_VAT_RATE_SE_STR` equals `'25'`
- Verify `DEFAULT_VAT_RATE_CH` equals `7.7` and `DEFAULT_VAT_RATE_CH_STR` equals `'7.7'`
- Verify string VAT rate produces exact Decimal: `new Prisma.Decimal(DEFAULT_VAT_RATE_CH_STR)` equals `7.7` exactly
- Verify VAT rate arithmetic via string constant: `new Prisma.Decimal('1000').times(new Prisma.Decimal(DEFAULT_VAT_RATE_CH_STR)).dividedBy(100)` equals exactly `77.00` (not `76.999...`)

**`src/lib/format-currency.test.ts` (~30 tests):**

Precision tests (7 cases) — **use `Prisma.Decimal` not `Decimal` shorthand**:
```
new Prisma.Decimal('0.1').plus('0.2') equals '0.30' (not 0.30000000000000004)
new Prisma.Decimal('1999.99').plus('0.01') equals '2000.00'
new Prisma.Decimal('100').dividedBy('3').toDecimalPlaces(2, ROUND_HALF_EVEN) equals '33.33'
new Prisma.Decimal('100').times('0.25') equals '25.00'
new Prisma.Decimal('99999999999.99').plus('0.01') equals '100000000000.00' (boundary)
new Prisma.Decimal('0').minus('0.01') equals '-0.01' (negative)
new Prisma.Decimal('1000').times(DEFAULT_VAT_RATE_CH_STR).dividedBy('100') equals '77.00'
```

Teaching/anti-pattern tests (2 cases) — **import `{ Prisma } from '@prisma/client'`, never from `decimal.js`**:
```typescript
// Demonstrates why number construction is dangerous
test('demonstrates floating-point danger with number constructor', () => {
  const bad = new Prisma.Decimal(0.1 + 0.2)
  const good = new Prisma.Decimal('0.1').plus('0.2')
  expect(bad.equals(new Prisma.Decimal('0.3'))).toBe(false)  // FAILS — proves the danger
  expect(good.equals(new Prisma.Decimal('0.3'))).toBe(true)  // PASSES — string is safe
})

// Demonstrates why VAT rates must use string construction
test('demonstrates VAT rate precision with string vs number construction', () => {
  const amount = new Prisma.Decimal('10000')
  const badResult = amount.times(new Prisma.Decimal(7.7)).dividedBy(100)
  const goodResult = amount.times(new Prisma.Decimal('7.7')).dividedBy(100)
  expect(badResult.toDecimalPlaces(2).equals(new Prisma.Decimal('770.00'))).toBe(false)
  expect(goodResult.toDecimalPlaces(2).equals(new Prisma.Decimal('770.00'))).toBe(true)
})
```

Formatting tests (16 cases — 4 currencies x 4 scenarios):
Note: SEK space is non-breaking space U+00A0 (`\u00A0`) in expected values.
```
SEK: "12\u00A0500,00" | "0,00" | "-1\u00A0234,56" | "1\u00A0000\u00A0000,00"
CHF: "12'500.00" | "0.00" | "-1'234.56" | "1'000'000.00"
EUR: "12,500.00" | "0.00" | "-1,234.56" | "1,000,000.00"
USD: "12,500.00" | "0.00" | "-1,234.56" | "1,000,000.00"
```

Rounding tests (4 cases) — test using `Prisma.Decimal` directly (this validates the inline pattern from roundCurrency Pattern section):
```
new Prisma.Decimal('33.335').toDecimalPlaces(2, ROUND_HALF_EVEN) → '33.34'
new Prisma.Decimal('33.345').toDecimalPlaces(2, ROUND_HALF_EVEN) → '33.34'
new Prisma.Decimal('33.355').toDecimalPlaces(2, ROUND_HALF_EVEN) → '33.36'
new Prisma.Decimal('0.001').toDecimalPlaces(2, ROUND_HALF_EVEN) → '0.00'
```

Error handling tests (2 cases):
```
formatCurrency('', 'SEK') → throws TypeError
formatCurrency('abc', 'CHF') → throws TypeError
```

Standard input tests (2 cases):
```
formatCurrency('12500.00', 'SEK') → "12\u00A0500,00"
formatCurrency('0', 'CHF') → "0.00"
```

### Architecture Constraints

- **Client-safe `src/lib/`**: Files in `src/lib/` are imported by components. They MUST NOT import `@prisma/client`, `next/*`, `src/server/*`, or `src/components/*`. Both `constants.ts` and `format-currency.ts` must be pure TypeScript with zero server dependencies.
- **No new dependencies**: `Prisma.Decimal` from `@prisma/client` provides full decimal.js arithmetic in the service layer. Do NOT install `decimal.js` separately.
- **Import path in services**: Always `import { Prisma } from '@prisma/client'` then `Prisma.Decimal`. Never import from `decimal.js` directly.
- **String constructors only**: `new Prisma.Decimal('123.45')` — NEVER `new Prisma.Decimal(123.45)`. Number constructor captures IEEE 754 imprecision.
- **Naming**: files use kebab-case (`format-currency.ts`), exports use camelCase (`formatCurrency`)
- **Tests co-located**: `.test.ts` files next to source files, run via Vitest. Note: precision and rounding tests import `Prisma` (these are server-side tests), while formatting tests do not need Prisma.

### Edge Cases and Future Considerations

**JSON serialization**: `Prisma.Decimal` serializes to JSON as a plain string (`"12500.00"`). When Server Actions return objects with Decimal fields, components receive strings. This is why `formatCurrency` accepts `string` — it matches the actual data type at the component boundary. If Prisma's serialization format changes in a future major version, `formatCurrency` may need updating.

**Audit log representation**: Story 2.1's audit logs store `oldData`/`newData` as JSONB. When future entities have Decimal fields, amounts will appear as strings in JSONB — lossless and human-readable.

**Currency additions**: Adding NOK or GBP in the future requires: one entry in `CURRENCIES` array (type updates automatically), one formatting case in `formatCurrency`. No migrations, no breaking changes.

**Known gap — no static enforcement**: The "Decimal stays Decimal until `formatCurrency`" boundary rule is enforced by convention and code review, not by tooling. A custom lint rule flagging `.toNumber()` on Decimal instances would be an ideal future improvement.

### Project Structure Notes

```
src/lib/constants.ts           — NEW (business constants)
src/lib/constants.test.ts      — NEW (type and value verification)
src/lib/format-currency.ts     — NEW (formatting + rounding utilities)
src/lib/format-currency.test.ts — NEW (precision, formatting, rounding tests)
docs/decimal-currency.md       — NEW (patterns documentation)
docs/index.md                  — MODIFIED (add link)
```

No existing files are modified except `docs/index.md`. Zero regression risk.

### Previous Story Intelligence (2.1)

- Always run `npx biome check --write` before committing — CI lint catches formatting
- Existing test patterns in `settings.test.ts` work reliably — but this story uses pure unit tests (no DB, no mocking), even simpler
- Documentation pattern: create `docs/<topic>.md` with Obsidian `[[wiki-links]]`, update `docs/index.md`
- The `toAuditData()` helper in `audit.ts` will encounter Decimal fields in future stories — Prisma serializes them as strings in JSONB, which is correct behavior

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 2, Story 2.2]
- [Source: _bmad-output/planning-artifacts/architecture.md — Money & Dates conventions, line 823]
- [Source: _bmad-output/planning-artifacts/architecture.md — Constants definition, line 1595]
- [Source: _bmad-output/planning-artifacts/architecture.md — Currency formatting conventions, line 307]
- [Source: _bmad-output/planning-artifacts/architecture.md — ECB Rate Cache, line 350]
- [Source: _bmad-output/planning-artifacts/prd.md — FR48 (decimal arithmetic), FR49 (immutable rates)]
- [Source: _bmad-output/planning-artifacts/prd.md — NFR19 (zero rounding errors)]
- [Source: _bmad-output/planning-artifacts/prd.md — Financial data integrity, line 312]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — DualCurrencyDisplay component, line 1008]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Financial typography, line 520]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Thousands separators, line 529]
- [Source: _bmad-output/implementation-artifacts/2-1-audit-trail-infrastructure.md — Previous story patterns]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
