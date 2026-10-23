-- F86 (D48, the owner's OK 2026-10-23): drop the two columns nothing reads any more. Forward-only; no real data
-- is in the app yet (B1 not started), so nothing is lost.
--   settlements.statement_superseded    — derived since F62 (`isStatementSuperseded`: cancelled + a statement)
--   journal_entries.bank_implicit_rate  — derived from the `transfer` link since journal T005 (`withImplicitRates`)
-- The lock function drops its set-once clause first, so no UPDATE ever runs against a missing column; the CHECK
-- `journal_entries_implicit_rate_positive_check` goes with its column.

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
    THEN
        RAISE EXCEPTION 'journal_entry_locked' USING ERRCODE = 'P0001',
            DETAIL = format('journal entry %s: money facts are written once', OLD."id");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "journal_entries" DROP COLUMN "bank_implicit_rate";

ALTER TABLE "settlements" DROP COLUMN "statement_superseded";
