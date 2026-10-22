# Decimal Arithmetic & Currency Formatting

Conventions for handling money and decimal arithmetic in AF.

## The Boundary Rule

**Decimal stays Decimal until the component display boundary.**

```
DB (DECIMAL 15,2) → Prisma.Decimal → Service layer → Server Action → JSON string → formatCurrency()
```

- **Services** operate on `Prisma.Decimal` objects — never `number`.
- **Server Actions** return objects whose Decimal fields are serialized as JSON strings (`"12500.00"`).
- **Components** receive strings and call `formatCurrency(amount, currency)` for display.
- Conversion to JavaScript `number` only happens implicitly inside `formatCurrency()` — nowhere else.

> **Enforced:** a Biome plugin (`biome-plugins/decimal-to-number.grit`) fails the lint on any `.toNumber()` outside a `components/` folder. In a service, compare Decimals with `.eq()` / `.gt()` / `.isZero()`.

## Decimal Type

Use `Prisma.Decimal` from `@prisma/client` (which wraps decimal.js). **Never install `decimal.js` separately.**

```typescript
// In service layer:
import { Prisma } from '@prisma/client'

const amount = new Prisma.Decimal('123.45')  // Always use string constructor
const total = amount.plus('10.00')           // Arithmetic returns Decimal
```

### String Constructors Only

```typescript
// ✅ Correct — exact
new Prisma.Decimal('123.45')
new Prisma.Decimal('7.7')

// ❌ Dangerous — JS arithmetic before Decimal captures IEEE 754 imprecision
new Prisma.Decimal(0.1 + 0.2)  // captures 0.30000000000000004
```

Single number literals like `new Prisma.Decimal(7.7)` happen to work because decimal.js converts via `String(n)`, but compound expressions like `0.1 + 0.2` are corrupted before Decimal sees them. **Always use strings to be safe.**

## Currency Formatting

See [[constants]] for `CURRENCIES`, `Currency` type, and precision rules.

`formatCurrency(amount: string, currency: Currency)` in `src/kernel/money/format-currency.ts`:

| Currency | Thousands | Decimal | Example |
|----------|-----------|---------|---------|
| SEK | non-breaking space (U+00A0) | comma | 12 500,00 |
| CHF | apostrophe | period | 12'500.00 |
| EUR | comma | period | 12,500.00 |
| USD | comma | period | 12,500.00 |

- Returns number-only string — no currency code prefix (component's responsibility).
- Negative amounts use minus prefix (`-12 500,00`), not accounting parentheses.
- Always outputs exactly 2 decimal digits.
- Throws `TypeError` for empty or non-numeric input.

### Adding New Currencies

To add NOK or GBP:
1. Add entry to `CURRENCIES` array in `src/kernel/nav/constants.ts` (type updates automatically)
2. Add formatting case in `getSeparators()` in `src/kernel/money/format-currency.ts`

No migrations, no breaking changes.

## Rounding

Rounding is a **service-layer concern** (before DB storage), not a display concern. Use the inline pattern:

```typescript
import { Prisma } from '@prisma/client'
import { CURRENCY_DECIMAL_PLACES } from '@/lib/constants'

// Banker's rounding (ROUND_HALF_EVEN) — EU financial standard
const rounded = amount.toDecimalPlaces(CURRENCY_DECIMAL_PLACES, Prisma.Decimal.ROUND_HALF_EVEN)
```

This is intentionally not a helper function — it's one line. Every service uses the same rounding mode.

## VAT Rate Constants

VAT rates exist in two forms in `src/kernel/nav/constants.ts`:

| Constant | Value | Use |
|----------|-------|-----|
| `DEFAULT_VAT_RATE_SE` | `25` | Display, comparisons |
| `DEFAULT_VAT_RATE_SE_STR` | `'25'` | Decimal construction in services |
| `DEFAULT_VAT_RATE_CH` | `7.7` | Display, comparisons |
| `DEFAULT_VAT_RATE_CH_STR` | `'7.7'` | Decimal construction in services |

Services **must** use the `_STR` versions for Decimal construction:

```typescript
// ✅ Correct
const vat = amount.times(new Prisma.Decimal(DEFAULT_VAT_RATE_CH_STR)).dividedBy(100)

// ❌ Works by accident (decimal.js handles single numbers) but violates the convention
const vat = amount.times(new Prisma.Decimal(DEFAULT_VAT_RATE_CH)).dividedBy(100)
```

## Database Columns

Future stories will use `DECIMAL(15,2)` for all currency columns via Prisma's `Decimal` type. The precision constants are:

- `CURRENCY_DECIMAL_PLACES = 2` — for currency amounts (öre/Rappen/cents)
- `EXCHANGE_RATE_DECIMAL_PLACES = 6` — for ECB exchange rates

## Audit Log Representation

When entities with Decimal fields are audited (see [[audit-trail]]), amounts appear as strings in JSONB `oldData`/`newData` — lossless and human-readable. This is correct behavior from Prisma's JSON serialization.

## Related

- [[constants]] — Business constants source
- [[audit-trail]] — Audit infrastructure
- [[server-actions]] — Server Action patterns and serialization
