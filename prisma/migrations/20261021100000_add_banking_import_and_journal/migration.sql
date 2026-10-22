-- Banking import + journal (D3, D25, D31; specs/banking/spec.md, specs/journal/spec.md).
-- bank_imports (one file), bank_transactions (one CSV row, verbatim, never updated), categorisation_rules
-- (text match → category / partner / flag), journal_entries (the financial fact with its SEK base, written once),
-- bank_accounts.role (main / savings), the Nordea format's `Date` header alias.

-- ============================================================================
-- bank_accounts.role
-- ============================================================================
CREATE TYPE "bank_account_role" AS ENUM ('main', 'savings');
ALTER TABLE "bank_accounts" ADD COLUMN "role" "bank_account_role" NOT NULL DEFAULT 'main';

-- ============================================================================
-- Nordea format: the first header is `Date` in the owner's real exports, `Booking date` in the older ones
-- ============================================================================
DROP RULE no_update_bank_formats ON bank_formats;
UPDATE "bank_formats"
SET "column_mapping" = jsonb_set(
    "column_mapping",
    '{columns,0}',
    ("column_mapping"->'columns'->0) || '{"aliases": ["Date"]}'::jsonb
)
WHERE "name" = 'Nordea CSV (Sweden)';
CREATE RULE no_update_bank_formats AS ON UPDATE TO bank_formats DO INSTEAD NOTHING;

-- ============================================================================
-- bank_imports
-- ============================================================================
CREATE TABLE "bank_imports" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"       UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "file_name"       VARCHAR(255) NOT NULL,
    "document_id"     UUID,
    "record_count"    INTEGER NOT NULL DEFAULT 0,
    "imported_count"  INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "error_count"     INTEGER NOT NULL DEFAULT 0,
    "errors"          JSONB NOT NULL DEFAULT '[]',
    "period_from"     DATE,
    "period_to"       DATE,
    "imported_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"      TIMESTAMPTZ NOT NULL,
    "created_by"      UUID NOT NULL,
    "source"          VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "bank_imports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bank_imports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bank_imports_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "bank_imports_period_check" CHECK ("period_from" IS NULL OR "period_to" IS NULL OR "period_to" >= "period_from"),
    CONSTRAINT "bank_imports_counts_check" CHECK ("record_count" >= 0 AND "imported_count" >= 0 AND "duplicate_count" >= 0 AND "error_count" >= 0)
);
CREATE INDEX "bank_imports_tenant_id_bank_account_id_idx" ON "bank_imports"("tenant_id", "bank_account_id");
CREATE INDEX "bank_imports_tenant_id_imported_at_idx" ON "bank_imports"("tenant_id", "imported_at" DESC);

-- ============================================================================
-- bank_transactions
-- ============================================================================
CREATE TABLE "bank_transactions" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"          UUID NOT NULL,
    "bank_account_id"    UUID NOT NULL,
    "bank_import_id"     UUID NOT NULL,
    "booking_date"       DATE NOT NULL,
    "amount"             DECIMAL(15,2) NOT NULL,
    "currency"           CHAR(3) NOT NULL,
    "balance"            DECIMAL(15,2),
    "sender"             TEXT,
    "recipient"          TEXT,
    "name"               TEXT,
    "additional_details" TEXT,
    "message"            TEXT,
    "own_notes"          TEXT,
    "description"        TEXT NOT NULL,
    "reference"          TEXT,
    "counterparty_key"   TEXT NOT NULL,
    "dedup_hash"         CHAR(64) NOT NULL,
    "occurrence"         INTEGER NOT NULL DEFAULT 0,
    "row_index"          INTEGER NOT NULL,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "created_by"         UUID NOT NULL,
    "source"             VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bank_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bank_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "bank_transactions_bank_import_id_fkey" FOREIGN KEY ("bank_import_id") REFERENCES "bank_imports"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "bank_transactions_currency_upper_check" CHECK ("currency" = upper("currency")),
    CONSTRAINT "bank_transactions_occurrence_check" CHECK ("occurrence" >= 0),
    CONSTRAINT "bank_transactions_row_index_check" CHECK ("row_index" >= 0)
);
CREATE UNIQUE INDEX "bank_transactions_account_hash_occurrence_key" ON "bank_transactions"("bank_account_id", "dedup_hash", "occurrence");
CREATE INDEX "bank_transactions_tenant_id_booking_date_idx" ON "bank_transactions"("tenant_id", "booking_date" DESC);
CREATE INDEX "bank_transactions_tenant_id_bank_account_id_booking_date_idx" ON "bank_transactions"("tenant_id", "bank_account_id", "booking_date");
CREATE INDEX "bank_transactions_tenant_id_counterparty_key_idx" ON "bank_transactions"("tenant_id", "counterparty_key");
CREATE INDEX "bank_transactions_tenant_id_bank_import_id_idx" ON "bank_transactions"("tenant_id", "bank_import_id");

-- A transaction is what the bank said. No route updates it (constitution §1).
CREATE OR REPLACE FUNCTION bank_transactions_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'bank_transaction_immutable' USING ERRCODE = 'P0001',
        DETAIL = format('bank transaction %s is immutable', OLD."id");
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER bank_transactions_immutable
    BEFORE UPDATE ON "bank_transactions"
    FOR EACH ROW EXECUTE FUNCTION bank_transactions_immutable();

CREATE TRIGGER bank_transactions_block_delete_when_linked
    BEFORE DELETE ON "bank_transactions"
    FOR EACH ROW EXECUTE FUNCTION block_delete_when_linked('bank_transaction');

-- ============================================================================
-- categorisation_rules
-- ============================================================================
CREATE TYPE "rule_match_type" AS ENUM ('contains', 'starts_with', 'ends_with', 'exact', 'regex');
CREATE TYPE "rule_match_field" AS ENUM ('counterparty_key', 'name', 'details', 'message', 'sender', 'recipient', 'all');
CREATE TYPE "rule_source" AS ENUM ('manual', 'learned');

CREATE TABLE "categorisation_rules" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"          UUID NOT NULL,
    "name"               VARCHAR(200) NOT NULL,
    "description"        VARCHAR(500),
    "match_type"         "rule_match_type" NOT NULL,
    "match_pattern"      VARCHAR(500) NOT NULL,
    "match_field"        "rule_match_field" NOT NULL DEFAULT 'counterparty_key',
    "bas_code"           VARCHAR(4),
    "partner_id"         UUID,
    "no_document_needed" BOOLEAN NOT NULL DEFAULT false,
    "priority"           INTEGER NOT NULL DEFAULT 100,
    "is_active"          BOOLEAN NOT NULL DEFAULT true,
    "rule_source"        "rule_source" NOT NULL DEFAULT 'manual',
    "hit_count"          INTEGER NOT NULL DEFAULT 0,
    "last_hit_at"        TIMESTAMPTZ,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"         TIMESTAMPTZ NOT NULL,
    "created_by"         UUID NOT NULL,
    "source"             VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "categorisation_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "categorisation_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "categorisation_rules_priority_check" CHECK ("priority" >= 0 AND "priority" <= 999),
    CONSTRAINT "categorisation_rules_pattern_check" CHECK (length("match_pattern") > 0),
    CONSTRAINT "categorisation_rules_sets_something_check" CHECK ("bas_code" IS NOT NULL OR "partner_id" IS NOT NULL OR "no_document_needed")
);
CREATE UNIQUE INDEX "categorisation_rules_tenant_name_key" ON "categorisation_rules"("tenant_id", "name");
CREATE INDEX "categorisation_rules_tenant_id_is_active_priority_idx" ON "categorisation_rules"("tenant_id", "is_active", "priority" DESC);

-- ============================================================================
-- journal_entries
-- ============================================================================
CREATE TYPE "journal_source" AS ENUM ('bank_transaction', 'manual');
CREATE TYPE "journal_categorised_by" AS ENUM ('manual', 'rule', 'partner_default');

CREATE TABLE "journal_entries" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"          UUID NOT NULL,
    "source_type"        "journal_source" NOT NULL,
    "source_id"          UUID,
    "entry_date"         DATE NOT NULL,
    "description"        TEXT NOT NULL,
    "counterparty_key"   TEXT,
    "amount"             DECIMAL(15,2) NOT NULL,
    "currency"           CHAR(3) NOT NULL,
    "amount_base"        DECIMAL(15,2) NOT NULL,
    "rate"               DECIMAL(18,6) NOT NULL,
    "rate_source"        VARCHAR(20) NOT NULL,
    "rate_date"          DATE,
    "bank_implicit_rate" DECIMAL(18,6),
    "bas_code"           VARCHAR(4),
    "partner_id"         UUID,
    "note"               TEXT,
    "no_document_needed" BOOLEAN NOT NULL DEFAULT false,
    "categorised_by"     "journal_categorised_by",
    "rule_id"            UUID,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"         TIMESTAMPTZ NOT NULL,
    "created_by"         UUID NOT NULL,
    "source"             VARCHAR(20) NOT NULL DEFAULT 'web',

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "journal_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "journal_entries_source_check" CHECK (("source_type" = 'manual') = ("source_id" IS NULL)),
    CONSTRAINT "journal_entries_rate_positive_check" CHECK ("rate" > 0),
    CONSTRAINT "journal_entries_implicit_rate_positive_check" CHECK ("bank_implicit_rate" IS NULL OR "bank_implicit_rate" > 0),
    CONSTRAINT "journal_entries_currency_upper_check" CHECK ("currency" = upper("currency")),
    CONSTRAINT "journal_entries_rate_source_check" CHECK ("rate_source" IN ('same_currency', 'ecb_daily', 'ecb_nearest', 'manual'))
);
-- one entry per source; manual entries have no source
CREATE UNIQUE INDEX "journal_entries_tenant_source_key" ON "journal_entries"("tenant_id", "source_type", "source_id") WHERE "source_id" IS NOT NULL;
CREATE INDEX "journal_entries_tenant_id_entry_date_idx" ON "journal_entries"("tenant_id", "entry_date" DESC);
CREATE INDEX "journal_entries_tenant_id_bas_code_idx" ON "journal_entries"("tenant_id", "bas_code");
CREATE INDEX "journal_entries_tenant_id_partner_id_idx" ON "journal_entries"("tenant_id", "partner_id");
CREATE INDEX "journal_entries_tenant_id_categorised_by_idx" ON "journal_entries"("tenant_id", "categorised_by");

-- The money facts are written once (constitution §1, D3). The owner's facts (bas_code, partner_id, note,
-- no_document_needed, categorised_by, rule_id) change freely; bank_implicit_rate may be set once (NULL → value).
CREATE OR REPLACE FUNCTION journal_entries_lock_money() RETURNS trigger AS $$
BEGIN
    IF NEW."amount" IS DISTINCT FROM OLD."amount"
       OR NEW."currency" IS DISTINCT FROM OLD."currency"
       OR NEW."amount_base" IS DISTINCT FROM OLD."amount_base"
       OR NEW."rate" IS DISTINCT FROM OLD."rate"
       OR NEW."rate_source" IS DISTINCT FROM OLD."rate_source"
       OR NEW."rate_date" IS DISTINCT FROM OLD."rate_date"
       OR NEW."entry_date" IS DISTINCT FROM OLD."entry_date"
       OR NEW."source_type" IS DISTINCT FROM OLD."source_type"
       OR NEW."source_id" IS DISTINCT FROM OLD."source_id"
       OR NEW."description" IS DISTINCT FROM OLD."description"
       OR NEW."counterparty_key" IS DISTINCT FROM OLD."counterparty_key"
       OR (OLD."bank_implicit_rate" IS NOT NULL AND NEW."bank_implicit_rate" IS DISTINCT FROM OLD."bank_implicit_rate")
    THEN
        RAISE EXCEPTION 'journal_entry_locked' USING ERRCODE = 'P0001',
            DETAIL = format('journal entry %s: money facts are written once', OLD."id");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER journal_entries_lock_money
    BEFORE UPDATE ON "journal_entries"
    FOR EACH ROW EXECUTE FUNCTION journal_entries_lock_money();

CREATE TRIGGER journal_entries_block_delete_when_linked
    BEFORE DELETE ON "journal_entries"
    FOR EACH ROW EXECUTE FUNCTION block_delete_when_linked('journal_entry');

-- ============================================================================
-- RLS + grants
-- ============================================================================
ALTER TABLE "bank_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_imports" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bank_imports"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "bank_imports" TO af_app;

ALTER TABLE "bank_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_transactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bank_transactions"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
-- no UPDATE grant: the trigger refuses it anyway, the grant makes the intent visible
GRANT SELECT, INSERT, DELETE ON TABLE "bank_transactions" TO af_app;

ALTER TABLE "categorisation_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categorisation_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "categorisation_rules"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "categorisation_rules" TO af_app;

ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "journal_entries"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "journal_entries" TO af_app;
