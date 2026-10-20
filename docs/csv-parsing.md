# CSV Parsing Service

## Nordea CSV Format

Reference: [Story 3.3 verified spec](_bmad-output/implementation-artifacts/3-3-bank-account-csv-format-configuration.md) — DO NOT re-research.

- **Delimiter:** `;` (semicolon)
- **Decimal separator:** `,` (comma)
- **Date format:** `YYYY/MM/DD`
- **Encoding:** the bytes decide — a UTF-8 BOM or a clean UTF-8 decode with multi-byte characters → UTF-8, otherwise the format's ISO-8859-1. Nordea's real exports arrive as UTF-8 with a BOM (owner's file, 2026-10); the older synthetic fixtures are Latin-1; both parse.
- **Headers:** Yes (first row)
- **Trailing delimiter:** Yes (empty field after last semicolon)
- **10 columns:** date, amount, sender, recipient, name, details, message, notes, balance, currency

## Description Resolution Chain

When `name` (primary description field, index 4) is empty:
1. `name` → use if non-empty
2. `details` (additionalDetails, index 5) → fallback
3. `sender` (index 2) → second fallback
4. `"Unknown transaction"` → final fallback

**Rationale:** Interest payments in savings accounts have empty `name` field. The description comes from `details` (e.g., "Ränta 2024").

## Encoding Handling

- Uses Node.js built-in `TextDecoder` (`utf-8` with `fatal: true` to sniff, else the format's encoding) — no external library
- Pre-decode Buffer to string BEFORE passing to `papaparse`
- Preserves Swedish characters: `ä` (0xE4), `ö` (0xF6), `å` (0xE5)
- Preserves special characters: `´` (acute accent 0xB4, as in `Skattepunkten´s`)
- Handles UTF-8 BOM prefix (`\xEF\xBB\xBF`) — stripped before parsing

## Deduplication Hash

SHA-256 hash for duplicate detection:
- **With reference:** `hash(date | amount | reference)` — most reliable (e.g., `/ROC/PMT-...`)
- **Without reference:** `hash(date | amount | description | rowIndex)` — fallback for card payments

## `ParsedRow` Interface

```typescript
interface ParsedRow {
  date: string;              // ISO 8601
  amount: Prisma.Decimal;    // Parsed from comma-decimal
  currency: string;          // Per-row currency
  description: string;       // Resolved via chain
  reference: string | null;  // From message field
  notes: string | null;      // User's own notes
  balance: Prisma.Decimal | null;  // May be null
  deduplicationHash: string; // SHA-256
  rawFields: Record<string, string>;  // All 10 original fields
}
```

## `rawFields` Design Decision

All 10 original CSV fields are preserved as `rawFields` for future use (e.g., audit trail, re-parsing with different format config). This ensures no data loss during import.

## Test Fixtures

- **Synthetic (committed, run in CI):** `src/modules/banking/__fixtures__/nordea-*.csv`
  - `nordea-sek-valid.csv` — 5 rows, SEK, various patterns
  - `nordea-chf-valid.csv` — 1 row, CHF, `/ROC/` reference
  - `nordea-interest.csv` — 1 row, empty name, tests description chain
  - `nordea-empty.csv` — 0 bytes, tests empty file rejection
  - `nordea-headers-only.csv` — header only, tests no-data rejection
  - `nordea-encoding.csv` — ISO-8859-1 with `ä`, `ö`, `å`, `´` characters
  - `nordea-bom.csv` — UTF-8 BOM prefix
  - `nordea-quoted-semicolons.csv` — quoted field with embedded semicolons
- **Real files (local only, `.gitignore`-d):** `prisma/data/*.csv`
  - Tests run via `describe.skipIf(!existsSync(...))` — skipped in CI

## Known Edge Cases (from real data)

- Empty balance on card payments → `null`, not `0`
- Year number in sender field for interest payments
- `´` (U+00B4 acute accent, not apostrophe) in vendor names
- Structured `/ROC/` references as primary dedup input

## Security

CSV values starting with `=`, `+`, `-` (except numeric negatives), `@` are flagged as potentially suspicious (formula injection). The parser logs warnings but does not modify values — sanitization responsibility is at the display boundary.

## Column Mapping

Uses configurable `columnMapping` JSON from `bank_formats` table. The parser is format-agnostic — tested with 2 different column orderings to prove independence from Nordea-specific hardcoding.
