-- Migration: add_bank_formats_and_accounts
-- Story 3.3: Bank Account & CSV Format Configuration
--
-- Architecture:
--   bank_formats   — App-level reference data (no tenant_id, no RLS).
--                    Immutable via PostgreSQL RULEs. Contains CSV format definitions
--                    (delimiter, decimal separator, date format, encoding, column mapping).
--                    Seeded with Nordea CSV (Sweden) format.
--
--   bank_accounts  — Tenant-level CRUD (tenant_id, RLS enabled).
--                    References bank_formats via FK. Each record represents one
--                    bank account + currency combination for a tenant.
--
-- column_mapping JSONB structure:
--   {
--     "columns": [{ "index": 0, "field": "date", "label": "Booking date" }, ...],
--     "hasHeader": true,
--     "skipRows": 0,
--     "trailingDelimiter": true,
--     "primaryDescriptionField": "name",
--     "referenceField": "message"
--   }
--
-- Downstream consumers:
--   - Epic 6 (Story 6.2): CSV import uses bank account + format to parse files
--   - Epic 9 (Story 9.1): App admin manages the format library

-- ============================================================================
-- PART 1: bank_formats (app-level, immutable reference data)
-- ============================================================================

CREATE TABLE bank_formats (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100)    NOT NULL UNIQUE,
    bank_name       VARCHAR(100)    NOT NULL,
    delimiter       VARCHAR(10)     NOT NULL,
    decimal_separator VARCHAR(5)    NOT NULL,
    date_format     VARCHAR(30)     NOT NULL,
    encoding        VARCHAR(30)     NOT NULL,
    column_mapping  JSONB           NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Immutability: PostgreSQL RULEs prevent modification
CREATE RULE no_update_bank_formats AS ON UPDATE TO bank_formats DO INSTEAD NOTHING;
CREATE RULE no_delete_bank_formats AS ON DELETE TO bank_formats DO INSTEAD NOTHING;
CREATE RULE no_insert_bank_formats AS ON INSERT TO bank_formats DO INSTEAD NOTHING;

-- Grants: SELECT-only for app role (seeding done via migration superuser)
GRANT SELECT ON TABLE bank_formats TO af_app;

-- Belt-and-suspenders: explicitly revoke write permissions
REVOKE INSERT, UPDATE, DELETE ON TABLE bank_formats FROM af_app;

-- ============================================================================
-- PART 2: Seed Nordea CSV (Sweden) format
-- ============================================================================
-- NOTE: INSERT rule is temporarily disabled for seeding, then re-enabled.
-- The rule "no_insert_bank_formats" silently drops INSERTs, so we must
-- drop it, seed, and recreate it.

DROP RULE no_insert_bank_formats ON bank_formats;

INSERT INTO bank_formats (name, bank_name, delimiter, decimal_separator, date_format, encoding, column_mapping)
VALUES (
    'Nordea CSV (Sweden)',
    'Nordea',
    ';',
    ',',
    'YYYY/MM/DD',
    'ISO-8859-1',
    '{
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
    }'::jsonb
);

CREATE RULE no_insert_bank_formats AS ON INSERT TO bank_formats DO INSTEAD NOTHING;

-- ============================================================================
-- PART 3: bank_accounts (tenant-level, full CRUD)
-- ============================================================================

CREATE TABLE bank_accounts (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID            NOT NULL,
    account_alias   VARCHAR(100),
    account_number  VARCHAR(50)     NOT NULL,
    currency        VARCHAR(3)      NOT NULL DEFAULT 'SEK',
    bank_format_id  UUID            NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    created_by      UUID            NOT NULL,
    source          VARCHAR(20)     NOT NULL DEFAULT 'web'
);

-- Unique constraint: same account + currency per tenant is a duplicate
ALTER TABLE bank_accounts
    ADD CONSTRAINT bank_accounts_tenant_account_currency_unique
    UNIQUE (tenant_id, account_number, currency);

-- Foreign keys
ALTER TABLE bank_accounts
    ADD CONSTRAINT bank_accounts_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE bank_accounts
    ADD CONSTRAINT bank_accounts_bank_format_id_fkey
    FOREIGN KEY (bank_format_id) REFERENCES bank_formats(id);

-- Indexes for query performance
CREATE INDEX bank_accounts_tenant_id_idx ON bank_accounts (tenant_id);
CREATE INDEX bank_accounts_bank_format_id_idx ON bank_accounts (bank_format_id);

-- RLS: tenant isolation
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON bank_accounts
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Grants: full CRUD for app role on tenant table
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE bank_accounts TO af_app;
