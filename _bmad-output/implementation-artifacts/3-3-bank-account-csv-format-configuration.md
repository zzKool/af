# Story 3.3: Bank Account & CSV Format Configuration

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an owner,
I want to add bank accounts to my company and configure which CSV format each account uses,
so that bank CSV imports parse correctly for each of my bank accounts.

## Acceptance Criteria

1. **Given** the owner is logged in with tenant context
   **When** the owner navigates to `/(app)/settings/bank-accounts`
   **Then** an app-level `bank_formats` table is seeded with the Nordea CSV format mapping (column structure, date format, comma decimal, semicolon delimiter, encoding) (FR42 seed)

2. **Given** the `bank_formats` table exists with seeded data
   **When** the system reads bank formats
   **Then** the table is app-level (no `tenant_id`, no RLS), immutable via PostgreSQL RULEs (no UPDATE, no DELETE), with `GRANT SELECT` only to `defterfab_app`

3. **Given** the `bank_formats` table exists
   **When** a tenant-level `bank_accounts` table is created
   **Then** it follows the mandatory tenant model template (id, tenantId, createdAt, updatedAt, createdBy, source) with `account_alias`, `account_number`, `currency`, and a foreign key `bank_format_id` referencing `bank_formats` (no `bank_name` column — derived from format relation)

4. **Given** the bank accounts table exists
   **When** the owner adds a new bank account
   **Then** the account is created with alias, account number, currency (from CURRENCIES constant), and a format selected from the app-level bank format library, RLS-isolated to the tenant, and an audit log entry is written with `entityType: "bank_account"`

5. **Given** the owner has existing bank accounts
   **When** the owner views the bank accounts page
   **Then** all accounts for the tenant are listed with alias (or format bank name + account number as fallback title), account number, currency, and the configured format details (delimiter, decimal, encoding) for verification

6. **Given** the owner has an existing bank account
   **When** the owner edits the account (alias, account number, currency, or format)
   **Then** changes are saved via auto-save pattern (onBlur for text fields, onChange for selects), an audit log captures oldData/newData, and the UI reflects the update

7. **Given** the owner has an existing bank account
   **When** the owner removes an account that has no imported transactions
   **Then** the account is deleted, an audit log captures the old state, and it disappears from the list

8. **Given** the owner adds a bank account
   **When** the combination of `tenant_id + account_number + currency` already exists
   **Then** a validation error is shown (DUPLICATE_ENTRY), the duplicate is not created

9. **Given** the story implementation is complete
   **When** new concepts, patterns, or configurations are introduced
   **Then** `docs/` is updated with Obsidian-style `[[wiki-links]]` documenting them

## Tasks / Subtasks

- [x] Task 0: Retro Gate Check (AC: prerequisite)
  - [x] 0.1 Check `_bmad-output/implementation-artifacts/deferred-items.md` — no items with deadlines at or before Story 3.3
  - [x] 0.2 Document check result in Dev Notes below

- [x] Task 1: Database Migration — bank_formats (app-level) + bank_accounts (tenant-level) (AC: #1, #2, #3)
  - [x] 1.1 Create single Prisma migration with both tables
  - [x] 1.2 CREATE TABLE `bank_formats`: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `name VARCHAR(100) NOT NULL UNIQUE` (human-readable, e.g., "Nordea CSV (Sweden)"), `bank_name VARCHAR(100) NOT NULL` (e.g., "Nordea"), `delimiter VARCHAR(10) NOT NULL` (e.g., ";"), `decimal_separator VARCHAR(5) NOT NULL` (e.g., ","), `date_format VARCHAR(30) NOT NULL` (e.g., "YYYY/MM/DD"), `encoding VARCHAR(30) NOT NULL` (e.g., "ISO-8859-1"), `column_mapping JSONB NOT NULL` (column name → field mapping), `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - [x] 1.3 Immutability for `bank_formats`: `CREATE RULE no_update_bank_formats AS ON UPDATE TO bank_formats DO INSTEAD NOTHING;` `CREATE RULE no_delete_bank_formats AS ON DELETE TO bank_formats DO INSTEAD NOTHING;` — same pattern as `bas_categories` and `ecb_rates`
  - [x] 1.4 `GRANT SELECT ON TABLE bank_formats TO defterfab_app` — SELECT only (app role cannot write to reference tables; seeding done via migration superuser)
  - [x] 1.5 `REVOKE INSERT, UPDATE, DELETE ON TABLE bank_formats FROM defterfab_app` — belt-and-suspenders (learned from Story 3.1 fix migration)
  - [x] 1.6 Seed Nordea CSV format via INSERT in migration SQL (see Dev Notes for exact column_mapping JSONB)
  - [x] 1.7 CREATE TABLE `bank_accounts`: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `tenant_id UUID NOT NULL`, `account_alias VARCHAR(100)` (optional friendly name), `account_number VARCHAR(50) NOT NULL`, `currency VARCHAR(3) NOT NULL DEFAULT 'SEK'`, `bank_format_id UUID NOT NULL REFERENCES bank_formats(id)`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `created_by UUID NOT NULL`, `source VARCHAR(20) NOT NULL DEFAULT 'web'`. **No `bank_name` column** — the bank name is derived from the format relation (`bank_formats.bank_name`)
  - [x] 1.8 Add `UNIQUE(tenant_id, account_number, currency)` constraint on `bank_accounts` — allows same account number with different currencies (e.g., Nordea Plusgiro "211 53 13-5" with both SEK and CHF)
  - [x] 1.9 Enable RLS on `bank_accounts`: `ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY; ALTER TABLE bank_accounts FORCE ROW LEVEL SECURITY;`
  - [x] 1.10 Create tenant isolation policy: `CREATE POLICY tenant_isolation ON bank_accounts USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);`
  - [x] 1.11 `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE bank_accounts TO defterfab_app`
  - [x] 1.12 Add indexes: `(tenant_id)` on bank_accounts, `(bank_format_id)` on bank_accounts
  - [x] 1.13 Add migration comment block explaining: bank_formats as app-level reference data, bank_accounts as tenant CRUD, Nordea seed, column_mapping JSONB structure

- [x] Task 2: Prisma Schema Update (AC: #1, #2, #3)
  - [x] 2.1 Add `BankFormat` model to `prisma/schema/app.prisma` — NO tenantId, NO RLS. Fields: `id` (UUID @id), `name` (String unique), `bankName`, `delimiter`, `decimalSeparator`, `dateFormat`, `encoding`, `columnMapping` (Json @db.JsonB), `createdAt`. Comment: "App-level reference data — not following mandatory template (no tenantId, no RLS)"
  - [x] 2.2 Add `BankAccount` model to `prisma/schema/app.prisma` — follows mandatory template (id, tenantId, createdAt, updatedAt, createdBy, source), plus `accountAlias` (String?), `accountNumber` (String), `currency` (String @db.VarChar(3)), `bankFormatId` (String @db.Uuid). **No `bankName` field** — derived from format relation. Relations: `tenant Tenant`, `bankFormat BankFormat`. Unique constraint: `@@unique([tenantId, accountNumber, currency])`
  - [x] 2.3 Add `bankAccounts BankAccount[]` relation to existing `Tenant` model
  - [x] 2.4 Add `bankAccounts BankAccount[]` relation to `BankFormat` model
  - [x] 2.5 Run `npx prisma generate` — verify client generation succeeds

- [x] Task 3: Service Layer (AC: #4, #5, #6, #7, #8)
  - [x] 3.1 Create `src/server/services/bank-accounts.ts` with `ServiceResult<T>` return types. Import types: `TransactionClient` from `@/server/db/tenant-client`, `CallerIdentity` from `@/types/caller-identity`, `AuditLogger` from `@/types/audit`, `AppError` from `@/types/app-error`. Use `toAuditData()` from `@/server/services/audit` for audit data sanitization
  - [x] 3.2 `getBankFormats(tx: TransactionClient)` — read-only, no `caller` or `audit` params. Query `bank_formats` (app-level, no RLS). Return all formats ordered by `name`. This is an **architectural exception** like `getBasCategories` — app-level reference data, no tenant scope
  - [x] 3.3 `getBankAccounts(tx: TransactionClient, caller: CallerIdentity)` — read-only, no `audit` param. Query `bank_accounts` (RLS-scoped by middleware) with `include: { bankFormat: true }`. Return all accounts ordered by `accountNumber`, `currency`
  - [x] 3.4 `createBankAccount(tx, caller, audit, input: { accountAlias?: string, accountNumber: string, currency: string, bankFormatId: string })` — create row. Validate currency is in CURRENCIES constant. Validate bankFormatId exists in bank_formats (query app-level table). Catch Prisma P2002 → return DUPLICATE_ENTRY AppError (duplicate = same account_number + currency). Audit log with `entityType: "bank_account"`
  - [x] 3.5 `updateBankAccount(tx, caller, audit, id: string, input: { accountAlias?: string | null, accountNumber?: string, currency?: string, bankFormatId?: string })` — update existing account. Read-before-write for audit oldData. If bankFormatId changes, validate it exists. If accountNumber or currency changes, catch P2002 for duplicate. Audit with `entityType: "bank_account"`
  - [x] 3.6 `deleteBankAccount(tx, _caller, audit, id: string)` — DELETE account. Read-before-delete for audit oldData. Add TODO comment: `// TODO: Epic 6 — check for imported transactions before allowing delete`. No reference check needed yet (no downstream consumers). Audit with `entityType: "bank_account"`
  - [x] 3.7 Ensure service MUST NOT import from `next/*` or `src/components/*`

- [x] Task 4: Server Actions (AC: #4, #5, #6, #7, #8)
  - [x] 4.1 Create `src/server/actions/bank-accounts.ts`
  - [x] 4.2 `getBankFormats` — `authedAction` with empty schema (app-level reference data, any authenticated user can read — same pattern as `getBasCategories`)
  - [x] 4.3 `getBankAccounts` — `ownerAction` with empty schema (tenant-private data, owner-only — same pattern as `getVatRegistrations`)
  - [x] 4.4 `createBankAccount` — `ownerAction` with schema `z.object({ accountAlias: z.string().max(100).trim().optional(), accountNumber: z.string().min(1).max(50).trim(), currency: z.string().length(3).toUpperCase(), bankFormatId: z.string().uuid() })`
  - [x] 4.5 `updateBankAccount` — `ownerAction` with schema for id (uuid), plus accountAlias, accountNumber, currency, bankFormatId — all optional except id
  - [x] 4.6 `deleteBankAccount` — `ownerAction` with schema `z.object({ id: z.string().uuid() })`

- [x] Task 5: UI Component — Bank Accounts Tab (AC: #5, #6, #7, #8)
  - [x] 5.1 Create `src/components/settings/bank-accounts-tab.tsx`
  - [x] 5.2 Props: `initialAccounts: BankAccount[]` (with bankFormat relation), `bankFormats: BankFormat[]` (for select dropdown)
  - [x] 5.3 List view: display all accounts as cards showing alias as title (fallback: `format.bankName + " - " + accountNumber`), account number, currency badge, and format details row (delimiter, decimal, encoding) for verification
  - [x] 5.4 Add account form: account number input, currency select (from CURRENCIES constant), bank format select (from bankFormats prop — auto-select if only one option), optional alias input. Use `useAction()` pattern from vat-registrations-tab.tsx
  - [x] 5.5 Inline edit: text fields auto-save onBlur (alias, accountNumber); select fields auto-save onChange (currency, bankFormatId). Display configured format details for verification
  - [x] 5.6 Delete button per account with confirmation (no undo — hard delete)
  - [x] 5.7 Error handling: toast.error on action failures (duplicate, validation). Success is silent (auto-save pattern)
  - [x] 5.8 Empty state: "No bank accounts configured yet" with guidance text and "Add Bank Account" CTA
  - [x] 5.9 Optimistic updates: update local state immediately, revert on error (follow VAT/BAS pattern)
  - [x] 5.10 Use `actionError()` helper pattern from vat-registrations-tab.tsx for extracting error messages

- [x] Task 6: Settings Page Integration (AC: #5)
  - [x] 6.1 Enable the Bank Accounts tab in `src/app/(app)/settings/page.tsx` — the existing tab uses `value="bank-accounts"` and is `disabled`. Remove `disabled` prop, add `nativeButton={false}` and `render={<Link href="/settings/bank-accounts" />}`, update label from "Bank Accounts (Coming soon)" to "Bank Accounts"
  - [x] 6.2 Create `src/app/(app)/settings/bank-accounts/page.tsx` — follow `settings/vat-registrations/page.tsx` pattern: server component with `getAuthContext` + member role check + redirect non-owners to `/dashboard`, fetch initial data (both bank accounts AND bank formats) via `withTenantTransaction`, render `BankAccountsTab` client component with both props
  - [x] 6.3 Ensure tab navigation works between Company, BAS Categories, VAT Registrations, and Bank Accounts

- [x] Task 7: Service & RLS Tests (AC: #1, #2, #3, #4, #5, #6, #7, #8)
  - [x] 7.1 Create `src/server/services/bank-accounts.test.ts`
  - [x] 7.2 Test `getBankFormats`: verify seeded Nordea format is returned with all fields (name, delimiter, decimalSeparator, dateFormat, encoding, columnMapping)
  - [x] 7.3 Test `createBankAccount`: add account with Nordea format, verify all fields stored including bankFormatId FK
  - [x] 7.4 Test create multiple: add two accounts with same number but different currencies (e.g., "211 53 13-5" SEK and CHF), verify both returned with format relation included
  - [x] 7.5 Test duplicate prevention: same accountNumber + same currency for same tenant → DUPLICATE_ENTRY AppError (not throw)
  - [x] 7.6 Test update: change accountAlias, verify audit captures oldData/newData
  - [x] 7.7 Test update bankFormatId: change format reference, verify FK integrity
  - [x] 7.8 Test update accountNumber+currency collision: changing to existing combo → DUPLICATE_ENTRY
  - [x] 7.9 Test delete: remove account, verify audit captures old state
  - [x] 7.10 Test currency validation: reject invalid currency (not in CURRENCIES)
  - [x] 7.11 Test bankFormatId validation: reject non-existent format ID → NOT_FOUND or VALIDATION_ERROR
  - [x] 7.12 Use `assertRlsIsolation(prisma, "bankAccount", tenantA.id, tenantB.id)` for tenant isolation
  - [x] 7.13 Use `assertAuditLogged(adminPool, tenantId, "create", "bank_account")` for audit trail
  - [x] 7.14 Use `assertCrudOperations` from config-crud-helpers for a full create/read/update/delete cycle test
  - [x] 7.15 Test server actions: verify `ownerAction` RBAC enforcement (mock non-owner should fail for bank account mutations)
  - [x] 7.16 Test `getBankFormats` action: verify `authedAction` allows any authenticated role (not just owner)
  - [x] 7.17 Test app-level data visibility: verify both tenant A and tenant B can read the same `bank_formats` data (no RLS isolation on app-level table) — new test pattern for two-table architecture

- [x] Task 8: Documentation & Cleanup (AC: all, #9)
  - [x] 8.1 Update `docs/index.md` with link to new bank accounts doc
  - [x] 8.2 Create `docs/bank-accounts.md` with Obsidian-style `[[wiki-links]]`: bank_formats app-level reference data model, bank_accounts tenant data model, Nordea CSV format column mapping, format library design (app-level vs tenant), downstream consumers (Epic 6 CSV import, Epic 9 format admin). Follow `docs/vat-registrations.md` heading structure
  - [x] 8.3 Add inline code comments documenting: column_mapping JSONB structure, format library architecture, downstream usage by CSV import
  - [x] 8.4 Run `npx biome check --write` before each commit
  - [x] 8.5 Run full test suite: `npm run test` — all existing tests + new tests pass
  - [x] 8.6 Run `npm run lint` — clean

## Dev Notes

### Task Dependencies

Tasks must be executed in order due to dependencies:
- **Task 1 -> Task 2**: Prisma schema must match the migration SQL
- **Task 2 -> Tasks 3+4**: Services and actions need generated Prisma client
- **Tasks 3+4 -> Task 5**: UI components consume the server actions
- **Task 5 -> Task 6**: Settings page integration needs the component
- **Tasks 3-6 -> Task 7**: Tests need all code written first
- **Tasks 7 -> Task 8**: Docs after everything passes

### Pattern Reuse — Follow Stories 3.1 and 3.2

This is the **third config CRUD page** in Epic 3. Story 3.1 (BAS Categories) established the app-level reference data pattern. Story 3.2 (VAT Registrations) established the tenant CRUD pattern. Story 3.3 combines BOTH patterns:

| Aspect | Story 3.1 (BAS) | Story 3.2 (VAT) | Story 3.3 (Bank Accounts) |
|--------|-----------------|-----------------|---------------------------|
| App-level table | Yes (`bas_categories`, no RLS) | No | Yes (`bank_formats`, no RLS) |
| Tenant table | `tenant_bas_preferences` (sparse join) | `vat_registrations` (full CRUD) | `bank_accounts` (full CRUD) |
| RLS | Yes on tenant table | Yes, tenant_isolation | Yes, tenant_isolation on bank_accounts |
| FK to app table | Yes (`basCode` -> BasCategory.code) | No | Yes (`bankFormatId` -> BankFormat.id) |
| Service params | `tx, caller, audit` | Same | Same |
| Read action (app-level) | `authedAction` (reference data) | N/A | `authedAction` for getBankFormats |
| Read action (tenant) | `authedAction` (pref with join) | `ownerAction` (private data) | `ownerAction` for getBankAccounts |
| Write action | `ownerAction` | `ownerAction` | `ownerAction` |
| Unique constraint | `[tenantId, basCode]` | `[tenantId, country, vatNumber]` | `[tenantId, accountNumber, currency]` |
| UI pattern | Virtual list + accordion + auto-save | Simple list/cards + auto-save | Cards + auto-save + format select dropdown |
| Audit | entityType: "tenant_bas_preference" | entityType: "vat_registration" | entityType: "bank_account" |
| Seeding | ~460 rows from XLSX parse | No seeding | 1 row (Nordea format) |

### Two-Model Architecture

This story introduces the first **two-table pattern** where a tenant entity references an app-level entity:

```
bank_formats (app-level, immutable, no RLS)
  ├── id UUID PK
  ├── name VARCHAR(100) UNIQUE — "Nordea CSV (Sweden)"
  ├── bank_name VARCHAR(100) — "Nordea"
  ├── delimiter VARCHAR(10) — ";"
  ├── decimal_separator VARCHAR(5) — ","
  ├── date_format VARCHAR(30) — "YYYY/MM/DD"
  ├── encoding VARCHAR(30) — "ISO-8859-1"
  ├── column_mapping JSONB — field-to-column map
  └── created_at TIMESTAMPTZ

bank_accounts (tenant-level, RLS, full CRUD)
  ├── id UUID PK
  ├── tenant_id UUID FK → tenants
  ├── account_alias VARCHAR(100) — optional friendly name (e.g., "Plusgiro SEK")
  ├── account_number VARCHAR(50) — "211 53 13-5"
  ├── currency VARCHAR(3) — "SEK" (account's primary currency)
  ├── bank_format_id UUID FK → bank_formats — format library reference
  ├── created_at TIMESTAMPTZ
  ├── updated_at TIMESTAMPTZ
  ├── created_by UUID
  └── source VARCHAR(20) DEFAULT 'web'
  └── UNIQUE(tenant_id, account_number, currency)
```

**No `bank_name` on `bank_accounts`** — the bank name is always derived from the format relation (`bankFormat.bankName`). This avoids data duplication and inconsistency. The UI displays `bankFormat.bankName` on each card.

### Multi-Currency Account Pattern

A single physical bank account (e.g., Nordea Plusgiro "211 53 13-5") can handle multiple currencies. In Nordea's ebanking, this appears as separate lines — one for SEK, one for CHF. We model this as **two separate `bank_account` records** with the same `account_number` but different `currency` values:

| account_alias | account_number | currency | bank_format_id |
|---------------|---------------|----------|---------------|
| Plusgiro SEK | 211 53 13-5 | SEK | (Nordea format UUID) |
| Plusgiro CHF | 211 53 13-5 | CHF | (Nordea format UUID) |
| Savings | 1195 32 74218 | SEK | (Nordea format UUID) |

This is why the unique constraint is `(tenant_id, account_number, currency)` — it correctly allows the same account number with different currencies while preventing true duplicates.

When the owner imports a CSV, they select which bank account to import into. This tells the parser both the format AND the expected currency. The per-row currency column in the CSV serves as a **validation check** — if it doesn't match the account's currency, the parser should flag it as an error (Epic 6 concern).

### Nordea CSV Format — Seed Data (Verified from Real Exports)

The migration seeds exactly **one** bank format: Nordea CSV (Sweden). The column_mapping JSONB is derived from **actual Nordea ebanking CSV exports** (Plusgiro business account):

```json
{
  "columns": [
    { "index": 0, "field": "date", "label": "Booking date" },
    { "index": 1, "field": "amount", "label": "Amount" },
    { "index": 2, "field": "sender", "label": "Sender" },
    { "index": 3, "field": "recipient", "label": "Recipient" },
    { "index": 4, "field": "name", "label": "Name" },
    { "index": 5, "field": "details", "label": "Additional details" },
    { "index": 6, "field": "message", "label": "Message" },
    { "index": 7, "field": "notes", "label": "Own notes" },
    { "index": 8, "field": "balance", "label": "Balance" },
    { "index": 9, "field": "currency", "label": "Currency" }
  ],
  "hasHeader": true,
  "skipRows": 0,
  "trailingDelimiter": true,
  "primaryDescriptionField": "name",
  "referenceField": "message"
}
```

**Format details (verified):**
- **Delimiter:** `;` (semicolon)
- **Decimal separator:** `,` (comma) — e.g., `20539,00` or `-224,47`
- **Negative amounts:** leading minus sign — e.g., `-224,47`
- **Thousands separator:** none — `137632,60` not `137 632,60`
- **Date format:** `YYYY/MM/DD` — slash separator, NOT dash (e.g., `2025/01/10`)
- **Encoding:** `ISO-8859-1` — Nordea's legacy encoding (handles å, ä, ö)
- **Headers:** English — `Booking date`, `Amount`, etc. (NOT Swedish)
- **Trailing delimiter:** every row (including header) ends with `;`
- **10 columns** — `Sender` and `Recipient` are typically empty; `Name` and `Additional details` are often identical
- **Balance:** can be empty on some rows (e.g., card payments)
- **Currency:** per-row (e.g., `CHF` or `SEK`) — used for validation in Epic 6

**Semantic hints for Epic 6 parser:**
- `primaryDescriptionField: "name"` — column 4 (`Name`) is the best journal entry description (counterparty name)
- `referenceField: "message"` — column 6 (`Message`) contains payment references (e.g., `/ROC/PMT-10000694-5681983`)

**Security note for Epic 6:** the parser must sanitize CSV values starting with `=`, `+`, `-` (except numeric negatives), `@` to prevent CSV injection if data is ever re-exported.

**Future formats** (not seeded now, added via Story 9.1):
- SEB CSV (Sweden) — different column order, different encoding
- Handelsbanken CSV (Sweden) — different format entirely

### Currency Validation

Use the existing `CURRENCIES` constant from `src/lib/constants.ts`:
```typescript
export const CURRENCIES = ["SEK", "CHF", "EUR", "USD"];
```

Validate at both service level (check `CURRENCIES.includes(currency)`) and Zod schema level in actions (`.length(3).toUpperCase()`). The Zod schema validates shape; the service validates business rules.

### Unique Constraint Design

The unique constraint is `(tenant_id, account_number, currency)`. Rationale:
- A single physical bank account (e.g., Nordea Plusgiro) can handle multiple currencies
- In Nordea's ebanking, multi-currency accounts appear as separate lines (one per currency)
- The owner registers each currency variant as a separate bank account record
- The constraint allows `("211 53 13-5", "SEK")` and `("211 53 13-5", "CHF")` to coexist
- While preventing true duplicates: same account + same currency added twice

### Bank Format Selection UX

The owner selects a format from a **dropdown** (shadcn `Select` component), not a text input. The dropdown is populated from `getBankFormats()` which returns all app-level formats. Each option shows the format name (e.g., "Nordea CSV (Sweden)"). After selection, the card displays format details (delimiter, encoding, date format) for verification — so the owner can confirm the format matches their bank.

This matches the UX spec: "Select component for bank format selector" and the first-time setup flow: "Add bank account → Select format from library".

### Auto-Save UX Pattern

Follow the auto-save pattern from Stories 3.1 and 3.2:
- **Text fields** (alias, accountNumber): save onBlur via `useAction()` + `executeAsync`
- **Select fields** (currency, bankFormatId): save onChange immediately
- Toast only on error; success is silent
- Optimistic updates with error rollback
- `actionError()` helper from vat-registrations-tab.tsx for error extraction
- **Auto-select format:** when only one format exists in the dropdown, pre-select it (UX polish for first-time setup)

### Delete Safety

Currently NO downstream references exist to `bank_accounts`. Epic 6 (Story 6.2: Bank CSV Import) will create journal entries linked to bank accounts. For now, delete is unconditional. Add a TODO comment: `// TODO: Epic 6 — check for imported transactions before allowing delete`.

### Downstream Consumers

Bank accounts will be consumed by:
- **Epic 6 (Story 6.2)**: Bank CSV import uses `accountConfig` (bank account + its format) to parse CSV files — `csvParser.parse(caller, file, accountConfig)`
- **Epic 6 (Story 6.7)**: Banking transactions view filters by bank account
- **Epic 9 (Story 9.1)**: App-level admin manages the bank format library (adds SEB, Handelsbanken, etc.)

The `getBankAccounts` service method (with `include: { bankFormat: true }`) will be reused by these future stories. The `getBankFormats` method will be reused by Story 9.1.

### Previous Story Intelligence (Stories 3.1 + 3.2)

- **All tests passing** after Story 3.2 — 231 total tests, must not regress
- Config CRUD helpers ready: `assertRlsIsolation`, `assertAuditLogged`, `assertCrudOperations` in `src/server/test-utils/config-crud-helpers.ts`
- Architecture guard tests enforce: no GRANT ALL, no console.*, no next/* in services
- **Migration safety**: always additive (new migration files), never edit applied migrations
- **Biome check before commit**: `npx biome check --write`
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`
- **actionError() helper** already in vat-registrations-tab.tsx — follow same pattern or extract to shared util
- **App-level immutability** pattern from BAS: PostgreSQL RULEs + `GRANT SELECT` + `REVOKE INSERT, UPDATE, DELETE` (belt-and-suspenders, learned from Story 3.1 fix migration)
- **TabsTrigger** pattern: `nativeButton={false}` + `render={<Link href=... />}` for route-based tabs
- Story 3.2 code review findings applied: removed phantom ID fallback, fixed React key collision, added refs for stale closure avoidance, reordered Zod schema (trim before length)

### Existing Constants (DO NOT duplicate)

`src/lib/constants.ts` already defines:
```typescript
export const CURRENCIES = ["SEK", "CHF", "EUR", "USD"];
```
Use this directly for currency validation and the currency select dropdown. Do NOT create a new currency list.

### Project Structure Notes

All paths follow project conventions:
- Services: `src/server/services/bank-accounts.ts` (kebab-case)
- Actions: `src/server/actions/bank-accounts.ts` (kebab-case)
- Components: `src/components/settings/bank-accounts-tab.tsx` (kebab-case file, PascalCase component: `BankAccountsTab`)
- Tests: co-located `src/server/services/bank-accounts.test.ts`
- Page: `src/app/(app)/settings/bank-accounts/page.tsx`
- Prisma schema: `prisma/schema/app.prisma` (existing file, add two models)

### Mutation Story Checklist

- [x] RLS policy task — Task 1.9, 1.10 (bank_accounts only; bank_formats has no RLS)
- [x] Specific GRANTs task — Task 1.4 (SELECT for bank_formats), Task 1.11 (full CRUD for bank_accounts)
- [x] Audit log integration task — Task 3.4, 3.5, 3.6 (create/update/delete bank_accounts, all audit-logged)
- [x] RLS isolation test — Task 7.12 (assertRlsIsolation for bankAccount)
- [x] Audit log test — Task 7.13 (assertAuditLogged for bank_account)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3] — acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md] — config dependency graph (Bank Accounts → references App.Bank Format Library), data flow (CSV import → csvParser.parse with accountConfig), project structure (settings/bank-accounts/ page)
- [Source: _bmad-output/planning-artifacts/prd.md#FR39] — add bank accounts per tenant referencing format library
- [Source: _bmad-output/planning-artifacts/prd.md#FR42] — app-level bank CSV format mappings
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Journey 5] — first-time setup flow: add bank account → select format → test with sample CSV
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] — Select component for bank format selector, auto-save form pattern, delete confirmation dialog
- [Source: _bmad-output/implementation-artifacts/3-2-vat-registration-management.md] — tenant CRUD pattern (service, action, component, test)
- [Source: src/server/test-utils/config-crud-helpers.ts] — reusable test helpers
- [Source: src/server/actions/settings.ts] — production server action pattern (ownerAction)
- [Source: src/server/services/bas-preferences.ts] — app-level read pattern (getBasCategories — no caller, no audit)
- [Source: src/server/actions/bas-preferences.ts] — authedAction for app-level reference reads
- [Source: src/server/services/vat-registrations.ts] — tenant CRUD service pattern (ServiceResult, CallerIdentity, AuditLogger)
- [Source: src/components/settings/vat-registrations-tab.tsx] — UI auto-save pattern (useAction, onBlur, optimistic updates, actionError)
- [Source: src/app/(app)/settings/vat-registrations/page.tsx] — server component page pattern (auth + RBAC + data fetch + render)
- [Source: src/app/(app)/settings/page.tsx] — disabled Bank Accounts tab to enable
- [Source: src/lib/constants.ts] — CURRENCIES constant (do not duplicate)
- [Source: prisma/schema/app.prisma] — current schema with Tenant model and BasCategory (app-level reference pattern)
- [Source: prisma/migrations/20260312035401_add_bas_categories/migration.sql] — app-level immutability pattern (RULEs + GRANTs)
- [Source: prisma/migrations/20260312055000_fix_bas_categories_insert_rule/migration.sql] — belt-and-suspenders REVOKE pattern
- [Source: src/types/caller-identity.ts] — CallerIdentity type
- [Source: src/types/audit.ts] — AuditLogger interface
- [Source: src/types/app-error.ts] — AppError type and ErrorCode enum
- [Source: src/server/services/audit.ts] — createAuditEntry + toAuditData helpers
- [Source: docs/vat-registrations.md] — established documentation pattern

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Task 0: Checked deferred-items.md — no items with deadlines at or before Story 3.3. Earliest deadline is "Before Epic 5" (Sentry integration). Clear to proceed.

### Completion Notes List

- Task 0: Deferred items checked — no items due at or before Story 3.3
- Task 1: Created migration `20260312200000_add_bank_formats_and_accounts` with bank_formats (app-level, immutable) and bank_accounts (tenant-level, RLS) tables. Seeded Nordea CSV format. Applied to both dev and test databases.
- Task 2: Added BankFormat and BankAccount models to Prisma schema with relations to Tenant. Prisma client generated successfully.
- Task 3: Created bank-accounts.ts service with getBankFormats, getBankAccounts, createBankAccount, updateBankAccount, deleteBankAccount. Currency validation via CURRENCIES constant. Format ID validation. P2002 duplicate handling. Audit logging on all mutations.
- Task 4: Created bank-accounts.ts actions with authedAction for getBankFormats (any authenticated user), ownerAction for all bank account operations. Zod schemas with trim/toUpperCase transforms.
- Task 5: Created bank-accounts-tab.tsx with card-based account list, auto-save pattern (onBlur for text, onChange for selects), format details display, empty state, add form with auto-select for single format, delete with confirmation, optimistic updates.
- Task 6: Enabled Bank Accounts tab in settings page, created server component page with auth/RBAC/data fetch pattern.
- Task 7: 22 tests passing — format fields, app-level visibility, CRUD, multi-currency, duplicate prevention, update collision, delete, currency validation, format validation, full CRUD cycle, RLS isolation, audit logging (create/update/delete), action RBAC (owner/member/unauthenticated). Full suite: 253 tests, 0 failures.
- Task 8: Created docs/bank-accounts.md with Obsidian wiki-links. Updated docs/index.md. Biome check clean. Full test suite passing.

### Change Log

- 2026-03-12: Story 3.3 implementation complete — bank formats + bank accounts with full CRUD, RLS, audit, tests, and docs

### File List

New files:
- prisma/migrations/20260312200000_add_bank_formats_and_accounts/migration.sql
- src/server/services/bank-accounts.ts
- src/server/actions/bank-accounts.ts
- src/components/settings/bank-accounts-tab.tsx
- src/app/(app)/settings/bank-accounts/page.tsx
- src/server/services/bank-accounts.test.ts
- docs/bank-accounts.md

Modified files:
- prisma/schema/app.prisma (added BankFormat + BankAccount models, Tenant relation)
- src/app/(app)/settings/page.tsx (enabled Bank Accounts tab)
- docs/index.md (added bank-accounts link)
