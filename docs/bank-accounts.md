# Bank Accounts

Bank account configuration with CSV format library for transaction import. Since the banking import (see [[banking]]) an account also carries `role ∈ main | savings` (the savings CSV goes to the accountant yearly, D13/D31) and cannot be deleted while it has imports.

## Overview

Bank accounts link a tenant's bank accounts to CSV format definitions for automated transaction import (Epic 6). This is the first **two-table pattern** where a tenant entity references an app-level entity:

- `bank_formats` — App-level reference data (immutable, no RLS). Contains CSV parsing configurations (delimiter, encoding, column mapping). Seeded with Nordea; future formats added via Story 9.1.
- `bank_accounts` — Tenant-level CRUD (RLS-scoped). Each record = one bank account + currency combination referencing a format from the library.

Unlike [[vat-registrations]] (tenant-only data), bank accounts combine both patterns from [[bas-categories]] (app-level reference) and VAT registrations (tenant CRUD).

## Data Model

### bank_formats Table (App-Level)

App-level reference data — **not** following mandatory template (no `tenantId`, no RLS):

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | VARCHAR(100) | Unique human-readable name ("Nordea CSV (Sweden)") |
| `bank_name` | VARCHAR(100) | Bank name ("Nordea") |
| `delimiter` | VARCHAR(10) | Column delimiter (";") |
| `decimal_separator` | VARCHAR(5) | Decimal separator (",") |
| `date_format` | VARCHAR(30) | Date format ("YYYY/MM/DD") |
| `encoding` | VARCHAR(30) | File encoding ("ISO-8859-1") |
| `column_mapping` | JSONB | Field-to-column mapping (see below) |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

**Immutability** enforced via PostgreSQL RULEs (`no_update`, `no_delete`, `no_insert`) + `REVOKE INSERT, UPDATE, DELETE` (belt-and-suspenders pattern from Story 3.1).

### column_mapping JSONB Structure

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

- `primaryDescriptionField` — Best column for journal entry description (counterparty name)
- `referenceField` — Column containing payment references

### bank_accounts Table (Tenant-Level)

Follows the mandatory tenant model template (`id`, `tenantId`, `createdAt`, `updatedAt`, `createdBy`, `source`):

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | FK to tenants, RLS-scoped |
| `account_alias` | VARCHAR(100) | Optional friendly name ("Plusgiro SEK") |
| `account_number` | VARCHAR(50) | Bank account number ("211 53 13-5") |
| `currency` | VARCHAR(3) | Account currency ("SEK", "CHF", etc.) |
| `bank_format_id` | UUID | FK to bank_formats |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |
| `created_by` | UUID | User who created the account |
| `source` | VARCHAR(20) | Origin: "web", "mcp", etc. |

### Unique Constraint

`UNIQUE(tenant_id, account_number, currency)` — allows the same physical account number with different currencies (multi-currency accounts like Nordea Plusgiro).

### No bank_name Column

The bank name is always derived from the format relation (`bankFormat.bankName`). This avoids data duplication and inconsistency.

## Design Decisions

### Multi-Currency Accounts

A single physical bank account (e.g., Nordea Plusgiro "211 53 13-5") can handle multiple currencies. We model this as **separate records** per currency:

| alias | account_number | currency |
|-------|---------------|----------|
| Plusgiro SEK | 211 53 13-5 | SEK |
| Plusgiro CHF | 211 53 13-5 | CHF |

### Format Library Architecture

Formats are app-level (shared across all tenants) and immutable. This design:

- Prevents tenants from modifying shared parsing rules
- Allows centralized format management (Story 9.1)
- Keeps format definitions consistent across imports

### Delete Safety

Currently no downstream references exist to `bank_accounts`. A TODO in `deleteBankAccount` marks where reference checks will be added when Epic 6 introduces imported transactions.

## Downstream Consumers

Bank accounts will be consumed by:

- **Epic 6 (Story 6.2)**: CSV import uses `accountConfig` (bank account + its format) to parse CSV files
- **Epic 6 (Story 6.7)**: Banking transactions view filters by bank account
- **Epic 9 (Story 9.1)**: App-level admin manages the bank format library (adds SEB, Handelsbanken, etc.)

## Auto-Save UX Pattern

Follows the same auto-save pattern as [[vat-registrations]] and [[bas-categories]]:

- Text fields (`accountAlias`, `accountNumber`): save onBlur
- Select fields (`currency`, `bankFormatId`): save onChange
- Toast only on error; success is silent
- Optimistic updates with error rollback
- Format details displayed per card for verification (delimiter, encoding, date format)

## Related

- [[prisma-rls-setup]] — RLS tenant isolation pattern
- [[audit-trail]] — Audit logging for all CRUD operations
- [[server-actions]] — ownerAction RBAC for mutations, authedAction for format reads
- [[bas-categories]] — App-level reference data pattern (same immutability approach)
- [[vat-registrations]] — Tenant CRUD pattern (same auto-save approach)
- [[config-page-test-template]] — Test structure for config CRUD pages

## IBAN / BIC (2026-10-20)

`bank_accounts.iban` and `bic` (migration `20261021000000_add_print_identity`) are printed in the invoice payment box for the account whose currency matches the invoice ([[invoices]]); both editable in the Bank accounts tab with the same auto-save-on-blur as the alias. Optional — without them the account number prints.
