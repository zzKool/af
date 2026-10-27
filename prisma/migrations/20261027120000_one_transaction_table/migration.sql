-- One transaction table (F113, D59 — specs/banking/one-table.md, PR A).
-- The bank row carries its own facts: the SEK base and rate (written once) and the owner's facts (BAS, partner,
-- note, no document needed, categorised_by, rule_id). Every bank-sourced journal entry is copied onto its row,
-- every link from a journal entry is re-pointed to the row. `journal_entries` stays, read by nothing, until PR B.
-- Refuses to run while a manual journal entry exists (D59: periodisation is the accountant's, D1).

-- ----------------------------------------------------------------------------
-- 0. the guard: no manual entries
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    manual_list text;
BEGIN
    SELECT string_agg(format('%s %s (%s)', entry_date, left(description, 40), currency || ' ' || amount), '; ' ORDER BY entry_date)
      INTO manual_list
      FROM "journal_entries" WHERE "source_type" = 'manual';
    IF manual_list IS NOT NULL THEN
        RAISE EXCEPTION 'one_transaction_table: manual journal entries exist — delete them first (D59): %', manual_list
            USING ERRCODE = 'P0001';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. partners: the target of composite (tenant_id, id) foreign keys (D63)
-- ----------------------------------------------------------------------------
ALTER TABLE "partners" ADD CONSTRAINT "partners_tenant_id_id_key" UNIQUE ("tenant_id", "id");

-- ----------------------------------------------------------------------------
-- 2. the columns (nullable first — the copy fills them, then NOT NULL)
-- ----------------------------------------------------------------------------
ALTER TABLE "bank_transactions"
    ADD COLUMN "amount_base"        DECIMAL(15, 2),
    ADD COLUMN "rate"               DECIMAL(18, 6),
    ADD COLUMN "rate_source"        "rate_source",
    ADD COLUMN "rate_date"          DATE,
    ADD COLUMN "bas_code"           VARCHAR(4),
    ADD COLUMN "partner_id"         UUID,
    ADD COLUMN "note"               TEXT,
    ADD COLUMN "no_document_needed" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "categorised_by"     "journal_categorised_by",
    ADD COLUMN "rule_id"            UUID,
    ADD COLUMN "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now();

-- ----------------------------------------------------------------------------
-- 3. the copy: every bank-sourced entry onto its row (the immutability trigger is replaced below; disable it here)
-- ----------------------------------------------------------------------------
ALTER TABLE "bank_transactions" DISABLE TRIGGER "bank_transactions_immutable";
UPDATE "bank_transactions" t
   SET "amount_base"        = e."amount_base",
       "rate"               = e."rate",
       "rate_source"        = e."rate_source",
       "rate_date"          = e."rate_date",
       "bas_code"           = e."bas_code",
       "partner_id"         = e."partner_id",
       "note"               = e."note",
       "no_document_needed" = e."no_document_needed",
       "categorised_by"     = e."categorised_by",
       "rule_id"            = e."rule_id",
       "updated_at"         = e."updated_at"
  FROM "journal_entries" e
 WHERE e."source_type" = 'bank_transaction'
   AND e."source_id"   = t."id"
   AND e."tenant_id"   = t."tenant_id";

-- a row without an entry would have no base: none is expected (the import wrote both in one transaction)
DO $$
DECLARE
    missing int;
BEGIN
    SELECT count(*) INTO missing FROM "bank_transactions" WHERE "amount_base" IS NULL;
    IF missing > 0 THEN
        RAISE EXCEPTION 'one_transaction_table: % bank transaction(s) have no journal entry — nothing changed', missing
            USING ERRCODE = 'P0001';
    END IF;
END $$;

ALTER TABLE "bank_transactions"
    ALTER COLUMN "amount_base" SET NOT NULL,
    ALTER COLUMN "rate"        SET NOT NULL,
    ALTER COLUMN "rate_source" SET NOT NULL,
    ADD CONSTRAINT "bank_transactions_rate_source_check" CHECK ("rate_source" <> 'bank'),
    ADD CONSTRAINT "bank_transactions_tenant_id_partner_id_fkey"
        FOREIGN KEY ("tenant_id", "partner_id") REFERENCES "partners"("tenant_id", "id")
        ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE INDEX "bank_transactions_tenant_id_bas_code_idx"       ON "bank_transactions"("tenant_id", "bas_code");
CREATE INDEX "bank_transactions_tenant_id_partner_id_idx"     ON "bank_transactions"("tenant_id", "partner_id");
CREATE INDEX "bank_transactions_tenant_id_categorised_by_idx" ON "bank_transactions"("tenant_id", "categorised_by");

-- ----------------------------------------------------------------------------
-- 4. the links: from a journal entry → from its row; a duplicate of an existing row link is the same fact, dropped
-- ----------------------------------------------------------------------------
DELETE FROM "links" l
 USING "journal_entries" e
 WHERE l."from_type" = 'journal_entry' AND l."from_id" = e."id" AND e."source_type" = 'bank_transaction'
   AND EXISTS (
       SELECT 1 FROM "links" x
        WHERE x."tenant_id" = l."tenant_id" AND x."from_type" = 'bank_transaction' AND x."from_id" = e."source_id"
          AND x."to_type" = l."to_type" AND x."to_id" = l."to_id" AND x."kind" = l."kind");
UPDATE "links" l
   SET "from_type" = 'bank_transaction', "from_id" = e."source_id"
  FROM "journal_entries" e
 WHERE l."from_type" = 'journal_entry' AND l."from_id" = e."id" AND e."source_type" = 'bank_transaction';
DO $$
DECLARE
    leftover int;
BEGIN
    SELECT count(*) INTO leftover FROM "links" WHERE "from_type" = 'journal_entry' OR "to_type" = 'journal_entry';
    IF leftover > 0 THEN
        RAISE EXCEPTION 'one_transaction_table: % link(s) still point at a journal entry', leftover USING ERRCODE = 'P0001';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. the lock: the bank's facts and the base are written once; the owner's facts change freely
-- ----------------------------------------------------------------------------
DROP TRIGGER "bank_transactions_immutable" ON "bank_transactions";
DROP FUNCTION bank_transactions_immutable();
CREATE OR REPLACE FUNCTION bank_transactions_lock_facts() RETURNS trigger AS $$
BEGIN
    IF NEW."bank_account_id"    IS DISTINCT FROM OLD."bank_account_id"
       OR NEW."bank_import_id"  IS DISTINCT FROM OLD."bank_import_id"
       OR NEW."booking_date"    IS DISTINCT FROM OLD."booking_date"
       OR NEW."amount"          IS DISTINCT FROM OLD."amount"
       OR NEW."currency"        IS DISTINCT FROM OLD."currency"
       OR NEW."balance"         IS DISTINCT FROM OLD."balance"
       OR NEW."sender"          IS DISTINCT FROM OLD."sender"
       OR NEW."recipient"       IS DISTINCT FROM OLD."recipient"
       OR NEW."name"            IS DISTINCT FROM OLD."name"
       OR NEW."additional_details" IS DISTINCT FROM OLD."additional_details"
       OR NEW."message"         IS DISTINCT FROM OLD."message"
       OR NEW."own_notes"       IS DISTINCT FROM OLD."own_notes"
       OR NEW."description"     IS DISTINCT FROM OLD."description"
       OR NEW."reference"       IS DISTINCT FROM OLD."reference"
       OR NEW."counterparty_key" IS DISTINCT FROM OLD."counterparty_key"
       OR NEW."dedup_hash"      IS DISTINCT FROM OLD."dedup_hash"
       OR NEW."occurrence"      IS DISTINCT FROM OLD."occurrence"
       OR NEW."row_index"       IS DISTINCT FROM OLD."row_index"
       OR NEW."source"          IS DISTINCT FROM OLD."source"
       OR NEW."amount_base"     IS DISTINCT FROM OLD."amount_base"
       OR NEW."rate"            IS DISTINCT FROM OLD."rate"
       OR NEW."rate_source"     IS DISTINCT FROM OLD."rate_source"
       OR NEW."rate_date"       IS DISTINCT FROM OLD."rate_date"
       OR NEW."created_at"      IS DISTINCT FROM OLD."created_at"
       OR NEW."created_by"      IS DISTINCT FROM OLD."created_by"
       OR NEW."tenant_id"       IS DISTINCT FROM OLD."tenant_id"
    THEN
        RAISE EXCEPTION 'bank_transaction_locked' USING ERRCODE = 'P0001',
            DETAIL = format('bank transaction %s: the bank''s facts and the base are written once', OLD."id");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER bank_transactions_lock_facts
    BEFORE UPDATE ON "bank_transactions"
    FOR EACH ROW EXECUTE FUNCTION bank_transactions_lock_facts();

-- ----------------------------------------------------------------------------
-- 6. the History: the entries' categorisation trail appended onto the rows' own (audit rows are append-only;
--    the old journal_entry rows stay as they are). Creates are not copied: the import is the row's own create.
-- ----------------------------------------------------------------------------
INSERT INTO "audit_logs" ("tenant_id", "user_id", "action", "entity_type", "entity_id", "old_data", "new_data", "source", "created_at")
SELECT a."tenant_id", a."user_id", a."action", 'bank_transaction', e."source_id"::text, a."old_data", a."new_data", a."source", a."created_at"
  FROM "audit_logs" a
  JOIN "journal_entries" e ON e."id"::text = a."entity_id" AND e."tenant_id" = a."tenant_id"
 WHERE a."entity_type" = 'journal_entry' AND a."action" = 'update' AND e."source_type" = 'bank_transaction';

-- journal_entries keeps its rows, read by nothing, as a safety net until PR B drops it (D65). Its own lock and
-- RLS stay as they are.
